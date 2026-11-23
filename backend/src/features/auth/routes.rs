use super::*;
use crate::auth::hash_password;

#[derive(Deserialize)]
pub(super) struct LoginRequest {
    #[serde(default)]
    username: String,
    password: String,
    #[serde(default)]
    kind: String,
}

#[derive(Deserialize)]
pub(super) struct PairRequest {
    code: String,
    #[serde(default)]
    kind: String,
}

/// Issues a short-lived one-time code for a phone joining this server. The
/// caller is already authenticated, so the code inherits its user.
pub(super) async fn create_pairing(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<AuthContext>,
) -> Json<Value> {
    let (code, expires_in) = state.pairing.issue(context.user.id);
    Json(json!({ "code": code, "expiresIn": expires_in }))
}

pub(super) async fn pair(
    State(state): State<Arc<AppState>>,
    ConnectInfo(connect): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(mut input): Json<PairRequest>,
) -> Response {
    let key = client_key(&headers, Some(connect), &state.config.trusted_proxies);
    if !state.login_limiter.allow(&key) {
        let mut response = AppError::RateLimited.into_response();
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        return response;
    }
    if input.kind.is_empty() {
        input.kind = "web".into();
    }
    if input.kind != "web" && input.kind != "mobile" {
        return AppError::BadRequest("invalid client kind".into()).into_response();
    }
    let code = input.code.trim();
    let Some(user_id) = state.pairing.consume(code) else {
        return AppError::InvalidCredentials.into_response();
    };
    let result = match state.auth.session_for_user(user_id, &input.kind).await {
        Ok(value) => value,
        Err(error) => return error.into_response(),
    };
    state.login_limiter.reset(&key);
    let mut response = Json(json!({
        "token": if input.kind == "mobile" { result.token.clone() } else { String::new() },
        "csrfToken": result.csrf_token,
        "expiresAt": result.session.expires_at,
        "user": result.user,
    }))
    .into_response();
    if input.kind == "web" {
        append_auth_cookies(
            response.headers_mut(),
            &result.token,
            &result.csrf_token,
            state.auth.secure_cookies(),
        );
    }
    response
}

pub(super) async fn login(
    State(state): State<Arc<AppState>>,
    ConnectInfo(connect): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(mut input): Json<LoginRequest>,
) -> Response {
    let key = client_key(&headers, Some(connect), &state.config.trusted_proxies);
    if !state.login_limiter.allow(&key) {
        let mut response = AppError::RateLimited.into_response();
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        return response;
    }
    if input.username.is_empty() {
        input.username = "admin".into();
    }
    if input.kind.is_empty() {
        input.kind = "web".into();
    }
    if input.kind != "web" && input.kind != "mobile" {
        return AppError::BadRequest("invalid client kind".into()).into_response();
    }
    let result = match state
        .auth
        .login(&input.username, &input.password, &input.kind)
        .await
    {
        Ok(value) => value,
        Err(AppError::Unauthorized | AppError::InvalidCredentials) => {
            return AppError::InvalidCredentials.into_response()
        }
        Err(error) => return error.into_response(),
    };
    state.login_limiter.reset(&key);
    let mut response = Json(json!({
        "token": if input.kind == "mobile" { result.token.clone() } else { String::new() },
        "csrfToken": result.csrf_token,
        "expiresAt": result.session.expires_at,
        "user": result.user,
    }))
    .into_response();
    if input.kind == "web" {
        append_auth_cookies(
            response.headers_mut(),
            &result.token,
            &result.csrf_token,
            state.auth.secure_cookies(),
        );
    }
    response
}

pub(super) fn append_auth_cookies(headers: &mut HeaderMap, token: &str, csrf: &str, secure: bool) {
    let secure_flag = if secure { "; Secure" } else { "" };
    let session = format!(
        "{SESSION_COOKIE}={token}; Path=/; Max-Age=2592000; HttpOnly; SameSite=Strict{secure_flag}"
    );
    let csrf_cookie =
        format!("{CSRF_COOKIE}={csrf}; Path=/; Max-Age=2592000; SameSite=Strict{secure_flag}");
    if let Ok(value) = HeaderValue::from_str(&session) {
        headers.append(header::SET_COOKIE, value);
    }
    if let Ok(value) = HeaderValue::from_str(&csrf_cookie) {
        headers.append(header::SET_COOKIE, value);
    }
}

pub(super) fn clear_auth_cookies(headers: &mut HeaderMap, secure: bool) {
    let secure_flag = if secure { "; Secure" } else { "" };
    for name in [SESSION_COOKIE, CSRF_COOKIE] {
        let value = format!(
            "{name}=; Path=/; Max-Age=0; HttpOnly={}; SameSite=Strict{secure_flag}",
            name == SESSION_COOKIE
        );
        if let Ok(value) = HeaderValue::from_str(&value) {
            headers.append(header::SET_COOKIE, value);
        }
    }
}

pub(super) async fn me(Extension(context): Extension<AuthContext>) -> Json<Value> {
    Json(json!({ "user": context.user, "session": context.session }))
}

pub(super) async fn logout(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<AuthContext>,
) -> Response {
    let _ = state.auth.logout(&context.session.id).await;
    let mut response = Json(json!({ "ok": true })).into_response();
    if context.from_cookie {
        clear_auth_cookies(response.headers_mut(), state.auth.secure_cookies());
    }
    response
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AcceptInviteRequest {
    username: String,
    password: String,
    #[serde(default)]
    display_name: String,
}

pub(super) async fn invite_info(
    State(state): State<Arc<AppState>>,
    Path(token): Path<String>,
) -> AppResult<Json<Value>> {
    let invite = state.store.invite_by_token(&token).await?;
    let valid = invite.used_at.is_none() && invite.expires_at > crate::store::now();
    Ok(Json(json!({
        "valid": valid,
        "role": invite.role,
        "expiresAt": invite.expires_at,
    })))
}

pub(super) async fn accept_invite(
    State(state): State<Arc<AppState>>,
    ConnectInfo(connect): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Path(token): Path<String>,
    Json(input): Json<AcceptInviteRequest>,
) -> Response {
    let key = client_key(&headers, Some(connect), &state.config.trusted_proxies);
    if !state.login_limiter.allow(&key) {
        let mut response = AppError::RateLimited.into_response();
        response
            .headers_mut()
            .insert(header::RETRY_AFTER, HeaderValue::from_static("60"));
        return response;
    }
    let username = input.username.trim();
    let display_name = input.display_name.trim();
    if username.len() < 2 || username.len() > 64 || input.password.len() < 6 {
        return AppError::BadRequest(
            "Usuário com 2 a 64 caracteres e senha com pelo menos 6.".into(),
        )
        .into_response();
    }
    let hash = match hash_password(&input.password) {
        Ok(hash) => hash,
        Err(error) => return AppError::Internal(error).into_response(),
    };
    let user = match state
        .store
        .accept_invite(
            &token,
            username,
            &hash,
            if display_name.is_empty() {
                username
            } else {
                display_name
            },
        )
        .await
    {
        Ok(user) => user,
        Err(AppError::NotFound) => {
            return AppError::BadRequest("Convite inválido ou expirado.".into()).into_response()
        }
        Err(AppError::Conflict) => {
            return AppError::BadRequest("Este usuário já existe.".into()).into_response()
        }
        Err(error) => return error.into_response(),
    };
    state.login_limiter.reset(&key);
    let result = match state.auth.session_for_user(user.id, "web").await {
        Ok(result) => result,
        Err(error) => return error.into_response(),
    };
    let mut response = Json(json!({
        "csrfToken": result.csrf_token,
        "expiresAt": result.session.expires_at,
        "user": result.user,
    }))
    .into_response();
    append_auth_cookies(
        response.headers_mut(),
        &result.token,
        &result.csrf_token,
        state.auth.secure_cookies(),
    );
    response
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CreateInviteRequest {
    #[serde(default)]
    role: String,
    #[serde(default)]
    days: Option<i64>,
}

pub(super) async fn list_invites(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!({ "invites": state.store.invites().await? })))
}

pub(super) async fn create_invite(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<CreateInviteRequest>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    let role = if input.role.is_empty() {
        "member".to_string()
    } else {
        input.role
    };
    let invite = state
        .store
        .create_invite(auth.user.id, &role, input.days.unwrap_or(30))
        .await?;
    Ok(Json(json!(invite)))
}

pub(super) async fn revoke_invite(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(invite_id): Path<String>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.store.revoke_invite(&invite_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub(super) async fn list_users(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!({ "users": state.store.list_users().await? })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RoleRequest {
    role: String,
}

pub(super) async fn set_role(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(user_id): Path<i64>,
    Json(input): Json<RoleRequest>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    if input.role == "member" {
        let target = state.store.user_by_id(user_id).await?;
        let admins = state
            .store
            .list_users()
            .await?
            .iter()
            .filter(|user| user.is_admin())
            .count() as i64;
        if target.is_admin() && admins <= 1 {
            return Err(AppError::BadRequest(
                "O servidor precisa de pelo menos um admin.".into(),
            ));
        }
    }
    state.store.set_user_role(user_id, &input.role).await?;
    Ok(Json(json!({ "ok": true })))
}

pub(super) async fn remove_user(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(user_id): Path<i64>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    if user_id == auth.user.id {
        return Err(AppError::BadRequest(
            "Você não pode apagar a própria conta.".into(),
        ));
    }
    let target = state.store.user_by_id(user_id).await?;
    if target.is_admin() {
        let admins: i64 = state
            .store
            .list_users()
            .await?
            .iter()
            .filter(|user| user.is_admin())
            .count() as i64;
        if admins <= 1 {
            return Err(AppError::BadRequest(
                "O servidor precisa de pelo menos um admin.".into(),
            ));
        }
    }
    state.store.delete_user(user_id).await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProjectMemberRequest {
    user_id: i64,
}

pub(super) async fn list_project_members(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(project_id): Path<String>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.store.project(&project_id).await?;
    Ok(Json(json!({
        "members": state.store.project_members(&project_id).await?,
    })))
}

pub(super) async fn add_project_member(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path(project_id): Path<String>,
    Json(input): Json<ProjectMemberRequest>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    state.store.project(&project_id).await?;
    state.store.user_by_id(input.user_id).await?;
    state
        .store
        .add_project_member(&project_id, input.user_id)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

pub(super) async fn remove_project_member(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Path((project_id, user_id)): Path<(String, i64)>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    state
        .store
        .remove_project_member(&project_id, user_id)
        .await?;
    Ok(Json(json!({ "ok": true })))
}
