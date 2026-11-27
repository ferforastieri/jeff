//! Tools a room bot gets for the duration of one delivery. The CLI receives a
//! secret URL and is the only process that knows it, exactly like the dev-mode
//! gateway: cards, memory, messages and the bot's own browser.

use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
    Json, Router,
};
use serde_json::{json, Value};
use tokio::net::TcpListener;
use tokio::task::JoinHandle;

use crate::browser::BrowserManager;
use crate::errors::{bad_request, AppResult};
use crate::features::browser::vault::VaultService;
use crate::features::rooms::models::*;
use crate::features::rooms::queue::RoomQueue;
use crate::features::rooms::schedule::Schedule;
use crate::model::Project;
use crate::platform::store::Store;
use crate::workspace::WorkspaceService;

#[derive(Clone)]
pub struct RoomGateway {
    store: Store,
    rooms: RoomQueue,
    browser: Arc<BrowserManager>,
    principal: Principal,
    room_id: String,
    room_name: String,
    project_id: String,
    root: PathBuf,
    routine_run_id: Option<String>,
    workspace: WorkspaceService,
    admin: bool,
    vault: Arc<VaultService>,
    token: String,
    tools: Vec<Value>,
}

impl RoomGateway {
    #[allow(clippy::too_many_arguments)]
    pub async fn start(
        store: Store,
        rooms: RoomQueue,
        browser: Arc<BrowserManager>,
        principal: Principal,
        room_id: String,
        room_name: String,
        project_id: String,
        root: PathBuf,
        routine_run_id: Option<String>,
        workspace: WorkspaceService,
        admin: bool,
        vault: Arc<VaultService>,
    ) -> AppResult<(String, JoinHandle<()>)> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let port = listener.local_addr()?.port();
        let token = crate::crypto::new_id();
        let routine_tools = routine_run_id.is_some();
        let state = Self {
            store,
            rooms,
            browser,
            principal,
            room_id,
            room_name,
            project_id,
            root,
            routine_run_id,
            workspace,
            admin,
            vault,
            tools: definitions(routine_tools, admin),
            token: token.clone(),
        };
        let app = Router::new()
            .route("/mcp/{token}", post(handle))
            .with_state(state);
        let handle = tokio::spawn(async move {
            if let Err(error) = axum::serve(
                listener,
                app.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .await
            {
                tracing::warn!(%error, "room gateway stopped");
            }
        });
        Ok((format!("http://127.0.0.1:{port}/mcp/{token}"), handle))
    }

    async fn call(&self, name: &str, args: Value) -> AppResult<Value> {
        let admin_tool = matches!(
            name,
            "list_projects"
                | "create_project"
                | "list_agents"
                | "create_bot"
                | "list_rooms"
                | "create_room"
                | "list_routines"
                | "create_routine"
        );
        if admin_tool && !self.admin {
            return Err(bad_request("Ferramenta exclusiva do agente configurador."));
        }
        if matches!(
            name,
            "browser_open"
                | "browser_click"
                | "browser_type"
                | "browser_select"
                | "browser_set_checked"
                | "browser_fill"
                | "browser_drag"
                | "browser_upload"
                | "browser_evaluate"
                | "browser_run_script"
                | "fill_login"
                | "fill_card"
        ) {
            let session = self.session().await?;
            if session.is_takeover() {
                return Err(bad_request(
                    "O humano assumiu o navegador. Pare e peça para devolver o controle.",
                ));
            }
        }
        match name {
            "create_card" => {
                let title = args["title"].as_str().unwrap_or("").trim().to_string();
                if title.is_empty() {
                    return Err(bad_request("O card precisa de um título."));
                }
                let owner = args["owner"]
                    .as_str()
                    .and_then(|value| value.trim().strip_prefix('@').or(Some(value.trim())))
                    .unwrap_or("");
                let owner_id = if owner.is_empty() {
                    self.principal.id.clone()
                } else if owner == self.principal.id
                    || owner.eq_ignore_ascii_case(&self.principal.handle)
                {
                    self.principal.id.clone()
                } else {
                    let members = self.store.room_members(&self.room_id).await?;
                    members
                        .iter()
                        .find(|member| member.handle.eq_ignore_ascii_case(owner))
                        .map(|member| member.id.clone())
                        .unwrap_or_else(|| self.principal.id.clone())
                };
                let card = self
                    .store
                    .create_card(
                        &self.project_id,
                        CreateCardInput {
                            title,
                            description: args["description"].as_str().unwrap_or("").to_string(),
                            owner_id: Some(owner_id),
                            due_at: args["dueAt"].as_i64(),
                            priority: args["priority"].as_str().map(str::to_string),
                            room_id: Some(self.room_id.clone()),
                            message_id: None,
                        },
                        &self.principal.id,
                    )
                    .await?;
                Ok(json!({ "card": card }))
            }
            "move_card" => {
                let card_id = args["cardId"].as_str().unwrap_or("");
                let column = args["column"].as_str().unwrap_or("");
                let card = self.store.card(&self.project_id, card_id).await?;
                self.store
                    .move_card(&self.project_id, &card.id, column)
                    .await?;
                Ok(json!({ "ok": true, "column": column }))
            }
            "list_cards" => Ok(json!({ "cards": self.store.list_cards(&self.project_id).await? })),
            "remember" => {
                let text = args["text"].as_str().unwrap_or("");
                let memory = self
                    .store
                    .remember_memory(
                        &self.principal.id,
                        CreateMemoryInput {
                            text: text.to_string(),
                            inclusion: args["inclusion"].as_str().map(str::to_string),
                            site: None,
                        },
                    )
                    .await?;
                Ok(json!({ "saved": true, "memory": memory }))
            }
            "search_memories" => {
                let query = args["query"].as_str().unwrap_or("");
                let memories = self
                    .store
                    .search_memories(&self.principal.id, query, 10)
                    .await?;
                Ok(json!({ "memories": memories }))
            }
            "send_message" => {
                let to = args["to"]
                    .as_str()
                    .unwrap_or("")
                    .trim()
                    .trim_start_matches('@');
                let text = args["text"].as_str().unwrap_or("").trim();
                if to.is_empty() || text.is_empty() {
                    return Err(bad_request("Informe o destinatário e o texto."));
                }
                let members = self.store.room_members(&self.room_id).await?;
                let target = members
                    .iter()
                    .find(|member| member.handle.eq_ignore_ascii_case(to))
                    .ok_or_else(|| bad_request(format!("Ninguém na sala se chama @{to}.")))?;
                if target.id == self.principal.id {
                    return Err(bad_request("Não mande mensagem para você mesmo."));
                }
                let message = self
                    .store
                    .append_room_message(&self.room_id, &self.principal.id, text, "message", None)
                    .await?;
                let deliveries = self
                    .store
                    .enqueue_room_deliveries(&self.room_id, &message, &[target.id.clone()])
                    .await?;
                for delivery in &deliveries {
                    self.rooms.schedule(delivery.recipient_id.clone());
                }
                Ok(json!({ "sent": true, "deliveries": deliveries.len() }))
            }
            "browser_open" => {
                let url = args["url"].as_str().unwrap_or("").trim();
                let session = self.session().await?;
                Ok(session.open(url).await?)
            }
            "browser_snapshot" => {
                let session = self.session().await?;
                Ok(session.snapshot().await?)
            }
            "browser_read" => {
                let session = self.session().await?;
                Ok(session.read().await?)
            }
            "browser_click" => {
                let reference = args["ref"].as_str().unwrap_or("");
                let session = self.session().await?;
                Ok(session.click_ref(reference).await?)
            }
            "browser_type" => {
                let reference = args["ref"].as_str().unwrap_or("");
                let text = args["text"].as_str().unwrap_or("");
                let session = self.session().await?;
                Ok(session.type_ref(reference, text).await?)
            }
            "list_projects" => Ok(json!({ "projects": self.store.list_projects().await? })),
            "create_project" => {
                let name = args["name"].as_str().unwrap_or("").trim();
                if name.is_empty() {
                    return Err(bad_request("Informe o nome do repo."));
                }
                let parent = args["parent"]
                    .as_str()
                    .map(str::to_string)
                    .or_else(|| {
                        self.workspace
                            .roots()
                            .first()
                            .map(|root| root.to_string_lossy().to_string())
                    })
                    .ok_or_else(|| bad_request("Nenhuma raiz de workspace configurada."))?;
                let repo = self.workspace.create_repo(&parent, name, false).await?;
                let project = self
                    .store
                    .create_project(Project {
                        id: crate::crypto::new_id(),
                        name: name.to_string(),
                        root: repo.path,
                        color: "#0063D1".into(),
                        created_at: crate::platform::store::now(),
                        updated_at: crate::platform::store::now(),
                    })
                    .await?;
                Ok(json!({ "project": project }))
            }
            "list_agents" => Ok(json!({ "agents": self.store.list_bots().await? })),
            "create_bot" => {
                let name = args["name"].as_str().unwrap_or("").trim();
                if name.is_empty() {
                    return Err(bad_request("Informe o nome do bot."));
                }
                let bot = self
                    .store
                    .create_bot(CreateBotInput {
                        name: name.to_string(),
                        handle: args["handle"].as_str().unwrap_or("").to_string(),
                        title: args["title"].as_str().unwrap_or("").to_string(),
                        persona: args["persona"].as_str().unwrap_or("").to_string(),
                        engine: args["engine"].as_str().unwrap_or("claude").to_string(),
                        model: args["model"].as_str().unwrap_or("").to_string(),
                        effort: String::new(),
                        proxy: args["proxy"].as_str().unwrap_or("").to_string(),
                    })
                    .await?;
                Ok(json!({ "agent": bot }))
            }
            "list_rooms" => Ok(json!({ "rooms": self.store.list_rooms(&self.project_id).await? })),
            "create_room" => {
                let name = args["name"].as_str().unwrap_or("").trim();
                if name.is_empty() {
                    return Err(bad_request("Informe o nome da sala."));
                }
                let mut members = args["memberIds"]
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                let current = self.store.room_members(&self.room_id).await?;
                for member in current.iter().filter(|member| member.kind == "human") {
                    if !members.contains(&member.id) {
                        members.push(member.id.clone());
                    }
                }
                let room = self
                    .store
                    .create_room(
                        &self.project_id,
                        &self.principal,
                        CreateRoomInput {
                            name: name.to_string(),
                            icon: String::new(),
                            title: args["title"].as_str().unwrap_or("").to_string(),
                            instructions: args["instructions"].as_str().unwrap_or("").to_string(),
                            lead_id: None,
                            member_ids: members,
                            category_id: None,
                            visibility: "private".into(),
                            repos: Vec::new(),
                        },
                    )
                    .await?;
                Ok(json!({ "room": room }))
            }
            "list_routines" => Ok(json!({
                "routines": self.store.routines_for_room(&self.room_id).await?,
            })),
            "create_routine" => {
                let name = args["name"].as_str().unwrap_or("").trim();
                if name.is_empty() {
                    return Err(bad_request("Informe o nome da rotina."));
                }
                let instruction = args["instruction"].as_str().unwrap_or("").trim();
                if instruction.is_empty() {
                    return Err(bad_request("Informe a instrução da rotina."));
                }
                let schedule: Schedule = serde_json::from_value(args["schedule"].clone())
                    .map_err(|error| bad_request(format!("Agendamento inválido: {error}")))?;
                let bots = self.store.room_bot_members(&self.room_id).await?;
                let agent = args["agentHandle"]
                    .as_str()
                    .and_then(|handle| {
                        let wanted = handle.trim().trim_start_matches('@');
                        bots.iter()
                            .find(|bot| bot.handle.eq_ignore_ascii_case(wanted))
                            .cloned()
                    })
                    .unwrap_or_else(|| self.principal.clone());
                let routine = self
                    .store
                    .create_routine(
                        &self.project_id,
                        &self.room_id,
                        CreateRoutineInput {
                            agent_id: agent.id,
                            name: name.to_string(),
                            instruction: instruction.to_string(),
                            schedule,
                            timezone: args["timezone"].as_str().unwrap_or("UTC").to_string(),
                            active: true,
                            limit_policy: None,
                            missed_policy: None,
                        },
                    )
                    .await?;
                Ok(json!({ "routine": routine }))
            }
            "list_vault" => Ok(json!({
                "items": self.vault.list(&self.project_id).await?,
            })),
            "fill_login" => {
                let (item, secret) = self
                    .vault
                    .secret(&self.project_id, args["vaultId"].as_str().unwrap_or(""))
                    .await?;
                let session = self.session().await?;
                if let Some(reference) = args["refUsername"]
                    .as_str()
                    .filter(|value| !value.is_empty())
                {
                    session.type_ref(reference, &item.username).await?;
                }
                session
                    .fill_secret(args["refPassword"].as_str().unwrap_or(""), &secret)
                    .await?;
                Ok(json!({ "ok": true, "filled": true }))
            }
            "fill_card" => {
                let (item, number) = self
                    .vault
                    .secret(&self.project_id, args["vaultId"].as_str().unwrap_or(""))
                    .await?;
                let session = self.session().await?;
                session
                    .fill_secret(args["refNumber"].as_str().unwrap_or(""), &number)
                    .await?;
                for (key, reference) in [
                    ("expiry", args["refExpiry"].as_str()),
                    ("cvc", args["refCvc"].as_str()),
                    ("holder", args["refHolder"].as_str()),
                ] {
                    if let Some(reference) = reference.filter(|value| !value.is_empty()) {
                        if let Some(value) =
                            item.meta[key].as_str().filter(|value| !value.is_empty())
                        {
                            session.type_ref(reference, value).await?;
                        }
                    }
                }
                Ok(json!({ "ok": true, "filled": true }))
            }
            "browser_record_start" => {
                let session = self.session().await?;
                session.record_start();
                Ok(json!({ "recording": true }))
            }
            "browser_record_stop" => {
                let session = self.session().await?;
                Ok(json!({ "steps": session.record_stop() }))
            }
            "browser_teach_stop" => {
                let session = self.session().await?;
                let steps = session.record_stop();
                let title = args["title"].as_str().unwrap_or("Receita ensinada");
                Ok(json!({ "skill": teach_skill(title, &steps) }))
            }
            "browser_evaluate" | "browser_run_script" => {
                let expression = args["expression"].as_str().unwrap_or("");
                let session = self.session().await?;
                Ok(session.evaluate(expression).await?)
            }
            "browser_select" => {
                let reference = args["ref"].as_str().unwrap_or("");
                let value = args["value"].as_str().unwrap_or("");
                let session = self.session().await?;
                Ok(session.select_option(reference, value).await?)
            }
            "browser_set_checked" => {
                let reference = args["ref"].as_str().unwrap_or("");
                let checked = args["checked"].as_bool().unwrap_or(false);
                let session = self.session().await?;
                Ok(session.set_checked(reference, checked).await?)
            }
            "browser_wait_for" => {
                let text = args["text"].as_str().unwrap_or("");
                let timeout = args["timeoutMs"].as_u64().unwrap_or(10_000);
                let session = self.session().await?;
                Ok(session.wait_for_text(text, timeout).await?)
            }
            "browser_fill" => {
                let fields = args["fields"]
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(|item| {
                                Some((
                                    item["ref"].as_str()?.to_string(),
                                    item["value"].as_str()?.to_string(),
                                ))
                            })
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if fields.is_empty() {
                    return Err(bad_request("Informe os campos."));
                }
                let session = self.session().await?;
                Ok(session.fill_fields(&fields).await?)
            }
            "browser_drag" => {
                let session = self.session().await?;
                Ok(session
                    .drag_ref(
                        args["from"].as_str().unwrap_or(""),
                        args["to"].as_str().unwrap_or(""),
                    )
                    .await?)
            }
            "browser_screenshot" => {
                let session = self.session().await?;
                Ok(session.screenshot().await?)
            }
            "browser_environment" => {
                let session = self.session().await?;
                Ok(session
                    .set_environment(
                        args["width"].as_u64().map(|value| value as u32),
                        args["height"].as_u64().map(|value| value as u32),
                        args["colorScheme"].as_str(),
                        args["reducedMotion"].as_bool(),
                    )
                    .await?)
            }
            "browser_upload" => {
                let reference = args["ref"].as_str().unwrap_or("");
                let paths = args["paths"]
                    .as_array()
                    .map(|items| {
                        items
                            .iter()
                            .filter_map(Value::as_str)
                            .map(str::to_string)
                            .collect::<Vec<_>>()
                    })
                    .unwrap_or_default();
                if paths.is_empty() {
                    return Err(bad_request("Informe os arquivos."));
                }
                let root = std::fs::canonicalize(&self.root).unwrap_or_else(|_| self.root.clone());
                let mut allowed = Vec::new();
                for path in paths {
                    let canonical = std::fs::canonicalize(&path)
                        .map_err(|_| bad_request(format!("Arquivo não encontrado: {path}")))?;
                    if !canonical.starts_with(&root) {
                        return Err(bad_request("Upload fora do repo."));
                    }
                    allowed.push(canonical.to_string_lossy().to_string());
                }
                let session = self.session().await?;
                Ok(session.upload_files(reference, &allowed).await?)
            }
            "routine_no_update" => {
                let Some(run_id) = &self.routine_run_id else {
                    return Err(bad_request(
                        "Esta ferramenta só existe numa execução de rotina.",
                    ));
                };
                self.store.set_routine_no_update(run_id).await?;
                Ok(json!({ "recorded": true }))
            }
            "routine_report_failure" => {
                let Some(run_id) = &self.routine_run_id else {
                    return Err(bad_request(
                        "Esta ferramenta só existe numa execução de rotina.",
                    ));
                };
                let reason = args["reason"].as_str().unwrap_or("A rotina falhou.");
                self.store
                    .set_routine_run_status(run_id, "failed", reason)
                    .await?;
                Ok(json!({ "recorded": true }))
            }
            other => Err(bad_request(format!("Ferramenta desconhecida: {other}"))),
        }
    }

    async fn session(&self) -> AppResult<Arc<crate::browser::BrowserSession>> {
        self.browser
            .session(&format!("bot-{}", self.principal.id), &self.root)
            .await
    }
}

fn teach_skill(title: &str, steps: &[Value]) -> String {
    let mut markdown = format!("# {}\n\n", title.trim());
    markdown
        .push_str("Receita gravada no navegador. Confirme os seletores antes de reutilizar.\n\n");
    for step in steps {
        match step["action"].as_str().unwrap_or("") {
            "open" => markdown.push_str(&format!(
                "- Abrir `{}`.\n",
                step["url"].as_str().unwrap_or("")
            )),
            "click" => markdown.push_str(&format!(
                "- Clicar em **{}**.\n",
                step["label"]
                    .as_str()
                    .filter(|value| !value.is_empty())
                    .unwrap_or("o elemento")
            )),
            "type" => markdown.push_str(&format!(
                "- Digitar em **{}**: `{}`.\n",
                step["label"]
                    .as_str()
                    .filter(|value| !value.is_empty())
                    .unwrap_or("o campo"),
                step["text"].as_str().unwrap_or("")
            )),
            "fill-secret" => markdown.push_str("- Preencher a senha a partir do cofre.\n"),
            _ => {}
        }
    }
    markdown.push_str(
        "\n## Verificação\n\nConfirme o resultado antes de dar a tarefa por concluída.\n",
    );
    markdown
}

fn text_tool(name: &str, description: &str, properties: Value, required: Vec<&str>) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
        }
    })
}

fn definitions(routine: bool, admin: bool) -> Vec<Value> {
    let mut tools = vec![
        text_tool(
            "create_card",
            "Abre um card no quadro do repo. Use quando a pessoa pedir trabalho que precisa de acompanhamento.",
            json!({
                "title": { "type": "string", "description": "Título curto do card." },
                "description": { "type": "string" },
                "owner": { "type": "string", "description": "Handle de quem fica responsável; vazio é você." },
                "dueAt": { "type": "integer", "description": "Prazo em ms desde 1970." },
                "priority": { "type": "string", "enum": ["low","normal","high","urgent"] }
            }),
            vec!["title"],
        ),
        text_tool(
            "move_card",
            "Move um card do repo para outra coluna.",
            json!({
                "cardId": { "type": "string" },
                "column": { "type": "string", "enum": ["todo","doing","review","blocked","done"] }
            }),
            vec!["cardId", "column"],
        ),
        text_tool(
            "list_cards",
            "Lista os cards do repo.",
            json!({}),
            vec![],
        ),
        text_tool(
            "remember",
            "Guarda um fato durável sobre você ou sobre o trabalho. Memórias essenciais entram em todo prompt.",
            json!({
                "text": { "type": "string" },
                "inclusion": { "type": "string", "enum": ["essential","searchable"] }
            }),
            vec!["text"],
        ),
        text_tool(
            "search_memories",
            "Busca nas suas memórias guardadas.",
            json!({ "query": { "type": "string" } }),
            vec!["query"],
        ),
        text_tool(
            "send_message",
            "Manda uma mensagem para outro membro da sala; ela entra na fila dele.",
            json!({
                "to": { "type": "string", "description": "Handle do destinatário, com ou sem @." },
                "text": { "type": "string" }
            }),
            vec!["to", "text"],
        ),
        text_tool(
            "browser_open",
            "Abre uma URL no seu navegador privado e persistente. Logins ficam guardados entre execuções.",
            json!({ "url": { "type": "string" } }),
            vec!["url"],
        ),
        text_tool(
            "browser_read",
            "Lê URL, título, texto, console e rede da página atual.",
            json!({}),
            vec![],
        ),
        text_tool(
            "browser_snapshot",
            "Lista os controles visíveis com referências estáveis. Chame antes de clicar ou digitar.",
            json!({}),
            vec![],
        ),
        text_tool(
            "browser_click",
            "Clica num elemento pela referência do último snapshot.",
            json!({ "ref": { "type": "string", "description": "Ex.: r12" } }),
            vec!["ref"],
        ),
        text_tool(
            "browser_type",
            "Foca um campo pela referência do último snapshot e digita.",
            json!({
                "ref": { "type": "string" },
                "text": { "type": "string" }
            }),
            vec!["ref", "text"],
        ),
    ];
    tools.push(text_tool(
        "browser_evaluate",
        "Roda JavaScript na página atual e devolve o valor.",
        json!({ "expression": { "type": "string" } }),
        vec!["expression"],
    ));
    tools.push(text_tool(
        "browser_select",
        "Escolhe uma opção num select pela referência do snapshot.",
        json!({ "ref": { "type": "string" }, "value": { "type": "string" } }),
        vec!["ref", "value"],
    ));
    tools.push(text_tool(
        "browser_set_checked",
        "Marca ou desmarca um checkbox pela referência do snapshot.",
        json!({ "ref": { "type": "string" }, "checked": { "type": "boolean" } }),
        vec!["ref", "checked"],
    ));
    tools.push(text_tool(
        "browser_wait_for",
        "Espera um texto aparecer na página, até 30 segundos.",
        json!({ "text": { "type": "string" }, "timeoutMs": { "type": "integer" } }),
        vec!["text"],
    ));
    tools.push(text_tool(
        "list_vault",
        "Lista os logins e cartões guardados no cofre do repo. Nunca devolve a senha.",
        json!({}),
        vec![],
    ));
    tools.push(text_tool(
        "fill_login",
        "Preenche usuário e senha de um item do cofre sem revelar a senha.",
        json!({
            "vaultId": { "type": "string" },
            "refUsername": { "type": "string" },
            "refPassword": { "type": "string" }
        }),
        vec!["vaultId", "refPassword"],
    ));
    tools.push(text_tool(
        "fill_card",
        "Preenche um cartão do cofre num formulário.",
        json!({
            "vaultId": { "type": "string" },
            "refNumber": { "type": "string" },
            "refExpiry": { "type": "string" },
            "refCvc": { "type": "string" },
            "refHolder": { "type": "string" }
        }),
        vec!["vaultId", "refNumber"],
    ));
    tools.push(text_tool(
        "browser_record_start",
        "Começa a gravar os passos do navegador para ensinar uma receita.",
        json!({}),
        vec![],
    ));
    tools.push(text_tool(
        "browser_record_stop",
        "Para a gravação e devolve os passos.",
        json!({}),
        vec![],
    ));
    tools.push(text_tool(
        "browser_teach_stop",
        "Para a gravação e devolve um SKILL.md com o passo a passo.",
        json!({ "title": { "type": "string" } }),
        vec!["title"],
    ));
    tools.push(text_tool(
        "browser_fill",
        "Preenche vários campos de uma vez com referências do último snapshot.",
        json!({
            "fields": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ref": { "type": "string" },
                        "value": { "type": "string" }
                    },
                    "required": ["ref", "value"]
                }
            }
        }),
        vec!["fields"],
    ));
    tools.push(text_tool(
        "browser_drag",
        "Arrasta um elemento até outro pelas referências do snapshot.",
        json!({ "from": { "type": "string" }, "to": { "type": "string" } }),
        vec!["from", "to"],
    ));
    tools.push(text_tool(
        "browser_screenshot",
        "Tira um screenshot PNG da página atual.",
        json!({}),
        vec![],
    ));
    tools.push(text_tool(
        "browser_environment",
        "Muda viewport, tema e redução de movimento.",
        json!({
            "width": { "type": "integer" },
            "height": { "type": "integer" },
            "colorScheme": { "type": "string", "enum": ["light","dark"] },
            "reducedMotion": { "type": "boolean" }
        }),
        vec![],
    ));
    tools.push(text_tool(
        "browser_upload",
        "Envia arquivos do repo para um input de arquivo pela referência do snapshot.",
        json!({
            "ref": { "type": "string" },
            "paths": { "type": "array", "items": { "type": "string" } }
        }),
        vec!["ref", "paths"],
    ));
    if admin {
        tools.push(text_tool(
            "list_projects",
            "Lista os repos disponíveis.",
            json!({}),
            vec![],
        ));
        tools.push(text_tool(
            "create_project",
            "Cria uma pasta de repo dentro de uma raiz permitida e a registra no Jeff.",
            json!({
                "name": { "type": "string" },
                "parent": { "type": "string", "description": "Raiz onde a pasta nasce; vazio usa a primeira." }
            }),
            vec!["name"],
        ));
        tools.push(text_tool(
            "list_agents",
            "Lista os bots do workspace.",
            json!({}),
            vec![],
        ));
        tools.push(text_tool(
            "create_bot",
            "Cria um bot. Use engine claude, codex ou opencode.",
            json!({
                "name": { "type": "string" },
                "handle": { "type": "string" },
                "title": { "type": "string" },
                "persona": { "type": "string" },
                "engine": { "type": "string", "enum": ["claude","codex","opencode"] },
                "model": { "type": "string" },
                "proxy": { "type": "string" }
            }),
            vec!["name"],
        ));
        tools.push(text_tool(
            "list_rooms",
            "Lista os canais.",
            json!({}),
            vec![],
        ));
        tools.push(text_tool(
            "create_room",
            "Cria um canal e coloca você e as pessoas do canal atual dentro.",
            json!({
                "name": { "type": "string" },
                "title": { "type": "string" },
                "instructions": { "type": "string" },
                "memberIds": { "type": "array", "items": { "type": "string" } }
            }),
            vec!["name"],
        ));
        tools.push(text_tool(
            "list_routines",
            "Lista as rotinas desta sala.",
            json!({}),
            vec![],
        ));
        tools.push(text_tool(
            "create_routine",
            "Cria uma rotina nesta sala para um bot.",
            json!({
                "agentHandle": { "type": "string" },
                "name": { "type": "string" },
                "instruction": { "type": "string" },
                "schedule": { "type": "object" },
                "timezone": { "type": "string" }
            }),
            vec!["name", "instruction", "schedule"],
        ));
    }
    if routine {
        tools.push(text_tool(
            "routine_no_update",
            "Só numa rotina: nada a reportar. Não escreva texto antes.",
            json!({}),
            vec![],
        ));
        tools.push(text_tool(
            "routine_report_failure",
            "Só numa rotina: a tarefa não pôde ser feita. Encerra a execução como falha.",
            json!({ "reason": { "type": "string" } }),
            vec!["reason"],
        ));
    }
    tools
}

async fn handle(
    State(state): State<RoomGateway>,
    Path(token): Path<String>,
    Json(body): Json<Value>,
) -> Response {
    if token != state.token {
        return StatusCode::NOT_FOUND.into_response();
    }
    let id = body.get("id").cloned().unwrap_or(Value::Null);
    let reply =
        |result: Value| Json(json!({"jsonrpc":"2.0","id":id,"result":result})).into_response();
    match body["method"].as_str().unwrap_or("") {
        "initialize" => {
            let protocol = body
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-03-26");
            reply(json!({
                "protocolVersion": protocol,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "jeff-room", "version": env!("CARGO_PKG_VERSION") },
                "instructions": format!(
                    "Ferramentas da sala \"{}\". Use-as para agir, não para descrever o que faria.",
                    state.room_name
                )
            }))
        }
        "notifications/initialized" => StatusCode::ACCEPTED.into_response(),
        "ping" => reply(json!({})),
        "tools/list" => reply(json!({ "tools": state.tools })),
        "tools/call" => {
            let name = body
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let args = body
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or_else(|| json!({}));
            tracing::debug!(name, "room gateway call");
            match state.call(name, args).await {
                Ok(result) => {
                    if let Some(image) = result.get("__image") {
                        let data = image["data"].as_str().unwrap_or("");
                        let mime = image["mimeType"].as_str().unwrap_or("image/png");
                        reply(json!({
                            "content": [{ "type": "image", "data": data, "mimeType": mime }],
                            "isError": false
                        }))
                    } else {
                        reply(json!({
                            "content": [{ "type": "text", "text": result.to_string() }],
                            "isError": false
                        }))
                    }
                }
                Err(error) => reply(json!({
                    "content": [{ "type": "text", "text": error.to_string() }],
                    "isError": true
                })),
            }
        }
        other => Json(json!({
            "jsonrpc":"2.0","id":id,
            "error": { "code": -32601, "message": format!("Método não suportado: {other}") }
        }))
        .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::rooms::models::{CreateBotInput, CreateRoomInput};
    use crate::workspace::WorkspaceService;
    use std::time::Duration;

    async fn rpc(url: &str, body: Value) -> Value {
        reqwest::Client::new()
            .post(url)
            .timeout(Duration::from_secs(5))
            .json(&body)
            .send()
            .await
            .unwrap()
            .json()
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn gateway_lets_a_room_bot_open_cards_and_remember() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("workspace");
        std::fs::create_dir_all(&root).unwrap();
        let store = Store::open(&dir.path().join("jeff.db")).await.unwrap();
        sqlx::query(
            "INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'fer','x','now')",
        )
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO projects(id,name,root,color,created_at,updated_at) VALUES('p1','P',$1,'#000','0','0')",
        )
        .bind(root.to_string_lossy().to_string())
        .execute(&store.pool)
        .await
        .unwrap();
        let me = store.ensure_human_principal(1).await.unwrap();
        let bot = store
            .create_bot(CreateBotInput {
                name: "Ana".into(),
                handle: "ana".into(),
                title: "revisora".into(),
                persona: String::new(),
                engine: "claude".into(),
                model: String::new(),
                effort: String::new(),
                proxy: String::new(),
            })
            .await
            .unwrap();
        let room = store
            .create_room(
                "p1",
                &me,
                CreateRoomInput {
                    name: "Geral".into(),
                    icon: String::new(),
                    title: String::new(),
                    instructions: String::new(),
                    lead_id: Some(bot.id.clone()),
                    member_ids: vec![bot.id.clone()],
                    category_id: None,
                    visibility: "private".into(),
                    repos: Vec::new(),
                },
            )
            .await
            .unwrap();

        let browser = Arc::new(BrowserManager::new(dir.path().to_path_buf()));
        let vault = Arc::new(
            crate::features::browser::vault::VaultService::new(
                store.clone(),
                &dir.path().join("master.key"),
            )
            .unwrap(),
        );
        let queue = RoomQueue::new(
            store.clone(),
            WorkspaceService::new(vec![root.clone()]).unwrap(),
            browser.clone(),
            vault.clone(),
        );
        let (url, handle) = RoomGateway::start(
            store.clone(),
            queue,
            browser,
            bot.clone(),
            room.id.clone(),
            room.name.clone(),
            room.project_id.clone(),
            root,
            None,
            WorkspaceService::new(vec![dir.path().to_path_buf()]).unwrap(),
            false,
            vault,
        )
        .await
        .unwrap();

        let listed = rpc(
            &url,
            json!({"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}),
        )
        .await;
        let names = listed["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|tool| tool["name"].as_str())
            .collect::<Vec<_>>();
        assert!(names.contains(&"create_card"));
        assert!(names.contains(&"remember"));
        assert!(names.contains(&"browser_snapshot"));
        assert!(!names.contains(&"routine_no_update"));

        let card = rpc(
            &url,
            json!({
                "jsonrpc":"2.0","id":2,"method":"tools/call",
                "params":{"name":"create_card","arguments":{"title":"Revisar o diff","priority":"high"}}
            }),
        )
        .await;
        assert_eq!(card["result"]["isError"], false);
        let cards = store.list_cards("p1").await.unwrap();
        assert_eq!(cards.len(), 1);
        assert_eq!(cards[0].owner_id.as_deref(), Some(bot.id.as_str()));
        assert_eq!(cards[0].priority, "high");

        let memory = rpc(
            &url,
            json!({
                "jsonrpc":"2.0","id":3,"method":"tools/call",
                "params":{"name":"remember","arguments":{"text":"Prefere respostas curtas.","inclusion":"essential"}}
            }),
        )
        .await;
        assert_eq!(memory["result"]["isError"], false);
        assert_eq!(store.essential_memories(&bot.id).await.unwrap().len(), 1);

        let found = rpc(
            &url,
            json!({
                "jsonrpc":"2.0","id":4,"method":"tools/call",
                "params":{"name":"search_memories","arguments":{"query":"curtas"}}
            }),
        )
        .await;
        assert_eq!(found["result"]["isError"], false);
        assert!(found["result"]["content"][0]["text"]
            .as_str()
            .unwrap_or_default()
            .contains("curtas"));

        handle.abort();
    }
}
