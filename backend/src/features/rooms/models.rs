use serde::{Deserialize, Serialize};
use serde_json::Value;

/// A participant in the room world. An agent is a participant with
/// `kind = "bot"`; a person is a participant with `kind = "human"` linked to a
/// user row.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Principal {
    pub id: String,
    pub kind: String,
    pub user_id: Option<i64>,
    pub name: String,
    pub handle: String,
    pub avatar: Value,
    pub bot: Option<Value>,
    pub created_at: i64,
}

/// The compact author the transcript carries.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Author {
    pub id: String,
    pub name: String,
    pub handle: String,
    pub kind: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub name: String,
    pub title: String,
    pub instructions: String,
    pub lead_id: Option<String>,
    pub isolated: bool,
    pub archived: bool,
    pub created_at: i64,
    pub updated_at: i64,
    #[serde(default)]
    pub members: Vec<Principal>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub seq: i64,
    pub id: String,
    pub room_id: String,
    pub author: Author,
    pub text: String,
    pub kind: String,
    pub reply_to: Option<String>,
    pub task_id: Option<String>,
    pub created_at: i64,
}

/// A queued unit of work for one bot. The queue is per recipient, not per
/// room, so two rooms never block each other.
#[derive(Clone, Debug)]
pub struct Delivery {
    pub id: String,
    pub room_id: String,
    pub message_id: String,
    pub recipient_id: String,
    pub sender_kind: String,
    pub sender_id: Option<String>,
    pub reply_to: Option<String>,
    pub status: String,
    pub position: i64,
    pub created_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BotConfig {
    #[serde(default)]
    pub engine: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub persona: String,
    #[serde(default)]
    pub folders: Vec<String>,
    #[serde(default)]
    pub proxy: String,
}

impl BotConfig {
    pub fn engine(&self) -> String {
        let value = self.engine.trim();
        if value.is_empty() {
            "opencode".into()
        } else {
            value.to_ascii_lowercase()
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoomInput {
    pub name: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub instructions: String,
    #[serde(default)]
    pub lead_id: Option<String>,
    #[serde(default)]
    pub member_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateBotInput {
    pub name: String,
    #[serde(default)]
    pub handle: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub persona: String,
    #[serde(default)]
    pub engine: String,
    #[serde(default)]
    pub model: String,
    #[serde(default)]
    pub effort: String,
    #[serde(default)]
    pub proxy: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendMessageInput {
    pub text: String,
    #[serde(default)]
    pub reply_to: Option<String>,
    /// Explicit recipients. Empty means "the lead", or every bot when the room
    /// has no lead.
    #[serde(default)]
    pub recipient_ids: Vec<String>,
    /// Client-generated id used to make a retried send a no-op.
    #[serde(default)]
    pub client_message_id: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueueInput {
    pub paused: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Card {
    pub id: String,
    pub project_id: String,
    pub room_id: Option<String>,
    pub message_id: Option<String>,
    pub task_id: Option<String>,
    pub title: String,
    pub description: String,
    pub owner_id: Option<String>,
    pub owner: Option<Author>,
    pub due_at: Option<i64>,
    pub priority: String,
    pub attachments: Value,
    pub column: String,
    pub created_by: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCardInput {
    pub title: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub due_at: Option<i64>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub room_id: Option<String>,
    #[serde(default)]
    pub message_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCardInput {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub owner_id: Option<String>,
    #[serde(default)]
    pub due_at: Option<i64>,
    #[serde(default)]
    pub priority: Option<String>,
    #[serde(default)]
    pub column: Option<String>,
}

pub const CARD_COLUMNS: [&str; 5] = ["todo", "doing", "review", "blocked", "done"];
pub fn valid_column(value: &str) -> bool {
    CARD_COLUMNS.contains(&value)
}

pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// Handles are mentioned in messages as `@handle`; keep them to one word.
pub fn normalize_handle(value: &str) -> String {
    let handle: String = value
        .trim()
        .trim_start_matches('@')
        .to_ascii_lowercase()
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(40)
        .collect();
    if handle.is_empty() {
        "bot".into()
    } else {
        handle
    }
}

// --- routines -----------------------------------------------------------

use crate::features::rooms::schedule::Schedule;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineTrigger {
    pub id: String,
    pub schedule: Schedule,
    pub next_run_at: Option<i64>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Routine {
    pub id: String,
    pub project_id: String,
    pub room_id: String,
    pub agent_id: String,
    pub name: String,
    pub instruction: String,
    pub active: bool,
    pub timezone: String,
    pub limit_policy: String,
    pub missed_policy: String,
    pub trigger: RoutineTrigger,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoutineRun {
    pub id: String,
    pub routine_id: String,
    pub trigger_id: Option<String>,
    pub agent_id: String,
    pub room_id: String,
    pub kind: String,
    pub source: Option<String>,
    pub scheduled_for: i64,
    pub routine_name: String,
    pub instruction: String,
    pub status: String,
    pub error: String,
    pub no_update: bool,
    pub delivery_id: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateRoutineInput {
    pub agent_id: String,
    pub name: String,
    pub instruction: String,
    pub schedule: Schedule,
    #[serde(default)]
    pub timezone: String,
    #[serde(default = "default_true")]
    pub active: bool,
    #[serde(default)]
    pub limit_policy: Option<String>,
    #[serde(default)]
    pub missed_policy: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateRoutineInput {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub instruction: Option<String>,
    #[serde(default)]
    pub schedule: Option<Schedule>,
    #[serde(default)]
    pub timezone: Option<String>,
    #[serde(default)]
    pub active: Option<bool>,
    #[serde(default)]
    pub limit_policy: Option<String>,
    #[serde(default)]
    pub missed_policy: Option<String>,
}

fn default_true() -> bool {
    true
}

// --- memory -------------------------------------------------------------

pub const MEMORY_BUDGET_BYTES: usize = 8_192;
pub const MEMORY_TEXT_LIMIT: usize = 500;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Memory {
    pub id: String,
    pub agent_id: String,
    pub text: String,
    pub origin: String,
    pub source_message_id: Option<String>,
    pub site: Option<String>,
    pub inclusion: String,
    pub user_controlled: bool,
    pub revision: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateMemoryInput {
    pub text: String,
    #[serde(default)]
    pub inclusion: Option<String>,
    #[serde(default)]
    pub site: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMemoryInput {
    #[serde(default)]
    pub text: Option<String>,
    #[serde(default)]
    pub inclusion: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RoomEvent {
    pub id: String,
    pub room_id: Option<String>,
    pub card_id: Option<String>,
    pub actor_id: Option<String>,
    pub actor_name: Option<String>,
    pub actor_handle: Option<String>,
    pub kind: String,
    pub detail: String,
    pub created_at: i64,
}
