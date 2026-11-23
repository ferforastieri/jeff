//! Optional Redis connection.
//!
//! Redis is a performance layer, never a source of truth: every operation here
//! fails open (returns `None`, logs and moves on). When `JEFF_REDIS_URL` is not
//! set the whole thing is disabled and the process behaves as before.

use std::time::Duration;

use redis::aio::ConnectionManager;
use redis::Client;
use serde::de::DeserializeOwned;
use serde::Serialize;

const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Clone)]
pub struct RedisBus {
    client: Option<Client>,
    connection: Option<ConnectionManager>,
    instance: String,
}

impl RedisBus {
    pub fn disabled() -> Self {
        Self {
            client: None,
            connection: None,
            instance: crate::crypto::new_id(),
        }
    }

    /// Connects when a URL is configured. A broken Redis never prevents the
    /// server from starting: it just turns the cache off.
    pub async fn connect(url: Option<&str>) -> Self {
        let Some(url) = url.map(str::trim).filter(|url| !url.is_empty()) else {
            return Self::disabled();
        };
        let url = if url.contains("://") {
            url.to_string()
        } else {
            format!("redis://{url}")
        };
        let client = match Client::open(url) {
            Ok(client) => client,
            Err(error) => {
                tracing::warn!(%error, "redis URL is invalid; cache disabled");
                return Self::disabled();
            }
        };
        let connection =
            match tokio::time::timeout(CONNECT_TIMEOUT, client.get_connection_manager()).await {
                Ok(Ok(connection)) => connection,
                Ok(Err(error)) => {
                    tracing::warn!(%error, "redis is unreachable; cache disabled");
                    return Self::disabled();
                }
                Err(_) => {
                    tracing::warn!("redis connection timed out; cache disabled");
                    return Self::disabled();
                }
            };
        tracing::info!("redis connected");
        Self {
            client: Some(client),
            connection: Some(connection),
            instance: crate::crypto::new_id(),
        }
    }

    pub fn enabled(&self) -> bool {
        self.connection.is_some()
    }

    pub fn client(&self) -> Option<Client> {
        self.client.clone()
    }

    pub fn instance_id(&self) -> &str {
        &self.instance
    }

    pub async fn get_json<T: DeserializeOwned>(&self, key: &str) -> Option<T> {
        let mut connection = self.connection.clone()?;
        let value: Option<String> = redis::cmd("GET")
            .arg(key)
            .query_async(&mut connection)
            .await
            .ok()?;
        serde_json::from_str(value?.as_str()).ok()
    }

    pub async fn set_json<T: Serialize>(&self, key: &str, value: &T, ttl_secs: u64) {
        let Some(mut connection) = self.connection.clone() else {
            return;
        };
        let Ok(payload) = serde_json::to_string(value) else {
            return;
        };
        let _ = redis::cmd("SET")
            .arg(key)
            .arg(payload)
            .arg("EX")
            .arg(ttl_secs)
            .query_async::<redis::Value>(&mut connection)
            .await;
    }

    pub async fn del(&self, key: &str) {
        let Some(mut connection) = self.connection.clone() else {
            return;
        };
        let _ = redis::cmd("DEL")
            .arg(key)
            .query_async::<redis::Value>(&mut connection)
            .await;
    }

    pub async fn publish_json<T: Serialize>(&self, channel: &str, value: &T) {
        let Some(mut connection) = self.connection.clone() else {
            return;
        };
        let Ok(payload) = serde_json::to_string(value) else {
            return;
        };
        let _ = redis::cmd("PUBLISH")
            .arg(channel)
            .arg(payload)
            .query_async::<redis::Value>(&mut connection)
            .await;
    }
}
