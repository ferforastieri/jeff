//! Atlassian Rovo MCP: OAuth 2.1 with dynamic client registration, so a
//! person connects Jira/Confluence/Bitbucket without creating an API token.
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use serde::Deserialize;
use serde_json::json;
use sha2::{Digest, Sha256};

use crate::crypto::random_secret;
use crate::errors::{bad_request, AppError, AppResult};

const REGISTER: &str = "https://mcp.atlassian.com/v1/register";
const AUTHORIZE: &str = "https://mcp.atlassian.com/v1/authorize";
const TOKEN: &str = "https://mcp.atlassian.com/v1/token";
const MCP_URL: &str = "https://mcp.atlassian.com/v2/mcp";
const SCOPES: &str = "read:me read:account offline_access email \
read:jira:agent-interface write:jira:agent-interface search:jira:agent-interface \
read:confluence:agent-interface write:confluence:agent-interface search:confluence:agent-interface \
read:bitbucket:agent-interface write:bitbucket:agent-interface \
read:jsm:agent-interface write:jsm:agent-interface";

struct Pending {
    user_id: i64,
    verifier: String,
    client_id: String,
    redirect_uri: String,
    expires: Instant,
}

#[derive(Clone)]
pub struct AtlassianOAuth {
    pending: Arc<Mutex<HashMap<String, Pending>>>,
    client: reqwest::Client,
}

#[derive(Debug, Deserialize)]
struct Registration {
    client_id: String,
}

#[derive(Debug, Deserialize)]
struct Tokens {
    access_token: String,
    #[serde(default)]
    refresh_token: String,
    #[serde(default)]
    expires_in: i64,
}

impl AtlassianOAuth {
    pub fn new() -> Self {
        Self {
            pending: Arc::new(Mutex::new(HashMap::new())),
            client: reqwest::Client::new(),
        }
    }

    pub async fn start(&self, user_id: i64, base_url: &str) -> AppResult<String> {
        let redirect_uri = format!(
            "{}/api/mcp/atlassian/callback",
            base_url.trim_end_matches('/')
        );
        let registration: Registration = self
            .client
            .post(REGISTER)
            .json(&json!({
                "client_name": "Jeff",
                "redirect_uris": [redirect_uri],
                "grant_types": ["authorization_code", "refresh_token"],
                "response_types": ["code"],
                "token_endpoint_auth_method": "none"
            }))
            .send()
            .await
            .map_err(|error| AppError::ServiceUnavailable(format!("Atlassian OAuth: {error}")))?
            .error_for_status()
            .map_err(|error| AppError::ServiceUnavailable(format!("Atlassian OAuth: {error}")))?
            .json()
            .await
            .map_err(|error| AppError::ServiceUnavailable(format!("Atlassian OAuth: {error}")))?;
        let verifier = random_secret(48);
        let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
        let state = random_secret(24);
        let client_id = registration.client_id;
        if let Ok(mut pending) = self.pending.lock() {
            pending.retain(|_, item| item.expires > Instant::now());
            pending.insert(
                state.clone(),
                Pending {
                    user_id,
                    verifier,
                    client_id: client_id.clone(),
                    redirect_uri: redirect_uri.clone(),
                    expires: Instant::now() + Duration::from_secs(600),
                },
            );
        }
        let url = format!(
            "{AUTHORIZE}?response_type=code&client_id={}&redirect_uri={}&scope={}&state={}&code_challenge={}&code_challenge_method=S256&resource={}",
            urlencoding(&client_id),
            urlencoding(&redirect_uri),
            urlencoding(SCOPES),
            urlencoding(&state),
            challenge,
            urlencoding(MCP_URL),
        );
        Ok(url)
    }

    pub async fn finish(&self, state: &str, code: &str) -> AppResult<(i64, TokensPublic)> {
        let pending = self
            .pending
            .lock()
            .ok()
            .and_then(|mut pending| pending.remove(state))
            .ok_or_else(|| bad_request("Atlassian OAuth expirou; conecte de novo."))?;
        if pending.expires <= Instant::now() {
            return Err(bad_request("Atlassian OAuth expirou; conecte de novo."));
        }
        let response = self
            .client
            .post(TOKEN)
            .form(&[
                ("grant_type", "authorization_code"),
                ("code", code),
                ("redirect_uri", pending.redirect_uri.as_str()),
                ("client_id", pending.client_id.as_str()),
                ("code_verifier", pending.verifier.as_str()),
                ("resource", MCP_URL),
            ])
            .send()
            .await
            .map_err(|error| AppError::ServiceUnavailable(format!("Atlassian OAuth: {error}")))?;
        if !response.status().is_success() {
            let body = response.text().await.unwrap_or_default();
            return Err(bad_request(format!(
                "Atlassian OAuth recusou o código: {body}"
            )));
        }
        let tokens: Tokens = response
            .json()
            .await
            .map_err(|error| AppError::ServiceUnavailable(format!("Atlassian OAuth: {error}")))?;
        Ok((
            pending.user_id,
            TokensPublic {
                access_token: tokens.access_token,
                refresh_token: tokens.refresh_token,
                expires_at: chrono::Utc::now().timestamp_millis() + tokens.expires_in.max(0) * 1000,
            },
        ))
    }
}

pub struct TokensPublic {
    pub access_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

impl AtlassianOAuth {
    pub fn mcp_url() -> &'static str {
        MCP_URL
    }
}

fn urlencoding(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes()).collect()
}
