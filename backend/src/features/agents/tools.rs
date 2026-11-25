use super::models::{now, RunContext};
use crate::{
    ai::AiService,
    email::EmailService,
    errors::{bad_request, AppError, AppResult},
    store::Store,
    workspace::WorkspaceService,
};
use serde_json::{json, Value};
use sqlx::Row;
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::io::{AsyncRead, AsyncReadExt};

#[derive(Clone)]
pub struct Tools {
    pub store: Store,
    pub ai: AiService,
    pub workspace: WorkspaceService,
    pub email: EmailService,
    pub artifacts: PathBuf,
    pub mcp: crate::features::integrations::mcp::Service,
    pub http: reqwest::Client,
    /// Debug-mode runs drive a real PTY the user watches live.
    pub terminals: Arc<crate::terminal::TerminalManager>,
    /// Debug-mode runs also drive a live Chromium the user watches.
    pub browser: Arc<crate::browser::BrowserManager>,
}

/// A full `tools/list` payload easily passes 50 KB per server. The model only
/// needs names, a short description and the argument names to pick and call a
/// tool, so keep the listing compact instead of turning every list into an
/// artifact the model then struggles to read back.
fn compact_mcp_tools(value: &Value) -> Value {
    let tools = value["tools"]
        .as_array()
        .map(|tools| {
            tools
                .iter()
                .map(|tool| {
                    let description = tool["description"]
                        .as_str()
                        .unwrap_or("")
                        .lines()
                        .next()
                        .unwrap_or("")
                        .chars()
                        .take(240)
                        .collect::<String>();
                    let arguments = tool["inputSchema"]["properties"]
                        .as_object()
                        .map(|properties| properties.keys().cloned().collect::<Vec<_>>())
                        .unwrap_or_default();
                    let required = tool["inputSchema"]["required"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default();
                    json!({
                        "name": tool["name"],
                        "description": description,
                        "arguments": arguments,
                        "required": required,
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    json!({"count": tools.len(), "tools": tools})
}

/// Exposed to every CLI run so an agent can ask the user a structured question
/// instead of ending the turn with a question that nothing can answer.
pub fn ask_user_definition() -> Value {
    json!({
        "name": "ask_user",
        "description": "Ask the user a decision you cannot infer. Send short questions with 2-4 options each; the answers return as this tool's result and the run continues. Use it instead of ending the turn with a question in prose.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "questions": {
                    "type": "array",
                    "minItems": 1,
                    "items": {
                        "type": "object",
                        "properties": {
                            "header": {"type": "string"},
                            "question": {"type": "string"},
                            "multiple": {"type": "boolean"},
                            "options": {
                                "type": "array",
                                "minItems": 1,
                                "items": {
                                    "type": "object",
                                    "properties": {
                                        "label": {"type": "string"},
                                        "description": {"type": "string"}
                                    },
                                    "required": ["label"]
                                }
                            }
                        },
                        "required": ["question", "options"]
                    }
                }
            },
            "required": ["questions"]
        }
    })
}

/// The visible terminal is only exposed to runs started in debug mode. The
/// agent decides what to run; the user watches each command and its output.
pub fn debug_terminal_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "debug_terminal_run",
            "description": "Run a command in the debug terminal the user is watching. Use it to start the program, run tests and inspect state. The command and its output appear in real time in the terminal.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "command": {"type": "string", "description": "Shell command to execute in the project directory."}
                },
                "required": ["command"]
            }
        }),
        json!({
            "name": "debug_terminal_output",
            "description": "Read the tail of the debug terminal output. Use after debug_terminal_run to see the result, including while a command is still running.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tailBytes": {"type": "integer", "description": "How many bytes of recent output to return (default 16000)."}
                }
            }
        }),
    ]
}

/// The live browser is only exposed to runs started in debug mode. The agent
/// decides what to do; the user watches the same Chromium in the app.
pub fn debug_browser_definitions() -> Vec<Value> {
    vec![
        json!({
            "name": "debug_browser_open",
            "description": "Open a URL in the live Chromium the user is watching. Use it before inspecting a web app or reproducing a UI bug.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {"type": "string", "description": "http or https URL to open."}
                },
                "required": ["url"]
            }
        }),
        json!({
            "name": "debug_browser_read",
            "description": "Read the current page: URL, title, visible text, recent console messages and failed network requests. Use it after opening or interacting with the page.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
        json!({
            "name": "debug_browser_click",
            "description": "Click an element in the live browser, visibly. Prefer a CSS selector; x/y are viewport pixels when no selector is given.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "selector": {"type": "string", "description": "CSS selector of the element to click."},
                    "x": {"type": "number", "description": "Viewport x coordinate when no selector is used."},
                    "y": {"type": "number", "description": "Viewport y coordinate when no selector is used."}
                }
            }
        }),
        json!({
            "name": "debug_browser_type",
            "description": "Type text into the focused element (or click a selector first) in the live browser. The user sees the text appear.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {"type": "string"},
                    "selector": {"type": "string", "description": "Optional CSS selector to focus before typing."}
                },
                "required": ["text"]
            }
        }),
        json!({
            "name": "debug_browser_press",
            "description": "Press a key in the live browser (Enter, Tab, Escape, Backspace, arrows, Home, End, PageUp, PageDown).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "key": {"type": "string"}
                },
                "required": ["key"]
            }
        }),
        json!({
            "name": "debug_browser_reload",
            "description": "Reload the page in the live browser.",
            "inputSchema": { "type": "object", "properties": {} }
        }),
    ]
}

pub fn mutating(name: &str) -> bool {
    matches!(
        name,
        "write_file"
            | "edit_file"
            | "delete_file"
            | "shell"
            | "debug_terminal_run"
            | "debug_browser_click"
            | "debug_browser_type"
            | "debug_browser_press"
            | "debug_browser_reload"
            | "remember"
            | "email_send"
    )
}

pub fn needs_permission(name: &str) -> bool {
    mutating(name) || name == "mcp_call"
}

fn text<'a>(args: &'a Value, key: &str) -> AppResult<&'a str> {
    args[key]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| bad_request(format!("{key} is required")))
}

impl Tools {
    pub async fn artifact(
        &self,
        ctx: &RunContext,
        name: &str,
        mime: &str,
        bytes: &[u8],
    ) -> AppResult<String> {
        if bytes.len() > 8 * 1024 * 1024 {
            return Err(AppError::TooLarge);
        }
        let id = crate::crypto::new_id();
        let path = self.artifacts.join(&id);
        tokio::fs::create_dir_all(&self.artifacts).await?;
        tokio::fs::write(&path, bytes).await?;
        sqlx::query("INSERT INTO agent_artifacts VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)")
            .bind(&id)
            .bind(ctx.user_id)
            .bind(&ctx.project_id)
            .bind(&ctx.run.id)
            .bind(name)
            .bind(mime)
            .bind(&id)
            .bind(bytes.len() as i64)
            .bind(now())
            .execute(self.store.pool())
            .await?;
        Ok(id)
    }

    pub async fn artifact_bytes(
        &self,
        user: i64,
        project: &str,
        id: &str,
    ) -> AppResult<(String, Vec<u8>, PathBuf)> {
        let row = sqlx::query(
            "SELECT path,mime FROM agent_artifacts WHERE id=$1 AND user_id=$2 AND project_id=$3",
        )
        .bind(id)
        .bind(user)
        .bind(project)
        .fetch_optional(self.store.pool())
        .await?
        .ok_or(AppError::NotFound)?;
        let path = self.artifacts.join(row.get::<String, _>("path"));
        Ok((row.get("mime"), tokio::fs::read(&path).await?, path))
    }

    pub async fn execute(&self, ctx: &RunContext, name: &str, args: &Value) -> AppResult<Value> {
        match name {
            "read_file" => {
                let path = text(args, "path")?.to_owned();
                let ws = self.workspace.clone();
                let root = ctx.root.clone();
                let file = tokio::task::spawn_blocking(move || ws.read(&root, &path))
                    .await
                    .map_err(|e| AppError::Internal(e.into()))??;
                let offset = args["offset"].as_u64().unwrap_or(1).max(1) as usize;
                let limit = args["limit"].as_u64().unwrap_or(60).clamp(1, 200) as usize;
                let lines = file
                    .content
                    .lines()
                    .skip(offset - 1)
                    .take(limit)
                    .enumerate()
                    .map(|(i, l)| format!("{}: {}", offset + i, l))
                    .collect::<Vec<_>>()
                    .join("\n");
                Ok(
                    json!({"path":file.path,"hash":file.hash,"offset":offset,"content":lines,"totalLines":file.content.lines().count()}),
                )
            }
            "list_files" => {
                let query = args["query"].as_str().unwrap_or("").to_owned();
                let ws = self.workspace.clone();
                let root = ctx.root.clone();
                let paths = tokio::task::spawn_blocking(move || ws.files(&root, &query, 100))
                    .await
                    .map_err(|e| AppError::Internal(e.into()))??;
                Ok(json!(paths))
            }
            "search" => {
                let prefix = args["path"].as_str().unwrap_or("");
                let matches = self
                    .workspace
                    .search(&ctx.root, text(args, "query")?, 100)
                    .await?;
                Ok(json!(matches
                    .into_iter()
                    .filter(|m| m.path.starts_with(prefix))
                    .take(40)
                    .collect::<Vec<_>>()))
            }
            "write_file" | "edit_file" => {
                let ws = self.workspace.clone();
                let root = ctx.root.clone();
                let args = args.clone();
                let name = name.to_owned();
                let result = tokio::task::spawn_blocking(move || -> AppResult<Value> {
                    let path = text(&args, "path")?;
                    let existing = match ws.read(&root, path) {
                        Ok(f) => Some(f),
                        Err(AppError::NotFound) => None,
                        Err(AppError::Io(e)) if e.kind() == std::io::ErrorKind::NotFound => None,
                        Err(e) => return Err(e),
                    };
                    let (content, hash) = if name == "edit_file" {
                        let file = existing.as_ref().ok_or(AppError::NotFound)?;
                        let old = text(&args, "oldText")?;
                        let new = args["newText"]
                            .as_str()
                            .ok_or_else(|| bad_request("newText is required"))?;
                        if file.content.matches(old).count() != 1 {
                            return Err(bad_request("oldText must match exactly one location"));
                        }
                        (file.content.replacen(old, new, 1), file.hash.clone())
                    } else {
                        let content = args["content"]
                            .as_str()
                            .ok_or_else(|| bad_request("content is required"))?
                            .to_owned();
                        let hash = args["expectedHash"].as_str().unwrap_or("").to_owned();
                        if existing.is_some() && hash.is_empty() {
                            return Err(bad_request(
                                "Read the file first and provide expectedHash",
                            ));
                        }
                        (content, hash)
                    };
                    let file = ws.write(&root, path, &content, &hash)?;
                    Ok(json!({"path":file.path,"hash":file.hash,"bytes":file.size}))
                })
                .await
                .map_err(|e| AppError::Internal(e.into()))??;
                Ok(result)
            }
            "delete_file" => {
                let path = text(args, "path")?.to_owned();
                let ws = self.workspace.clone();
                let root = ctx.root.clone();
                let deleted = path.clone();
                tokio::task::spawn_blocking(move || ws.delete(&root, &path))
                    .await
                    .map_err(|e| AppError::Internal(e.into()))??;
                Ok(json!({"path":deleted,"deleted":true}))
            }
            "shell" => {
                shell(
                    &ctx.root,
                    text(args, "command")?,
                    args.get("timeoutMs").and_then(Value::as_u64),
                )
                .await
            }
            "read_artifact" => {
                let id = text(args, "id")?;
                let (mime, bytes, path) = self
                    .artifact_bytes(ctx.user_id, &ctx.project_id, id)
                    .await?;
                if mime.starts_with("image/") {
                    return Ok(
                        json!({"id":id,"mime":mime,"url":format!("/api/projects/{}/agent/artifacts/{id}",ctx.project_id)}),
                    );
                }
                let Ok(source) = std::str::from_utf8(&bytes) else {
                    // Any file type is accepted: binary attachments stay on the
                    // server and the agent inspects them with its shell.
                    return Ok(json!({
                        "id": id,
                        "mime": mime,
                        "bytes": bytes.len(),
                        "path": path.display().to_string(),
                        "note": "Arquivo binário; use o shell do repo para inspecionar (file, unzip -l, python, etc.)."
                    }));
                };
                let offset = args["offset"].as_u64().unwrap_or(0) as usize;
                let limit = args["limit"].as_u64().unwrap_or(1800).clamp(1, 2000) as usize;
                Ok(
                    json!({"id":id,"offset":offset,"text":source.chars().skip(offset).take(limit).collect::<String>(),"totalChars":source.chars().count()}),
                )
            }
            "search_history" => {
                let query = text(args, "query")?
                    .split_whitespace()
                    .take(8)
                    .map(|s| format!("\"{}\"", s.replace('"', "\"\"")))
                    .collect::<Vec<_>>()
                    .join(" OR ");
                let rows=sqlx::query("SELECT m.id,m.session_id,substr(m.content_text,1,1200) AS text FROM agent_history_fts f JOIN agent_messages m ON m.seq=f.rowid JOIN agent_sessions s ON s.id=m.session_id WHERE agent_history_fts MATCH ? AND s.user_id=? AND s.project_id=? ORDER BY bm25(agent_history_fts) LIMIT 5")
                    .bind(query).bind(ctx.user_id).bind(&ctx.project_id).fetch_all(self.store.pool()).await?;
                Ok(json!(rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"sessionId":r.get::<String,_>("session_id"),"text":r.get::<String,_>("text")})).collect::<Vec<_>>()))
            }
            "remember" => {
                let source = text(args, "sourceId")?;
                let content = text(args, "content")?;
                if content.len() > 2000 {
                    return Err(AppError::TooLarge);
                }
                let count:i64=sqlx::query_scalar("SELECT count(*) FROM agent_messages m JOIN agent_sessions s ON s.id=m.session_id WHERE m.id=$1 AND s.user_id=$2 AND s.project_id=$3")
                    .bind(source).bind(ctx.user_id).bind(&ctx.project_id).fetch_one(self.store.pool()).await?;
                if count == 0 {
                    return Err(bad_request("Memory source must be a project message id"));
                }
                let id = crate::crypto::new_id();
                sqlx::query("INSERT INTO agent_memories VALUES($1,$2,$3,$4,$5,$6)")
                    .bind(&id)
                    .bind(ctx.user_id)
                    .bind(&ctx.project_id)
                    .bind(content)
                    .bind(source)
                    .bind(now())
                    .execute(self.store.pool())
                    .await?;
                Ok(json!({"id":id,"saved":true}))
            }
            "search_memory" => {
                let rows=sqlx::query("SELECT id,content,source_id FROM agent_memories WHERE user_id=$1 AND project_id=$2 AND instr(lower(content),lower($3))>0 ORDER BY created_at DESC LIMIT 5")
                    .bind(ctx.user_id).bind(&ctx.project_id).bind(text(args,"query")?).fetch_all(self.store.pool()).await?;
                Ok(json!(rows.iter().map(|r|json!({"id":r.get::<String,_>("id"),"content":r.get::<String,_>("content"),"sourceId":r.get::<String,_>("source_id")})).collect::<Vec<_>>()))
            }
            "email_list" | "email_read" | "email_send" => {
                let account = text(args, "accountId")?;
                if !ctx.agent.email_account_ids.iter().any(|s| s == account) {
                    return Err(AppError::Forbidden);
                }
                match name {
                    "email_list" => Ok(json!(
                        self.email
                            .messages(
                                account,
                                args["limit"].as_u64().unwrap_or(10).min(30) as usize
                            )
                            .await?
                    )),
                    "email_read" => Ok(json!(
                        self.email.message(account, text(args, "uid")?).await?
                    )),
                    _ => {
                        self.email
                            .send(account, serde_json::from_value(args.clone())?)
                            .await?;
                        Ok(json!({"sent":true}))
                    }
                }
            }
            "fetch_url" => {
                let url = reqwest::Url::parse(text(args, "url")?)
                    .map_err(|e| bad_request(e.to_string()))?;
                if !matches!(url.scheme(), "http" | "https") {
                    return Err(bad_request("HTTP(S) URL required"));
                }
                let mut response = self
                    .http
                    .get(url)
                    .send()
                    .await
                    .map_err(|e| AppError::Upstream(e.to_string()))?
                    .error_for_status()
                    .map_err(|e| AppError::Upstream(e.to_string()))?;
                let mut bytes = Vec::new();
                let mut truncated = false;
                while let Some(chunk) = response
                    .chunk()
                    .await
                    .map_err(|e| AppError::Upstream(e.to_string()))?
                {
                    let take = (256 * 1024usize)
                        .saturating_sub(bytes.len())
                        .min(chunk.len());
                    bytes.extend_from_slice(&chunk[..take]);
                    if take < chunk.len() || bytes.len() >= 256 * 1024 {
                        truncated = true;
                        break;
                    }
                }
                Ok(json!({"text":String::from_utf8_lossy(&bytes),"truncated":truncated}))
            }
            "mcp_list" | "mcp_call" => {
                let requested = args.get("server").and_then(Value::as_str).unwrap_or("");
                let server = self.mcp.resolve(&ctx.agent.mcp_servers, requested).await?;
                let value = self
                    .mcp
                    .call(
                        &ctx.root,
                        &server.id,
                        if name == "mcp_list" {
                            "tools/list"
                        } else {
                            "tools/call"
                        },
                        if name == "mcp_list" {
                            json!({})
                        } else {
                            json!({"name":text(args,"tool")?,"arguments":args["arguments"]})
                        },
                    )
                    .await?;
                if name == "mcp_list" {
                    Ok(compact_mcp_tools(&value))
                } else {
                    Ok(value)
                }
            }
            _ => Err(bad_request(format!("Unknown tool: {name}"))),
        }
    }
}

struct ProcessGroup(u32);
impl Drop for ProcessGroup {
    fn drop(&mut self) {
        #[cfg(unix)]
        if self.0 > 0 {
            unsafe {
                libc::kill(-(self.0 as i32), libc::SIGKILL);
            }
        }
    }
}
async fn bounded<R: AsyncRead + Unpin>(mut reader: R) -> std::io::Result<(String, usize)> {
    let mut output = Vec::new();
    let mut total = 0;
    let mut chunk = [0u8; 4096];
    loop {
        let n = reader.read(&mut chunk).await?;
        if n == 0 {
            break;
        }
        total += n;
        let keep = (64 * 1024usize).saturating_sub(output.len()).min(n);
        output.extend_from_slice(&chunk[..keep]);
    }
    Ok((String::from_utf8_lossy(&output).into_owned(), total))
}
pub async fn shell(
    root: &std::path::Path,
    command: &str,
    timeout_ms: Option<u64>,
) -> AppResult<Value> {
    #[cfg(unix)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("/bin/sh");
        #[cfg(windows)]
        c.creation_flags(0x08000000);
        c.arg("-lc").arg(command);
        c.process_group(0);
        c
    };
    #[cfg(windows)]
    let mut cmd = {
        let mut c = tokio::process::Command::new("cmd.exe");
        #[cfg(windows)]
        c.creation_flags(0x08000000);
        c.arg("/C").arg(command);
        c
    };
    cmd.current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let mut child = cmd.spawn()?;
    let _group = ProcessGroup(child.id().unwrap_or(0));
    let out = child
        .stdout
        .take()
        .ok_or_else(|| bad_request("Missing stdout"))?;
    let err = child
        .stderr
        .take()
        .ok_or_else(|| bad_request("Missing stderr"))?;
    let wait = async {
        let (status, out, err) = tokio::try_join!(child.wait(), bounded(out), bounded(err))?;
        Ok::<_, std::io::Error>(
            json!({"exitCode":status.code(),"stdout":out.0,"stderr":err.0,"stdoutBytes":out.1,"stderrBytes":err.1,"truncated":out.1>65536||err.1>65536}),
        )
    };
    match timeout_ms.filter(|ms| *ms > 0) {
        Some(ms) => tokio::time::timeout(Duration::from_millis(ms), wait)
            .await
            .map_err(|_| bad_request(format!("Command timed out after {ms}ms")))?
            .map_err(AppError::Io),
        None => wait.await.map_err(AppError::Io),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mcp_list_is_compact_but_keeps_the_callable_shape() {
        let full = json!({"tools": [{
            "name": "getJiraIssue",
            "title": "Get Jira issue",
            "description": "Returns one issue.\nSecond line that should not survive.",
            "inputSchema": {
                "type": "object",
                "properties": {"cloudId": {"type": "string"}, "issueIdOrKey": {"type": "string"}},
                "required": ["cloudId", "issueIdOrKey"]
            },
            "annotations": {"readOnlyHint": true}
        }]});
        let compact = compact_mcp_tools(&full);
        assert_eq!(compact["count"], 1);
        assert_eq!(compact["tools"][0]["name"], "getJiraIssue");
        assert_eq!(compact["tools"][0]["description"], "Returns one issue.");
        assert_eq!(
            compact["tools"][0]["arguments"],
            json!(["cloudId", "issueIdOrKey"])
        );
        assert_eq!(
            compact["tools"][0]["required"],
            json!(["cloudId", "issueIdOrKey"])
        );
        assert!(compact["tools"][0].get("inputSchema").is_none());
    }
}
