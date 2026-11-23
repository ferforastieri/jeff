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
    mode: String,
    #[serde(default)]
    activity: String,
    #[serde(default)]
    objective: String,
    #[serde(default)]
    tools: String,
    agent_name: String,
    project_id: String,
    #[serde(default)]
    team_name: String,
}

async fn read(state: &AppState, key: &str) -> String {
    state.store.setting(key).await.unwrap_or_default()
}

pub(super) async fn onboarding_status(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let done = read(&state, "onboarding.done").await == "1";
    Ok(Json(json!({
        "done": done,
        "mode": read(&state, "onboarding.mode").await,
        "activity": read(&state, "onboarding.activity").await,
        "objective": read(&state, "onboarding.objective").await,
        "tools": read(&state, "onboarding.tools").await,
        "teamName": read(&state, "onboarding.team").await,
        "agentId": read(&state, "onboarding.agent").await,
        "projectId": read(&state, "onboarding.project").await,
        "needsProject": state.store.list_projects_for(auth.user.id, auth.user.is_admin()).await?.is_empty(),
        "isAdmin": auth.user.is_admin(),
    })))
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
    if input.mode != "solo" && input.mode != "team" {
        return Err(bad_request("mode deve ser solo ou team."));
    }
    let agent_name = input.agent_name.trim();
    if agent_name.is_empty() || agent_name.chars().count() > 60 {
        return Err(bad_request(
            "O agente precisa de um nome de até 60 caracteres.",
        ));
    }
    let project = state.store.project(&input.project_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
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
                        member_ids: Vec::new(),
                    },
                )
                .await?
        }
    };

    for (key, value) in [
        ("onboarding.done", "1".to_string()),
        ("onboarding.mode", input.mode.clone()),
        ("onboarding.activity", input.activity.trim().to_string()),
        ("onboarding.objective", input.objective.trim().to_string()),
        ("onboarding.tools", input.tools.trim().to_string()),
        ("onboarding.team", input.team_name.trim().to_string()),
        ("onboarding.agent", config_bot.id.clone()),
        ("onboarding.project", project.id.clone()),
    ] {
        state.store.set_setting(key, &value).await?;
    }
    state
        .store
        .set_user_onboarded(auth.user.id, input.activity.trim())
        .await?;

    let invite = if input.mode == "team" {
        Some(
            state
                .store
                .create_invite(auth.user.id, "member", 30)
                .await?,
        )
    } else {
        None
    };

    Ok(Json(json!({
        "ok": true,
        "projectId": project.id,
        "agentId": config_bot.id,
        "dmRoomId": dm.id,
        "roomId": general.id,
        "invite": invite,
    })))
}
