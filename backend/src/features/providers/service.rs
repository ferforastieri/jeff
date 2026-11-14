use std::path::Path;
use std::time::Duration;

use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::crypto::{decrypt, encrypt, load_or_create_key};
use crate::errors::{AppError, AppResult};
use crate::store::Store;

const SETTING_KEY: &str = "native_ai_config";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// User-visible name of this connection, independent of the wire protocol.
    #[serde(default)]
    pub label: String,
    pub provider: String,
    #[serde(rename = "baseUrl")]
    pub base_url: String,
    #[serde(skip)]
    pub api_key: String,
    #[serde(
        rename = "apiKeyEnc",
        default,
        skip_serializing_if = "String::is_empty"
    )]
    pub api_key_enc: String,
    pub model: String,
    #[serde(rename = "autocompleteModel", default)]
    pub autocomplete_model: String,
    #[serde(rename = "maxTokens")]
    pub max_tokens: i32,
    pub temperature: f64,
    pub autocomplete: bool,
    #[serde(rename = "systemPrompt")]
    pub system_prompt: String,
    /// Resolved connection name for display; never persisted.
    #[serde(skip)]
    pub connection_label: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfig {
    pub label: String,
    pub connection_label: String,
    pub provider: String,
    pub base_url: String,
    pub model: String,
    pub autocomplete_model: String,
    pub max_tokens: i32,
    pub temperature: f64,
    pub autocomplete: bool,
    pub system_prompt: String,
    pub has_key: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConfigInput {
    #[serde(default)]
    pub label: String,
    pub provider: String,
    pub base_url: String,
    pub api_key: Option<String>,
    pub clear_key: Option<bool>,
    pub model: String,
    #[serde(default)]
    pub autocomplete_model: String,
    pub max_tokens: i32,
    pub temperature: f64,
    pub autocomplete: bool,
    pub system_prompt: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: Value,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiModel {
    pub id: String,
    pub label: String,
    pub provider: String,
    #[serde(rename = "connectionLabel", skip_serializing_if = "String::is_empty")]
    pub connection_label: String,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub variants: Vec<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub inputs: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct CompleteInput {
    pub path: String,
    pub language: String,
    pub prefix: String,
    pub suffix: String,
}

#[derive(Clone)]
pub struct AiService {
    pub(crate) store: Store,
    pub(crate) key: Vec<u8>,
    pub(crate) client: Client,
}

impl AiService {
    pub fn new(store: Store, key_file: &Path) -> AppResult<Self> {
        Ok(Self {
            store,
            key: load_or_create_key(key_file)?,
            client: Client::builder()
                .user_agent(format!("Toph/{}", crate::VERSION))
                .timeout(Duration::from_secs(600))
                .build()
                .map_err(|error| AppError::Internal(error.into()))?,
        })
    }

    pub async fn load(&self) -> AppResult<AiConfig> {
        let raw = match self.store.setting(SETTING_KEY).await {
            Ok(raw) => raw,
            Err(AppError::NotFound) => {
                return Ok(AiConfig {
                    label: String::new(),
                    provider: String::new(),
                    base_url: String::new(),
                    api_key: String::new(),
                    api_key_enc: String::new(),
                    model: String::new(),
                    autocomplete_model: String::new(),
                    max_tokens: 4096,
                    temperature: 0.0,
                    autocomplete: false,
                    system_prompt: String::new(),
                    connection_label: String::new(),
                });
            }
            Err(error) => return Err(error),
        };
        let mut config: AiConfig = serde_json::from_str(&raw)
            .map_err(|error| crate::errors::bad_request(format!("invalid AI config: {error}")))?;
        if !config.api_key_enc.is_empty() {
            config.api_key = decrypt(&self.key, &config.api_key_enc)
                .map_err(|error| AppError::Internal(error.into()))?;
        }
        config.normalize();
        Ok(config)
    }

    pub async fn public(&self) -> AppResult<PublicConfig> {
        let config = self.load().await?;
        Ok(PublicConfig {
            label: config.label.clone(),
            connection_label: config.connection_name(),
            provider: config.provider,
            base_url: config.base_url,
            model: config.model,
            autocomplete_model: config.autocomplete_model,
            max_tokens: config.max_tokens,
            temperature: config.temperature,
            autocomplete: config.autocomplete,
            system_prompt: config.system_prompt,
            has_key: !config.api_key.is_empty(),
        })
    }

    pub async fn save(&self, input: AiConfigInput) -> AppResult<PublicConfig> {
        let provider = input.provider.trim().to_lowercase();
        if !matches!(
            provider.as_str(),
            "openai" | "custom" | "anthropic" | "ollama"
        ) {
            return Err(crate::errors::bad_request("unsupported AI provider"));
        }
        let base_url = input.base_url.trim().trim_end_matches('/').to_string();
        if !base_url.is_empty() {
            let parsed = reqwest::Url::parse(&base_url)
                .map_err(|_| crate::errors::bad_request("base URL must be http or https"))?;
            if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
                return Err(crate::errors::bad_request("base URL must be http or https"));
            }
        }
        let mut max_tokens = input.max_tokens;
        if max_tokens <= 0 {
            max_tokens = 1024;
        }
        if max_tokens > 8192 {
            max_tokens = 8192;
        }
        let temperature = input.temperature.clamp(0.0, 2.0);
        super::connections::validate_endpoint(&provider, &base_url)?;
        let old = self.load().await?;
        let api_key = if input.clear_key.unwrap_or(false) {
            String::new()
        } else if let Some(key) = input.api_key.filter(|key| !key.trim().is_empty()) {
            key.trim().to_string()
        } else if provider == old.provider && base_url == old.base_url {
            old.api_key
        } else {
            String::new()
        };
        let api_key_enc =
            encrypt(&self.key, &api_key).map_err(|error| AppError::Internal(error.into()))?;
        let mut config = AiConfig {
            label: input.label.trim().to_string(),
            provider,
            base_url,
            api_key,
            api_key_enc,
            model: input.model.trim().to_string(),
            autocomplete_model: input.autocomplete_model.trim().to_string(),
            max_tokens,
            temperature,
            autocomplete: input.autocomplete,
            system_prompt: input.system_prompt,
            connection_label: String::new(),
        };
        config.normalize();
        self.store
            .set_setting(SETTING_KEY, &serde_json::to_string(&config)?)
            .await?;
        self.public().await
    }

    pub async fn test(&self) -> AppResult<()> {
        let config = self.load().await?;
        if config.provider.is_empty() {
            return Err(crate::errors::bad_request("AI provider is not configured"));
        }
        let (url, headers) = match config.provider.as_str() {
            "anthropic" => (
                super::protocol::models_endpoint(&config.base_url),
                vec![
                    ("x-api-key", config.api_key.clone()),
                    ("anthropic-version", "2023-06-01".into()),
                ],
            ),
            "ollama" => (format!("{}/api/tags", config.base_url), Vec::new()),
            "openai" | "custom" => (
                super::protocol::models_endpoint(&config.base_url),
                vec![("Authorization", format!("Bearer {}", config.api_key))],
            ),
            _ => return Err(crate::errors::bad_request("Unsupported provider protocol")),
        };
        self.check(&url, &headers).await
    }

    pub async fn models(&self) -> AppResult<Vec<AiModel>> {
        let mut result = Vec::new();
        let default = self.load().await?;
        if !default.provider.is_empty() {
            let name = default.connection_name();
            for mut model in self.models_for(&default).await? {
                model.id = format!("default::{}", model.id);
                model.connection_label = name.clone();
                result.push(model);
            }
        }
        for connection in self.connections().await? {
            let name = infer_connection_name(
                &connection.label,
                &connection.config.provider,
                &connection.config.base_url,
            );
            for mut model in self.models_for(&connection.config).await? {
                model.id = format!("{}::{}", connection.id, model.id);
                model.connection_label = name.clone();
                result.push(model);
            }
        }
        Ok(result)
    }

    async fn models_for(&self, config: &AiConfig) -> AppResult<Vec<AiModel>> {
        match config.provider.as_str() {
            "anthropic" => self.models_anthropic(&config).await,
            "ollama" => self.models_ollama(&config).await,
            "openai" | "custom" => self.models_openai(&config).await,
            _ => Err(crate::errors::bad_request(
                "Configure a direct model provider",
            )),
        }
    }

    async fn models_openai(&self, config: &AiConfig) -> AppResult<Vec<AiModel>> {
        let value = self
            .get_json(
                &super::protocol::models_endpoint(&config.base_url),
                &auth_headers(&config.api_key),
            )
            .await?;
        let mut models = Vec::new();
        for item in value
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            if let Some(id) = item.get("id").and_then(Value::as_str) {
                models.push(AiModel {
                    id: id.into(),
                    label: model_label(&item, id),
                    provider: config.provider.clone(),
                    connection_label: String::new(),
                    variants: reasoning_variants(&item),
                    inputs: Vec::new(),
                });
            }
        }
        models.sort_by(|a, b| a.label.cmp(&b.label));
        Ok(models)
    }

    async fn models_anthropic(&self, config: &AiConfig) -> AppResult<Vec<AiModel>> {
        let value = self
            .get_json(
                &super::protocol::models_endpoint(&config.base_url),
                &[
                    ("x-api-key", config.api_key.clone()),
                    ("anthropic-version", "2023-06-01".into()),
                ],
            )
            .await?;
        let mut models = Vec::new();
        for item in value
            .get("data")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            let Some(id) = item.get("id").and_then(Value::as_str) else {
                continue;
            };
            let label = item
                .get("display_name")
                .and_then(Value::as_str)
                .filter(|value| !value.is_empty())
                .unwrap_or(id);
            models.push(AiModel {
                id: id.into(),
                label: model_label(&item, label),
                provider: config.provider.clone(),
                connection_label: String::new(),
                variants: reasoning_variants(&item),
                inputs: Vec::new(),
            });
        }
        Ok(models)
    }

    async fn models_ollama(&self, config: &AiConfig) -> AppResult<Vec<AiModel>> {
        let value = self
            .get_json(
                &format!("{}/api/tags", config.base_url.trim_end_matches('/')),
                &[],
            )
            .await?;
        let mut models = Vec::new();
        for item in value
            .get("models")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default()
        {
            if let Some(name) = item.get("name").and_then(Value::as_str) {
                models.push(AiModel {
                    id: name.into(),
                    label: name.into(),
                    provider: "ollama".into(),
                    connection_label: String::new(),
                    variants: Vec::new(),
                    inputs: Vec::new(),
                });
            }
        }
        Ok(models)
    }

    pub async fn chat(
        &self,
        messages: Vec<Message>,
        model: Option<&str>,
        effort: Option<&str>,
    ) -> AppResult<String> {
        let config = self.resolve(model.unwrap_or("")).await?;
        let messages = messages
            .into_iter()
            .map(|m| json!({"role":m.role,"content":m.content}))
            .collect::<Vec<_>>();
        if crate::features::agents::context::estimate(&json!(messages))
            > crate::features::agents::context::INPUT_BUDGET
        {
            return Err(crate::errors::bad_request(
                "Selected text exceeds the input token budget; narrow the selection",
            ));
        }
        let turn = self.turn(&config, &messages, &[], effort, |_| {}).await?;
        if !turn.calls.is_empty() {
            return Err(crate::errors::bad_request(
                "Tool execution requires an agent run",
            ));
        }
        Ok(turn.text)
    }

    pub async fn complete(&self, input: CompleteInput) -> AppResult<String> {
        let prefix = tail(&input.prefix, 2500);
        let suffix = head(&input.suffix, 600);
        let prompt = format!(
            "You are an inline code completion engine. The user is typing in {language}. Continue the file exactly at <cursor>.\n\
             Output only the raw characters to insert. Do not use markdown or code fences, do not explain, and do not repeat the text before or after the cursor. If no useful completion is possible, output nothing.\n\n\
             File: {path}\nLanguage: {language}\n\n<before>\n{prefix}\n</before>\n<cursor>\n<after>\n{suffix}\n</after>",
            language = input.language,
            path = input.path,
            prefix = prefix,
            suffix = suffix,
        );
        let config = self.load().await?;
        let mut messages = vec![Message {
            role: "user".into(),
            content: json!(prompt),
        }];
        if !config.system_prompt.is_empty() {
            messages.insert(
                0,
                Message {
                    role: "system".into(),
                    content: json!(config.system_prompt.clone()),
                },
            );
        }
        let mut selected = self
            .resolve(if config.autocomplete_model.is_empty() {
                &config.model
            } else {
                &config.autocomplete_model
            })
            .await?;
        selected.max_tokens = selected.max_tokens.min(512);
        let messages = messages
            .into_iter()
            .map(|m| json!({"role":m.role,"content":m.content}))
            .collect::<Vec<_>>();
        let session = format!(
            "completion-{}",
            crate::crypto::sha256_hex(input.path.as_bytes())
        );
        let turn = self
            .turn_in_session(&selected, &messages, &[], None, &session, |_| {})
            .await?;
        Ok(clean_completion(&turn.text))
    }

    async fn get_json(&self, url: &str, headers: &[(&str, String)]) -> AppResult<Value> {
        let mut request = self.client.get(url);
        for (key, value) in headers {
            if !value.is_empty() {
                request = request.header(*key, value);
            }
        }
        let response = request
            .send()
            .await
            .map_err(|error| AppError::Upstream(format!("AI provider unavailable: {error}")))?;
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::Upstream(format!(
                "provider returned {}: {}",
                status,
                body.chars().take(1024).collect::<String>().trim()
            )));
        }
        serde_json::from_str(&body)
            .map_err(|error| AppError::Upstream(format!("invalid provider response: {error}")))
    }

    async fn check(&self, url: &str, headers: &[(&str, String)]) -> AppResult<()> {
        let mut request = self.client.get(url);
        for (key, value) in headers {
            if !value.is_empty() {
                request = request.header(*key, value);
            }
        }
        let response = request
            .send()
            .await
            .map_err(|error| AppError::Upstream(format!("AI provider unavailable: {error}")))?;
        if !response.status().is_success() {
            return Err(AppError::Upstream(format!(
                "provider returned {}",
                response.status()
            )));
        }
        Ok(())
    }
}

impl AiConfig {
    /// Name shown to the user for this connection. The protocol is separate.
    pub fn connection_name(&self) -> String {
        if !self.connection_label.trim().is_empty() {
            return self.connection_label.trim().to_string();
        }
        infer_connection_name(&self.label, &self.provider, &self.base_url)
    }

    fn normalize(&mut self) {
        self.label = self.label.trim().to_string();
        self.provider = self.provider.trim().to_lowercase();
        if self.provider.is_empty() {
            self.provider = String::new();
        }
        self.base_url = self.base_url.trim().trim_end_matches('/').to_string();
        self.model = self.model.trim().to_string();
        self.autocomplete_model = self.autocomplete_model.trim().to_string();
        if self.max_tokens <= 0 {
            self.max_tokens = 1024;
        }
        self.temperature = self.temperature.clamp(0.0, 2.0);
    }
}

/// Display name of a direct connection. The protocol stays a separate field so
/// "OpenCode Go" or any user-chosen name never becomes "Custom AI" in the UI.
pub fn infer_connection_name(label: &str, provider: &str, base_url: &str) -> String {
    let label = label.trim();
    if !label.is_empty() {
        return label.to_string();
    }
    let base = base_url.to_lowercase();
    if base.contains("opencode.ai/inference/go") {
        return "OpenCode Go".into();
    }
    let host = reqwest::Url::parse(base_url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_owned));
    if host.as_deref() == Some("api.openai.com") {
        return "OpenAI".into();
    }
    match provider {
        "openai" => "OpenAI".into(),
        "anthropic" => "Anthropic".into(),
        "ollama" => "Ollama".into(),
        _ => host.unwrap_or_else(|| "Conexão personalizada".into()),
    }
}

/// Models served by hosted gateways (OpenCode Go included) publish the reasoning
/// levels they accept. Older catalogues used `reasoning_options`; both shapes
/// feed the effort selector so a model is only offered levels it supports.
fn reasoning_variants(item: &Value) -> Vec<String> {
    let mut variants = Vec::new();
    if let Some(values) = item
        .pointer("/capabilities/reasoning/effort")
        .and_then(Value::as_array)
    {
        for value in values {
            push_variant(&mut variants, value);
        }
    }
    if variants.is_empty() {
        if let Some(options) = item.get("reasoning_options").and_then(Value::as_array) {
            for option in options {
                if option.get("type").and_then(Value::as_str) != Some("effort") {
                    continue;
                }
                if let Some(values) = option.get("values").and_then(Value::as_array) {
                    for value in values {
                        push_variant(&mut variants, value);
                    }
                }
            }
        }
    }
    variants
}

fn push_variant(variants: &mut Vec<String>, value: &Value) {
    if let Some(value) = value.as_str() {
        let value = value.trim();
        if !value.is_empty() && !variants.iter().any(|current| current == value) {
            variants.push(value.to_string());
        }
    }
}

fn model_label(item: &Value, fallback: &str) -> String {
    for key in ["name", "display_name"] {
        if let Some(value) = item.get(key).and_then(Value::as_str) {
            let value = value.trim();
            if !value.is_empty() {
                return value.to_string();
            }
        }
    }
    fallback.to_string()
}

fn auth_headers(key: &str) -> Vec<(&'static str, String)> {
    if key.is_empty() {
        Vec::new()
    } else {
        vec![("Authorization", format!("Bearer {key}"))]
    }
}

fn tail(value: &str, limit: usize) -> &str {
    if value.len() <= limit {
        value
    } else {
        &value[value.len() - limit..]
    }
}

fn head(value: &str, limit: usize) -> &str {
    if value.len() <= limit {
        value
    } else {
        &value[..limit]
    }
}

fn clean_completion(value: &str) -> String {
    let mut value = value.trim().to_string();
    if value.starts_with("```") {
        let mut lines: Vec<&str> = value.lines().collect();
        if lines
            .first()
            .is_some_and(|line| line.trim_start().starts_with("```"))
        {
            lines.remove(0);
        }
        if lines.last().is_some_and(|line| line.trim() == "```") {
            lines.pop();
        }
        value = lines.join("\n");
    }
    value
}

#[cfg(test)]
mod catalog_tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_effort_levels_from_the_live_gateway_catalog() {
        let item = json!({
            "id": "deepseek-v4.1-flash",
            "name": "DeepSeek V4.1 Flash",
            "capabilities": { "reasoning": { "supported": true, "effort": ["low", "high", "max"] } }
        });
        assert_eq!(reasoning_variants(&item), ["low", "high", "max"]);
        assert_eq!(model_label(&item, "fallback"), "DeepSeek V4.1 Flash");
    }

    #[test]
    fn reads_effort_levels_from_legacy_reasoning_options() {
        let item = json!({
            "id": "grok-4.7",
            "reasoning_options": [
                { "type": "toggle" },
                { "type": "effort", "values": ["low", "medium", "high", "xhigh"] }
            ]
        });
        assert_eq!(
            reasoning_variants(&item),
            ["low", "medium", "high", "xhigh"]
        );
        assert_eq!(model_label(&item, "grok-4.7"), "grok-4.7");
    }

    #[test]
    fn drops_duplicate_or_empty_effort_levels() {
        let item = json!({
            "capabilities": { "reasoning": { "effort": ["low", "low", "", " max "] } }
        });
        assert_eq!(reasoning_variants(&item), ["low", "max"]);
    }
}
