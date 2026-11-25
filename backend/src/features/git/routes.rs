use super::*;

const GIT_TOKEN_HEADER: &str = "x-jeff-git-token";

pub(super) async fn list_git_connections(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    Ok(Json(
        json!({ "connections": state.git.list(auth.user.id).await }),
    ))
}

#[derive(Deserialize)]
pub(super) struct GitConnectionInput {
    #[serde(default)]
    username: String,
    token: String,
}

pub(super) async fn save_git_connection(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(provider): Path<String>,
    Json(input): Json<GitConnectionInput>,
) -> AppResult<Json<Value>> {
    let connection = state
        .git
        .save(auth.user.id, &provider, &input.username, &input.token)
        .await?;
    Ok(Json(json!(connection)))
}

pub(super) async fn remove_git_connection(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(provider): Path<String>,
) -> AppResult<Json<Value>> {
    state.git.remove(auth.user.id, &provider).await?;
    Ok(Json(json!({ "ok": true })))
}

/// Called by the git credential helper inside a terminal. The helper carries
/// the short-lived token issued when the terminal was created; provider tokens
/// never land in the shell environment.
pub(super) async fn git_credential(
    State(state): State<Arc<AppState>>,
    headers: HeaderMap,
    Query(query): Query<HashMap<String, String>>,
) -> AppResult<Json<Value>> {
    let token = headers
        .get(GIT_TOKEN_HEADER)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default();
    let Some(user_id) = state.git.resolve_terminal_token(token) else {
        return Err(AppError::Unauthorized);
    };
    let host = query.get("host").map(String::as_str).unwrap_or_default();
    let Some(credential) = state.git.credentials_for_host(user_id, host).await else {
        return Err(AppError::NotFound);
    };
    Ok(Json(json!({
        "username": credential.username,
        "password": credential.token,
    })))
}
