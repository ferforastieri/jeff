use std::sync::Arc;

use axum::extract::{Extension, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{AppState, AuthContext};
use crate::errors::{bad_request, AppError, AppResult};
use crate::features::rooms::models::{CreateBotInput, CreateRoomInput};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct OnboardingInput {
    #[serde(default)]
    activity: String,
    #[serde(default)]
    objective: String,
    #[serde(default)]
    tools: String,
    agent_name: String,
    #[serde(default)]
    team_name: String,
    #[serde(default)]
    timezone: String,
    #[serde(default)]
    avatar: Value,
    #[serde(default)]
    workspace_logo: String,
}

async fn read(state: &AppState, key: &str) -> String {
    state.store.setting(key).await.unwrap_or_default()
}

pub(super) async fn onboarding_status(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let done = read(&state, "onboarding.done").await == "1";
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let workspace_state_raw = read(&state, &format!("workspace.state:{}", auth.user.id)).await;
    let workspace_state: Value = serde_json::from_str(&workspace_state_raw).unwrap_or(Value::Null);
    Ok(Json(json!({
        "done": done,
        "activity": read(&state, "onboarding.activity").await,
        "objective": read(&state, "onboarding.objective").await,
        "tools": read(&state, "onboarding.tools").await,
        "teamName": read(&state, "onboarding.team").await,
        "timezone": read(&state, "onboarding.timezone").await,
        "devMode": auth.user.is_admin() || auth.user.dev_access,
        "devAccess": auth.user.dev_access,
        "workspaceLogo": read(&state, "workspace.logo").await,
        "avatar": me.avatar,
        "workspaceState": workspace_state,
        "agentId": read(&state, "onboarding.agent").await,
        "projectId": state.store.workspace_project().await.map(|project| project.id).unwrap_or_default(),
        "displayName": auth.user.display_name,
        "email": state.store.user_email(auth.user.id).await?,
        "isAdmin": auth.user.is_admin(),
        "memberCount": state.store.list_users().await?.len(),
    })))
}

/// The user's workspace preferences (sidebar order, dashboard, task and drive
/// views, status): one JSON document in the settings table, so every browser
/// and the phone open the same workspace.
pub(super) async fn workspace_preferences(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let raw = read(&state, &format!("workspace.preferences:{}", auth.user.id)).await;
    let preferences: Value = serde_json::from_str(&raw).unwrap_or_else(|_| json!({}));
    Ok(Json(json!({ "preferences": preferences })))
}

pub(super) async fn set_workspace_preferences(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<Value>,
) -> AppResult<Json<Value>> {
    if !input.is_object() {
        return Err(bad_request("As preferências precisam ser um objeto."));
    }
    let raw = input.to_string();
    if raw.len() > 256 * 1024 {
        return Err(bad_request("Preferências grandes demais."));
    }
    state
        .store
        .set_setting(&format!("workspace.preferences:{}", auth.user.id), &raw)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct WorkspaceStateInput {
    #[serde(default)]
    project_id: String,
    #[serde(default)]
    room_id: String,
    #[serde(default)]
    view: String,
}

/// The per-user workspace position, so the same project/channel opens on any
/// device. It is navigation state, not a preference.
pub(super) async fn set_workspace_state(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<WorkspaceStateInput>,
) -> AppResult<Json<Value>> {
    let view = match input.view.as_str() {
        "home" | "chat" | "tasks" | "calendar" | "drive" | "wiki" => input.view,
        _ => "home".into(),
    };
    let value = json!({
        "projectId": input.project_id,
        "roomId": input.room_id,
        "view": view,
    });
    state
        .store
        .set_setting(
            &format!("workspace.state:{}", auth.user.id),
            &value.to_string(),
        )
        .await?;
    Ok(Json(value))
}

/// Creates the fixed config agent, its direct conversation and the default
/// room. Everything is reused if a previous attempt stopped halfway, so the
/// wizard can be retried safely.
pub(super) async fn onboarding_complete(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<OnboardingInput>,
) -> AppResult<Json<Value>> {
    if read(&state, "onboarding.done").await == "1" {
        return Err(AppError::Conflict);
    }
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    let timezone = if input.timezone.trim().is_empty() {
        "America/Sao_Paulo"
    } else {
        input.timezone.trim()
    };
    if timezone.parse::<chrono_tz::Tz>().is_err() {
        return Err(bad_request("Fuso horário inválido."));
    }
    let agent_name = input.agent_name.trim();
    if agent_name.is_empty() || agent_name.chars().count() > 60 {
        return Err(bad_request(
            "O agente precisa de um nome de até 60 caracteres.",
        ));
    }
    let project = state.store.workspace_project().await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if input
        .avatar
        .as_object()
        .map(|avatar| !avatar.is_empty())
        .unwrap_or(false)
    {
        state
            .store
            .set_principal_avatar(&me.id, &input.avatar)
            .await?;
    }
    let handle = crate::features::rooms::models::normalize_handle(agent_name);

    let persona = format!(
        "Você é {agent_name}, o agente de configuração deste Jeff. \
Sua pessoa trabalha com {} e quer {}. Ferramentas que já usa: {}. \
Ajude a configurar o workspace: criar projetos, escolher modelos, instalar skills, criar bots, \
salas e rotinas. Explique o próximo passo em vez de despejar um manual. \
Quando faltar uma decisão que muda o caminho, pergunte.",
        if input.activity.trim().is_empty() {
            "trabalho geral"
        } else {
            input.activity.trim()
        },
        if input.objective.trim().is_empty() {
            "organizar o dia a dia"
        } else {
            input.objective.trim()
        },
        if input.tools.trim().is_empty() {
            "nada informado"
        } else {
            input.tools.trim()
        },
    );
    let config_bot = match state
        .store
        .list_bots()
        .await?
        .into_iter()
        .find(|bot| bot.handle == handle)
    {
        Some(bot) => bot,
        None => {
            state
                .store
                .create_bot(CreateBotInput {
                    name: agent_name.to_string(),
                    handle: handle.clone(),
                    title: "configuração do Jeff".into(),
                    persona,
                    engine: "claude".into(),
                    model: String::new(),
                    effort: String::new(),
                    proxy: String::new(),
                })
                .await?
        }
    };

    let rooms = state.store.list_rooms(&project.id).await?;
    let dm = match rooms.iter().find(|room| {
        room.kind == "dm"
            && room.members.iter().any(|member| member.id == config_bot.id)
            && room.members.iter().any(|member| member.id == me.id)
    }) {
        Some(room) => room.clone(),
        None => {
            state
                .store
                .create_dm_room(
                    &project.id,
                    agent_name,
                    &[me.id.clone(), config_bot.id.clone()],
                )
                .await?
        }
    };
    let general = match rooms
        .iter()
        .find(|room| room.kind == "room" && room.name == "Geral")
    {
        Some(room) => room.clone(),
        None => {
            state
                .store
                .create_room(
                    &project.id,
                    &me,
                    CreateRoomInput {
                        name: "Geral".into(),
                        title: String::new(),
                        instructions: String::new(),
                        lead_id: None,
                        member_ids: vec![config_bot.id.clone()],
                        category_id: None,
                        visibility: "public".into(),
                    },
                )
                .await?
        }
    };
    state
        .store
        .add_room_member(&general.id, &config_bot.id)
        .await?;

    for (key, value) in [
        ("onboarding.done", "1".to_string()),
        ("onboarding.activity", input.activity.trim().to_string()),
        ("onboarding.objective", input.objective.trim().to_string()),
        ("onboarding.tools", input.tools.trim().to_string()),
        ("onboarding.team", input.team_name.trim().to_string()),
        ("onboarding.timezone", timezone.to_string()),
        ("onboarding.agent", config_bot.id.clone()),
        ("onboarding.project", project.id.clone()),
    ] {
        state.store.set_setting(key, &value).await?;
    }
    if !input.workspace_logo.trim().is_empty() {
        state
            .store
            .set_setting("workspace.logo", input.workspace_logo.trim())
            .await?;
    }
    let workspace_state = json!({
        "projectId": project.id,
        "roomId": dm.id,
        "view": "home",
    });
    state
        .store
        .set_setting(
            &format!("workspace.state:{}", auth.user.id),
            &workspace_state.to_string(),
        )
        .await?;
    state
        .store
        .set_user_onboarded(auth.user.id, input.activity.trim())
        .await?;

    let invite = state
        .store
        .create_invite(auth.user.id, "member", 30)
        .await?;

    Ok(Json(json!({
        "ok": true,
        "projectId": project.id,
        "agentId": config_bot.id,
        "dmRoomId": dm.id,
        "roomId": general.id,
        "invite": invite,
    })))
}
