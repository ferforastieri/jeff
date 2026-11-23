//! The room queue. Every message that needs an answer becomes one delivery per
//! recipient; the queue runs them one at a time per bot, survives a restart and
//! keeps each bot on its own CLI session.

use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use tokio::sync::broadcast;
use tokio_util::sync::CancellationToken;

use crate::browser::BrowserManager;
use crate::errors::{bad_request, AppError, AppResult};
use crate::features::agents::cli;
use crate::features::browser::vault::VaultService;
use crate::features::integrations::mcp::Server;
use crate::features::rooms::gateway::RoomGateway;
use crate::features::rooms::models::*;
use crate::platform::store::Store;
use crate::workspace::WorkspaceService;

/// Stops the per-run gateway when the delivery ends, however it ends.
struct GatewayHandle(Option<tokio::task::JoinHandle<()>>);
impl Drop for GatewayHandle {
    fn drop(&mut self) {
        if let Some(handle) = self.0.take() {
            handle.abort();
        }
    }
}

#[derive(Clone, Debug)]
pub struct RoomCompletion {
    pub room_id: String,
    pub project_id: String,
    pub bot_id: String,
    pub bot_name: String,
    pub message_id: String,
    pub text: String,
    pub failed: bool,
}

type CompletionHandler = Arc<dyn Fn(RoomCompletion) + Send + Sync>;

struct Inner {
    store: Store,
    workspace: WorkspaceService,
    browser: Arc<BrowserManager>,
    vault: Arc<VaultService>,
    scheduled: Mutex<HashSet<String>>,
    cancels: Mutex<HashMap<String, CancellationToken>>,
    events: broadcast::Sender<Value>,
    on_complete: Mutex<Option<CompletionHandler>>,
}

#[derive(Clone)]
pub struct RoomQueue {
    inner: Arc<Inner>,
}

impl RoomQueue {
    pub fn new(
        store: Store,
        workspace: WorkspaceService,
        browser: Arc<BrowserManager>,
        vault: Arc<VaultService>,
    ) -> Self {
        let (events, _) = broadcast::channel(256);
        Self {
            inner: Arc::new(Inner {
                store,
                workspace,
                browser,
                vault,
                scheduled: Mutex::new(HashSet::new()),
                cancels: Mutex::new(HashMap::new()),
                events,
                on_complete: Mutex::new(None),
            }),
        }
    }

    pub fn subscribe(&self) -> broadcast::Receiver<Value> {
        self.inner.events.subscribe()
    }

    pub fn set_on_complete(&self, handler: impl Fn(RoomCompletion) + Send + Sync + 'static) {
        *self.inner.on_complete.lock().unwrap() = Some(Arc::new(handler));
    }

    async fn notify_completion(&self, delivery: &Delivery, failed: bool, text: &str) {
        let Ok(room) = self.inner.store.room_by_id(&delivery.room_id).await else {
            return;
        };
        let Ok(principal) = self.inner.store.principal(&delivery.recipient_id).await else {
            return;
        };
        let handler = self.inner.on_complete.lock().unwrap().clone();
        if let Some(handler) = handler {
            handler(RoomCompletion {
                room_id: room.id,
                project_id: room.project_id,
                bot_id: principal.id,
                bot_name: principal.name,
                message_id: delivery.message_id.clone(),
                text: text.to_string(),
                failed,
            });
        }
    }

    /// Asks for a drain of one bot's queue. Safe to call many times: only the
    /// first call spawns a worker.
    pub fn schedule(&self, principal_id: String) {
        {
            let mut scheduled = self.inner.scheduled.lock().unwrap();
            if !scheduled.insert(principal_id.clone()) {
                return;
            }
        }
        let queue = self.clone();
        tokio::spawn(async move {
            queue.drain(&principal_id).await;
            queue.inner.scheduled.lock().unwrap().remove(&principal_id);
        });
    }

    pub fn cancel(&self, principal_id: &str) {
        if let Some(token) = self.inner.cancels.lock().unwrap().get(principal_id) {
            token.cancel();
        }
    }

    /// Marks whatever a crash left behind and resumes the queues that still
    /// have work. Called once, after the server opens the database.
    pub async fn recover(&self) {
        match self.inner.store.recover_room_deliveries().await {
            Ok(recipients) => {
                for recipient in recipients {
                    self.schedule(recipient);
                }
            }
            Err(error) => tracing::warn!(%error, "room queue: recovery"),
        }
    }

    async fn drain(&self, principal_id: &str) {
        loop {
            if self
                .inner
                .store
                .room_queue_paused(principal_id)
                .await
                .unwrap_or(false)
            {
                return;
            }
            let delivery = match self.inner.store.next_room_delivery(principal_id).await {
                Ok(Some(delivery)) => delivery,
                Ok(None) => return,
                Err(error) => {
                    tracing::warn!(%error, "room queue: next delivery");
                    return;
                }
            };
            let cancel = CancellationToken::new();
            self.inner
                .cancels
                .lock()
                .unwrap()
                .insert(principal_id.to_string(), cancel.clone());
            if let Err(error) = self
                .inner
                .store
                .mark_room_delivery(&delivery.id, "starting", "")
                .await
            {
                tracing::warn!(%error, "room queue: mark starting");
            }
            self.emit(&delivery, "starting", "");

            let result = self.run_delivery(&delivery, &cancel).await;

            self.inner.cancels.lock().unwrap().remove(principal_id);
            match result {
                Ok(()) => {
                    let _ = self
                        .inner
                        .store
                        .mark_room_delivery(&delivery.id, "completed", "")
                        .await;
                    let _ = self
                        .inner
                        .store
                        .finish_routine_run(&delivery.id, "succeeded", "")
                        .await;
                    self.emit(&delivery, "completed", "");
                }
                Err(error) => {
                    let interrupted = cancel.is_cancelled();
                    let status = if interrupted { "interrupted" } else { "failed" };
                    let message = error.to_string();
                    let _ = self
                        .inner
                        .store
                        .mark_room_delivery(&delivery.id, status, &message)
                        .await;
                    let routine_status = if interrupted { "interrupted" } else { "failed" };
                    let _ = self
                        .inner
                        .store
                        .finish_routine_run(&delivery.id, routine_status, &message)
                        .await;
                    self.emit(&delivery, status, &message);
                    if !interrupted {
                        let _ = self.post_failure(&delivery, &message).await;
                        self.notify_completion(&delivery, true, &message).await;
                    }
                }
            }
        }
    }

    fn emit(&self, delivery: &Delivery, status: &str, error: &str) {
        let _ = self.inner.events.send(json!({
            "type": "delivery",
            "deliveryId": delivery.id,
            "roomId": delivery.room_id,
            "recipientId": delivery.recipient_id,
            "status": status,
            "error": error,
        }));
    }

    async fn post_failure(&self, delivery: &Delivery, message: &str) -> AppResult<()> {
        let text = if message.trim().is_empty() {
            "Não consegui responder.".to_string()
        } else {
            format!("Não consegui responder: {message}")
        };
        self.inner
            .store
            .append_room_message(
                &delivery.room_id,
                &delivery.recipient_id,
                &text,
                "error",
                Some(&delivery.message_id),
            )
            .await?;
        Ok(())
    }

    async fn run_delivery(&self, delivery: &Delivery, cancel: &CancellationToken) -> AppResult<()> {
        let principal = self.inner.store.principal(&delivery.recipient_id).await?;
        if principal.kind != "bot" {
            return Err(bad_request(
                "Uma entrega só pode ter um bot como destinatário.",
            ));
        }
        let config = principal
            .bot
            .as_ref()
            .and_then(|value| serde_json::from_value::<BotConfig>(value.clone()).ok())
            .unwrap_or_default();
        let room = self.inner.store.room_by_id(&delivery.room_id).await?;
        let project = self.inner.store.project(&room.project_id).await?;
        let root = self
            .inner
            .workspace
            .validate_root(Path::new(&project.root))?;
        let message = self.inner.store.room_message(&delivery.message_id).await?;
        let members = self.inner.store.room_members(&room.id).await?;
        let history = self
            .inner
            .store
            .room_messages(&room.id, None, 30)
            .await
            .unwrap_or_default();

        let mut system = system_prompt(&principal, &config, &room, &project.name, &members);
        let memories = self
            .inner
            .store
            .essential_memories(&principal.id)
            .await
            .unwrap_or_default();
        if let Some(block) = crate::features::rooms::memory_store::essential_prompt(&memories) {
            system.push_str("\n\n");
            system.push_str(&block);
        }
        let prompt = user_prompt(&history, &message);
        let engine = config.engine();

        self.inner
            .store
            .mark_room_delivery(&delivery.id, "running", "")
            .await?;
        self.emit(delivery, "running", "");

        let stored = self
            .inner
            .store
            .room_session(&principal.id, &room.id)
            .await?;
        let same_engine = stored
            .as_ref()
            .map(|(stored_engine, _)| stored_engine.eq_ignore_ascii_case(&engine))
            .unwrap_or(false);
        let session = stored
            .as_ref()
            .filter(|_| same_engine)
            .map(|(_, id)| id.clone());
        let seed = format!("room:{}:bot:{}", room.id, principal.id);

        let routine = self
            .inner
            .store
            .routine_run_by_delivery(&delivery.id)
            .await
            .ok()
            .flatten();
        self.inner
            .browser
            .set_proxy(&format!("bot-{}", principal.id), &config.proxy);
        let config_agent = self
            .inner
            .store
            .setting("onboarding.agent")
            .await
            .unwrap_or_default();
        let admin = config_agent == principal.id;
        let (gateway_url, gateway_handle) = RoomGateway::start(
            self.inner.store.clone(),
            self.clone(),
            self.inner.browser.clone(),
            principal.clone(),
            room.id.clone(),
            room.name.clone(),
            room.project_id.clone(),
            root.clone(),
            routine.as_ref().map(|run| run.id.clone()),
            self.inner.workspace.clone(),
            admin,
            self.inner.vault.clone(),
        )
        .await?;
        let _gateway = GatewayHandle(Some(gateway_handle));
        let mcp_servers = vec![Server {
            id: "jeff".into(),
            name: "jeff".into(),
            transport: "http".into(),
            url: gateway_url,
            command: Vec::new(),
            env: HashMap::new(),
            token: String::new(),
            timeout_seconds: 900,
            auto_approve: true,
        }];

        let answer = match engine.as_str() {
            "claude" => {
                let session = session.unwrap_or_else(|| cli::session_uuid(&seed));
                let resume = same_engine;
                let mut on_tool = |_tool: cli::NativeTool| {};
                let (text, _) = cli::run_claude(
                    &config.model,
                    &config.effort,
                    &system,
                    &prompt,
                    &root,
                    &[],
                    &mcp_servers,
                    &session,
                    resume,
                    cancel,
                    &mut on_tool,
                )
                .await?;
                self.inner
                    .store
                    .save_room_session(&principal.id, &room.id, &engine, &session)
                    .await?;
                text
            }
            "codex" => {
                if config.model.trim().is_empty() {
                    return Err(bad_request("Configure o modelo do bot antes de usá-lo."));
                }
                let mut on_tool = |_tool: cli::NativeTool| {};
                let (text, _, returned) = cli::run_codex(
                    &config.model,
                    &system,
                    &prompt,
                    &root,
                    &[],
                    &mcp_servers,
                    session.as_deref(),
                    cancel,
                    &mut on_tool,
                )
                .await?;
                if let Some(returned) = returned {
                    self.inner
                        .store
                        .save_room_session(&principal.id, &room.id, &engine, &returned)
                        .await?;
                }
                text
            }
            "opencode" => {
                if config.model.trim().is_empty() {
                    return Err(bad_request("Configure o modelo do bot antes de usá-lo."));
                }
                let session = session.unwrap_or_else(|| cli::session_uuid(&seed));
                let (text, _) = cli::run_opencode(
                    &config.model,
                    &system,
                    &prompt,
                    &session,
                    &root,
                    &[],
                    &[],
                    &[],
                    &mcp_servers,
                    cancel,
                    |_: &str| {},
                    |_: &str| {},
                    |_: cli::NativeTool| {},
                )
                .await?;
                self.inner
                    .store
                    .save_room_session(&principal.id, &room.id, &engine, &session)
                    .await?;
                text
            }
            other => {
                return Err(bad_request(format!(
                    "O engine \"{other}\" não está ligado para bots de sala."
                )))
            }
        };

        if let Some(run) = &routine {
            if let Ok(current) = self.inner.store.routine_run(&run.id).await {
                if current.no_update {
                    return Ok(());
                }
            }
        }
        let answer = answer.trim();
        if answer.is_empty() {
            return Err(AppError::Upstream("O engine terminou sem resposta.".into()));
        }
        self.inner
            .store
            .append_room_message(&room.id, &principal.id, answer, "message", None)
            .await?;
        self.notify_completion(delivery, false, answer).await;
        Ok(())
    }
}

fn system_prompt(
    principal: &Principal,
    config: &BotConfig,
    room: &Room,
    project: &str,
    members: &[Principal],
) -> String {
    let mut text = String::new();
    text.push_str(&format!(
        "Você é {} (@{}), {}.\n",
        principal.name,
        principal.handle,
        if config.title.trim().is_empty() {
            "um membro bot da sala"
        } else {
            config.title.trim()
        }
    ));
    if !config.persona.trim().is_empty() {
        text.push('\n');
        text.push_str(config.persona.trim());
        text.push('\n');
    }
    text.push_str(&format!(
        "\nVocê participa da sala \"{}\" do projeto \"{}\".\n",
        room.name, project
    ));
    if !room.title.trim().is_empty() {
        text.push_str(&format!("Assunto da sala: {}\n", room.title.trim()));
    }
    if !room.instructions.trim().is_empty() {
        text.push_str(&format!(
            "Instruções da sala (valem para todos os membros):\n{}\n",
            room.instructions.trim()
        ));
    }
    let roster = members
        .iter()
        .map(|member| {
            format!(
                "@{} ({}, {})",
                member.handle,
                member.name,
                if member.kind == "bot" {
                    "bot"
                } else {
                    "pessoa"
                }
            )
        })
        .collect::<Vec<_>>()
        .join("; ");
    if !roster.is_empty() {
        text.push_str(&format!("Membros: {roster}.\n"));
    }
    text.push_str(
        "\nResponda à mensagem mais recente como esse bot, em texto simples e direto, no idioma do usuário. \
         Não invente falas de outros membros e não descreva o que você faria: faça. \
         Se a mensagem não for para você, responda apenas \"\".",
    );
    text
}

fn user_prompt(history: &[Message], target: &Message) -> String {
    let mut text = String::new();
    if history.len() > 1 {
        text.push_str("Conversa recente da sala:\n");
        let start = history.len().saturating_sub(24);
        for message in &history[start..] {
            if message.id == target.id {
                continue;
            }
            let line = format!(
                "@{}: {}",
                message.author.handle,
                message.text.chars().take(3_000).collect::<String>()
            );
            text.push_str(&line);
            text.push('\n');
            if text.len() > 20_000 {
                break;
            }
        }
        text.push('\n');
    }
    text.push_str(&format!(
        "Mensagem para responder:\n@{}: {}",
        target.author.handle,
        target.text.chars().take(8_000).collect::<String>()
    ));
    text
}
