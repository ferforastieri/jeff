//! The OpenCode service: the models it offers (with their effort variants) and
//! the titles of the sessions it runs. The Jeff server proxies it so the app
//! never reads provider keys of its own.
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Duration;

const DEFAULT_URL: &str = "http://127.0.0.1:3005";

/// The CLI rewrites its service file on every start, including the real port.
/// Read it instead of assuming a port: the old hardcoded 3005 made the model
/// list fall back to `opencode models`, which has no effort variants.
fn service() -> Option<Value> {
    let home = std::env::var("HOME").ok()?;
    let home = PathBuf::from(home);
    for relative in [
        ".local/state/opencode/service.json",
        ".config/opencode/service.json",
    ] {
        let Ok(text) = std::fs::read_to_string(home.join(relative)) else {
            continue;
        };
        if let Ok(value) = serde_json::from_str::<Value>(&text) {
            return Some(value);
        }
    }
    None
}

fn base_url() -> String {
    std::env::var("JEFF_OPENCODE_URL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            service()
                .and_then(|value| value.get("url")?.as_str().map(str::to_owned))
                .filter(|url| !url.trim().is_empty())
        })
        .unwrap_or_else(|| DEFAULT_URL.to_string())
}

/// The service's own password (the CLI's background service file), or the
/// header the deployment passes in `JEFF_OPENCODE_AUTH`.
fn password() -> Option<String> {
    if let Ok(auth) = std::env::var("JEFF_OPENCODE_AUTH") {
        let value = auth.trim();
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    service().and_then(|value| value.get("password")?.as_str().map(str::to_owned))
}

async fn get(path: &str) -> Option<Value> {
    let url = format!("{}{}", base_url().trim_end_matches('/'), path);
    let mut request = reqwest::Client::new()
        .get(url)
        .timeout(Duration::from_secs(6))
        .header("accept", "application/json");
    if let Some(password) = password() {
        request = request.basic_auth("opencode", Some(password));
    }
    let response = request.send().await.ok()?;
    if !response.status().is_success() {
        return None;
    }
    response.json::<Value>().await.ok()
}

/// Every chat model the harness offers, as `provider/model`, with its effort
/// variants (the same names the runtime appends as `#variant`).
pub async fn models() -> Option<Vec<Value>> {
    let value = get("/api/model").await?;
    let data = value.get("data")?.as_array()?;
    let mut models = Vec::new();
    for item in data {
        if item.get("type").and_then(Value::as_str) != Some("chat") {
            continue;
        }
        let Some(provider) = item.get("providerID").and_then(Value::as_str) else {
            continue;
        };
        let Some(model) = item
            .get("modelID")
            .or_else(|| item.get("id"))
            .and_then(Value::as_str)
        else {
            continue;
        };
        let variants = item
            .get("variants")
            .and_then(Value::as_array)
            .map(|list| {
                list.iter()
                    .filter_map(|variant| variant.get("id").and_then(Value::as_str))
                    .map(str::to_owned)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        models.push(json!({
            "id": format!("{provider}/{model}"),
            "label": item.get("name").and_then(Value::as_str).unwrap_or(model),
            "provider": provider,
            "variants": variants,
        }));
    }
    Some(models)
}

/// The sessions the harness knows: id, title and when it last moved.
pub async fn session_titles() -> Option<Vec<Value>> {
    let value = get("/api/session").await?;
    let data = value.get("data")?.as_array()?;
    Some(
        data.iter()
            .filter_map(|session| {
                let id = session.get("id").and_then(Value::as_str)?;
                Some(json!({
                    "id": id,
                    "title": session.get("title").and_then(Value::as_str).unwrap_or(""),
                    "updatedAt": session
                        .get("time")
                        .and_then(|time| time.get("updated"))
                        .and_then(Value::as_i64)
                        .unwrap_or(0),
                }))
            })
            .collect(),
    )
}
