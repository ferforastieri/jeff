use std::sync::Arc;

use axum::extract::{Extension, Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{AppState, AuthContext};
use crate::errors::{AppError, AppResult};
use crate::features::rooms::models::{CreateRoutineInput, UpdateRoutineInput};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RunsQuery {
    limit: Option<i64>,
}

pub(super) async fn list_project_routines(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    state.store.ensure_human_principal(auth.user.id).await?;
    Ok(Json(json!({
        "routines": state.store.routines_for_project(&project).await?,
    })))
}

pub(super) async fn list_room_routines(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!({
        "routines": state.store.routines_for_room(&room.id).await?,
    })))
}

pub(super) async fn create_routine(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<CreateRoutineInput>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!(
        state
            .store
            .create_routine(&project, &room.id, input)
            .await?
    )))
}

pub(super) async fn update_routine(
    State(state): State<Arc<AppState>>,
    Path((project, routine_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<UpdateRoutineInput>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let routine = state
        .store
        .update_routine(&project, &routine_id, input)
        .await?;
    let _ = state
        .store
        .log_room_event(
            &project,
            Some(&routine.room_id),
            None,
            Some(&me.id),
            "routine.updated",
            &routine.name,
        )
        .await;
    Ok(Json(json!(routine)))
}

pub(super) async fn delete_routine(
    State(state): State<Arc<AppState>>,
    Path((project, routine_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let routine = state.store.routine(&project, &routine_id).await?;
    state.store.delete_routine(&project, &routine_id).await?;
    let _ = state
        .store
        .log_room_event(
            &project,
            Some(&routine.room_id),
            None,
            Some(&me.id),
            "routine.deleted",
            &routine.name,
        )
        .await;
    Ok(Json(json!({ "ok": true })))
}

pub(super) async fn test_routine(
    State(state): State<Arc<AppState>>,
    Path((project, routine_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let routine = state.store.routine(&project, &routine_id).await?;
    let run = state.routines.run_now(&project, &routine_id).await?;
    let _ = state
        .store
        .log_room_event(
            &project,
            Some(&routine.room_id),
            None,
            Some(&me.id),
            "routine.tested",
            &routine.name,
        )
        .await;
    Ok(Json(json!(run)))
}

pub(super) async fn list_routine_runs(
    State(state): State<Arc<AppState>>,
    Path((project, routine_id)): Path<(String, String)>,
    Query(query): Query<RunsQuery>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    state.store.routine(&project, &routine_id).await?;
    Ok(Json(json!({
        "runs": state
            .store
            .routine_runs(&routine_id, query.limit.unwrap_or(30))
            .await?,
    })))
}
