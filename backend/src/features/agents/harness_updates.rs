//! Harness update checks. The CLIs are installed by the user (or by the
//! Harness settings page); this task only compares the installed version with
//! the latest npm release and, when a newer one exists, writes an in-app
//! notification and sends a push. It never updates a CLI on its own.

use std::time::Duration;

use serde_json::Value;

use crate::crypto::new_id;
use crate::errors::AppResult;
use crate::features::agents::engines::{self, ENGINES};
use crate::features::notifications::repository::StoredNotification;
use crate::push::{PushMessage, PushService};
use crate::store::Store;

pub(crate) const FIRST_CHECK_DELAY: Duration = Duration::from_secs(2 * 60);
pub(crate) const CHECK_INTERVAL: Duration = Duration::from_secs(60 * 60);

fn latest_url(id: &str) -> Option<String> {
    let opencode = match std::env::consts::ARCH {
        "aarch64" => "@opencode/cli-linux-arm64",
        _ => "@opencode/cli-linux-x64",
    };
    let package = match id {
        "opencode" => opencode,
        "codex" => "@openai/codex",
        "claude" => "@anthropic-ai/claude-code",
        _ => return None,
    };
    Some(format!("https://registry.npmjs.org/{package}/latest"))
}

/// `opencode v2.2.6` → (2, 2, 6), `codex-cli 0.172.0` → (0, 172, 0).
fn semver(text: &str) -> Option<(u64, u64, u64)> {
    let token = text.split_whitespace().find(|part| {
        let part = part.trim_start_matches('v');
        part.contains('.') && part.chars().next().is_some_and(|c| c.is_ascii_digit())
    })?;
    let mut parts = token.trim_start_matches('v').split('.');
    let major = parts.next()?.parse().ok()?;
    let minor = parts.next()?.parse().ok()?;
    let patch = parts
        .next()?
        .split(|c: char| !c.is_ascii_digit())
        .next()?
        .parse()
        .ok()?;
    Some((major, minor, patch))
}

async fn latest_version(client: &reqwest::Client, id: &str) -> Option<String> {
    let url = latest_url(id)?;
    let response = client
        .get(url)
        .timeout(Duration::from_secs(15))
        .send()
        .await
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let value: Value = response.json().await.ok()?;
    value
        .get("version")
        .and_then(Value::as_str)
        .map(str::to_owned)
}

/// Checks every installed harness. A version is announced once: the setting
/// `harness_update.<engine>` remembers the last version already notified.
pub async fn check(store: &Store, push: &PushService) -> AppResult<()> {
    let users = store.list_users().await?;
    if users.is_empty() {
        return Ok(());
    }
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new());

    for engine in ENGINES {
        let Some(path) = engines::find_binary(engine.binary) else {
            continue;
        };
        let Some(current) = engines::version(&path).await else {
            continue;
        };
        let Some(current_parts) = semver(&current) else {
            continue;
        };
        let Some(latest) = latest_version(&client, engine.id).await else {
            continue;
        };
        let Some(latest_parts) = semver(&latest) else {
            continue;
        };
        if latest_parts <= current_parts {
            continue;
        }
        let key = format!("harness_update.{}", engine.id);
        if store.setting(&key).await.ok().as_deref() == Some(latest.as_str()) {
            continue;
        }

        let title = format!("Atualização do {}", engine.label);
        let body = format!(
            "{} {} está disponível (instalado {}).",
            engine.label,
            latest,
            current.trim()
        );
        for user in &users {
            let id = new_id();
            let created = chrono::Utc::now().timestamp_millis();
            let stored = StoredNotification {
                id: id.clone(),
                kind: "system".into(),
                title: title.clone(),
                body: body.clone(),
                project_id: None,
                project_name: None,
                chat_id: None,
                session_id: None,
                bot_id: None,
                bot_name: None,
                bot_role: None,
                notification_id: Some(id.clone()),
                room_id: None,
                created_at: created,
                is_read: false,
            };
            if let Err(error) = store.save_notification(user.id, &stored).await {
                tracing::warn!(%error, "could not persist harness update notification");
            }
            if push.enabled() {
                let message = PushMessage {
                    title: title.clone(),
                    body: body.clone(),
                    data: vec![
                        ("type".into(), "harness.update".into()),
                        ("engine".into(), engine.id.into()),
                        ("version".into(), latest.clone()),
                    ],
                };
                push.notify_for_user(user.id, &message).await;
            }
        }
        let _ = store.set_setting(&key, &latest).await;
    }
    Ok(())
}
