//! A tiny stdio MCP server that exposes the Jeff-only tools selected for one
//! Jeff (email accounts) to its native harness. It is configuration glue, not a
//! gateway: the harness talks MCP directly to this process and executes the
//! tools itself.

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

use crate::errors::AppResult;
use crate::platform::config::Config;
use crate::store::Store;

use super::service::{EmailService, SendInput};

fn definition(name: &str, description: &str, properties: Value, required: &[&str]) -> Value {
    json!({
        "name": name,
        "description": description,
        "inputSchema": {
            "type": "object",
            "properties": properties,
            "required": required,
            "additionalProperties": false
        }
    })
}

fn tools() -> Value {
    let mut items = Vec::new();
    items.push(definition(
        "email_list",
        "List recent messages in an authorized email account.",
        json!({"accountId": {"type": "string"}, "limit": {"type": "integer"}}),
        &["accountId"],
    ));
    items.push(definition(
        "email_read",
        "Read an email by UID from an authorized account.",
        json!({"accountId": {"type": "string"}, "uid": {"type": "string"}}),
        &["accountId", "uid"],
    ));
    items.push(definition(
        "email_send",
        "Send an email from an authorized account.",
        json!({
            "accountId": {"type": "string"},
            "to": {"type": "string"},
            "cc": {"type": "string"},
            "bcc": {"type": "string"},
            "subject": {"type": "string"},
            "text": {"type": "string"},
            "inReplyTo": {"type": "string"}
        }),
        &["accountId", "to", "subject", "text"],
    ));
    json!(items)
}

async fn call(email: &EmailService, accounts: &[String], params: &Value) -> Value {
    let name = params["name"].as_str().unwrap_or("");
    let args = &params["arguments"];
    let email_tool = name.starts_with("email_");
    let account = args["accountId"].as_str().unwrap_or("");
    if email_tool && !accounts.iter().any(|id| id == account) {
        return json!({
            "content": [{"type": "text", "text": "Conta de e-mail não autorizada para este Jeff."}],
            "isError": true
        });
    }
    let result: AppResult<Value> = match name {
        "email_list" => {
            let limit = args["limit"].as_u64().unwrap_or(10).clamp(1, 30) as usize;
            email.messages(account, limit).await.map(Value::Array)
        }
        "email_read" => match args["uid"].as_str() {
            Some(uid) if !uid.trim().is_empty() => email.message(account, uid).await,
            _ => {
                return json!({
                    "content": [{"type": "text", "text": "uid é obrigatório."}],
                    "isError": true
                })
            }
        },
        "email_send" => match serde_json::from_value::<SendInput>(args.clone()) {
            Ok(input) => email
                .send(account, input)
                .await
                .map(|_| json!({"sent": true})),
            Err(error) => Err(crate::errors::bad_request(error.to_string())),
        },
        other => {
            return json!({
                "content": [{"type": "text", "text": format!("Ferramenta desconhecida: {other}")}],
                "isError": true
            });
        }
    };
    match result {
        Ok(value) => json!({
            "content": [{
                "type": "text",
                "text": serde_json::to_string_pretty(&value).unwrap_or_default()
            }]
        }),
        Err(error) => json!({
            "content": [{"type": "text", "text": error.to_string()}],
            "isError": true
        }),
    }
}

pub async fn serve() -> anyhow::Result<()> {
    let accounts = std::env::var("JEFF_EMAIL_ACCOUNTS")
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|id| !id.is_empty())
        .map(str::to_string)
        .collect::<Vec<_>>();
    let config = Config::load()?;
    let store = Store::connect(&config.database_file).await?;
    let email = EmailService::new(store, &config.data_dir, &config.master_key_file)?;
    let authorized = email
        .list()
        .await?
        .into_iter()
        .filter(|account| accounts.iter().any(|id| id == &account.id))
        .map(|account| format!("{} <{}> = {}", account.name, account.email, account.id))
        .collect::<Vec<_>>();
    let mut instructions = Vec::new();
    if authorized.is_empty() {
        instructions.push("Este Jeff não tem contas de e-mail autorizadas.".to_string());
    } else {
        instructions.push(format!(
            "Contas de e-mail autorizadas para este Jeff:\n{}\nUse o id da conta no campo accountId.",
            authorized.join("\n")
        ));
    }
    let instructions = instructions.join("\n\n");
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let request: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(error) => {
                let response = json!({
                    "jsonrpc": "2.0",
                    "id": Value::Null,
                    "error": {"code": -32700, "message": error.to_string()}
                });
                let mut stdout = tokio::io::stdout();
                stdout.write_all(format!("{response}\n").as_bytes()).await?;
                stdout.flush().await?;
                continue;
            }
        };
        let id = request["id"].clone();
        if id.is_null() {
            continue;
        }
        let method = request["method"].as_str().unwrap_or("");
        let result = match method {
            "initialize" => Ok(json!({
                "protocolVersion": "2025-11-25",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "jeff_tools", "version": env!("CARGO_PKG_VERSION")},
                "instructions": instructions
            })),
            "ping" => Ok(json!({})),
            "tools/list" => Ok(json!({"tools": tools()})),
            "tools/call" => Ok(call(&email, &accounts, &request["params"]).await),
            "resources/list" => Ok(json!({"resources": []})),
            "prompts/list" => Ok(json!({"prompts": []})),
            other => Err(format!("Método não suportado: {other}")),
        };
        let response = match result {
            Ok(result) => json!({"jsonrpc": "2.0", "id": id, "result": result}),
            Err(message) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32601, "message": message}
            }),
        };
        let mut stdout = tokio::io::stdout();
        stdout.write_all(format!("{response}\n").as_bytes()).await?;
        stdout.flush().await?;
    }
    Ok(())
}
