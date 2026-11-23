use std::sync::Arc;

use axum::extract::{Extension, Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{AppState, AuthContext};
use crate::errors::{AppError, AppResult};
use crate::features::rooms::models::{CreateMemoryInput, UpdateMemoryInput};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MemoriesQuery {
    q: Option<String>,
    limit: Option<i64>,
}

pub(super) async fn list_memories(
    State(state): State<Arc<AppState>>,
    Path(agent_id): Path<String>,
    Query(query): Query<MemoriesQuery>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    state.store.ensure_human_principal(auth.user.id).await?;
    let agent = state.store.principal(&agent_id).await?;
    if agent.kind != "bot" {
        return Err(AppError::NotFound);
    }
    let memories = match query.q.as_deref().filter(|value| !value.trim().is_empty()) {
        Some(value) => {
            state
                .store
                .search_memories(&agent_id, value.trim(), query.limit.unwrap_or(50))
                .await?
        }
        None => state.store.memories(&agent_id).await?,
    };
    Ok(Json(json!({ "memories": memories })))
}

pub(super) async fn create_memory(
    State(state): State<Arc<AppState>>,
    Path(agent_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<CreateMemoryInput>,
) -> AppResult<Json<Value>> {
    state.store.ensure_human_principal(auth.user.id).await?;
    Ok(Json(json!(
        state.store.remember_memory(&agent_id, input).await?
    )))
}

pub(super) async fn update_memory(
    State(state): State<Arc<AppState>>,
    Path(memory_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<UpdateMemoryInput>,
) -> AppResult<Json<Value>> {
    state.store.ensure_human_principal(auth.user.id).await?;
    Ok(Json(json!(
        state.store.update_memory(&memory_id, input).await?
    )))
}

pub(super) async fn delete_memory(
    State(state): State<Arc<AppState>>,
    Path(memory_id): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    state.store.ensure_human_principal(auth.user.id).await?;
    state.store.delete_memory(&memory_id).await?;
    Ok(Json(json!({ "ok": true })))
}
