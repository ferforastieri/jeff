use std::sync::Arc;
use std::time::Duration;

use argon2::password_hash::rand_core::OsRng;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::{Algorithm, Argon2, Params, Version};
use chrono::{Duration as ChronoDuration, Utc};

use crate::crypto::{random_secret, token_hash};
use crate::errors::{AppError, AppResult};
use crate::model::{Session, User};
use crate::platform::redis::RedisBus;
use crate::store::Store;
use serde::{Deserialize, Serialize};

const ARGON_MEMORY: u32 = 64 * 1024;
const ARGON_ITERATIONS: u32 = 3;
const ARGON_PARALLELISM: u32 = 2;
const ARGON_KEY_LENGTH: usize = 32;

#[derive(Clone)]
pub struct AuthManager {
    store: Store,
    secure_cookies: bool,
    session_ttl: ChronoDuration,
    dummy_hash: Arc<String>,
    redis: RedisBus,
}

/// Cached for a minute: enough to take the session join and the `last_seen`
/// write off the hot path of every authenticated request. Logout invalidates
/// the entry immediately through the reverse key.
const SESSION_CACHE_TTL: u64 = 60;

#[derive(Serialize, Deserialize)]
struct CachedAuth {
    session: Session,
    user: User,
}

pub struct LoginResult {
    pub token: String,
    pub session: Session,
    pub user: User,
    pub csrf_token: String,
}

impl AuthManager {
    pub fn new(store: Store, secure_cookies: bool) -> Self {
        Self::with_redis(store, secure_cookies, RedisBus::disabled())
    }

    pub fn with_redis(store: Store, secure_cookies: bool, redis: RedisBus) -> Self {
        let dummy_hash =
            hash_password("jeff-invalid-password-placeholder").unwrap_or_else(|_| String::new());
        Self {
            store,
            secure_cookies,
            session_ttl: ChronoDuration::days(30),
            dummy_hash: Arc::new(dummy_hash),
            redis,
        }
    }

    pub fn secure_cookies(&self) -> bool {
        self.secure_cookies
    }

    pub async fn bootstrap(&self, configured_password: &str) -> AppResult<Option<String>> {
        if self.store.user_count().await? > 0 {
            return Ok(None);
        }
        let (password, generated) = if configured_password.trim().is_empty() {
            (random_secret(18), true)
        } else {
            (configured_password.to_string(), false)
        };
        let hash = hash_password(&password).map_err(|error| AppError::Internal(error.into()))?;
        self.store
            .create_user("admin", &hash, "admin", "Admin")
            .await?;
        Ok(generated.then_some(password))
    }

    pub async fn login(
        &self,
        username: &str,
        password: &str,
        kind: &str,
    ) -> AppResult<LoginResult> {
        let user = match self.store.user_by_username(username).await {
            Ok(user) => user,
            Err(AppError::NotFound) => {
                let _ = verify_password(self.dummy_hash.as_str(), password);
                return Err(AppError::Unauthorized);
            }
            Err(error) => return Err(error),
        };
        if !verify_password(&user.password_hash, password) {
            return Err(AppError::Unauthorized);
        }
        self.create_session(user, kind).await
    }

    /// Creates a session for an already authenticated user. Pairing codes use
    /// this path so a phone can join a local server without the admin password.
    pub async fn session_for_user(&self, user_id: i64, kind: &str) -> AppResult<LoginResult> {
        let user = self.store.user_by_id(user_id).await?;
        self.create_session(user, kind).await
    }

    async fn create_session(&self, user: User, kind: &str) -> AppResult<LoginResult> {
        let raw = random_secret(32);
        let hash = token_hash(&raw);
        let session_id = random_secret(16);
        let expires = Utc::now() + self.session_ttl;
        let session = self
            .store
            .create_session(&session_id, user.id, &hash, kind, expires)
            .await?;
        Ok(LoginResult {
            token: raw,
            session,
            user,
            csrf_token: random_secret(24),
        })
    }

    pub async fn authenticate(&self, raw: &str) -> AppResult<(Session, User)> {
        if raw.is_empty() {
            return Err(AppError::Unauthorized);
        }
        let hash = token_hash(raw);
        let cache_key = session_cache_key(&hash);
        if let Some(cached) = self.redis.get_json::<CachedAuth>(&cache_key).await {
            return Ok((cached.session, cached.user));
        }
        let (session, user) = self.store.session_by_token_hash(&hash).await?;
        let _ = self.store.touch_session(&session.id).await;
        let cached = CachedAuth {
            session: session.clone(),
            user: user.clone(),
        };
        self.redis
            .set_json(&cache_key, &cached, SESSION_CACHE_TTL)
            .await;
        self.redis
            .set_json(&session_reverse_key(&session.id), &hash, SESSION_CACHE_TTL)
            .await;
        Ok((session, user))
    }

    /// Passwordless first-run login: the email is the identity. The first
    /// email claims the installer's admin account; later emails create members.
    pub async fn login_by_email(&self, email: &str, kind: &str) -> AppResult<LoginResult> {
        let email = normalize_email(email)?;
        match self.store.user_by_email(&email).await {
            Ok(user) => self.create_session(user, kind).await,
            Err(AppError::NotFound) => {
                let users = self.store.list_users().await?;
                let admin_email = self.store.user_email(users[0].id).await?;
                let unclaimed = admin_email
                    .as_deref()
                    .map_or(true, |value| value.trim().is_empty());
                if users.len() == 1 && unclaimed {
                    self.store.set_user_email(users[0].id, &email).await?;
                    return self.create_session(users[0].clone(), kind).await;
                }
                let password = random_secret(24);
                let hash =
                    hash_password(&password).map_err(|error| AppError::Internal(error.into()))?;
                let role = if users.is_empty() { "admin" } else { "member" };
                let user = self
                    .store
                    .create_email_user(&email, role, "", &hash)
                    .await?;
                self.create_session(user, kind).await
            }
            Err(error) => Err(error),
        }
    }

    /// Whether an email already belongs to an account (no session, no write).
    pub async fn email_exists(&self, email: &str) -> AppResult<bool> {
        let email = normalize_email(email)?;
        match self.store.user_by_email(&email).await {
            Ok(_) => Ok(true),
            Err(AppError::NotFound) => Ok(false),
            Err(error) => Err(error),
        }
    }

    /// Creates the account on the last screen (email + name + password). A new
    /// email claims the installer's admin when it is still unclaimed; later
    /// emails create members. The session is created here, never on the email
    /// check.
    pub async fn register_by_email(
        &self,
        email: &str,
        name: &str,
        password: &str,
        kind: &str,
    ) -> AppResult<LoginResult> {
        let email = normalize_email(email)?;
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 60 {
            return Err(AppError::BadRequest(
                "Informe um nome de até 60 caracteres.".into(),
            ));
        }
        let length = password.chars().count();
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
        if self.store.user_by_email(&email).await.is_ok() {
            return Err(AppError::Conflict);
        }
        let users = self.store.list_users().await?;
        let hash = hash_password(password).map_err(|error| AppError::Internal(error.into()))?;
        let user = if users.len() == 1 {
            let admin_email = self.store.user_email(users[0].id).await?;
            let unclaimed = admin_email
                .as_deref()
                .map_or(true, |value| value.trim().is_empty());
            if unclaimed {
                self.store.set_user_email(users[0].id, &email).await?;
                self.store.set_user_display_name(users[0].id, name).await?;
                self.store.set_user_password(users[0].id, &hash).await?;
                self.store.user_by_email(&email).await?
            } else {
                let role = "member";
                self.store
                    .create_email_user(&email, role, name, &hash)
                    .await?
            }
        } else {
            let role = if users.is_empty() { "admin" } else { "member" };
            self.store
                .create_email_user(&email, role, name, &hash)
                .await?
        };
        self.create_session(user, kind).await
    }

    /// Drops the cached user for one session without ending the session.
    /// Profile changes (name, role) call this so the next request re-reads the row.
    pub async fn invalidate_session_cache(&self, session_id: &str) {
        let reverse_key = session_reverse_key(session_id);
        if let Some(hash) = self.redis.get_json::<String>(&reverse_key).await {
            self.redis.del(&session_cache_key(&hash)).await;
        }
        self.redis.del(&reverse_key).await;
    }

    pub async fn logout(&self, session_id: &str) -> AppResult<()> {
        self.store.delete_session(session_id).await?;
        let reverse_key = session_reverse_key(session_id);
        if let Some(hash) = self.redis.get_json::<String>(&reverse_key).await {
            self.redis.del(&session_cache_key(&hash)).await;
        }
        self.redis.del(&reverse_key).await;
        Ok(())
    }

    pub fn session_ttl(&self) -> Duration {
        Duration::from_secs(30 * 24 * 60 * 60)
    }
}

fn normalize_email(raw: &str) -> AppResult<String> {
    let email = raw.trim().to_lowercase();
    if email.len() > 254 || !email.contains('@') || email.starts_with('@') || email.ends_with('@') {
        return Err(AppError::BadRequest("Informe um e-mail válido.".into()));
    }
    Ok(email)
}

fn argon2() -> Argon2<'static> {
    let params = Params::new(
        ARGON_MEMORY,
        ARGON_ITERATIONS,
        ARGON_PARALLELISM,
        Some(ARGON_KEY_LENGTH),
    )
    .expect("valid argon2 params");
    Argon2::new(Algorithm::Argon2id, Version::V0x13, params)
}

pub fn hash_password(password: &str) -> anyhow::Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    argon2()
        .hash_password(password.as_bytes(), &salt)
        .map(|hash| hash.to_string())
        .map_err(|error| anyhow::anyhow!(error.to_string()))
}

pub fn verify_password(encoded: &str, password: &str) -> bool {
    let Ok(parsed) = PasswordHash::new(encoded) else {
        return false;
    };
    Argon2::default()
        .verify_password(password.as_bytes(), &parsed)
        .is_ok()
}

fn session_cache_key(hash: &str) -> String {
    format!("jeff:auth:token:{hash}")
}

fn session_reverse_key(session_id: &str) -> String {
    format!("jeff:auth:session:{session_id}")
}
