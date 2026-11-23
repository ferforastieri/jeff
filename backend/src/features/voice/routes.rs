use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{AppState, AuthContext};
use crate::errors::{AppError, AppResult};
use crate::features::voice::service::{SubscribeInput, TrackInput};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VoiceConfigInput {
    app_id: String,
    #[serde(default)]
    secret: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct JoinInput {
    sdp: String,
    #[serde(default)]
    tracks: Vec<TrackInput>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ExchangeInput {
    sdp: String,
    #[serde(default)]
    publish: Vec<TrackInput>,
    #[serde(default)]
    subscribe: Vec<SubscribeInput>,
}

async fn member(
    state: &AppState,
    auth: &AuthContext,
    project: &str,
    room_id: &str,
) -> AppResult<(
    crate::features::rooms::models::Room,
    crate::features::rooms::models::Principal,
)> {
    let room = state.store.room(project, room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    Ok((room, me))
}

pub(super) async fn voice_config(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(state.voice.config().await?))
}

pub(super) async fn save_voice_config(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<VoiceConfigInput>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(state.voice.save(&input.app_id, &input.secret).await?))
}

pub(super) async fn voice_join(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<JoinInput>,
) -> AppResult<Json<Value>> {
    let (room, me) = member(&state, &auth, &project, &room_id).await?;
    let name = if me.name.trim().is_empty() {
        me.handle.clone()
    } else {
        me.name.clone()
    };
    Ok(Json(
        state
            .voice
            .join(&room.id, &me.id, &name, &input.sdp, input.tracks)
            .await?,
    ))
}

pub(super) async fn voice_exchange(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<ExchangeInput>,
) -> AppResult<Json<Value>> {
    let (room, me) = member(&state, &auth, &project, &room_id).await?;
    Ok(Json(
        state
            .voice
            .exchange(&room.id, &me.id, &input.sdp, input.publish, input.subscribe)
            .await?,
    ))
}

pub(super) async fn voice_leave(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let (room, me) = member(&state, &auth, &project, &room_id).await?;
    state.voice.leave(&room.id, &me.id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub(super) async fn voice_participants(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let (room, _me) = member(&state, &auth, &project, &room_id).await?;
    Ok(Json(
        json!({ "participants": state.voice.participants(&room.id) }),
    ))
}
