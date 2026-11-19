use std::path::{Path, PathBuf};
use std::time::Duration;

use serde_json::{json, Value};
use tokio::process::Command;

use crate::errors::{bad_request, AppError, AppResult};

/// External agent harnesses. Only the ones marked `supported` are wired to the
/// Jeff runtime; the rest are listed so the UI can show what is installed and
/// how to install it.
#[derive(Clone, Copy)]
pub struct Engine {
    pub id: &'static str,
    pub label: &'static str,
    pub binary: &'static str,
    pub login: &'static str,
    pub install: &'static str,
    pub site: &'static str,
    pub supported: bool,
}

pub const ENGINES: &[Engine] = &[
    Engine {
        id: "opencode",
        label: "OpenCode",
        binary: "opencode",
        login: "opencode auth login",
        install: "curl -fsSL https://opencode.ai/v2/install | bash",
        site: "https://opencode.ai",
        supported: true,
    },
    Engine {
        id: "claude",
        label: "Claude Code",
        binary: "claude",
        login: "claude auth login",
        install: "curl -fsSL https://claude.ai/install.sh | bash",
        site: "https://code.claude.com",
        supported: true,
    },
    Engine {
        id: "codex",
        label: "Codex",
        binary: "codex",
        login: "codex login",
        install: "npm install --prefix \"$HOME/.local\" @openai/codex@latest && mkdir -p \"$HOME/.local/bin\" && ln -sf \"$HOME/.local/node_modules/.bin/codex\" \"$HOME/.local/bin/codex\"",
        site: "https://github.com/openai/codex",
        supported: true,
    },
    Engine {
        id: "cursor",
        label: "Cursor CLI",
        binary: "cursor-agent",
        login: "cursor-agent login",
        install: "curl https://cursor.com/install -fsS | bash",
        site: "https://cursor.com/cli",
        supported: false,
    },
    Engine {
        id: "grok",
        label: "Grok",
        binary: "grok",
        login: "grok login",
        install: "curl -fsSL https://x.ai/cli/install.sh | bash",
        site: "https://x.ai/cli",
        supported: false,
    },
    Engine {
        id: "pi",
        label: "Pi",
        binary: "pi",
        login: "pi",
        install: "npm install --prefix \"$HOME/.local\" @earendil-works/pi-coding-agent@latest && mkdir -p \"$HOME/.local/bin\" && ln -sf \"$HOME/.local/node_modules/.bin/pi\" \"$HOME/.local/bin/pi\"",
        site: "https://pi.dev",
        supported: false,
    },
    // Gemini CLI for personal accounts was replaced by Antigravity CLI in
    // June 2026. The official installer drops `agy` in ~/.local/bin, which the
    // binary lookup below already checks even when the daemon PATH is stale.
    Engine {
        id: "antigravity",
        label: "Antigravity CLI",
        binary: "agy",
        login: "agy",
        install: "curl -fsSL https://antigravity.google/cli/install.sh -o /tmp/jeff-antigravity-install.sh && bash /tmp/jeff-antigravity-install.sh",
        site: "https://antigravity.google/docs/cli/",
        supported: true,
    },
];

pub fn label(id: &str) -> String {
    engine(id)
        .map(|engine| engine.label.to_string())
        .unwrap_or_else(|_| id.to_string())
}

fn engine(id: &str) -> AppResult<&'static Engine> {
    ENGINES
        .iter()
        .find(|engine| engine.id == id)
        .ok_or_else(|| bad_request(format!("CLI desconhecida: {id}")))
}

fn executable(path: &Path) -> bool {
    let Ok(metadata) = path.metadata() else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Finds a CLI even when the daemon's PATH was captured before the user
/// installed it, which is the normal case inside the LXC.
pub fn find_binary(binary: &str) -> Option<PathBuf> {
    let mut candidates = Vec::new();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path).map(|dir| dir.join(binary)));
    }
    if let Some(home) = std::env::var_os("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".opencode/bin").join(binary));
        candidates.push(home.join(".local/bin").join(binary));
        candidates.push(home.join(".cargo/bin").join(binary));
        candidates.push(home.join(".claude/local").join(binary));
        candidates.push(home.join(".npm-global/bin").join(binary));
        candidates.push(home.join(".bun/bin").join(binary));
        candidates.push(home.join(".volta/bin").join(binary));
        candidates.push(home.join(".local/share/pnpm").join(binary));
    }
    candidates.push(PathBuf::from("/usr/local/bin").join(binary));
    candidates.push(PathBuf::from("/usr/bin").join(binary));
    candidates.into_iter().find(|path| executable(path))
}

pub fn list() -> Vec<Value> {
    ENGINES
        .iter()
        .map(|engine| {
            let path = find_binary(engine.binary);
            json!({
                "id": engine.id,
                "label": engine.label,
                "binary": engine.binary,
                "installed": path.is_some(),
                "path": path.map(|path| path.display().to_string()),
                "login": engine.login,
                "install": engine.install,
                "site": engine.site,
                "supported": engine.supported,
            })
        })
        .collect()
}

async fn version(path: &Path) -> Option<String> {
    let output = tokio::time::timeout(
        Duration::from_secs(10),
        Command::new(path).arg("--version").output(),
    )
    .await
    .ok()?
    .ok()?;
    let bytes = if output.status.success() {
        output.stdout
    } else {
        output.stderr
    };
    let text = String::from_utf8_lossy(&bytes);
    let line = text.lines().find(|line| !line.trim().is_empty())?.trim();
    Some(line.chars().take(200).collect())
}

async fn opencode_models(path: &Path) -> Option<(usize, Vec<String>)> {
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new(path).arg("models").output(),
    )
    .await
    .ok()?
    .ok()?;
    if !output.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let models = text
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && line.contains('/'))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    Some((models.len(), models.into_iter().take(12).collect()))
}

fn codex_models() -> Vec<Value> {
    let mut ids: Vec<String> = Vec::new();
    if let Some(home) = std::env::var_os("HOME") {
        let config = PathBuf::from(home).join(".codex/config.toml");
        if let Ok(text) = std::fs::read_to_string(config) {
            for line in text.lines() {
                let line = line.trim();
                if let Some(value) = line
                    .strip_prefix("model")
                    .and_then(|rest| rest.trim_start().strip_prefix('='))
                {
                    let slug = value.trim().trim_matches('"').to_string();
                    if !slug.is_empty() && !ids.contains(&slug) {
                        ids.push(slug);
                    }
                }
            }
        }
    }
    for slug in [
        "gpt-6.1-sol",
        "gpt-5.4-pro",
        "gpt-5-codex",
        "gpt-5.4",
        "gpt-5.1-codex-max",
        "o4-mini",
    ] {
        if !ids.iter().any(|id| id == slug) {
            ids.push(slug.to_string());
        }
    }
    ids.into_iter()
        .map(|id| {
            json!({
                "id": id,
                "label": id,
                "provider": "openai",
                "variants": [],
            })
        })
        .collect()
}

fn parse_antigravity_models(text: &str) -> Vec<Value> {
    text.lines()
        .filter_map(|line| {
            let mut parts = line.splitn(2, '\t');
            let id = parts.next()?.trim();
            if id.is_empty() {
                return None;
            }
            let label = parts
                .next()
                .map(str::trim)
                .filter(|label| !label.is_empty())
                .unwrap_or(id);
            let provider = if id.starts_with("gemini") {
                "google"
            } else if id.starts_with("claude") {
                "anthropic"
            } else if id.starts_with("gpt") || id.starts_with("o3") || id.starts_with("o4") {
                "openai"
            } else {
                "antigravity"
            };
            Some(json!({
                "id": id,
                "label": label,
                "provider": provider,
                "variants": [],
            }))
        })
        .collect()
}

/// Every model the OpenCode CLI offers (`opencode models`), the only source the
/// app listed from originally: the CLI is installed and logged in; no provider
/// key passes here.
pub async fn models() -> Value {
    models_for("opencode").await
}

/// Model listing for one installed harness. The composer asks for the engine
/// selected in the conversation, so each CLI's own login and catalogue are used.
pub async fn models_for(id: &str) -> Value {
    let Ok(engine) = engine(id) else {
        return json!({ "models": [] });
    };
    let Some(path) = find_binary(engine.binary) else {
        return json!({ "models": [] });
    };
    // Codex has no machine-readable model catalogue yet; use the model saved
    // in its config plus a small list of the current ChatGPT/API slugs.
    if engine.id == "codex" {
        return json!({ "models": codex_models() });
    }
    let Ok(Ok(output)) = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new(&path).arg("models").output(),
    )
    .await
    else {
        return json!({ "models": [] });
    };
    if !output.status.success() {
        return json!({ "models": [] });
    }
    let text = String::from_utf8_lossy(&output.stdout);
    let models = if engine.id == "antigravity" {
        // `agy models` prints `slug<TAB>Label` with no slash in the slug.
        parse_antigravity_models(&text)
    } else {
        text.lines()
            .map(str::trim)
            .filter(|line| !line.is_empty() && line.contains('/'))
            .map(|line| {
                let mut parts = line.splitn(2, '/');
                let provider = parts.next().unwrap_or("opencode");
                let model = parts.next().unwrap_or(line);
                json!({
                    "id": line,
                    "label": model,
                    "provider": provider,
                    "variants": [],
                })
            })
            .collect::<Vec<_>>()
    };
    json!({ "models": models })
}

pub async fn test(id: &str) -> AppResult<Value> {
    let engine = engine(id)?;
    let Some(path) = find_binary(engine.binary) else {
        return Ok(json!({
            "ok": false,
            "installed": false,
            "message": format!("{} não está instalado.", engine.label),
        }));
    };
    let version = version(&path).await;
    let mut models = None;
    if engine.id == "opencode" {
        models = opencode_models(&path).await;
    } else if engine.id == "antigravity" || engine.id == "codex" {
        let listed = models_for(engine.id).await;
        let count = listed["models"].as_array().map(Vec::len).unwrap_or(0);
        if count > 0 {
            models = Some((count, Vec::new()));
        }
    }
    let ok = version.is_some() || models.is_some();
    let message = if let Some((count, _)) = &models {
        format!("{} respondeu e listou {count} modelos.", engine.label)
    } else if let Some(version) = &version {
        format!("{} respondeu: {version}", engine.label)
    } else {
        format!(
            "{} foi encontrado, mas não respondeu ao teste.",
            engine.label
        )
    };
    let mut value = json!({
        "ok": ok,
        "installed": true,
        "path": path.display().to_string(),
        "version": version,
        "message": message,
    });
    if let Some((count, sample)) = models {
        value["modelCount"] = json!(count);
        value["models"] = json!(sample);
    }
    Ok(value)
}

/// The Antigravity CLI reports quota through its `/usage` print command. Its
/// groups share limits, so the most consumed window across groups is the one
/// the user actually has left.
async fn antigravity_limits(binary: &Path) -> AppResult<Value> {
    let output = tokio::time::timeout(
        Duration::from_secs(30),
        Command::new(binary)
            .args(["-p", "/usage", "--output-format", "json"])
            .env("AGY_CLI_DISABLE_AUTO_UPDATE", "true")
            .output(),
    )
    .await
    .map_err(|_| bad_request("O Antigravity CLI demorou para responder o uso."))?
    .map_err(AppError::Io)?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
        return Ok(json!({
            "ok": false,
            "message": if message.is_empty() { "O Antigravity CLI não devolveu o uso.".to_string() } else { message },
        }));
    }
    let parsed: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| bad_request(format!("Resposta inválida do Antigravity CLI: {error}")))?;
    let groups = parsed["command"]["data"]["groups"].as_array();
    if groups.is_none() || groups.map(Vec::is_empty).unwrap_or(true) {
        return Ok(
            json!({ "ok": false, "message": "O Antigravity CLI não devolveu janelas de uso." }),
        );
    }
    Ok(json!({
        "ok": true,
        "data": antigravity_usage_data(groups.unwrap()),
    }))
}

fn antigravity_usage_data(groups: &[Value]) -> Value {
    let mut rolling = json!({"percent": 0, "limited": false, "resetsAt": 0});
    let mut weekly = json!({"percent": 0, "limited": false, "resetsAt": 0});
    for group in groups {
        for bucket in group["buckets"].as_array().into_iter().flatten() {
            let target = match bucket["window"].as_str().unwrap_or("") {
                "5h" => &mut rolling,
                "weekly" => &mut weekly,
                _ => continue,
            };
            let remaining = bucket["remaining_fraction"].as_f64().unwrap_or(1.0);
            let percent = ((1.0 - remaining) * 100.0).round() as i64;
            if percent > target["percent"].as_i64().unwrap_or(0) {
                let resets_at = bucket["reset_time"]
                    .as_str()
                    .and_then(|text| chrono::DateTime::parse_from_rfc3339(text).ok())
                    .map(|date| date.timestamp_millis())
                    .unwrap_or(0);
                *target = json!({
                    "percent": percent,
                    "limited": remaining <= 0.0,
                    "resetsAt": resets_at,
                });
            }
        }
    }
    json!({
        "go": {
            "rolling": rolling,
            "weekly": weekly,
            "monthly": {"percent": 0, "limited": false, "resetsAt": 0},
        }
    })
}

/// The OpenCode Go allowance. The local OpenCode service exposes the rolling,
/// weekly and monthly windows as used percentages; Jeff shows what is left.
pub async fn limits(id: &str) -> AppResult<Value> {
    let engine = engine(id)?;
    let Some(binary) = find_binary(engine.binary) else {
        return Ok(json!({
            "ok": false,
            "message": format!("{} não está instalado.", engine.label),
        }));
    };
    if engine.id == "antigravity" {
        return antigravity_limits(&binary).await;
    }
    if engine.id != "opencode" {
        return Ok(json!({
            "ok": false,
            "message": "Limite do plano disponível apenas para OpenCode e Antigravity.",
        }));
    }
    let output = tokio::time::timeout(
        Duration::from_secs(20),
        Command::new(&binary)
            .args(["api", "get", "/api/experimental/usage/limits"])
            .output(),
    )
    .await
    .map_err(|_| bad_request("O OpenCode demorou para responder o limite do plano."))?
    .map_err(AppError::Io)?;
    if !output.status.success() {
        let message = String::from_utf8_lossy(&output.stderr)
            .trim()
            .chars()
            .take(500)
            .collect::<String>();
        return Ok(json!({
            "ok": false,
            "message": if message.is_empty() {
                "O OpenCode não devolveu o limite do plano.".to_string()
            } else {
                message
            },
        }));
    }
    let parsed: Value = serde_json::from_slice(&output.stdout)
        .map_err(|error| bad_request(format!("Resposta inválida do OpenCode: {error}")))?;
    Ok(json!({
        "ok": true,
        "data": parsed.get("data").cloned().unwrap_or(Value::Null),
    }))
}

pub async fn install(id: &str) -> AppResult<Value> {
    let engine = engine(id)?;
    if let Some(path) = find_binary(engine.binary) {
        return Ok(json!({
            "ok": true,
            "installed": true,
            "already": true,
            "path": path.display().to_string(),
            "output": "",
            "message": format!("{} já está instalado.", engine.label),
        }));
    }
    let output = tokio::time::timeout(
        Duration::from_secs(600),
        Command::new("sh").arg("-lc").arg(engine.install).output(),
    )
    .await
    .map_err(|_| bad_request("A instalação excedeu 10 minutos."))?
    .map_err(AppError::Io)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}");
    let tail = if combined.chars().count() > 6000 {
        combined
            .chars()
            .skip(combined.chars().count() - 6000)
            .collect::<String>()
    } else {
        combined
    };
    if !output.status.success() {
        return Err(bad_request(format!(
            "A instalação falhou (código {}).\n{}",
            output.status.code().unwrap_or(-1),
            tail
        )));
    }
    let path = find_binary(engine.binary);
    let installed = path.is_some();
    let path = path.map(|path| path.display().to_string());
    Ok(json!({
        "ok": installed,
        "installed": installed,
        "already": false,
        "path": path,
        "output": tail,
        "message": if installed {
            format!("{} instalado.", engine.label)
        } else {
            format!("O instalador terminou, mas {} não apareceu no PATH. Abra um terminal novo e teste de novo.", engine.label)
        },
    }))
}

/// Updates an installed harness in place. OpenCode carries its own upgrader;
/// Claude Code uses `claude update`; Codex is installed through npm.
pub async fn update(id: &str) -> AppResult<Value> {
    let engine = engine(id)?;
    let Some(path) = find_binary(engine.binary) else {
        return Ok(json!({
            "ok": false,
            "installed": false,
            "path": null,
            "version": null,
            "output": "",
            "message": format!("{} não está instalado. Use Instalar primeiro.", engine.label),
        }));
    };
    let mut command = match engine.id {
        "opencode" => {
            let mut command = Command::new(&path);
            command.arg("upgrade");
            command
        }
        "claude" => {
            let mut command = Command::new(&path);
            command.arg("update");
            command
        }
        "codex" => {
            let mut command = Command::new("sh");
            command.arg("-lc").arg(
                "npm install --prefix \"$HOME/.local\" @openai/codex@latest && mkdir -p \"$HOME/.local/bin\" && ln -sf \"$HOME/.local/node_modules/.bin/codex\" \"$HOME/.local/bin/codex\"",
            );
            command
        }
        "antigravity" => {
            let mut command = Command::new(&path);
            command.arg("update");
            command
        }
        _ => {
            return Ok(json!({
                "ok": false,
                "installed": true,
                "path": path.display().to_string(),
                "version": version(&path).await,
                "output": "",
                "message": format!("{} não tem atualização automática.", engine.label),
            }));
        }
    };
    let output = tokio::time::timeout(Duration::from_secs(600), command.output())
        .await
        .map_err(|_| bad_request("A atualização excedeu 10 minutos."))?
        .map_err(AppError::Io)?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}");
    let tail = if combined.chars().count() > 6000 {
        combined
            .chars()
            .skip(combined.chars().count() - 6000)
            .collect::<String>()
    } else {
        combined
    };
    let current = version(&path).await;
    Ok(json!({
        "ok": output.status.success(),
        "installed": true,
        "path": path.display().to_string(),
        "version": current,
        "output": tail,
        "message": if output.status.success() {
            match &current {
                Some(version) => format!("{} atualizado: {version}", engine.label),
                None => format!("{} atualizado.", engine.label),
            }
        } else {
            format!(
                "A atualização de {} falhou (código {}).",
                engine.label,
                output.status.code().unwrap_or(-1)
            )
        },
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn antigravity_models_use_the_whole_slug_as_the_id() {
        let models = parse_antigravity_models(
            "gemini-4-carbon-medium\tGemini 4 Carbon (Medium)\nclaude-sonnet-4-6\tClaude Sonnet 4.6\n",
        );
        assert_eq!(models.len(), 2);
        assert_eq!(models[0]["id"], "gemini-4-carbon-medium");
        assert_eq!(models[0]["label"], "Gemini 4 Carbon (Medium)");
        assert_eq!(models[0]["provider"], "google");
        assert_eq!(models[1]["provider"], "anthropic");
    }

    #[test]
    fn antigravity_usage_maps_windows_to_the_usage_ring() {
        let groups = json!([{
            "buckets": [
                {"window": "5h", "remaining_fraction": 0.4, "reset_time": "2026-11-18T16:00:00Z"},
                {"window": "weekly", "remaining_fraction": 0.8, "reset_time": "2026-11-25T12:00:00Z"},
            ]
        }]);
        let data = antigravity_usage_data(groups.as_array().unwrap());
        assert_eq!(data["go"]["rolling"]["percent"], 60);
        assert_eq!(data["go"]["weekly"]["percent"], 20);
        assert!(data["go"]["rolling"]["resetsAt"].as_i64().unwrap() > 0);
    }
}
