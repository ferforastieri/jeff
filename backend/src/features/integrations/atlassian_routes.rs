use super::*;

fn origin(headers: &HeaderMap) -> String {
    let proto = headers
        .get("x-forwarded-proto")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("https");
    let host = headers
        .get("x-forwarded-host")
        .or_else(|| headers.get(header::HOST))
        .and_then(|v| v.to_str().ok())
        .unwrap_or("jeff.fer.tec.br");
    format!("{proto}://{host}")
}

pub(super) async fn atlassian_start(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    headers: HeaderMap,
) -> AppResult<Json<Value>> {
    let url = state
        .atlassian
        .start(auth.user.id, &origin(&headers))
        .await?;
    Ok(Json(json!({ "url": url })))
}

#[derive(Deserialize)]
pub(super) struct CallbackQuery {
    code: String,
    state: String,
}

pub(super) async fn atlassian_callback(
    State(state): State<Arc<AppState>>,
    Query(query): Query<CallbackQuery>,
) -> AppResult<Redirect> {
    let (_user_id, tokens) = state.atlassian.finish(&query.state, &query.code).await?;
    state
        .mcp
        .upsert_oauth(
            "Atlassian (Jira, Confluence, Bitbucket)",
            crate::features::integrations::atlassian::AtlassianOAuth::mcp_url(),
            &tokens.access_token,
        )
        .await?;
    Ok(Redirect::to("/app/?connector=atlassian"))
}
