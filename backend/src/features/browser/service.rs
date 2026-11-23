use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicI64, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

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
    proxies: Mutex<HashMap<String, String>>,
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
    last_used: AtomicI64,
    pub clients: AtomicUsize,
    closed: AtomicBool,
    takeover: AtomicBool,
    recording_on: AtomicBool,
    recording: Mutex<Vec<Value>>,
    child: Mutex<Option<Child>>,
}

impl BrowserManager {
    pub fn new(data_dir: PathBuf) -> Self {
        Self {
            data_dir,
            sessions: Mutex::new(HashMap::new()),
            proxies: Mutex::new(HashMap::new()),
        }
    }

    pub fn set_proxy(&self, key: &str, proxy: &str) {
        let mut proxies = self.proxies.lock().unwrap();
        if proxy.trim().is_empty() {
            proxies.remove(key);
        } else {
            proxies.insert(key.to_string(), proxy.trim().to_string());
        }
    }

    /// Closes Chromium profiles nobody is watching and nobody used recently.
    pub fn maintain_idle(&self, max_age: Duration) {
        let now = chrono::Utc::now().timestamp_millis();
        let age = max_age.as_millis() as i64;
        let mut sessions = self.sessions.lock().unwrap();
        sessions.retain(|_, session| {
            let idle = now - session.last_used.load(Ordering::SeqCst);
            if session.clients.load(Ordering::SeqCst) == 0 && idle > age {
                session.close_now();
                false
            } else {
                true
            }
        });
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
        let proxy = self
            .proxies
            .lock()
            .ok()
            .and_then(|proxies| proxies.get(project_id).cloned())
            .unwrap_or_default();
        let session = launch(project_id, root, &self.data_dir, &proxy).await?;
        let mut sessions = self.sessions.lock().map_err(|_| internal("browser lock"))?;
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
    pub fn set_takeover(&self, active: bool) {
        self.takeover.store(active, Ordering::SeqCst);
    }

    pub fn is_takeover(&self) -> bool {
        self.takeover.load(Ordering::SeqCst)
    }

    pub fn record_start(&self) {
        self.recording.lock().unwrap().clear();
        self.recording_on.store(true, Ordering::SeqCst);
    }

    pub fn record_stop(&self) -> Vec<Value> {
        self.recording_on.store(false, Ordering::SeqCst);
        self.recording.lock().unwrap().clone()
    }

    fn record(&self, step: Value) {
        if self.recording_on.load(Ordering::SeqCst) {
            if let Ok(mut steps) = self.recording.lock() {
                steps.push(step);
            }
        }
    }

    async fn element_label(&self, reference: &str) -> String {
        let reference = reference.replace('"', "");
        let expression = format!(
            "(() => {{ const el = document.querySelector('[data-jeff-ref=\"{reference}\"]'); \
             if (!el) return ''; return (el.getAttribute('aria-label') || el.getAttribute('placeholder') \
               || el.getAttribute('title') || el.innerText || el.value || el.tagName).trim().slice(0, 90); }})()"
        );
        self.evaluate(&expression)
            .await
            .ok()
            .and_then(|value| value.as_str().map(str::to_string))
            .unwrap_or_default()
    }

    pub async fn fill_secret(&self, reference: &str, text: &str) -> AppResult<Value> {
        let reference = valid_ref(reference)?;
        let expression = format!(
            "(() => {{ const el = document.querySelector('[data-jeff-ref=\"{reference}\"]'); \
             if (!el) return false; el.focus(); if (typeof el.select === 'function') el.select(); return true; }})()"
        );
        if self.evaluate(&expression).await?.as_bool() != Some(true) {
            return Err(AppError::BadRequest("A referência não existe mais.".into()));
        }
        self.command("Input.insertText", json!({ "text": text }))
            .await
            .map_err(AppError::Upstream)?;
        self.record(json!({ "action": "fill-secret", "ref": reference }));
        Ok(json!({ "ok": true }))
    }

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
        self.last_used.store(
            chrono::Utc::now().timestamp_millis(),
            std::sync::atomic::Ordering::SeqCst,
        );
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
        self.record(json!({ "action": "open", "url": parsed.as_str() }));
        self.read().await
    }

    pub async fn click(
        &self,
        selector: Option<&str>,
        x: Option<f64>,
        y: Option<f64>,
    ) -> AppResult<Value> {
        let (x, y) = if let Some(selector) = selector.filter(|value| !value.trim().is_empty()) {
            let expression = format!(
                "(() => {{ const el = document.querySelector({}); if (!el) return null; el.scrollIntoView({{block:'center'}}); const r = el.getBoundingClientRect(); return {{x:r.left+r.width/2,y:r.top+r.height/2}}; }})()",
                serde_json::to_string(selector).unwrap_or_else(|_| "\"\"".into())
            );
            let result = self
                .command(
                    "Runtime.evaluate",
                    json!({"expression": expression, "returnByValue": true}),
                )
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

    /// The interactive page for an agent: every visible control gets a stable
    /// `data-jeff-ref` for this revision, and the text is what a person reads.
    pub async fn snapshot(&self) -> AppResult<Value> {
        const SCRIPT: &str = r#"(() => {
  const MAX = 400;
  document.querySelectorAll('[data-jeff-ref]').forEach((el) => el.removeAttribute('data-jeff-ref'));
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const s = getComputedStyle(el);
    return r.width > 1 && r.height > 1 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0';
  };
  const roleOf = (el) => el.getAttribute('role') || ({
    a: 'link', button: 'button',
    input: el.type === 'checkbox' ? 'checkbox' : el.type === 'radio' ? 'radio' : 'textbox',
    textarea: 'textbox', select: 'combobox',
    h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading'
  }[el.tagName.toLowerCase()] || '');
  const nameOf = (el) => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.innerText || el.value || el.getAttribute('name') || '').trim().replace(/\s+/g, ' ').slice(0, 160);
  const out = [];
  let n = 0;
  for (const el of document.querySelectorAll('a,button,input,textarea,select,[role],[contenteditable="true"],h1,h2,h3,h4')) {
    if (n >= MAX) break;
    if (!visible(el)) continue;
    const ref = 'r' + (++n);
    el.setAttribute('data-jeff-ref', ref);
    out.push({ ref, tag: el.tagName.toLowerCase(), role: roleOf(el), name: nameOf(el), value: (el.value || '').slice(0, 160), disabled: !!el.disabled, href: el.href || null });
  }
  return JSON.stringify({
    url: location.href,
    title: document.title,
    text: (document.body && document.body.innerText || '').slice(0, 12000),
    elements: out
  });
})()"#;
        let result = self
            .command(
                "Runtime.evaluate",
                json!({ "expression": SCRIPT, "returnByValue": true }),
            )
            .await
            .map_err(AppError::Upstream)?;
        let raw = result["result"]["result"]["value"].as_str().unwrap_or("{}");
        let mut page: Value = serde_json::from_str(raw).unwrap_or_else(|_| json!({ "text": raw }));
        page["revision"] = json!(crate::crypto::new_id());
        Ok(page)
    }

    pub async fn click_ref(&self, reference: &str) -> AppResult<Value> {
        let reference = valid_ref(reference)?;
        let expression = format!(
            "(() => {{ const el = document.querySelector('[data-jeff-ref=\"{reference}\"]'); \
             if (!el) return 'missing'; el.scrollIntoView({{block:'center', inline:'center'}}); el.click(); return 'ok'; }})()"
        );
        let result = self
            .command(
                "Runtime.evaluate",
                json!({ "expression": expression, "returnByValue": true }),
            )
            .await
            .map_err(AppError::Upstream)?;
        let value = result["result"]["result"]["value"].as_str().unwrap_or("");
        if value != "ok" {
            return Err(AppError::BadRequest(format!(
                "A referência {reference} não existe mais; tire um snapshot novo."
            )));
        }
        tokio::time::sleep(Duration::from_millis(250)).await;
        let label = self.element_label(reference).await;
        self.record(json!({ "action": "click", "ref": reference, "label": label }));
        Ok(json!({ "ok": true, "ref": reference }))
    }

    pub async fn type_ref(&self, reference: &str, text: &str) -> AppResult<Value> {
        let reference = valid_ref(reference)?;
        let expression = format!(
            "(() => {{ const el = document.querySelector('[data-jeff-ref=\"{reference}\"]'); \
             if (!el) return 'missing'; el.focus(); if (typeof el.select === 'function') el.select(); return 'ok'; }})()"
        );
        let result = self
            .command(
                "Runtime.evaluate",
                json!({ "expression": expression, "returnByValue": true }),
            )
            .await
            .map_err(AppError::Upstream)?;
        let value = result["result"]["result"]["value"].as_str().unwrap_or("");
        if value != "ok" {
            return Err(AppError::BadRequest(format!(
                "A referência {reference} não existe mais; tire um snapshot novo."
            )));
        }
        self.command("Input.insertText", json!({ "text": text }))
            .await
            .map_err(AppError::Upstream)?;
        let label = self.element_label(reference).await;
        self.record(json!({ "action": "type", "ref": reference, "label": label, "text": text }));
        Ok(json!({ "ok": true, "ref": reference, "typed": text.chars().count() }))
    }

    pub async fn evaluate(&self, expression: &str) -> AppResult<Value> {
        let result = self
            .command(
                "Runtime.evaluate",
                json!({
                    "expression": expression,
                    "returnByValue": true,
                    "awaitPromise": true,
                }),
            )
            .await
            .map_err(AppError::Upstream)?;
        if let Some(exception) = result.get("exceptionDetails") {
            return Err(AppError::BadRequest(format!(
                "A página lançou um erro: {}",
                exception["text"].as_str().unwrap_or("exceção")
            )));
        }
        Ok(result["result"]["result"]["value"].clone())
    }

    pub async fn select_option(&self, reference: &str, value: &str) -> AppResult<Value> {
        let reference = valid_ref(reference)?;
        let expression = format!(
            "(() => {{ const el = document.querySelector('[data-jeff-ref=\"{reference}\"]'); \
             if (!el) return false; el.value = {}; \
             el.dispatchEvent(new Event('input', {{bubbles:true}})); \
             el.dispatchEvent(new Event('change', {{bubbles:true}})); return true; }})()",
            serde_json::to_string(value).unwrap_or_else(|_| "\"\"".into())
        );
        if self.evaluate(&expression).await?.as_bool() != Some(true) {
            return Err(AppError::BadRequest("A referência não existe mais.".into()));
        }
        Ok(json!({ "ok": true, "value": value }))
    }

    pub async fn set_checked(&self, reference: &str, checked: bool) -> AppResult<Value> {
        let reference = valid_ref(reference)?;
        let expression = format!(
            "(() => {{ const el = document.querySelector('[data-jeff-ref=\"{reference}\"]'); \
             if (!el) return false; el.checked = {checked}; \
             el.dispatchEvent(new Event('input', {{bubbles:true}})); \
             el.dispatchEvent(new Event('change', {{bubbles:true}})); return true; }})()"
        );
        if self.evaluate(&expression).await?.as_bool() != Some(true) {
            return Err(AppError::BadRequest("A referência não existe mais.".into()));
        }
        Ok(json!({ "ok": true, "checked": checked }))
    }

    pub async fn wait_for_text(&self, text: &str, timeout_ms: u64) -> AppResult<Value> {
        let needle = serde_json::to_string(text).unwrap_or_else(|_| "\"\"".into());
        let expression = format!("!!(document.body && document.body.innerText.includes({needle}))");
        let deadline = Instant::now() + Duration::from_millis(timeout_ms.clamp(500, 30_000));
        loop {
            if self.evaluate(&expression).await?.as_bool() == Some(true) {
                return Ok(json!({ "found": true, "text": text }));
            }
            if Instant::now() >= deadline {
                return Err(AppError::BadRequest(format!(
                    "O texto \"{text}\" não apareceu a tempo."
                )));
            }
            tokio::time::sleep(Duration::from_millis(300)).await;
        }
    }

    pub async fn fill_fields(&self, fields: &[(String, String)]) -> AppResult<Value> {
        let mut items = Vec::new();
        for (reference, value) in fields {
            let reference = valid_ref(reference)?;
            items.push(json!({ "ref": reference, "value": value }));
        }
        let expression = format!(
            "(() => {{ const items = {}; let filled = 0; \
             for (const item of items) {{ \
               const el = document.querySelector('[data-jeff-ref=\"' + item.ref + '\"]'); \
               if (!el) continue; el.focus(); el.value = item.value; \
               el.dispatchEvent(new Event('input', {{bubbles:true}})); \
               el.dispatchEvent(new Event('change', {{bubbles:true}})); filled++; \
             }} return filled; }})()",
            serde_json::to_string(&items).unwrap_or_else(|_| "[]".into())
        );
        let filled = self.evaluate(&expression).await?;
        Ok(json!({ "ok": true, "filled": filled }))
    }

    pub async fn drag_ref(&self, from: &str, to: &str) -> AppResult<Value> {
        let from = valid_ref(from)?;
        let to = valid_ref(to)?;
        let expression = format!(
            "(() => {{ const a = document.querySelector('[data-jeff-ref=\"{from}\"]'); \
             const b = document.querySelector('[data-jeff-ref=\"{to}\"]'); \
             if (!a || !b) return null; const ra = a.getBoundingClientRect(); \
             const rb = b.getBoundingClientRect(); \
             return {{x1: ra.left + ra.width / 2, y1: ra.top + ra.height / 2, \
                      x2: rb.left + rb.width / 2, y2: rb.top + rb.height / 2}}; }})()"
        );
        let points = self.evaluate(&expression).await?;
        let (Some(x1), Some(y1), Some(x2), Some(y2)) = (
            points["x1"].as_f64(),
            points["y1"].as_f64(),
            points["x2"].as_f64(),
            points["y2"].as_f64(),
        ) else {
            return Err(AppError::BadRequest(
                "As referências do arrasto não existem mais.".into(),
            ));
        };
        for (kind, x, y) in [
            ("mousePressed", x1, y1),
            ("mouseMoved", (x1 + x2) / 2.0, (y1 + y2) / 2.0),
            ("mouseMoved", x2, y2),
            ("mouseReleased", x2, y2),
        ] {
            self.command(
                "Input.dispatchMouseEvent",
                json!({
                    "type": kind,
                    "x": x,
                    "y": y,
                    "button": "left",
                    "buttons": if kind == "mouseReleased" { 0 } else { 1 },
                    "clickCount": if kind == "mousePressed" { 1 } else { 0 },
                }),
            )
            .await
            .map_err(AppError::Upstream)?;
            tokio::time::sleep(Duration::from_millis(80)).await;
        }
        Ok(json!({ "ok": true }))
    }

    pub async fn screenshot(&self) -> AppResult<Value> {
        let result = self
            .command("Page.captureScreenshot", json!({ "format": "png" }))
            .await
            .map_err(AppError::Upstream)?;
        let data = result["result"]["data"]
            .as_str()
            .ok_or_else(|| AppError::Upstream("O Chromium não devolveu a imagem.".into()))?;
        Ok(json!({
            "__image": { "data": data, "mimeType": "image/png" }
        }))
    }

    pub async fn set_environment(
        &self,
        width: Option<u32>,
        height: Option<u32>,
        color_scheme: Option<&str>,
        reduced_motion: Option<bool>,
    ) -> AppResult<Value> {
        if let (Some(width), Some(height)) = (width, height) {
            self.command(
                "Emulation.setDeviceMetricsOverride",
                json!({
                    "width": width.clamp(240, 3840),
                    "height": height.clamp(240, 2160),
                    "deviceScaleFactor": 1,
                    "mobile": false,
                }),
            )
            .await
            .map_err(AppError::Upstream)?;
        }
        if let Some(scheme) = color_scheme.filter(|value| ["light", "dark"].contains(value)) {
            self.command(
                "Emulation.setEmulatedMedia",
                json!({ "features": [{ "name": "prefers-color-scheme", "value": scheme }] }),
            )
            .await
            .map_err(AppError::Upstream)?;
        }
        if let Some(reduced) = reduced_motion {
            self.command(
                "Emulation.setEmulatedMedia",
                json!({
                    "features": [{
                        "name": "prefers-reduced-motion",
                        "value": if reduced { "reduce" } else { "no-preference" }
                    }]
                }),
            )
            .await
            .map_err(AppError::Upstream)?;
        }
        Ok(json!({ "ok": true }))
    }

    pub async fn upload_files(&self, reference: &str, paths: &[String]) -> AppResult<Value> {
        let reference = valid_ref(reference)?;
        let document = self
            .command("DOM.getDocument", json!({ "depth": -1 }))
            .await
            .map_err(AppError::Upstream)?;
        let root = document["result"]["root"]["nodeId"]
            .as_i64()
            .ok_or_else(|| AppError::Upstream("DOM indisponível.".into()))?;
        let found = self
            .command(
                "DOM.querySelector",
                json!({
                    "nodeId": root,
                    "selector": format!("[data-jeff-ref=\"{reference}\"]"),
                }),
            )
            .await
            .map_err(AppError::Upstream)?;
        let node = found["result"]["nodeId"]
            .as_i64()
            .filter(|node| *node != 0)
            .ok_or_else(|| AppError::BadRequest("O campo de arquivo não existe mais.".into()))?;
        self.command(
            "DOM.setFileInputFiles",
            json!({ "files": paths, "nodeId": node }),
        )
        .await
        .map_err(AppError::Upstream)?;
        Ok(json!({ "ok": true, "files": paths.len() }))
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
        let index = if direction == "forward" {
            current + 1
        } else {
            current - 1
        };
        let Some(entry) = usize::try_from(index)
            .ok()
            .and_then(|index| entries.get(index))
        else {
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
        let page_text = result["result"]["result"]["value"].as_str().unwrap_or("{}");
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
        let _ = self.command("Page.stopScreencast", json!({})).await;
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

async fn launch(
    project_id: &str,
    root: &Path,
    data_dir: &Path,
    proxy: &str,
) -> AppResult<Arc<BrowserSession>> {
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
        .args(if proxy.trim().is_empty() {
            vec![]
        } else {
            vec![format!("--proxy-server={}", proxy.trim())]
        })
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
            if let Some(port) = text
                .lines()
                .next()
                .and_then(|line| line.trim().parse::<u16>().ok())
            {
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
        last_used: AtomicI64::new(chrono::Utc::now().timestamp_millis()),
        clients: AtomicUsize::new(0),
        closed: AtomicBool::new(false),
        takeover: AtomicBool::new(false),
        recording_on: AtomicBool::new(false),
        recording: Mutex::new(Vec::new()),
        child: Mutex::new(Some(child)),
    });

    for method in [
        "Page.enable",
        "Runtime.enable",
        "Log.enable",
        "Network.enable",
    ] {
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
        reply
            .send(Err("O navegador de debug encerrou.".into()))
            .ok();
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

fn valid_ref(value: &str) -> AppResult<&str> {
    let reference = value.trim();
    let valid = reference.len() >= 2
        && reference.starts_with('r')
        && reference[1..].chars().all(|c| c.is_ascii_digit());
    if !valid {
        return Err(AppError::BadRequest(
            "Referência inválida; use a do último snapshot.".into(),
        ));
    }
    Ok(reference)
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
