use super::*;
use crate::browser::BrowserSession;

/// The live browser a debug-mode agent drives. Created on demand so the UI can
/// attach its WebSocket before the agent opens a page.
pub(super) async fn debug_browser_info(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Value>> {
    let project = state.store.project(&project_id).await?;
    let session = state
        .browser
        .session(&project_id, FsPath::new(&project.root))
        .await?;
    let info = session.info();
    Ok(Json(json!({
        "id": info.id,
        "projectId": info.project_id,
        "pageUrl": info.page_url,
        "wsUrl": info.ws_url,
    })))
}

pub(super) async fn debug_browser_ws(
    State(state): State<Arc<AppState>>,
    Path(project_id): Path<String>,
    ws: WebSocketUpgrade,
) -> Response {
    let project = match state.store.project(&project_id).await {
        Ok(project) => project,
        Err(error) => return error.into_response(),
    };
    let session = match state
        .browser
        .session(&project_id, FsPath::new(&project.root))
        .await
    {
        Ok(session) => session,
        Err(error) => return error.into_response(),
    };
    session
        .clients
        .fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    ws.on_upgrade(move |socket| browser_socket(socket, session))
}

async fn browser_socket(mut socket: WebSocket, session: Arc<BrowserSession>) {
    if let Err(error) = session.start_streaming().await {
        let message = json!({ "type": "error", "message": error }).to_string();
        let _ = socket.send(Message::Text(message.into())).await;
    }
    if let Some(frame) = session.latest_frame() {
        let message = json!({
            "type": "frame",
            "data": frame.data,
            "width": frame.width,
            "height": frame.height,
            "url": frame.url,
        })
        .to_string();
        if socket.send(Message::Text(message.into())).await.is_err() {
            finish_client(&session).await;
            return;
        }
    }
    let mut frames = session.subscribe();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(2));
    let mut last_client = Instant::now();
    loop {
        tokio::select! {
            frame = frames.recv() => {
                match frame {
                    Ok(frame) => {
                        let message = json!({
                            "type": "frame",
                            "data": frame.data,
                            "width": frame.width,
                            "height": frame.height,
                            "url": frame.url,
                        })
                        .to_string();
                        if socket.send(Message::Text(message.into())).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
            incoming = socket.recv() => {
                last_client = Instant::now();
                match incoming {
                    Some(Ok(Message::Text(text))) => {
                        if handle_client_message(&session, &text).await.is_err() {
                            break;
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Err(_)) => break,
                    _ => {}
                }
            }
            _ = heartbeat.tick() => {
                if last_client.elapsed() > Duration::from_secs(90) {
                    break;
                }
            }
        }
    }
    finish_client(&session).await;
}

async fn handle_client_message(session: &Arc<BrowserSession>, text: &str) -> Result<(), ()> {
    let Ok(value) = serde_json::from_str::<Value>(text) else {
        return Ok(());
    };
    match value["type"].as_str().unwrap_or("") {
        "ping" => Ok(()),
        "mouse" => {
            let event = value["event"].as_str().unwrap_or("click");
            let x = value["x"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0) * 1280.0;
            let y = value["y"].as_f64().unwrap_or(0.0).clamp(0.0, 1.0) * 800.0;
            let session = session.clone();
            let event = event.to_string();
            let delta_y = value["deltaY"].as_f64().unwrap_or(0.0);
            tokio::spawn(async move {
                let _ = match event.as_str() {
                    "move" => session.mouse_move(x, y).await,
                    "wheel" => session.scroll(x, y, delta_y).await,
                    _ => session.mouse_click(x, y).await,
                };
            });
            Ok(())
        }
        "text" => {
            let text = value["text"].as_str().unwrap_or("").to_string();
            if text.is_empty() {
                return Ok(());
            }
            let session = session.clone();
            tokio::spawn(async move {
                let _ = session.type_text(&text, None).await;
            });
            Ok(())
        }
        "key" => {
            let key = value["key"].as_str().unwrap_or("Enter").to_string();
            let session = session.clone();
            tokio::spawn(async move {
                let _ = session.press(&key).await;
            });
            Ok(())
        }
        "navigate" => {
            let url = value["url"].as_str().unwrap_or("").to_string();
            if url.is_empty() {
                return Ok(());
            }
            let session = session.clone();
            tokio::spawn(async move {
                let _ = session.open(&url).await;
            });
            Ok(())
        }
        "reload" => {
            let session = session.clone();
            tokio::spawn(async move {
                let _ = session.reload().await;
            });
            Ok(())
        }
        "back" | "forward" => {
            let direction = value["type"].as_str().unwrap_or("back").to_string();
            let session = session.clone();
            tokio::spawn(async move {
                let _ = session.history(&direction).await;
            });
            Ok(())
        }
        _ => Ok(()),
    }
}

async fn finish_client(session: &Arc<BrowserSession>) {
    let remaining = session
        .clients
        .fetch_sub(1, std::sync::atomic::Ordering::SeqCst)
        .saturating_sub(1);
    if remaining == 0 {
        session.stop_streaming().await;
    }
}
