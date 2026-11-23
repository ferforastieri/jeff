use std::sync::Arc;

use axum::extract::{Extension, Path, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};

use super::{AppState, AuthContext};
use crate::errors::{AppError, AppResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct VaultInput {
    kind: String,
    name: String,
    #[serde(default)]
    username: String,
    secret: String,
    #[serde(default)]
    meta: Value,
}

pub(super) async fn list_vault(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.store.project(&project).await?;
    Ok(Json(json!({ "items": state.vault.list(&project).await? })))
}

pub(super) async fn add_vault(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<VaultInput>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.store.project(&project).await?;
    Ok(Json(json!(
        state
            .vault
            .add(
                &project,
                &input.kind,
                &input.name,
                &input.username,
                &input.secret,
                input.meta
            )
            .await?
    )))
}

pub(super) async fn delete_vault(
    State(state): State<Arc<AppState>>,
    Path((project, id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.vault.delete(&project, &id).await?;
    Ok(Json(json!({ "ok": true })))
}
