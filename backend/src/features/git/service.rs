use std::path::Path;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

use crate::crypto::{decrypt, encrypt, load_or_create_key, random_secret};
use crate::errors::{AppError, AppResult};
use crate::store::Store;

const PROVIDERS: [&str; 2] = ["github", "bitbucket"];

#[derive(Clone)]
pub struct GitService {
    store: Store,
    key: Arc<Vec<u8>>,
    /// Terminal sessions get an opaque token; the credential helper exchanges
    /// it for the connected user's Git credentials without putting the token
    /// itself in the shell history.
    sessions: Arc<Mutex<std::collections::HashMap<String, i64>>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct StoredCredential {
    pub username: String,
    pub token: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConnection {
    pub provider: String,
    pub username: String,
    pub connected: bool,
}

impl GitService {
    pub fn new(store: Store, key_file: &Path) -> AppResult<Self> {
        let key = load_or_create_key(key_file).map_err(|error| AppError::Internal(error.into()))?;
        Ok(Self {
            store,
            key: Arc::new(key),
            sessions: Arc::new(Mutex::new(std::collections::HashMap::new())),
        })
    }

    fn setting_key(user_id: i64, provider: &str) -> String {
        format!("git.{provider}.user.{user_id}")
    }

    fn provider(value: &str) -> AppResult<&'static str> {
        let normalized = value.trim().to_lowercase();
        PROVIDERS
            .iter()
            .copied()
            .find(|provider| *provider == normalized)
            .ok_or_else(|| AppError::BadRequest("Provedor Git inválido.".into()))
    }

    async fn read(&self, user_id: i64, provider: &str) -> Option<StoredCredential> {
        let raw = self
            .store
            .setting(&Self::setting_key(user_id, provider))
            .await
            .ok()?;
        if raw.trim().is_empty() {
            return None;
        }
        let plain = decrypt(&self.key, &raw).ok()?;
        serde_json::from_str(&plain).ok()
    }

    pub async fn list(&self, user_id: i64) -> Vec<PublicConnection> {
        let mut connections = Vec::with_capacity(PROVIDERS.len());
        for provider in PROVIDERS {
            let stored = self.read(user_id, provider).await;
            connections.push(PublicConnection {
                provider: provider.to_string(),
                username: stored
                    .as_ref()
                    .map(|item| item.username.clone())
                    .unwrap_or_default(),
                connected: stored.is_some(),
            });
        }
        connections
    }

    pub async fn save(
        &self,
        user_id: i64,
        provider: &str,
        username: &str,
        token: &str,
    ) -> AppResult<PublicConnection> {
        let provider = Self::provider(provider)?;
        let token = token.trim();
        if token.is_empty() {
            return Err(AppError::BadRequest("Informe o token do Git.".into()));
        }
        let username = username.trim();
        let username = if username.is_empty() {
            if provider == "github" {
                "x-access-token"
            } else {
                "x-token-auth"
            }
        } else {
            username
        };
        let stored = StoredCredential {
            username: username.to_string(),
            token: token.to_string(),
        };
        let plain =
            serde_json::to_string(&stored).map_err(|error| AppError::Internal(error.into()))?;
        let value = encrypt(&self.key, &plain).map_err(|error| AppError::Internal(error.into()))?;
        self.store
            .set_setting(&Self::setting_key(user_id, provider), &value)
            .await?;
        Ok(PublicConnection {
            provider: provider.to_string(),
            username: stored.username,
            connected: true,
        })
    }

    pub async fn remove(&self, user_id: i64, provider: &str) -> AppResult<()> {
        let provider = Self::provider(provider)?;
        self.store
            .set_setting(&Self::setting_key(user_id, provider), "")
            .await?;
        Ok(())
    }

    /// A short-lived token embedded in the terminal environment. It only maps
    /// to the user; the actual provider token never reaches the shell.
    pub fn issue_terminal_token(&self, user_id: i64) -> String {
        let token = random_secret(32);
        if let Ok(mut sessions) = self.sessions.lock() {
            sessions.insert(token.clone(), user_id);
        }
        token
    }

    pub fn resolve_terminal_token(&self, token: &str) -> Option<i64> {
        self.sessions.lock().ok()?.get(token).copied()
    }

    pub async fn credentials_for_host(&self, user_id: i64, host: &str) -> Option<StoredCredential> {
        let host = host.trim().to_lowercase();
        let provider = if host.ends_with("github.com") {
            "github"
        } else if host.ends_with("bitbucket.org") {
            "bitbucket"
        } else {
            return None;
        };
        self.read(user_id, provider).await
    }

    pub async fn credentials_for_provider(
        &self,
        user_id: i64,
        provider: &str,
    ) -> Option<StoredCredential> {
        self.read(user_id, Self::provider(provider).ok()?).await
    }
}
