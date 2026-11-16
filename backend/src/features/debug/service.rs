use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use futures_util::{SinkExt, StreamExt};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message as WsMessage;

use crate::crypto::new_id;
use crate::errors::{AppError, AppResult};

const OUTPUT_LIMIT: usize = 256 * 1024;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugStartInput {
    pub language: String,
    pub mode: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub address: String,
    #[serde(default)]
    pub cwd: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DebugSessionInfo {
    pub id: String,
    pub project_id: String,
    pub language: String,
    pub mode: String,
    pub status: String,
    pub ws_url: String,
    pub address: String,
}

pub struct DebugManager {
    sessions: Mutex<HashMap<String, Arc<DebugSession>>>,
}

pub struct DebugSession {
    pub id: String,
    pub project_id: String,
    pub language: String,
    pub mode: String,
    pub inspector_url: Mutex<Option<String>>,
    pub address: String,
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
    output: Mutex<Vec<u8>>,
    output_tx: broadcast::Sender<Vec<u8>>,
    dap_tx: broadcast::Sender<String>,
    last_thread: Mutex<Option<i64>>,
    pub paused: AtomicBool,
    pub clients: AtomicUsize,
    last_disconnect: Mutex<Instant>,
    closed: AtomicBool,
}

impl DebugManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }

    pub fn get(&self, project_id: &str) -> Option<Arc<DebugSession>> {
        self.sessions.lock().ok()?.get(project_id).cloned()
    }

    pub async fn start(
        &self,
        project_id: &str,
        root: &Path,
        input: DebugStartInput,
    ) -> AppResult<Arc<DebugSession>> {
        self.stop(project_id).await;
        let language = match input.language.as_str() {
            "node" | "python" => input.language.clone(),
            _ => {
                return Err(AppError::BadRequest(
                    "debug language must be node or python".into(),
                ))
            }
        };
        let mode = match input.mode.as_str() {
            "launch" | "attach" => input.mode.clone(),
            _ => {
                return Err(AppError::BadRequest(
                    "debug mode must be launch or attach".into(),
                ))
            }
        };
        let cwd = if input.cwd.trim().is_empty() {
            root.to_path_buf()
        } else {
            let raw = PathBuf::from(input.cwd.trim());
            let candidate = if raw.is_absolute() {
                raw
            } else {
                root.join(raw)
            };
            candidate
                .canonicalize()
                .map_err(|_| AppError::BadRequest("debug cwd does not exist".into()))?
        };
        if !cwd.starts_with(root) {
            return Err(AppError::Forbidden);
        }

        let session = if language == "node" {
            start_node(project_id, &cwd, &mode, &input).await?
        } else {
            start_python(project_id, &cwd, &mode, &input)?
        };
        self.sessions
            .lock()
            .map_err(|_| crate::errors::internal("debug lock"))?
            .insert(project_id.to_string(), session.clone());
        Ok(session)
    }

    pub async fn stop(&self, project_id: &str) {
        let session = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(project_id));
        if let Some(session) = session {
            session.resume().await;
            session.close();
        }
    }

    pub async fn close_project(&self, project_id: &str) {
        self.stop(project_id).await;
    }

    pub fn close_all_now(&self) {
        let sessions: Vec<Arc<DebugSession>> = self
            .sessions
            .lock()
            .ok()
            .map(|sessions| sessions.values().cloned().collect())
            .unwrap_or_default();
        for session in &sessions {
            session.close();
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }

    pub async fn close_all(&self) {
        let sessions: Vec<Arc<DebugSession>> = self
            .sessions
            .lock()
            .ok()
            .map(|sessions| sessions.values().cloned().collect())
            .unwrap_or_default();
        for session in &sessions {
            session.resume().await;
            session.close();
        }
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.clear();
        }
    }

    /// Continue sessions that were left paused after the last browser went away.
    /// This covers the mobile app being killed without a clean pagehide event.
    pub async fn maintain(&self) {
        let sessions: Vec<Arc<DebugSession>> = self
            .sessions
            .lock()
            .ok()
            .map(|sessions| sessions.values().cloned().collect())
            .unwrap_or_default();
        for session in sessions {
            if session.closed.load(Ordering::SeqCst) {
                continue;
            }
            if session.paused.load(Ordering::SeqCst) && session.clients.load(Ordering::SeqCst) == 0
            {
                let idle = session
                    .last_disconnect
                    .lock()
                    .map(|value| value.elapsed())
                    .unwrap_or_default();
                if idle > Duration::from_secs(5) {
                    session.resume().await;
                }
            }
        }
    }
}

impl DebugSession {
    pub fn info(&self) -> DebugSessionInfo {
        DebugSessionInfo {
            id: self.id.clone(),
            project_id: self.project_id.clone(),
            language: self.language.clone(),
            mode: self.mode.clone(),
            status: if self.closed.load(Ordering::SeqCst) {
                "stopped".into()
            } else if self.paused.load(Ordering::SeqCst) {
                "paused".into()
            } else {
                "running".into()
            },
            ws_url: format!("/api/projects/{}/debug/ws", self.project_id),
            address: self.address.clone(),
        }
    }

    pub async fn resume(&self) {
        if self.language == "node" {
            let url = self
                .inspector_url
                .lock()
                .ok()
                .and_then(|value| value.clone());
            if let Some(url) = url {
                let _ = resume_node(&url).await;
            }
        } else if self.paused.load(Ordering::SeqCst) {
            // debugpy stays on the last stopped thread. Continue it so a
            // browser that went away never leaves the project frozen.
            let thread = self
                .last_thread
                .lock()
                .ok()
                .and_then(|value| *value);
            if let Some(thread_id) = thread {
                let _ = self.write_dap(&json!({
                    "seq": 9_000_001,
                    "type": "request",
                    "command": "continue",
                    "arguments": { "threadId": thread_id }
                }));
            }
        }
        self.paused.store(false, Ordering::SeqCst);
    }

    pub fn close(&self) {
        if self.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        if let Ok(mut stdin) = self.stdin.lock() {
            let _ = stdin.take();
        }
        if let Ok(mut child) = self.child.lock() {
            if let Some(child) = child.as_mut() {
                let _ = child.kill();
                let _ = child.wait();
            }
        }
    }

    pub fn subscribe(&self) -> AppResult<(Vec<u8>, broadcast::Receiver<Vec<u8>>)> {
        let initial = self
            .output
            .lock()
            .map_err(|_| crate::errors::internal("debug output"))?
            .clone();
        Ok((initial, self.output_tx.subscribe()))
    }

    pub fn subscribe_dap(&self) -> AppResult<broadcast::Receiver<String>> {
        Ok(self.dap_tx.subscribe())
    }

    pub fn client_disconnected(&self) {
        if let Ok(mut last) = self.last_disconnect.lock() {
            *last = Instant::now();
        }
    }

    /// Sends a DAP request to the Python adapter. The browser speaks JSON over
    /// the socket; the adapter speaks the same messages with the DAP frame.
    pub fn write_dap(&self, value: &Value) -> AppResult<()> {
        let body = serde_json::to_vec(value)
            .map_err(|error| crate::errors::internal(error.to_string()))?;
        let mut guard = self
            .stdin
            .lock()
            .map_err(|_| crate::errors::internal("debug stdin"))?;
        let Some(stdin) = guard.as_mut() else {
            return Err(AppError::BadRequest("debug adapter has no stdin".into()));
        };
        stdin.write_all(format!("Content-Length: {}\r\n\r\n", body.len()).as_bytes())?;
        stdin.write_all(&body)?;
        stdin.flush()?;
        Ok(())
    }
}

fn port() -> AppResult<u16> {
    let listener =
        TcpListener::bind(("127.0.0.1", 0)).map_err(|error| AppError::Internal(error.into()))?;
    listener
        .local_addr()
        .map(|address| address.port())
        .map_err(|error| AppError::Internal(error.into()))
}

async fn inspector_ws(address: &str) -> AppResult<String> {
    let base = if address.starts_with("http://") || address.starts_with("https://") {
        address.trim_end_matches('/').to_string()
    } else {
        format!("http://{}", address.trim_end_matches('/'))
    };
    let url = if base.ends_with("/json/list") {
        base
    } else {
        format!("{base}/json/list")
    };
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .map_err(|error| AppError::Internal(error.into()))?;
    let value: Value = client
        .get(url)
        .send()
        .await
        .map_err(|error| AppError::BadRequest(format!("debug inspector unavailable: {error}")))?
        .json()
        .await
        .map_err(|error| {
            AppError::BadRequest(format!("invalid debug inspector response: {error}"))
        })?;
    value
        .as_array()
        .and_then(|items| {
            items.iter().find_map(|item| {
                item.get("webSocketDebuggerUrl")?
                    .as_str()
                    .map(str::to_string)
            })
        })
        .ok_or_else(|| AppError::BadRequest("debug inspector has no websocket endpoint".into()))
}

async fn wait_inspector(address: &str) -> AppResult<String> {
    for _ in 0..100 {
        if let Ok(url) = inspector_ws(address).await {
            return Ok(url);
        }
        tokio::time::sleep(Duration::from_millis(120)).await;
    }
    Err(AppError::BadRequest(
        "Node inspector did not start. Use a Node command such as `node src/index.js` or `npm run dev`.".into(),
    ))
}

async fn start_node(
    project_id: &str,
    cwd: &Path,
    mode: &str,
    input: &DebugStartInput,
) -> AppResult<Arc<DebugSession>> {
    if mode == "attach" {
        let address = input.address.trim();
        if address.is_empty() {
            return Err(AppError::BadRequest(
                "attach requires an inspector address".into(),
            ));
        }
        let ws = inspector_ws(address).await?;
        return Ok(new_session(
            project_id,
            "node",
            mode,
            address,
            Some(ws),
            None,
            None,
            None,
        ));
    }

    if input.command.trim().is_empty() {
        return Err(AppError::BadRequest("launch requires a command".into()));
    }
    let debug_port = port()?;
    let address = format!("127.0.0.1:{debug_port}");
    let mut command = Command::new("sh");
    command
        .arg("-lc")
        .arg(&input.command)
        .current_dir(cwd)
        .env("NODE_OPTIONS", node_options(debug_port))
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| AppError::BadRequest(format!("could not launch Node: {error}")))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let session = new_session(
        project_id,
        "node",
        mode,
        &address,
        None,
        Some(child),
        None,
        None,
    );
    if let Some(stdout) = stdout {
        spawn_reader(session.clone(), stdout);
    }
    if let Some(stderr) = stderr {
        spawn_reader(session.clone(), stderr);
    }
    let ws = wait_inspector(&address)
        .await
        .inspect_err(|_| session.close())?;
    if let Ok(mut slot) = session.inspector_url.lock() {
        *slot = Some(ws);
    }
    Ok(session)
}

fn start_python(
    project_id: &str,
    cwd: &Path,
    mode: &str,
    _input: &DebugStartInput,
) -> AppResult<Arc<DebugSession>> {
    // One adapter for both launch and attach: the browser sends the DAP
    // `launch`/`attach` request with the program or the address.
    let (python, pythonpath) = python_adapter()?;
    let mut command = Command::new(&python);
    command
        .args(["-m", "debugpy.adapter"])
        .current_dir(cwd)
        .env("PYDEVD_DISABLE_FILE_VALIDATION", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = &pythonpath {
        command.env("PYTHONPATH", path);
    }
    let mut child = command.spawn().map_err(|error| {
        AppError::BadRequest(format!("could not launch the Python debug adapter: {error}"))
    })?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdin = child.stdin.take();
    let session = new_session(
        project_id,
        "python",
        mode,
        "debugpy",
        None,
        Some(child),
        stdin,
        None,
    );
    if let Some(stdout) = stdout {
        spawn_dap_reader(session.clone(), stdout);
    }
    if let Some(stderr) = stderr {
        spawn_reader(session.clone(), stderr);
    }
    Ok(session)
}

/// The Python adapter is bundled in the image under /usr/local/lib/toph (or in
/// the data dir for a source install). `TOPH_DEBUGPY_PATH` overrides both.
fn python_adapter() -> AppResult<(String, Option<String>)> {
    let python = std::env::var("TOPH_DEBUG_PYTHON")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(which_python);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(path) = std::env::var("TOPH_DEBUGPY_PATH") {
        if !path.trim().is_empty() {
            candidates.push(PathBuf::from(path));
        }
    }
    candidates.push(PathBuf::from("/usr/local/lib/toph/debug-adapters/python"));
    if let Ok(dir) = std::env::var("TOPH_DATA_DIR") {
        if !dir.trim().is_empty() {
            candidates.push(PathBuf::from(dir).join("debug-adapters/python"));
        }
    }
    let pythonpath = candidates
        .into_iter()
        .find(|path| path.join("debugpy").is_dir())
        .map(|path| path.to_string_lossy().to_string());
    let mut check = Command::new(&python);
    check
        .args(["-c", "import debugpy"])
        .env("PYDEVD_DISABLE_FILE_VALIDATION", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(path) = &pythonpath {
        check.env("PYTHONPATH", path);
    }
    if !check.status().map(|status| status.success()).unwrap_or(false) {
        return Err(AppError::BadRequest(
            "debugpy não está instalado no servidor. Reinstale o Toph com o pacote de debug ou defina TOPH_DEBUGPY_PATH."
                .into(),
        ));
    }
    Ok((python, pythonpath))
}

fn spawn_dap_reader<R: Read + Send + 'static>(session: Arc<DebugSession>, mut reader: R) {
    thread::spawn(move || {
        let mut buffer: Vec<u8> = Vec::new();
        let mut chunk = [0u8; 16 * 1024];
        loop {
            let count = match reader.read(&mut chunk) {
                Ok(0) => break,
                Ok(count) => count,
                Err(_) => break,
            };
            buffer.extend_from_slice(&chunk[..count]);
            loop {
                let Some(header_end) = find_bytes(&buffer, b"\r\n\r\n") else {
                    break;
                };
                let header = String::from_utf8_lossy(&buffer[..header_end]).to_string();
                let length = header.lines().find_map(|line| {
                    let (name, value) = line.split_once(':')?;
                    if name.eq_ignore_ascii_case("Content-Length") {
                        value.trim().parse::<usize>().ok()
                    } else {
                        None
                    }
                });
                let Some(length) = length else {
                    buffer.drain(..header_end + 4);
                    continue;
                };
                if buffer.len() < header_end + 4 + length {
                    break;
                }
                let body = buffer[header_end + 4..header_end + 4 + length].to_vec();
                buffer.drain(..header_end + 4 + length);
                let Ok(value) = serde_json::from_slice::<Value>(&body) else {
                    continue;
                };
                match value.get("event").and_then(Value::as_str) {
                    Some("stopped") => {
                        session.paused.store(true, Ordering::SeqCst);
                        if let Some(thread) = value
                            .get("body")
                            .and_then(|body| body.get("threadId"))
                            .and_then(Value::as_i64)
                        {
                            if let Ok(mut slot) = session.last_thread.lock() {
                                *slot = Some(thread);
                            }
                        }
                    }
                    Some("continued") | Some("terminated") | Some("exited") => {
                        session.paused.store(false, Ordering::SeqCst);
                    }
                    _ => {}
                }
                let _ = session.dap_tx.send(value.to_string());
            }
        }
        // The adapter is gone: the session must not be restored as if it were
        // still alive on the next page load.
        session.paused.store(false, Ordering::SeqCst);
        session.closed.store(true, Ordering::SeqCst);
    });
}

fn find_bytes(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack
        .windows(needle.len())
        .position(|window| window == needle)
}

fn which_python() -> String {
    for candidate in ["python3", "python"] {
        if Command::new(candidate)
            .arg("--version")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok()
        {
            return candidate.to_string();
        }
    }
    "python3".into()
}

fn node_options(debug_port: u16) -> String {
    let existing = std::env::var("NODE_OPTIONS").unwrap_or_default();
    format!("{existing} --inspect-brk=127.0.0.1:{debug_port}")
        .trim()
        .to_string()
}

fn new_session(
    project_id: &str,
    language: &str,
    mode: &str,
    address: &str,
    inspector_url: Option<String>,
    child: Option<Child>,
    stdin: Option<ChildStdin>,
    _unused: Option<()>,
) -> Arc<DebugSession> {
    let (output_tx, _) = broadcast::channel(256);
    let (dap_tx, _) = broadcast::channel(256);
    Arc::new(DebugSession {
        id: new_id(),
        project_id: project_id.to_string(),
        language: language.to_string(),
        mode: mode.to_string(),
        inspector_url: Mutex::new(inspector_url),
        address: address.to_string(),
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        output: Mutex::new(Vec::new()),
        output_tx,
        dap_tx,
        last_thread: Mutex::new(None),
        paused: AtomicBool::new(false),
        clients: AtomicUsize::new(0),
        last_disconnect: Mutex::new(Instant::now()),
        closed: AtomicBool::new(false),
    })
}

fn spawn_reader<R: Read + Send + 'static>(session: Arc<DebugSession>, mut reader: R) {
    thread::spawn(move || {
        let mut buffer = [0u8; 16 * 1024];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    let chunk = buffer[..count].to_vec();
                    if let Ok(mut stored) = session.output.lock() {
                        stored.extend_from_slice(&chunk);
                        if stored.len() > OUTPUT_LIMIT {
                            let excess = stored.len() - OUTPUT_LIMIT;
                            stored.drain(..excess);
                        }
                    }
                    let _ = session.output_tx.send(chunk);
                }
                Err(_) => break,
            }
        }
    });
}

async fn resume_node(inspector_url: &str) -> AppResult<()> {
    let (mut socket, _) = tokio_tungstenite::connect_async(inspector_url)
        .await
        .map_err(|error| AppError::Internal(error.into()))?;
    let _ = socket
        .send(WsMessage::Text(
            json!({ "id": 1, "method": "Runtime.runIfWaitingForDebugger" })
                .to_string()
                .into(),
        ))
        .await;
    let _ = socket
        .send(WsMessage::Text(
            json!({ "id": 2, "method": "Debugger.resume" })
                .to_string()
                .into(),
        ))
        .await;
    let _ = socket.close(None).await;
    Ok(())
}

pub async fn proxy_node(session: Arc<DebugSession>, socket: axum::extract::ws::WebSocket) {
    let Some(url) = session
        .inspector_url
        .lock()
        .ok()
        .and_then(|value| value.clone())
    else {
        return;
    };
    let Ok((upstream, _)) = tokio_tungstenite::connect_async(&url).await else {
        return;
    };
    let (mut client_tx, mut client_rx) = socket.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();
    let session_for_events = session.clone();
    let upstream_to_client = async {
        while let Some(message) = upstream_rx.next().await {
            let Ok(message) = message else { break };
            if let WsMessage::Text(text) = &message {
                if let Ok(value) = serde_json::from_str::<Value>(text) {
                    match value.get("method").and_then(Value::as_str) {
                        Some("Debugger.paused") => {
                            session_for_events.paused.store(true, Ordering::SeqCst);
                        }
                        Some("Debugger.resumed") => {
                            session_for_events.paused.store(false, Ordering::SeqCst);
                        }
                        _ => {}
                    }
                }
            }
            let outgoing = match message {
                WsMessage::Text(text) => axum::extract::ws::Message::Text(text.to_string().into()),
                WsMessage::Binary(data) => axum::extract::ws::Message::Binary(data),
                WsMessage::Ping(data) => axum::extract::ws::Message::Ping(data),
                WsMessage::Pong(data) => axum::extract::ws::Message::Pong(data),
                WsMessage::Close(frame) => axum::extract::ws::Message::Close(frame.map(|frame| {
                    axum::extract::ws::CloseFrame {
                        code: frame.code.into(),
                        reason: frame.reason.to_string().into(),
                    }
                })),
                WsMessage::Frame(_) => continue,
            };
            if client_tx.send(outgoing).await.is_err() {
                break;
            }
        }
    };
    let client_to_upstream = async {
        while let Some(message) = client_rx.next().await {
            let Ok(message) = message else { break };
            let outgoing = match message {
                axum::extract::ws::Message::Text(text) => {
                    if let Ok(value) = serde_json::from_str::<Value>(&text) {
                        if value.get("method").and_then(Value::as_str) == Some("Debugger.resume") {
                            session.paused.store(false, Ordering::SeqCst);
                        }
                    }
                    WsMessage::Text(text.to_string().into())
                }
                axum::extract::ws::Message::Binary(data) => WsMessage::Binary(data),
                axum::extract::ws::Message::Ping(data) => WsMessage::Ping(data),
                axum::extract::ws::Message::Pong(data) => WsMessage::Pong(data),
                axum::extract::ws::Message::Close(frame) => WsMessage::Close(frame.map(|frame| {
                    tokio_tungstenite::tungstenite::protocol::CloseFrame {
                        code: frame.code.into(),
                        reason: frame.reason.to_string().into(),
                    }
                })),
            };
            if upstream_tx.send(outgoing).await.is_err() {
                break;
            }
        }
    };
    tokio::select! {
        _ = upstream_to_client => {}
        _ = client_to_upstream => {}
    }
}

pub async fn proxy_python(session: Arc<DebugSession>, mut socket: axum::extract::ws::WebSocket) {
    let Ok(mut events) = session.subscribe_dap() else {
        return;
    };
    let mut heartbeat = tokio::time::interval(Duration::from_secs(2));
    loop {
        tokio::select! {
            incoming = socket.recv() => {
                match incoming {
                    Some(Ok(axum::extract::ws::Message::Text(text))) => {
                        if let Ok(value) = serde_json::from_str::<Value>(&text) {
                            let _ = session.write_dap(&value);
                        }
                    }
                    Some(Ok(axum::extract::ws::Message::Ping(data))) => {
                        let _ = socket.send(axum::extract::ws::Message::Pong(data)).await;
                    }
                    Some(Ok(axum::extract::ws::Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            event = events.recv() => {
                match event {
                    Ok(text) => {
                        if socket.send(axum::extract::ws::Message::Text(text.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            _ = heartbeat.tick() => {
                if session.closed.load(Ordering::SeqCst) { break; }
            }
        }
    }
}
