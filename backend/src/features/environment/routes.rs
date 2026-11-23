use std::sync::Arc;

use axum::extract::{Extension, State};
use axum::Json;
use serde::Deserialize;
use serde_json::Value;

use super::{AppState, AuthContext};
use crate::errors::{AppError, AppResult};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct InstallInput {
    component: String,
}

pub(super) async fn environment_status(
    State(_state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(crate::features::environment::service::status()))
}

pub(super) async fn environment_install(
    State(_state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<InstallInput>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(
        crate::features::environment::service::install(&input.component).await?,
    ))
}
