use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::ai::AiConfig;
use crate::errors::{bad_request, AppError, AppResult};

use super::models::{AgentSpec, Attachment};
use super::skill_service::ManagedSkill;
use crate::features::integrations::mcp::Server;

/// A stable private home/config directory per Jeff session. The engine runs in
/// the project itself, but native harnesses need a fixed home whose config and
/// session files survive resumed turns and server restarts. It lives under the
/// data directory and is cleaned only when the chat/Jeff is deleted.
pub fn work_dir(session_id: &str) -> PathBuf {
    let safe: String = session_id
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '-' || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let base = std::env::var_os("JEFF_CLI_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("JEFF_DATA_DIR").map(|dir| PathBuf::from(dir).join("cli")))
        .unwrap_or_else(std::env::temp_dir);
    base.join(format!("jeff-cli-{safe}"))
}

/// Writes every attachment into the private CLI home, keeping its extension,
/// so the harness can inspect any format (zip, xlsx, binary) by path. OpenCode
/// still receives the images with `--file`.
pub async fn attachment_files(dir: &Path, attachments: &[Attachment]) -> AppResult<Vec<PathBuf>> {
    if attachments.is_empty() {
        return Ok(Vec::new());
    }
    tokio::fs::create_dir_all(dir).await?;
    let mut files = Vec::new();
    for (index, attachment) in attachments.iter().enumerate() {
        let Some((_, encoded)) = attachment.uri.split_once(";base64,") else {
            continue;
        };
        let data = STANDARD
            .decode(encoded)
            .map_err(|error| bad_request(error.to_string()))?;
        let original = Path::new(&attachment.name)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("anexo");
        let safe = original
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_') {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>();
        let extension = match attachment.mime.as_str() {
            "image/jpeg" => "jpg",
            "image/webp" => "webp",
            "image/gif" => "gif",
            "image/png" => "png",
            _ => "bin",
        };
        let name = if Path::new(&safe).extension().is_some() {
            safe
        } else {
            format!("{safe}.{extension}")
        };
        let path = dir.join(format!("{index}-{name}"));
        tokio::fs::write(&path, data).await?;
        files.push(path);
    }
    Ok(files)
}

/// The paths of the message's attachments, written for the harness's shell.
pub fn attachments_note(attachments: &[Attachment], files: &[PathBuf]) -> String {
    if files.is_empty() {
        return String::new();
    }
    let mut note = String::from("\n\nArquivos anexados nesta mensagem (caminhos no servidor):");
    for (attachment, path) in attachments.iter().zip(files) {
        note.push_str(&format!(
            "\n- {} ({}): {}",
            attachment.name,
            attachment.mime,
            path.display()
        ));
    }
    note.push_str("\nInspecione arquivos binários com o shell (file, unzip -l, python, etc.).");
    note
}

/// Jeff-only tools selected for one Jeff (the email connector), exposed as a
/// native stdio MCP server. The harness sees normal MCP tools and executes them
/// itself; there is no Jeff gateway.
pub fn native_server(accounts: &[String], data_dir: &std::path::Path) -> Option<Server> {
    if accounts.is_empty() {
        return None;
    }
    let executable = std::env::current_exe().ok()?;
    let mut env = HashMap::new();
    env.insert("JEFF_EMAIL_ACCOUNTS".into(), accounts.join(","));
    // The helper opens the same SQLite file. The data directory is not a
    // secret; pass it so the child does not depend on its working directory.
    env.insert("JEFF_DATA_DIR".into(), data_dir.display().to_string());
    Some(Server {
        id: "jeff-tools".into(),
        name: "jeff_tools".into(),
        transport: "stdio".into(),
        url: String::new(),
        command: vec![executable.display().to_string(), "mcp-tools".into()],
        env,
        token: String::new(),
        timeout_seconds: 120,
        auto_approve: true,
    })
}

/// A stable UUID for a Jeff conversation, used by Claude Code's native
/// session id/resume flags.
pub fn session_uuid(value: &str) -> String {
    let digest = Sha256::digest(value.as_bytes());
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    format!(
        "{:02x}{:02x}{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}-{:02x}{:02x}{:02x}{:02x}{:02x}{:02x}",
        bytes[0], bytes[1], bytes[2], bytes[3], bytes[4], bytes[5], bytes[6], bytes[7],
        bytes[8], bytes[9], bytes[10], bytes[11], bytes[12], bytes[13], bytes[14], bytes[15]
    )
}

fn safe_name(value: &str) -> String {
    let name: String = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() {
                ch.to_ascii_lowercase()
            } else {
                '_'
            }
        })
        .collect();
    let name = name.trim_matches('_').to_string();
    if name.is_empty() {
        "mcp".into()
    } else {
        name.chars().take(40).collect()
    }
}

/// Materializes the Jeff-managed skills as native SKILL.md files. OpenCode,
/// Claude and Codex all discover skills from files, so this is configuration,
/// not a prompt wrapper.
async fn materialize_skills(work: &Path, skills: &[ManagedSkill]) -> AppResult<Option<PathBuf>> {
    if skills.is_empty() {
        return Ok(None);
    }
    let root = work.join("skills");
    tokio::fs::create_dir_all(&root).await?;
    for (index, skill) in skills.iter().enumerate() {
        let id = safe_name(if skill.id.is_empty() {
            &skill.name
        } else {
            &skill.id
        });
        let folder = root.join(format!("{index}-{id}"));
        tokio::fs::create_dir_all(&folder).await?;
        // The native harnesses use this as a command name, so keep it a slug.
        let name = format!("{index}-{id}");
        let description = skill.description.replace('\n', " ").replace('"', "'");
        let body = format!(
            "---\nname: \"{name}\"\ndescription: \"{description}\"\n---\n\n{}\n",
            skill.body
        );
        tokio::fs::write(folder.join("SKILL.md"), body).await?;
    }
    Ok(Some(root))
}

/// Native MCP configuration with secrets passed through process environment
/// placeholders, never written into the generated config file.
fn native_mcp(servers: &[Server], envs: &mut HashMap<String, String>) -> Value {
    let mut out = serde_json::Map::new();
    for (index, server) in servers.iter().enumerate() {
        let base = safe_name(&server.name);
        let mut name = base.clone();
        let mut suffix = 2;
        while out.contains_key(&name) {
            name = format!("{base}_{suffix}");
            suffix += 1;
        }
        // Questions wait up to 600s in the backend; the harness must not give
        // up before the question itself expires.
        let timeout = server.timeout_seconds.clamp(5, 1800) * 1000;
        let mut entry = if server.transport == "http" {
            let mut value = json!({
                "type": "remote",
                "url": server.url,
                "oauth": false,
                "timeout": { "startup": timeout, "execution": timeout },
            });
            if !server.token.is_empty() {
                let key = format!("JEFF_MCP_{index}_TOKEN");
                envs.insert(key.clone(), server.token.clone());
                value["headers"] = json!({"Authorization": format!("Bearer {{env:{key}}}")});
            }
            value
        } else {
            let mut environment = serde_json::Map::new();
            for (key, value) in &server.env {
                let env_key = format!("JEFF_MCP_{index}_{}", safe_name(key).to_uppercase());
                envs.insert(env_key.clone(), value.clone());
                environment.insert(key.clone(), json!(format!("{{env:{env_key}}}")));
            }
            let mut value = json!({
                "type": "local",
                "command": server.command,
                "timeout": { "startup": timeout, "execution": timeout },
            });
            if !environment.is_empty() {
                value["environment"] = Value::Object(environment);
            }
            value
        };
        entry["codemode"] = json!(false);
        out.insert(name, entry);
    }
    Value::Object(out)
}

fn claude_mcp_config(servers: &[Server], envs: &mut HashMap<String, String>) -> Value {
    let mut out = serde_json::Map::new();
    for (index, server) in servers.iter().enumerate() {
        let base = safe_name(&server.name);
        let mut name = base.clone();
        let mut suffix = 2;
        while out.contains_key(&name) {
            name = format!("{base}_{suffix}");
            suffix += 1;
        }
        let entry = if server.transport == "http" {
            let mut value = json!({
                "type": "http",
                "url": server.url,
            });
            if !server.token.is_empty() {
                let key = format!("JEFF_MCP_{index}_TOKEN");
                envs.insert(key.clone(), server.token.clone());
                value["headers"] = json!({"Authorization": format!("Bearer ${{{key}}}")});
            }
            value
        } else {
            let command = server.command.first().cloned().unwrap_or_default();
            let args = server.command.iter().skip(1).cloned().collect::<Vec<_>>();
            let mut value = json!({
                "type": "stdio",
                "command": command,
                "args": args,
            });
            if !server.env.is_empty() {
                let mut environment = serde_json::Map::new();
                for (key, value) in &server.env {
                    let env_key = format!("JEFF_MCP_{index}_{}", safe_name(key).to_uppercase());
                    envs.insert(env_key.clone(), value.clone());
                    environment.insert(key.clone(), json!(format!("${{{env_key}}}")));
                }
                value["env"] = Value::Object(environment);
            }
            value
        };
        out.insert(name, entry);
    }
    json!({"mcpServers": out})
}

/// Builds a session-only Claude plugin containing the skills selected for
/// this Jeff. The user's own `~/.claude/skills` and project skills stay
/// untouched and available.
async fn claude_plugin(work: &Path, skills: &[ManagedSkill]) -> AppResult<Option<PathBuf>> {
    if skills.is_empty() {
        return Ok(None);
    }
    let root = work.join("claude-plugin");
    materialize_skills(&root, skills).await?;
    let manifest_dir = root.join(".claude-plugin");
    tokio::fs::create_dir_all(&manifest_dir).await?;
    let name = work
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| safe_name(name).replace('_', "-"))
        .unwrap_or_else(|| "jeff-skills".into());
    tokio::fs::write(
        manifest_dir.join("plugin.json"),
        json!({
            "name": format!("jeff-{name}"),
            "version": "1.0.0",
            "description": "Skills selected for this Jeff"
        })
        .to_string(),
    )
    .await?;
    Ok(Some(root))
}

fn opencode_config(system: &str, skills: Option<&Path>, mcp: Value) -> Value {
    let mut config = json!({
        "$schema": "https://opencode.ai/config.json",
        "share": "disabled",
        "autoupdate": false,
        "snapshot": false,
        "agents": {
            "jeff": {
                "mode": "primary",
                "system": system
            }
        }
    });
    if let Some(root) = skills {
        config["skills"] = json!([root.display().to_string()]);
    }
    if mcp
        .as_object()
        .map(|items| !items.is_empty())
        .unwrap_or(false)
    {
        config["mcp"] = json!({"servers": mcp});
    }
    config
}

#[derive(Clone, Debug, Default)]
pub struct CliUsage {
    pub input: i64,
    pub output: i64,
    pub cached: i64,
}

/// A completed tool call reported by a native harness. The runtime stores it
/// as a normal Jeff tool message so the transcript keeps the same shape.
#[derive(Clone, Debug)]
pub struct NativeTool {
    pub id: String,
    pub name: String,
    pub input: Value,
    pub output: Value,
    pub error: Option<String>,
    pub started_at: Option<i64>,
    pub finished_at: Option<i64>,
}

/// Maps a Jeff connection to the provider id OpenCode uses for the same API.
/// `custom` connections are identified by their base URL; unknown endpoints
/// keep the OpenCode Go default so a legacy model id still has a valid shape.
fn opencode_provider(config: &AiConfig) -> &'static str {
    match config.provider.as_str() {
        "openai" => "openai",
        "anthropic" => "anthropic",
        "gemini" | "google" => "google",
        "ollama" => "ollama",
        "openrouter" => "openrouter",
        "groq" => "groq",
        "mistral" => "mistral",
        "deepseek" => "deepseek",
        "xai" | "grok" => "xai",
        "opencode-go" | "opencode" => "opencode-go",
        "custom" => {
            let url = config.base_url.as_str();
            if url.contains("opencode.ai") {
                "opencode-go"
            } else if url.contains("openrouter.ai") {
                "openrouter"
            } else if url.contains("generativelanguage.googleapis.com") {
                "google"
            } else if url.contains("api.groq.com") {
                "groq"
            } else if url.contains("api.deepseek.com") {
                "deepseek"
            } else if url.contains("api.mistral.ai") {
                "mistral"
            } else if url.contains("api.x.ai") {
                "xai"
            } else if url.contains("api.openai.com") {
                "openai"
            } else if url.contains("api.anthropic.com") {
                "anthropic"
            } else {
                "opencode-go"
            }
        }
        _ => "opencode-go",
    }
}

/// The model OpenCode should run. Existing Jeff model ids are migrated:
/// `default::deepseek-v4.1-flash` becomes `opencode-go/deepseek-v4.1-flash`,
/// and a named connection keeps its real provider (`openai/gpt-5`). The
/// selected reasoning effort becomes the OpenCode variant (`model#max`).
pub fn opencode_model(agent: &AgentSpec, config: &AiConfig) -> String {
    let selected = if agent.model.trim().is_empty() {
        config.model.trim()
    } else {
        agent.model.trim()
    };
    let config_model = config
        .model
        .trim()
        .strip_prefix("default::")
        .unwrap_or(config.model.trim());
    let model = if let Some(model) = selected.strip_prefix("default::") {
        format!("{}/{}", opencode_provider(config), model)
    } else if let Some((_, model)) = selected.split_once("::") {
        format!("{}/{}", opencode_provider(config), model)
    } else if selected.contains('/') {
        selected.to_string()
    } else if selected.is_empty() {
        format!("{}/{}", opencode_provider(config), config_model)
    } else {
        format!("opencode-go/{selected}")
    };
    let effort: String = agent
        .effort
        .trim()
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        .collect();
    if effort.is_empty() || model.contains('#') {
        model
    } else {
        format!("{model}#{effort}")
    }
}

fn tail(text: &str) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    chars[chars.len().saturating_sub(2_000)..].iter().collect()
}

fn provider_model(model: &str, accepted: &[&str]) -> Option<String> {
    if model.trim().is_empty() {
        return None;
    }
    let value = model.rsplit("::").next().unwrap_or(model);
    let value = value.rsplit('/').next().unwrap_or(value);
    let lower = value.to_lowercase();
    accepted
        .iter()
        .any(|needle| lower.contains(needle))
        .then(|| value.to_string())
}

/// Jeff's own secrets must not reach the harness or the shells it spawns.
/// Variables for the selected MCP servers are passed explicitly and kept.
///
/// This is not a sandbox: the harness still runs as the same user, so a shell
/// can read `/proc/<server>/environ` and the data directory. It removes the
/// accidental exposure (`env` in a child, inherited tokens), not the last one.
fn hide_server_secrets<'a, I>(command: &mut Command, keep: I)
where
    I: IntoIterator<Item = &'a str>,
{
    let keep: std::collections::HashSet<&str> = keep.into_iter().collect();
    for (key, _) in std::env::vars_os() {
        let key = key.to_string_lossy();
        if !keep.contains(key.as_ref()) && server_secret(&key) {
            command.env_remove(key.as_ref());
        }
    }
}

fn server_secret(key: &str) -> bool {
    matches!(
        key,
        "JEFF_ADMIN_PASSWORD"
            | "JEFF_FIREBASE_CREDENTIALS_FILE"
            | "JEFF_FIREBASE_PROJECT_ID"
            | "JEFF_GITHUB_TOKEN"
    ) || key.starts_with("JEFF_MCP_")
}

/// Runs a CLI once, with the prompt on stdin, and captures both streams.
/// The whole process group is killed when the run is cancelled.
const MAX_CAPTURE_BYTES: usize = 128 * 1024 * 1024;

async fn read_capped<R>(mut reader: R) -> std::io::Result<(Vec<u8>, bool)>
where
    R: tokio::io::AsyncRead + Unpin,
{
    use tokio::io::AsyncReadExt;
    let mut output = Vec::new();
    let mut chunk = [0u8; 32 * 1024];
    let mut exceeded = false;
    loop {
        let count = reader.read(&mut chunk).await?;
        if count == 0 {
            break;
        }
        if output.len() < MAX_CAPTURE_BYTES {
            let room = MAX_CAPTURE_BYTES - output.len();
            let take = room.min(count);
            output.extend_from_slice(&chunk[..take]);
            if take < count {
                exceeded = true;
            }
        } else {
            exceeded = true;
        }
    }
    Ok((output, exceeded))
}

async fn run_capture<S: AsRef<str>>(
    binary: &Path,
    args: &[String],
    envs: &[(S, String)],
    cwd: &Path,
    prompt: &str,
    cancel: &CancellationToken,
) -> AppResult<(String, String)> {
    let mut command = Command::new(binary);
    command
        .args(args)
        .current_dir(cwd)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    hide_server_secrets(&mut command, envs.iter().map(|(key, _)| key.as_ref()));
    for (key, value) in envs {
        command.env(key.as_ref(), value);
    }
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            bad_request("A CLI do harness não está instalada.")
        } else {
            crate::errors::AppError::Io(error)
        }
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        use tokio::io::AsyncWriteExt;
        stdin.write_all(prompt.as_bytes()).await?;
    }
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| bad_request("A CLI não abriu stdout."))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| bad_request("A CLI não abriu stderr."))?;
    let out = tokio::spawn(read_capped(BufReader::new(stdout)));
    let err = tokio::spawn(read_capped(BufReader::new(stderr)));
    let status = tokio::select! {
        _ = cancel.cancelled() => {
            let _ = child.kill().await;
            return Err(bad_request("Execution cancelled"));
        }
        status = child.wait() => status?,
    };
    let (stdout, stdout_exceeded) = out
        .await
        .map_err(|error| crate::errors::internal(error.to_string()))??;
    let (stderr, stderr_exceeded) = err
        .await
        .map_err(|error| crate::errors::internal(error.to_string()))??;
    if stdout_exceeded || stderr_exceeded {
        return Err(bad_request(format!(
            "A CLI produziu mais de {} MB de saída; a execução foi interrompida para proteger a memória do servidor.",
            MAX_CAPTURE_BYTES / (1024 * 1024)
        )));
    }
    let stdout = String::from_utf8_lossy(&stdout).to_string();
    let stderr = String::from_utf8_lossy(&stderr).to_string();
    if !status.success() {
        return Err(bad_request(format!(
            "A CLI saiu com código {}. {}",
            status.code().unwrap_or(-1),
            tail(&stderr)
        )));
    }
    Ok((stdout, stderr))
}

/// Runs Claude Code headless with its native harness: native tools, project
/// config/skills and the Jeff system prompt. Jeff still owns the chat, run
/// state and final transcript.
pub async fn run_claude(
    model: &str,
    effort: &str,
    system: &str,
    prompt: &str,
    cwd: &Path,
    skills: &[ManagedSkill],
    mcp_servers: &[Server],
    session: &str,
    resume: bool,
    cancel: &CancellationToken,
    _on_tool: &mut (dyn FnMut(NativeTool) + Send),
) -> AppResult<(String, CliUsage)> {
    let binary = super::engines::find_binary("claude").ok_or_else(|| {
        bad_request(
            "O Claude Code não está instalado. Instale em Configurações → Harness e tente de novo.",
        )
    })?;
    let mut args = vec![
        "-p".to_string(),
        "--output-format".into(),
        "json".into(),
        "--dangerously-skip-permissions".into(),
        // The headless question tool has no one to answer; Jeff exposes
        // ask_user through MCP instead.
        "--disallowedTools".into(),
        "AskUserQuestion".into(),
        "--append-system-prompt".into(),
        system.to_string(),
    ];
    if resume {
        args.push("--resume".into());
        args.push(session.to_string());
    } else {
        args.push("--session-id".into());
        args.push(session.to_string());
    }
    if let Some(model) = provider_model(model, &["claude", "sonnet", "opus", "haiku"]) {
        args.push("--model".into());
        args.push(model);
    }
    if !effort.trim().is_empty() {
        args.push("--effort".into());
        args.push(effort.trim().to_string());
    }
    if let Some(plugin) = claude_plugin(cwd, skills).await? {
        args.push("--plugin-dir".into());
        args.push(plugin.display().to_string());
    }
    let mut secrets = HashMap::new();
    if !mcp_servers.is_empty() {
        tokio::fs::create_dir_all(cwd).await?;
        let path = cwd.join("jeff-mcp.json");
        tokio::fs::write(
            &path,
            claude_mcp_config(mcp_servers, &mut secrets).to_string(),
        )
        .await?;
        args.push("--mcp-config".into());
        args.push(path.display().to_string());
    }
    let mut environment = vec![
        ("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC", "1".into()),
        ("MCP_TOOL_TIMEOUT", "900000".into()),
    ];
    environment.extend(
        secrets
            .iter()
            .map(|(key, value)| (key.as_str(), value.clone())),
    );
    let (stdout, stderr) = run_capture(&binary, &args, &environment, cwd, prompt, cancel).await?;
    let value = serde_json::from_str::<Value>(stdout.trim())
        .ok()
        .or_else(|| {
            stdout
                .lines()
                .rev()
                .find_map(|line| serde_json::from_str::<Value>(line).ok())
        });
    let Some(value) = value else {
        if stdout.trim().is_empty() {
            return Err(bad_request(format!(
                "O Claude Code saiu sem resposta. {}",
                tail(&stderr)
            )));
        }
        return Ok((stdout.trim().to_string(), CliUsage::default()));
    };
    if value["is_error"].as_bool() == Some(true) || value["subtype"].as_str() != Some("success") {
        return Err(bad_request(
            value["result"]
                .as_str()
                .filter(|text| !text.trim().is_empty())
                .unwrap_or("O Claude Code terminou com erro.")
                .to_string(),
        ));
    }
    let text = value["result"].as_str().unwrap_or("").trim().to_string();
    if text.is_empty() {
        return Err(bad_request("O Claude Code terminou sem resposta."));
    }
    let usage = &value["usage"];
    let cached = usage["cache_read_input_tokens"].as_i64().unwrap_or(0);
    Ok((
        text,
        CliUsage {
            input: usage["input_tokens"].as_i64().unwrap_or(0)
                + cached
                + usage["cache_creation_input_tokens"].as_i64().unwrap_or(0),
            output: usage["output_tokens"].as_i64().unwrap_or(0),
            cached,
        },
    ))
}

#[cfg(unix)]
async fn link_or_copy(from: &Path, to: &Path) -> AppResult<()> {
    if tokio::fs::symlink(from, to).await.is_err() && from.is_file() {
        tokio::fs::copy(from, to).await?;
    }
    Ok(())
}

/// Builds a private Codex home that keeps the user's native auth/config and
/// adds the skills selected for this Jeff. Codex reads skills from
/// `$CODEX_HOME/skills`; the real `$HOME/.agents/skills` still loads because
/// only `CODEX_HOME` changes, not `HOME`.
async fn codex_home(work: &Path, skills: &[ManagedSkill]) -> AppResult<PathBuf> {
    let root = work.join("codex");
    let skills_root = root.join("skills");
    tokio::fs::create_dir_all(&skills_root).await?;
    let real = std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".codex")));
    if let Some(real) = real {
        for name in ["auth.json", "config.toml", "instructions.md"] {
            let from = real.join(name);
            let to = root.join(name);
            if tokio::fs::try_exists(&from).await.unwrap_or(false)
                && !tokio::fs::try_exists(&to).await.unwrap_or(false)
            {
                #[cfg(unix)]
                link_or_copy(&from, &to).await?;
                #[cfg(not(unix))]
                if from.is_file() {
                    tokio::fs::copy(&from, &to).await?;
                }
            }
        }
        if let Ok(mut entries) = tokio::fs::read_dir(real.join("skills")).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let name = entry.file_name();
                if name == ".system" {
                    continue;
                }
                let to = skills_root.join(&name);
                if !tokio::fs::try_exists(&to).await.unwrap_or(false) {
                    #[cfg(unix)]
                    link_or_copy(&entry.path(), &to).await?;
                }
            }
        }
    }
    materialize_skills(&root, skills).await?;
    Ok(root)
}

/// Runs Codex headless with its native harness (`codex exec --json`). Native
/// shell/edit/search tools are enabled; Jeff only stores the run and messages.
pub async fn run_codex(
    model: &str,
    system: &str,
    prompt: &str,
    cwd: &Path,
    skills: &[ManagedSkill],
    mcp_servers: &[Server],
    session: Option<&str>,
    cancel: &CancellationToken,
    on_tool: &mut (dyn FnMut(NativeTool) + Send),
) -> AppResult<(String, CliUsage, Option<String>)> {
    let binary = super::engines::find_binary("codex").ok_or_else(|| {
        bad_request(
            "O Codex não está instalado. Instale em Configurações → Harness e tente de novo.",
        )
    })?;
    let mut args = vec!["exec".to_string(), "--json".into()];
    if let Some(session) = session {
        args.push("resume".into());
        args.push(session.to_string());
    }
    args.extend([
        "--skip-git-repo-check".into(),
        "--sandbox".into(),
        "danger-full-access".into(),
        "-C".into(),
        cwd.display().to_string(),
        "-c".into(),
        format!(
            "developer_instructions={}",
            serde_json::to_string(system).unwrap_or_else(|_| "\"\"".into())
        ),
    ]);
    let mut envs: Vec<(String, String)> = Vec::new();
    for (index, server) in mcp_servers.iter().enumerate() {
        let name = safe_name(&server.name);
        if server.transport == "http" {
            args.push("-c".into());
            args.push(format!(
                "mcp_servers.{name}.url={}",
                serde_json::to_string(&server.url).unwrap_or_default()
            ));
            if !server.token.is_empty() {
                let key = format!("JEFF_MCP_{index}_TOKEN");
                envs.push((key.clone(), server.token.clone()));
                args.push("-c".into());
                args.push(format!("mcp_servers.{name}.bearer_token_env_var={key:?}"));
            }
        } else if !server.command.is_empty() {
            args.push("-c".into());
            args.push(format!(
                "mcp_servers.{name}.command={}",
                serde_json::to_string(&server.command).unwrap_or_default()
            ));
            for (key, value) in &server.env {
                args.push("-c".into());
                args.push(format!(
                    "mcp_servers.{name}.env.{key}={}",
                    serde_json::to_string(value).unwrap_or_default()
                ));
            }
        }
    }
    if let Some(model) = provider_model(model, &["gpt", "codex", "o3", "o4", "chatgpt"]) {
        args.push("-m".into());
        args.push(model);
    }
    args.push("-".into());
    let codex_home = codex_home(cwd, skills).await?;
    envs.push(("CODEX_HOME".into(), codex_home.display().to_string()));
    let (stdout, stderr) = run_capture(&binary, &args, &envs, cwd, prompt, cancel).await?;
    let mut text = String::new();
    let mut usage = CliUsage::default();
    let mut error: Option<String> = None;
    let mut thread_id: Option<String> = None;
    for line in stdout.lines() {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        match value["type"].as_str().unwrap_or("") {
            "thread.started" => {
                thread_id = value["thread_id"].as_str().map(str::to_string);
            }
            "item.completed" => {
                let item = &value["item"];
                let kind = item["type"].as_str().unwrap_or("");
                if kind == "agent_message" {
                    if let Some(part) = item["text"].as_str() {
                        if !text.is_empty() {
                            text.push_str("\n\n");
                        }
                        text.push_str(part);
                    }
                }
                let id = item["id"].as_str().unwrap_or("").to_string();
                let (name, input, output, tool_error) = match kind {
                    "command_execution" => {
                        let exit = item["exit_code"].as_i64().unwrap_or(0);
                        (
                            "shell".to_string(),
                            json!({"command": item["command"]}),
                            json!({
                                "exitCode": exit,
                                "stdout": item["aggregated_output"].as_str().unwrap_or(""),
                                "stderr": ""
                            }),
                            (exit != 0).then(|| format!("exit code {exit}")),
                        )
                    }
                    "file_change" => (
                        "edit_file".to_string(),
                        json!({"changes": item["changes"]}),
                        item["changes"].clone(),
                        None,
                    ),
                    "mcp_tool_call" => (
                        "mcp_call".to_string(),
                        json!({"server": item["server"], "tool": item["tool"], "arguments": item["arguments"]}),
                        item["result"].clone(),
                        None,
                    ),
                    _ => continue,
                };
                if !id.is_empty() {
                    on_tool(NativeTool {
                        id,
                        name,
                        input,
                        output,
                        error: tool_error,
                        started_at: None,
                        finished_at: None,
                    });
                }
            }
            "turn.completed" => {
                let raw = &value["usage"];
                usage.cached = raw["cached_input_tokens"].as_i64().unwrap_or(0);
                usage.input = raw["input_tokens"].as_i64().unwrap_or(0) + usage.cached;
                usage.output = raw["output_tokens"].as_i64().unwrap_or(0);
            }
            "turn.failed" | "error" => {
                error = Some(
                    value["error"]["message"]
                        .as_str()
                        .or_else(|| value["message"].as_str())
                        .unwrap_or("O Codex terminou com erro.")
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    if let Some(error) = error {
        return Err(bad_request(error));
    }
    if text.trim().is_empty() {
        return Err(bad_request(format!(
            "O Codex saiu sem resposta. {}",
            tail(&stderr)
        )));
    }
    Ok((text, usage, thread_id))
}

/// Serializes updates to the shared Antigravity MCP config across runs.
static AGY_MCP_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

/// Antigravity reads MCP servers from `~/.gemini/config/mcp_config.json`. Jeff
/// owns only the `jeff*` entries, so the user's own servers stay untouched.
/// The long timeout matters: `ask_user` waits for a person, not for a tool.
fn configure_antigravity_mcp(servers: &[Server]) -> AppResult<()> {
    let _guard = AGY_MCP_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    let Some(home) = std::env::var_os("HOME") else {
        return Ok(());
    };
    let path = PathBuf::from(home).join(".gemini/config/mcp_config.json");
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(AppError::Io)?;
    }
    let mut root: Value = std::fs::read(&path)
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_else(|| json!({}));
    if !root.is_object() {
        root = json!({});
    }
    let Some(root_map) = root.as_object_mut() else {
        return Ok(());
    };
    let servers_value = root_map.entry("mcpServers").or_insert_with(|| json!({}));
    let Some(configured) = servers_value.as_object_mut() else {
        return Err(bad_request("mcp_config.json inválido."));
    };
    let managed: Vec<String> = configured
        .keys()
        .filter(|name| name.starts_with("jeff_") || name.as_str() == "jeff")
        .cloned()
        .collect();
    for name in managed {
        configured.remove(&name);
    }
    for server in servers {
        let name = if server.id == "jeff" {
            "jeff".to_string()
        } else {
            format!("jeff_{}", safe_name(&server.id))
        };
        let entry = if server.transport == "http" {
            let mut headers = serde_json::Map::new();
            if !server.token.is_empty() {
                headers.insert(
                    "Authorization".to_string(),
                    json!(format!("Bearer {}", server.token)),
                );
            }
            json!({
                "serverUrl": server.url,
                "headers": Value::Object(headers),
                "timeoutSeconds": 900,
            })
        } else {
            let mut command_args = server.command.clone();
            if command_args.is_empty() {
                continue;
            }
            let command = command_args.remove(0);
            let env: serde_json::Map<String, Value> = server
                .env
                .iter()
                .map(|(key, value)| (key.clone(), json!(value)))
                .collect();
            json!({
                "command": command,
                "args": command_args,
                "env": Value::Object(env),
                "timeoutSeconds": 900,
            })
        };
        configured.insert(name, entry);
    }
    let bytes = serde_json::to_vec_pretty(&root).map_err(|error| bad_request(error.to_string()))?;
    std::fs::write(&path, bytes).map_err(AppError::Io)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Runs one Antigravity CLI turn with the CLI's own Google login. Print mode
/// returns a single JSON envelope; Jeff keeps the conversation id as the
/// session ledger so the next turn resumes the same thread.
pub async fn run_antigravity(
    model: &str,
    system: &str,
    prompt: &str,
    cwd: &Path,
    mcp_servers: &[Server],
    conversation: Option<&str>,
    cancel: &CancellationToken,
) -> AppResult<(String, CliUsage, Option<String>)> {
    let Some(binary) = super::engines::find_binary("agy") else {
        return Err(bad_request("O Antigravity CLI não está instalado."));
    };
    configure_antigravity_mcp(mcp_servers)?;
    let mut args = vec![
        "--output-format".to_string(),
        "json".to_string(),
        "--dangerously-skip-permissions".to_string(),
    ];
    if let Some(slug) = provider_model(
        model,
        &[
            "gemini",
            "carbon",
            "argon",
            "hydrogen",
            "orchestrator",
            "claude",
            "gpt",
            "oss",
        ],
    ) {
        args.push("--model".to_string());
        args.push(slug);
    }
    if let Some(id) = conversation {
        args.push("--conversation".to_string());
        args.push(id.to_string());
    }
    // `agy -p` consumes the next argument as the prompt, so it goes last.
    args.push("-p".to_string());
    let full_prompt = if system.trim().is_empty() {
        prompt.to_string()
    } else {
        format!("{system}\n\n{prompt}")
    };
    args.push(full_prompt);
    let envs = [("AGY_CLI_DISABLE_AUTO_UPDATE", "true".to_string())];
    let (stdout, stderr) = run_capture(&binary, &args, &envs, cwd, "", cancel).await?;
    let value: Value = serde_json::from_str(stdout.trim()).map_err(|error| {
        bad_request(format!(
            "O Antigravity CLI devolveu uma resposta inválida: {error}. {}",
            tail(&stderr)
        ))
    })?;
    let status = value["status"].as_str().unwrap_or("");
    if !status.eq_ignore_ascii_case("SUCCESS") {
        let message = value["error"]
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| tail(&stderr));
        return Err(bad_request(format!(
            "O Antigravity CLI falhou ({status}): {message}"
        )));
    }
    let text = value["response"].as_str().unwrap_or("").to_string();
    if text.trim().is_empty() {
        return Err(bad_request(format!(
            "O Antigravity CLI saiu sem resposta. {}",
            tail(&stderr)
        )));
    }
    let usage = &value["usage"];
    let number = |key: &str| usage[key].as_u64().unwrap_or(0) as i64;
    let thread = value["conversation_id"].as_str().map(str::to_owned);
    Ok((
        text,
        CliUsage {
            input: number("input_tokens"),
            output: number("output_tokens"),
            cached: number("cache_read_tokens"),
        },
        thread,
    ))
}

/// Runs one Gemini CLI turn in headless JSON mode. The CLI keeps its own
/// Google login in the persistent home; Jeff feeds the full context and stores
/// the final response.
pub async fn run_gemini(
    model: &str,
    system: &str,
    prompt: &str,
    cwd: &Path,
    cancel: &CancellationToken,
) -> AppResult<(String, CliUsage, Option<String>)> {
    let Some(binary) = super::engines::find_binary("gemini") else {
        return Err(bad_request("O Gemini CLI não está instalado."));
    };
    let mut args = vec![
        "--output-format".to_string(),
        "json".to_string(),
        "--approval-mode".to_string(),
        "yolo".to_string(),
        "--skip-trust".to_string(),
    ];
    if let Some(slug) = provider_model(model, &["gemini"]) {
        args.push("-m".to_string());
        args.push(slug);
    }
    let full_prompt = if system.trim().is_empty() {
        prompt.to_string()
    } else {
        format!("{system}\n\n{prompt}")
    };
    args.push("-p".to_string());
    args.push(full_prompt);
    let (stdout, stderr) = run_capture::<String>(&binary, &args, &[], cwd, "", cancel).await?;
    let value: Value = serde_json::from_str(stdout.trim()).map_err(|error| {
        bad_request(format!(
            "O Gemini CLI devolveu uma resposta inválida: {error}. {}",
            tail(&stderr)
        ))
    })?;
    if let Some(error) = value.get("error").filter(|value| !value.is_null()) {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .or_else(|| error.as_str())
            .unwrap_or("erro sem detalhes");
        return Err(bad_request(format!("O Gemini CLI falhou: {message}")));
    }
    let text = value["response"].as_str().unwrap_or("").to_string();
    if text.trim().is_empty() {
        return Err(bad_request(format!(
            "O Gemini CLI saiu sem resposta. {}",
            tail(&stderr)
        )));
    }
    let mut input = 0i64;
    let mut output = 0i64;
    let mut cached = 0i64;
    let models = value["stats"]["models"].as_object();
    if let Some(models) = models {
        for model in models.values() {
            let tokens = &model["tokens"];
            input += tokens["prompt"]
                .as_i64()
                .or_else(|| tokens["input"].as_i64())
                .unwrap_or(0);
            output += tokens["candidates"]
                .as_i64()
                .or_else(|| tokens["output"].as_i64())
                .unwrap_or(0);
            cached += tokens["cached"].as_i64().unwrap_or(0);
        }
    } else {
        let tokens = &value["stats"]["tokens"];
        input = tokens["prompt"]
            .as_i64()
            .or_else(|| tokens["input"].as_i64())
            .unwrap_or(0);
        output = tokens["candidates"]
            .as_i64()
            .or_else(|| tokens["output"].as_i64())
            .unwrap_or(0);
        cached = tokens["cached"].as_i64().unwrap_or(0);
    }
    Ok((
        text,
        CliUsage {
            input,
            output,
            cached,
        },
        value["sessionId"]
            .as_str()
            .or_else(|| value["session_id"].as_str())
            .map(str::to_owned),
    ))
}

/// Runs one OpenCode turn with its native harness. Native tools, project
/// config, skills and plugins stay available; Jeff injects identity and stores
/// the transcript.
pub async fn run_opencode<F, R, T>(
    model: &str,
    system: &str,
    prompt: &str,
    session_id: &str,
    project: &Path,
    attachments: &[Attachment],
    files: &[PathBuf],
    skills: &[ManagedSkill],
    mcp_servers: &[Server],
    cancel: &CancellationToken,
    mut on_text: F,
    mut on_reasoning: R,
    mut on_tool: T,
) -> AppResult<(String, CliUsage)>
where
    F: FnMut(&str),
    R: FnMut(&str),
    T: FnMut(NativeTool) + Send,
{
    let home = work_dir(session_id);
    let skill_root = materialize_skills(&home, skills).await?;
    let mut envs = HashMap::new();
    let config = opencode_config(
        system,
        skill_root.as_deref(),
        native_mcp(mcp_servers, &mut envs),
    );
    tokio::fs::create_dir_all(&home).await?;
    let config_path = home.join("opencode.json");
    tokio::fs::write(&config_path, config.to_string()).await?;
    // systemd starts Jeff with a minimal PATH; resolve the CLI the same way the
    // Settings detector does instead of relying on PATH containing ~/.local/bin.
    let binary = super::engines::find_binary("opencode").ok_or_else(|| {
        bad_request(
            "O OpenCode não está instalado. Instale em Configurações → CLIs e tente de novo.",
        )
    })?;
    let mut command = Command::new(&binary);
    command
        // A private server keeps this run's config and permissions out of the
        // user's shared OpenCode service.
        .arg("--standalone")
        .arg("--log-level")
        .arg("error")
        .arg("run")
        .arg("--session")
        .arg(session_id)
        .arg("--format")
        .arg("json")
        .arg("--auto")
        .arg("--thinking")
        .arg("--agent")
        .arg("jeff")
        .arg("-m")
        .arg(model);
    for (attachment, file) in attachments.iter().zip(files) {
        if attachment.mime.starts_with("image/") {
            command.arg("--file").arg(file);
        }
    }
    hide_server_secrets(&mut command, envs.keys().map(String::as_str));
    command
        .arg(prompt)
        .current_dir(project)
        .env("OPENCODE_CONFIG", &config_path)
        .envs(&envs)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    #[cfg(unix)]
    command.process_group(0);
    let mut child = command.spawn().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            bad_request(
                "O OpenCode não está instalado. Instale em Configurações → CLIs e tente de novo.",
            )
        } else {
            crate::errors::AppError::Io(error)
        }
    })?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| bad_request("OpenCode sem stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| bad_request("OpenCode sem stderr"))?;
    let mut lines = BufReader::new(stdout).lines();
    let mut err_lines = BufReader::new(stderr).lines();
    let mut text = String::new();
    let mut usage = CliUsage::default();
    let mut error: Option<String> = None;
    let mut seen_parts = std::collections::HashSet::new();
    let mut stderr_done = false;
    let mut completed = false;
    loop {
        tokio::select! {
            _=cancel.cancelled()=>{
                let _=child.kill().await;
                return Err(bad_request("Execution cancelled"));
            }
            line=lines.next_line()=>{
                let Ok(Some(line))=line else { break; };
                let Ok(value)=serde_json::from_str::<Value>(&line) else { continue };
                match value["type"].as_str().unwrap_or("") {
                    "text" => {
                        if let Some(part)=value["part"]["text"].as_str() {
                            if !part.is_empty() {
                                // The CLI prints each finished text part once; the
                                // id guards against duplicated snapshots.
                                let part_id = value["part"]["id"].as_str().unwrap_or("").to_string();
                                if part_id.is_empty() || seen_parts.insert(format!("text:{part_id}")) {
                                    text.push_str(part);
                                    on_text(part);
                                }
                            }
                        }
                    }
                    "reasoning" => {
                        if let Some(part)=value["part"]["text"].as_str() {
                            if !part.trim().is_empty() {
                                let part_id = value["part"]["id"].as_str().unwrap_or("").to_string();
                                if part_id.is_empty() || seen_parts.insert(format!("reasoning:{part_id}")) {
                                    on_reasoning(part);
                                }
                            }
                        }
                    }
                    "tool_use" => {
                        let part = &value["part"];
                        let state = &part["state"];
                        let status = state["status"].as_str().unwrap_or("completed");
                        if status != "completed" && status != "error" { continue; }
                        let id = part["id"].as_str().unwrap_or("").to_string();
                        let name = part["tool"].as_str().unwrap_or("tool").to_string();
                        let input = state["input"].clone();
                        let output = if state["output"].is_null() {
                            state["metadata"]["content"].clone()
                        } else {
                            state["output"].clone()
                        };
                        let error = if status == "error" {
                            state["error"].as_str().map(str::to_string)
                                .or_else(|| state["output"].as_str().map(str::to_string))
                        } else { None };
                        if !id.is_empty() {
                            on_tool(NativeTool {
                                id,
                                name,
                                input,
                                output,
                                error,
                                started_at: state["time"]["start"].as_i64(),
                                finished_at: state["time"]["end"].as_i64(),
                            });
                        }
                    }
                    "step_finish" => {
                        let tokens=&value["part"]["tokens"];
                        usage.input += tokens["input"].as_i64().unwrap_or(0)
                            + tokens["cache"]["read"].as_i64().unwrap_or(0)
                            + tokens["cache"]["write"].as_i64().unwrap_or(0);
                        usage.cached += tokens["cache"]["read"].as_i64().unwrap_or(0);
                        usage.output += tokens["output"].as_i64().unwrap_or(0)
                            + tokens["reasoning"].as_i64().unwrap_or(0);
                        // The turn is over. The CLI can still linger because a
                        // background shell or its private server keeps running,
                        // which left the chat "thinking" forever.
                        if value["part"]["reason"].as_str() == Some("stop") {
                            // We end the CLI ourselves; the signal is not a failure.
                            completed = true;
                            let _ = child.kill().await;
                            break;
                        }
                    }
                    "error" => {
                        let data=&value["error"]["data"];
                        error=Some(
                            data["message"].as_str()
                                .or_else(|| value["error"]["message"].as_str())
                                .or_else(|| value["error"]["name"].as_str())
                                .unwrap_or("OpenCode terminou com erro.")
                                .to_string(),
                        );
                    }
                    _ => {}
                }
            }
            line=async {
                if stderr_done {
                    std::future::pending::<()>().await;
                }
                err_lines.next_line().await
            }=>{
                match line {
                    Ok(Some(line)) => {
                        if !line.trim().is_empty() {
                            error=Some(line);
                        }
                    }
                    Ok(None) => stderr_done = true,
                    Err(_) => stderr_done = true,
                }
            }
        }
    }
    let status = child.wait().await?;
    if !completed && !status.success() {
        return Err(bad_request(error.unwrap_or_else(|| {
            format!("OpenCode saiu com código {}", status.code().unwrap_or(-1))
        })));
    }
    if let Some(error) = error {
        if text.trim().is_empty() {
            return Err(bad_request(error));
        }
    }
    Ok((text, usage))
}

#[cfg(test)]
mod tests {
    use super::server_secret;

    #[test]
    fn only_jeff_secrets_are_hidden_from_the_harness() {
        for key in [
            "JEFF_ADMIN_PASSWORD",
            "JEFF_MCP_0_TOKEN",
            "JEFF_MCP_1_JEFF_PROJECT_ROOT",
            "JEFF_FIREBASE_CREDENTIALS_FILE",
            "JEFF_FIREBASE_PROJECT_ID",
            "JEFF_GITHUB_TOKEN",
        ] {
            assert!(server_secret(key), "{key} must be hidden");
        }
        for key in [
            "JEFF_DATA_DIR",
            "JEFF_WORKSPACES",
            "JEFF_PYTHON",
            "PATH",
            "HOME",
            "OPENCODE_CONFIG",
            "GITHUB_TOKEN",
        ] {
            assert!(!server_secret(key), "{key} must reach the harness");
        }
    }
}
