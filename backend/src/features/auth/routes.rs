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
pub(super) struct LoginEmailRequest {
    email: String,
    #[serde(default)]
    kind: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ProfileRequest {
    display_name: String,
}

#[derive(Deserialize)]
pub(super) struct PasswordRequest {
    password: String,
}

/// Sets the password of the signed-in account (the first-run screen after the name).
pub(super) async fn set_password(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<AuthContext>,
    Json(input): Json<PasswordRequest>,
) -> AppResult<Json<Value>> {
    let length = input.password.chars().count();
    if length < 8 {
        return Err(AppError::BadRequest(
            "A senha precisa ter pelo menos 8 caracteres.".into(),
        ));
    }
    if length > 128 {
        return Err(AppError::BadRequest(
            "A senha pode ter no máximo 128 caracteres.".into(),
        ));
    }
    let hash = hash_password(&input.password).map_err(|error| AppError::Internal(error.into()))?;
    state
        .store
        .set_user_password(context.user.id, &hash)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Deserialize)]
pub(super) struct EmailStatusRequest {
    email: String,
}

#[derive(Deserialize)]
pub(super) struct RegisterRequest {
    email: String,
    name: String,
    password: String,
    #[serde(default)]
    kind: String,
}

/// Checks the email without creating anything: the account only appears on "Criar conta".
pub(super) async fn email_status(
    State(state): State<Arc<AppState>>,
    Json(input): Json<EmailStatusRequest>,
) -> AppResult<Json<Value>> {
    Ok(Json(json!({
        "exists": state.auth.email_exists(&input.email).await?,
    })))
}

pub(super) async fn register(
    State(state): State<Arc<AppState>>,
    ConnectInfo(connect): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(mut input): Json<RegisterRequest>,
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
    let result = match state
        .auth
        .register_by_email(&input.email, &input.name, &input.password, &input.kind)
        .await
    {
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

pub(super) async fn login_email(
    State(state): State<Arc<AppState>>,
    ConnectInfo(connect): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(mut input): Json<LoginEmailRequest>,
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
    let result = match state.auth.login_by_email(&input.email, &input.kind).await {
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

pub(super) async fn update_profile(
    State(state): State<Arc<AppState>>,
    Extension(context): Extension<AuthContext>,
    Json(input): Json<ProfileRequest>,
) -> AppResult<Json<Value>> {
    let name = input.display_name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(crate::errors::bad_request(
            "Informe um nome de até 80 caracteres.",
        ));
    }
    state
        .store
        .set_user_display_name(context.user.id, name)
        .await?;
    let user = state.store.user_by_id(context.user.id).await?;
    Ok(Json(json!({ "user": user })))
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

pub(super) async fn list_team_principals(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    let mut principals = Vec::new();
    for user in state.store.list_users().await? {
        principals.push(state.store.ensure_human_principal(user.id).await?);
    }
    Ok(Json(json!({ "principals": principals })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RoleRequest {
    #[serde(default)]
    role: Option<String>,
    #[serde(default)]
    dev_access: Option<bool>,
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
    if input.role.is_none() && input.dev_access.is_none() {
        return Err(AppError::BadRequest("Nada para atualizar.".into()));
    }
    let target = state.store.user_by_id(user_id).await?;
    if let Some(role) = input.role.as_deref() {
        if !["admin", "member"].contains(&role) {
            return Err(AppError::BadRequest("Papel inválido.".into()));
        }
        if role == "member" {
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
        state.store.set_user_role(user_id, role).await?;
    }
    if let Some(allowed) = input.dev_access {
        state.store.set_user_dev_access(user_id, allowed).await?;
    }
    // The user row is cached with the session; drop it so role and dev access
    // changes apply on the next request instead of after the cache expires.
    for session_id in state.store.session_ids_for_user(user_id).await? {
        state.auth.invalidate_session_cache(&session_id).await;
    }
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
