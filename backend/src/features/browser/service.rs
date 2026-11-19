use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::{broadcast, mpsc, oneshot};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;

use crate::errors::{internal, AppError, AppResult};

const VIEWPORT_WIDTH: u32 = 1280;
const VIEWPORT_HEIGHT: u32 = 800;
const FRAME_QUALITY: u8 = 55;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserFrame {
    pub data: String,
    pub width: u32,
    pub height: u32,
    pub url: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BrowserInfo {
    pub id: String,
    pub project_id: String,
    pub page_url: String,
    pub ws_url: String,
}

struct CommandRequest {
    method: String,
    params: Value,
    reply: oneshot::Sender<Result<Value, String>>,
}

pub struct BrowserManager {
    data_dir: PathBuf,
    sessions: Mutex<HashMap<String, Arc<BrowserSession>>>,
}

pub struct BrowserSession {
    pub id: String,
    pub project_id: String,
    page_url: Arc<Mutex<String>>,
    command_tx: mpsc::Sender<CommandRequest>,
    frames: broadcast::Sender<BrowserFrame>,
    latest: Arc<Mutex<Option<BrowserFrame>>>,
    console: Arc<Mutex<Vec<Value>>>,
    network: Arc<Mutex<Vec<Value>>>,
    streaming: AtomicBool,
    pub clients: AtomicUsize,
    closed: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl BrowserManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, project_id: &str) -> Option<Arc<BrowserSession>> {
        self.sessions.lock().ok()?.get(project_id).cloned()
    }

    pub async fn session(&self, project_id: &str, root: &Path) -> AppResult<Arc<BrowserSession>> {
        if let Some(session) = self.get(project_id) {
            if !session.closed.load(Ordering::SeqCst) {
                return Ok(session);
            }
            self.close_project(project_id).await;
        }
        let session = launch(project_id, root, &self.data_dir).await?;
        let mut sessions = self
            .sessions
            .lock()
            .map_err(|_| internal("browser lock"))?;
        if let Some(existing) = sessions.get(project_id) {
            if !existing.closed.load(Ordering::SeqCst) {
                session.close_now();
                return Ok(existing.clone());
            }
        }
        sessions.insert(project_id.to_string(), session.clone());
        Ok(session)
    }

    pub async fn close_project(&self, project_id: &str) {
        let session = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(project_id));
        if let Some(session) = session {
            session.close().await;
        }
    }

    pub async fn close_all(&self) {
        let sessions: Vec<Arc<BrowserSession>> = self
            .sessions
            .lock()
            .ok()
            .map(|sessions| sessions.values().cloned().collect())
            .unwrap_or_default();
        for session in sessions {
            session.close().await;
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }

    pub fn close_all_now(&self) {
        let sessions: Vec<Arc<BrowserSession>> = self
            .sessions
            .lock()
            .ok()
            .map(|sessions| sessions.values().cloned().collect())
            .unwrap_or_default();
        for session in sessions {
            session.close_now();
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }
}

impl BrowserSession {
    pub fn info(&self) -> BrowserInfo {
        BrowserInfo {
            id: self.id.clone(),
            project_id: self.project_id.clone(),
            page_url: self
                .page_url
                .lock()
                .map(|url| url.clone())
                .unwrap_or_default(),
            ws_url: format!(
                "/api/projects/{}/debug/browser/ws",
                urlencoding(&self.project_id)
            ),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<BrowserFrame> {
        self.frames.subscribe()
    }

    pub fn latest_frame(&self) -> Option<BrowserFrame> {
        self.latest.lock().ok().and_then(|frame| frame.clone())
    }

    pub async fn start_streaming(&self) -> Result<(), String> {
        if self.streaming.swap(true, Ordering::SeqCst) {
            return Ok(());
        }
        let result = self
            .command(
                "Page.startScreencast",
                json!({
                    "format": "jpeg",
                    "quality": FRAME_QUALITY,
                    "maxWidth": VIEWPORT_WIDTH,
                    "maxHeight": VIEWPORT_HEIGHT,
                    "everyNthFrame": 2
                }),
            )
            .await;
        if result.is_err() {
            self.streaming.store(false, Ordering::SeqCst);
        }
        result.map(|_| ())
    }

    pub async fn stop_streaming(&self) {
        if !self.streaming.swap(false, Ordering::SeqCst) {
            return;
        }
        let _ = self.command("Page.stopScreencast", json!({})).await;
    }

    pub async fn command(&self, method: &str, params: Value) -> Result<Value, String> {
        if self.closed.load(Ordering::SeqCst) {
            return Err("O navegador de debug foi encerrado.".into());
        }
        let (reply, answer) = oneshot::channel();
        self.command_tx
            .send(CommandRequest {
                method: method.to_string(),
                params,
                reply,
            })
            .await
            .map_err(|_| "O navegador de debug não está disponível.".to_string())?;
        match tokio::time::timeout(Duration::from_secs(15), answer).await {
            Ok(Ok(result)) => result,
            Ok(Err(_)) => Err("O navegador de debug encerrou a conexão.".into()),
            Err(_) => Err(format!("O navegador não respondeu a {method}.")),
        }
    }

    pub async fn open(&self, url: &str) -> AppResult<Value> {
        let parsed = reqwest::Url::parse(url.trim())
            .map_err(|_| AppError::BadRequest("URL do navegador inválida.".into()))?;
        if !matches!(parsed.scheme(), "http" | "https") {
            return Err(AppError::BadRequest(
                "O navegador de debug só abre http ou https.".into(),
            ));
        }
        self.command("Page.navigate", json!({ "url": parsed.as_str() }))
            .await
            .map_err(|error| AppError::Upstream(error))?;
        if let Ok(mut page_url) = self.page_url.lock() {
            *page_url = parsed.to_string();
        }
        tokio::time::sleep(Duration::from_millis(600)).await;
        self.read().await
    }

    pub async fn click(&self, selector: Option<&str>, x: Option<f64>, y: Option<f64>) -> AppResult<Value> {
        let (x, y) = if let Some(selector) = selector.filter(|value| !value.trim().is_empty()) {
            let expression = format!(
                "(() => {{ const el = document.querySelector({}); if (!el) return null; el.scrollIntoView({{block:'center'}}); const r = el.getBoundingClientRect(); return {{x:r.left+r.width/2,y:r.top+r.height/2}}; }})()",
                serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".into())
            );
            let result = self
                .command("Runtime.evaluate", json!({"expression": expression, "returnByValue": true}))
                .await
                .map_err(AppError::Upstream)?;
            let value = &result["result"]["result"]["value"];
            (
                value["x"].as_f64().ok_or_else(|| {
                    AppError::BadRequest(format!("Nenhum elemento encontrado para {selector}."))
                })?,
                value["y"].as_f64().ok_or_else(|| {
                    AppError::BadRequest(format!("Nenhum elemento encontrado para {selector}."))
                })?,
            )
        } else {
            (
                x.ok_or_else(|| AppError::BadRequest("Informe o seletor ou x/y.".into()))?,
                y.ok_or_else(|| AppError::BadRequest("Informe o seletor ou x/y.".into()))?,
            )
        };
        self.mouse_click(x, y).await?;
        Ok(json!({ "ok": true, "x": x, "y": y }))
    }

    pub async fn mouse_click(&self, x: f64, y: f64) -> AppResult<()> {
        let base = json!({
            "x": x,
            "y": y,
            "button": "left",
            "buttons": 1,
            "clickCount": 1
        });
        let mut pressed = base.clone();
        pressed["type"] = json!("mousePressed");
        self.command("Input.dispatchMouseEvent", pressed)
            .await
            .map_err(AppError::Upstream)?;
        let mut released = base;
        released["type"] = json!("mouseReleased");
        released["buttons"] = json!(0);
        self.command("Input.dispatchMouseEvent", released)
            .await
            .map_err(AppError::Upstream)?;
        Ok(())
    }

    pub async fn mouse_move(&self, x: f64, y: f64) -> AppResult<()> {
        self.command(
            "Input.dispatchMouseEvent",
            json!({"type":"mouseMoved","x":x,"y":y,"button":"none","buttons":0}),
        )
        .await
        .map_err(AppError::Upstream)?;
        Ok(())
    }

    pub async fn scroll(&self, x: f64, y: f64, delta_y: f64) -> AppResult<()> {
        self.command(
            "Input.dispatchMouseEvent",
            json!({"type":"mouseWheel","x":x,"y":y,"deltaX":0,"deltaY":delta_y}),
        )
        .await
        .map_err(AppError::Upstream)?;
        Ok(())
    }

    pub async fn type_text(&self, text: &str, selector: Option<&str>) -> AppResult<Value> {
        if let Some(selector) = selector.filter(|value| !value.trim().is_empty()) {
            self.click(Some(selector), None, None).await?;
        }
        self.command("Input.insertText", json!({ "text": text }))
            .await
            .map_err(AppError::Upstream)?;
        Ok(json!({ "ok": true, "typed": text.chars().count() }))
    }

    pub async fn press(&self, key: &str) -> AppResult<Value> {
        let (code, vk, text) = key_fields(key);
        let event = json!({
            "type": "keyDown",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk,
            "text": text
        });
        self.command("Input.dispatchKeyEvent", event)
            .await
            .map_err(AppError::Upstream)?;
        let mut up = json!({
            "type": "keyUp",
            "key": key,
            "code": code,
            "windowsVirtualKeyCode": vk,
            "nativeVirtualKeyCode": vk
        });
        up["text"] = json!("");
        self.command("Input.dispatchKeyEvent", up)
            .await
            .map_err(AppError::Upstream)?;
        Ok(json!({ "ok": true, "key": key }))
    }

    pub async fn reload(&self) -> AppResult<Value> {
        self.command("Page.reload", json!({ "ignoreCache": true }))
            .await
            .map_err(AppError::Upstream)?;
        tokio::time::sleep(Duration::from_millis(400)).await;
        self.read().await
    }

    pub async fn history(&self, direction: &str) -> AppResult<Value> {
        let result = self
            .command("Page.getNavigationHistory", json!({}))
            .await
            .map_err(AppError::Upstream)?;
        let current = result["result"]["currentIndex"].as_i64().unwrap_or(0);
        let entries = result["result"]["entries"]
            .as_array()
            .cloned()
            .unwrap_or_default();
        let index = if direction == "forward" { current + 1 } else { current - 1 };
        let Some(entry) = usize::try_from(index).ok().and_then(|index| entries.get(index)) else {
            return Ok(json!({ "ok": false, "reason": "Sem histórico nessa direção." }));
        };
        let entry_id = entry["id"].clone();
        self.command(
            "Page.navigateToHistoryEntry",
            json!({ "entryId": entry_id }),
        )
        .await
        .map_err(AppError::Upstream)?;
        tokio::time::sleep(Duration::from_millis(400)).await;
        self.read().await
    }

    pub async fn read(&self) -> AppResult<Value> {
        let result = self
            .command(
                "Runtime.evaluate",
                json!({
                    "expression": "JSON.stringify({title: document.title, url: location.href, text: (document.body && document.body.innerText || '').slice(0, 16000)})",
                    "returnByValue": true
                }),
            )
            .await
            .map_err(AppError::Upstream)?;
        let page_text = result["result"]["result"]["value"]
            .as_str()
            .unwrap_or("{}");
        let page: Value = serde_json::from_str(page_text).unwrap_or_else(|_| json!({}));
        if let Some(url) = page["url"].as_str() {
            if let Ok(mut page_url) = self.page_url.lock() {
                *page_url = url.to_string();
            }
        }
        let console = self
            .console
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default();
        let network = self
            .network
            .lock()
            .map(|items| items.clone())
            .unwrap_or_default();
        Ok(json!({
            "page": page,
            "console": console,
            "network": network,
        }))
    }

    pub async fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        let _ = self
            .command("Page.stopScreencast", json!({}))
            .await;
        self.close_now();
    }

    pub fn close_now(&self) {
        self.closed.store(true, Ordering::SeqCst);
        if let Ok(mut child) = self.child.lock() {
            if let Some(mut child) = child.take() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }
}

async fn launch(project_id: &str, root: &Path, data_dir: &Path) -> AppResult<Arc<BrowserSession>> {
    let binary = chromium_binary().ok_or_else(|| {
        AppError::ServiceUnavailable(
            "Chromium não encontrado no servidor; defina JEFF_CHROMIUM com o caminho do binário."
                .into(),
        )
    })?;
    let user_data = data_dir.join("browser").join(project_id);
    std::fs::create_dir_all(&user_data)?;
    for name in [
        "SingletonLock",
        "SingletonCookie",
        "SingletonSocket",
        "DevToolsActivePort",
    ] {
        let _ = std::fs::remove_file(user_data.join(name));
    }

    let mut child = Command::new(&binary)
        .arg("--headless=new")
        .arg("--no-sandbox")
        .arg("--disable-gpu")
        .arg("--disable-dev-shm-usage")
        .arg("--disable-background-networking")
        .arg("--disable-extensions")
        .arg("--disable-sync")
        .arg("--hide-scrollbars")
        .arg("--mute-audio")
        .arg("--no-first-run")
        .arg("--no-default-browser-check")
        .arg("--force-device-scale-factor=1")
        .arg(format!("--window-size={VIEWPORT_WIDTH},{VIEWPORT_HEIGHT}"))
        .arg("--remote-debugging-address=127.0.0.1")
        .arg("--remote-debugging-port=0")
        .arg(format!("--user-data-dir={}", user_data.display()))
        .arg("about:blank")
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;

    let port_file = user_data.join("DevToolsActivePort");
    let mut devtools_port = 0u16;
    for _ in 0..150 {
        if let Ok(text) = std::fs::read_to_string(&port_file) {
            if let Some(port) = text.lines().next().and_then(|line| line.trim().parse::<u16>().ok()) {
                devtools_port = port;
                break;
            }
        }
        if let Some(status) = child.try_wait()? {
            return Err(AppError::ServiceUnavailable(format!(
                "O Chromium encerrou ao iniciar ({status})."
            )));
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if devtools_port == 0 {
        let _ = child.kill();
        let _ = child.wait();
        return Err(AppError::ServiceUnavailable(
            "O Chromium não abriu a porta de depuração.".into(),
        ));
    }

    let client = reqwest::Client::new();
    let mut ws_url = String::new();
    for _ in 0..50 {
        let list_url = format!("http://127.0.0.1:{devtools_port}/json/list");
        if let Ok(response) = client.get(&list_url).send().await {
            if let Ok(list) = response.json::<Value>().await {
                if let Some(url) = list
                    .as_array()
                    .and_then(|items| {
                        items.iter().find(|item| {
                            item["type"].as_str() == Some("page")
                                && item["webSocketDebuggerUrl"].as_str().is_some()
                        })
                    })
                    .and_then(|item| item["webSocketDebuggerUrl"].as_str())
                {
                    ws_url = url.to_string();
                    break;
                }
            }
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    if ws_url.is_empty() {
        let _ = child.kill();
        let _ = child.wait();
        return Err(AppError::ServiceUnavailable(
            "O Chromium não expôs uma página depurável.".into(),
        ));
    }

    let (socket, _) = connect_async(&ws_url)
        .await
        .map_err(|error| AppError::ServiceUnavailable(format!("Chromium CDP: {error}")))?;
    let (command_tx, command_rx) = mpsc::channel(64);
    let (frames, _) = broadcast::channel(16);
    let latest = Arc::new(Mutex::new(None));
    let console = Arc::new(Mutex::new(Vec::new()));
    let network = Arc::new(Mutex::new(Vec::new()));
    let page_url = Arc::new(Mutex::new("about:blank".to_string()));
    tokio::spawn(actor(
        socket,
        command_rx,
        frames.clone(),
        latest.clone(),
        console.clone(),
        network.clone(),
        page_url.clone(),
    ));

    let session = Arc::new(BrowserSession {
        id: crate::crypto::new_id(),
        project_id: project_id.to_string(),
        page_url,
        command_tx,
        frames,
        latest,
        console,
        network,
        streaming: AtomicBool::new(false),
        clients: AtomicUsize::new(0),
        closed: AtomicBool::new(false),
        child: Mutex::new(Some(child)),
    });

    for method in ["Page.enable", "Runtime.enable", "Log.enable", "Network.enable"] {
        if let Err(error) = session.command(method, json!({})).await {
            session.close_now();
            return Err(AppError::ServiceUnavailable(format!(
                "Chromium CDP não inicializou ({method}: {error})."
            )));
        }
    }
    Ok(session)
}

async fn actor(
    socket: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
    mut commands: mpsc::Receiver<CommandRequest>,
    frames: broadcast::Sender<BrowserFrame>,
    latest: Arc<Mutex<Option<BrowserFrame>>>,
    console: Arc<Mutex<Vec<Value>>>,
    network: Arc<Mutex<Vec<Value>>>,
    page_url: Arc<Mutex<String>>,
) {
    let (mut write, mut read) = socket.split();
    let mut pending: HashMap<u64, oneshot::Sender<Result<Value, String>>> = HashMap::new();
    let mut next_id = 1u64;
    loop {
        tokio::select! {
            command = commands.recv() => {
                let Some(command) = command else { break };
                let id = next_id;
                next_id += 1;
                let payload = json!({
                    "id": id,
                    "method": command.method,
                    "params": command.params,
                });
                if write.send(Message::Text(payload.to_string().into())).await.is_err() {
                    command.reply.send(Err("O navegador de debug encerrou.".into())).ok();
                    break;
                }
                pending.insert(id, command.reply);
            }
            message = read.next() => {
                match message {
                    Some(Ok(Message::Text(text))) => {
                        let Ok(value) = serde_json::from_str::<Value>(&text) else { continue };
                        if let Some(id) = value.get("id").and_then(Value::as_u64) {
                            if let Some(reply) = pending.remove(&id) {
                                reply.send(Ok(value)).ok();
                            }
                            continue;
                        }
                        let Some(method) = value.get("method").and_then(Value::as_str) else { continue };
                        let params = value.get("params").cloned().unwrap_or(Value::Null);
                        match method {
                            "Page.screencastFrame" => {
                                let session_id = params["sessionId"].as_u64().unwrap_or(0);
                                let ack = json!({
                                    "id": next_id,
                                    "method": "Page.screencastFrameAck",
                                    "params": { "sessionId": session_id },
                                });
                                next_id += 1;
                                let _ = write.send(Message::Text(ack.to_string().into())).await;
                                if let Some(data) = params["data"].as_str() {
                                    let width = params["metadata"]["deviceWidth"]
                                        .as_u64()
                                        .unwrap_or(VIEWPORT_WIDTH as u64) as u32;
                                    let height = params["metadata"]["deviceHeight"]
                                        .as_u64()
                                        .unwrap_or(VIEWPORT_HEIGHT as u64) as u32;
                                    let url = page_url
                                        .lock()
                                        .map(|value| value.clone())
                                        .unwrap_or_default();
                                    let frame = BrowserFrame {
                                        data: data.to_string(),
                                        width,
                                        height,
                                        url,
                                    };
                                    if let Ok(mut latest) = latest.lock() {
                                        *latest = Some(frame.clone());
                                    }
                                    let _ = frames.send(frame);
                                }
                            }
                            "Page.frameNavigated" => {
                                if params["frame"]["parentId"].is_null() {
                                    if let Some(url) = params["frame"]["url"].as_str() {
                                        if let Ok(mut current) = page_url.lock() {
                                            *current = url.to_string();
                                        }
                                    }
                                }
                            }
                            "Runtime.consoleAPICalled" => {
                                let text = console_text(&params);
                                if !text.is_empty() {
                                    push_capped(&console, json!({
                                        "level": params["type"].as_str().unwrap_or("log"),
                                        "text": text,
                                        "at": chrono::Utc::now().timestamp_millis(),
                                    }));
                                }
                            }
                            "Log.entryAdded" => {
                                let entry = &params["entry"];
                                let text = entry["text"].as_str().unwrap_or("").trim();
                                if !text.is_empty() {
                                    push_capped(&console, json!({
                                        "level": entry["level"].as_str().unwrap_or("info"),
                                        "text": text,
                                        "url": entry["url"].as_str().unwrap_or(""),
                                        "at": chrono::Utc::now().timestamp_millis(),
                                    }));
                                }
                            }
                            "Network.responseReceived" => {
                                let response = &params["response"];
                                let url = response["url"].as_str().unwrap_or("");
                                if !url.is_empty() {
                                    push_capped(&network, json!({
                                        "url": url,
                                        "status": response["status"].as_u64().unwrap_or(0),
                                        "type": params["type"].as_str().unwrap_or(""),
                                        "at": chrono::Utc::now().timestamp_millis(),
                                    }));
                                }
                            }
                            "Network.loadingFailed" => {
                                let request_id = params["requestId"].as_str().unwrap_or("");
                                push_capped(&network, json!({
                                    "url": request_id,
                                    "status": 0,
                                    "error": params["errorText"].as_str().unwrap_or(""),
                                    "at": chrono::Utc::now().timestamp_millis(),
                                }));
                            }
                            _ => {}
                        }
                    }
                    Some(Ok(Message::Binary(_))) => {}
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
        }
    }
    for (_, reply) in pending {
        reply.send(Err("O navegador de debug encerrou.".into())).ok();
    }
}

fn push_capped(target: &Arc<Mutex<Vec<Value>>>, value: Value) {
    if let Ok(mut items) = target.lock() {
        items.push(value);
        if items.len() > 200 {
            let excess = items.len() - 200;
            items.drain(0..excess);
        }
    }
}

fn console_text(params: &Value) -> String {
    params["args"]
        .as_array()
        .map(|args| {
            args.iter()
                .filter_map(|arg| {
                    arg["value"]
                        .as_str()
                        .map(str::to_string)
                        .or_else(|| arg["description"].as_str().map(str::to_string))
                        .or_else(|| arg["value"].as_f64().map(|value| value.to_string()))
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .unwrap_or_default()
}

fn key_fields(key: &str) -> (&'static str, u32, &'static str) {
    match key {
        "Enter" => ("Enter", 13, "\r"),
        "Tab" => ("Tab", 9, "\t"),
        "Escape" | "Esc" => ("Escape", 27, ""),
        "Backspace" => ("Backspace", 8, ""),
        "Delete" => ("Delete", 46, ""),
        "ArrowUp" | "Up" => ("ArrowUp", 38, ""),
        "ArrowDown" | "Down" => ("ArrowDown", 40, ""),
        "ArrowLeft" | "Left" => ("ArrowLeft", 37, ""),
        "ArrowRight" | "Right" => ("ArrowRight", 39, ""),
        "Home" => ("Home", 36, ""),
        "End" => ("End", 35, ""),
        "PageUp" => ("PageUp", 33, ""),
        "PageDown" => ("PageDown", 34, ""),
        _ => {
            if key.chars().count() == 1 {
                ("", 0, "")
            } else {
                ("", 0, "")
            }
        }
    }
}

fn chromium_binary() -> Option<PathBuf> {
    if let Ok(value) = std::env::var("JEFF_CHROMIUM") {
        let path = PathBuf::from(value.trim());
        if !value.trim().is_empty() && path.is_file() {
            return Some(path);
        }
    }
    let candidates = [
        "/home/fernando/.local/bin/chromium",
        "/usr/local/bin/chromium",
        "/usr/bin/chromium",
        "/usr/bin/chromium-browser",
        "/usr/bin/google-chrome",
        "/usr/bin/google-chrome-stable",
    ];
    for candidate in candidates {
        let path = PathBuf::from(candidate);
        if path.is_file() {
            return Some(path);
        }
    }
    if let Some(paths) = std::env::var_os("PATH") {
        for directory in std::env::split_paths(&paths) {
            for name in [
                "chromium",
                "chromium-browser",
                "google-chrome",
                "google-chrome-stable",
            ] {
                let path = directory.join(name);
                if path.is_file() {
                    return Some(path);
                }
            }
        }
    }
    None
}

fn urlencoding(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}
