use std::sync::Arc;

use axum::extract::{Extension, Path, Query, State};
use axum::Json;
use serde::Deserialize;
use serde_json::{json, Value};
use sqlx::Row;

use super::{AppState, AuthContext};
use crate::errors::{bad_request, AppError, AppResult};
use crate::features::rooms::models::{
    CreateBotInput, CreateCardInput, CreateRoomInput, QueueInput, SendMessageInput, UpdateCardInput,
};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RoomMessagesQuery {
    before: Option<i64>,
    limit: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct AddMemberInput {
    principal_id: String,
}

pub(super) async fn list_principals(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let bots = state.store.list_bots().await?;
    Ok(Json(json!({ "me": me, "bots": bots })))
}

pub(super) async fn create_bot(
    State(state): State<Arc<AppState>>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<CreateBotInput>,
) -> AppResult<Json<Value>> {
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!(state.store.create_bot(input).await?)))
}

pub(super) async fn list_rooms(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let rooms = state.store.list_rooms(&project).await?;
    let visible: Vec<_> = rooms
        .into_iter()
        .filter(|room| room.members.iter().any(|member| member.id == me.id))
        .collect();
    Ok(Json(json!({ "rooms": visible })))
}

pub(super) async fn create_room(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<CreateRoomInput>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let room = state.store.create_room(&project, &me, input).await?;
    let _ = state
        .store
        .log_room_event(
            &project,
            Some(&room.id),
            None,
            Some(&me.id),
            "room.created",
            &room.name,
        )
        .await;
    Ok(Json(json!(room)))
}

pub(super) async fn get_room(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!(room)))
}

pub(super) async fn delete_room(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let _ = state
        .store
        .log_room_event(
            &project,
            Some(&room.id),
            None,
            Some(&me.id),
            "room.deleted",
            &room.name,
        )
        .await;
    for member in room.members.iter().filter(|member| member.kind == "bot") {
        state.rooms.cancel(&member.id);
    }
    state.store.delete_room(&project, &room_id).await?;
    Ok(Json(json!({ "ok": true })))
}

pub(super) async fn list_messages(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Query(query): Query<RoomMessagesQuery>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    let messages = state
        .store
        .room_messages(&room.id, query.before, query.limit.unwrap_or(80))
        .await?;
    Ok(Json(json!({ "messages": messages })))
}

pub(super) async fn send_message(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<SendMessageInput>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    let project_row = state.store.project(&project).await?;
    let text = input.text.trim();
    if text.is_empty() {
        return Err(bad_request("A mensagem está vazia."));
    }
    if text.chars().count() > 100_000 {
        return Err(AppError::TooLarge);
    }
    let message = state
        .store
        .append_room_message(&room.id, &me.id, text, "message", input.reply_to.as_deref())
        .await?;

    let bots: Vec<_> = room
        .members
        .iter()
        .filter(|member| member.kind == "bot")
        .cloned()
        .collect();

    // An explicit mention wins; then an explicit recipient list; then the
    // lead; then every bot in the room.
    let mentioned: Vec<String> = bots
        .iter()
        .filter(|bot| {
            text.split_whitespace().any(|word| {
                word.trim_start_matches('@')
                    .trim_end_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_')
                    .eq_ignore_ascii_case(&bot.handle)
            })
        })
        .map(|bot| bot.id.clone())
        .collect();

    let recipients: Vec<String> = if !input.recipient_ids.is_empty() {
        input
            .recipient_ids
            .iter()
            .filter(|id| bots.iter().any(|bot| &bot.id == *id))
            .cloned()
            .collect()
    } else if !mentioned.is_empty() {
        mentioned
    } else if let Some(lead) = room
        .lead_id
        .as_ref()
        .filter(|lead| bots.iter().any(|bot| &bot.id == *lead))
    {
        let history = state
            .store
            .room_messages(&room.id, None, 24)
            .await
            .unwrap_or_default();
        match crate::features::rooms::routing::route(&state.ai, &room, &bots, &message, &history)
            .await
        {
            Some(decision) => {
                tracing::debug!(reason = %decision.reason, room = %room.id, "room routing");
                decision.recipients
            }
            None => vec![lead.clone()],
        }
    } else {
        bots.iter().map(|bot| bot.id.clone()).collect()
    };

    let deliveries = state
        .store
        .enqueue_room_deliveries(&room.id, &message, &recipients)
        .await?;
    for delivery in &deliveries {
        state.rooms.schedule(delivery.recipient_id.clone());
    }

    let preview: String = text.chars().take(140).collect();
    let body = format!("{}: {}", me.name, preview);
    for member in room
        .members
        .iter()
        .filter(|member| member.kind == "human" && member.id != me.id)
    {
        let mentioned = text
            .to_ascii_lowercase()
            .contains(&format!("@{}", member.handle.to_ascii_lowercase()));
        if room.kind != "dm" && !mentioned {
            continue;
        }
        if let Some(user_id) = member.user_id {
            let title = if room.kind == "dm" {
                format!("{} em {}", me.name, room.name)
            } else {
                format!("#{}", room.name)
            };
            state
                .emit_room_notification(
                    user_id,
                    title,
                    body.clone(),
                    project.clone(),
                    project_row.name.clone(),
                    room.id.clone(),
                )
                .await;
        }
    }
    Ok(Json(json!({
        "message": message,
        "deliveries": deliveries.len(),
    })))
}

pub(super) async fn get_queue(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    let mut bots = Vec::new();
    for member in room.members.iter().filter(|member| member.kind == "bot") {
        bots.push(json!({
            "principalId": member.id,
            "paused": state.store.room_queue_paused(&member.id).await?,
        }));
    }
    Ok(Json(json!({ "bots": bots })))
}

pub(super) async fn set_queue(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<QueueInput>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    for member in room.members.iter().filter(|member| member.kind == "bot") {
        state
            .store
            .set_room_queue_paused(&member.id, input.paused)
            .await?;
        if input.paused {
            state.rooms.cancel(&member.id);
        } else {
            state.rooms.schedule(member.id.clone());
        }
    }
    Ok(Json(json!({ "ok": true, "paused": input.paused })))
}

pub(super) async fn cancel_delivery(
    State(state): State<Arc<AppState>>,
    Path((project, room_id, delivery_id)): Path<(String, String, String)>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    let delivery = state.store.room_delivery(&delivery_id).await?;
    if delivery.room_id != room.id {
        return Err(AppError::NotFound);
    }
    state
        .store
        .cancel_room_delivery(&delivery.recipient_id, &delivery.id)
        .await?;
    Ok(Json(json!({ "ok": true })))
}

pub(super) async fn add_member(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<AddMemberInput>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    if !auth.user.is_admin() {
        return Err(AppError::Forbidden);
    }
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    state
        .store
        .add_room_member(&room.id, &input.principal_id)
        .await?;
    let member = state.store.principal(&input.principal_id).await?;
    let _ = state
        .store
        .log_room_event(
            &project,
            Some(&room.id),
            None,
            Some(&me.id),
            "member.added",
            &member.name,
        )
        .await;
    Ok(Json(json!(member)))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MoveCardInput {
    column: String,
}

pub(super) async fn list_cards(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    Ok(Json(
        json!({ "cards": state.store.list_cards(&project).await? }),
    ))
}

pub(super) async fn create_card(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Extension(auth): Extension<AuthContext>,
    Json(input): Json<CreateCardInput>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    Ok(Json(json!(
        state.store.create_card(&project, input, &me.id).await?
    )))
}

pub(super) async fn update_card(
    State(state): State<Arc<AppState>>,
    Path((project, card_id)): Path<(String, String)>,
    Json(input): Json<UpdateCardInput>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    let card = state.store.update_card(&project, &card_id, input).await?;
    let _ = state
        .store
        .log_room_event(
            &project,
            card.room_id.as_deref(),
            Some(&card.id),
            None,
            "card.updated",
            &card.title,
        )
        .await;
    Ok(Json(json!(card)))
}

pub(super) async fn move_card(
    State(state): State<Arc<AppState>>,
    Path((project, card_id)): Path<(String, String)>,
    Json(input): Json<MoveCardInput>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    Ok(Json(json!(
        state
            .store
            .move_card(&project, &card_id, &input.column)
            .await?
    )))
}

pub(super) async fn delete_card(
    State(state): State<Arc<AppState>>,
    Path((project, card_id)): Path<(String, String)>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    state.store.delete_card(&project, &card_id).await?;
    let _ = state
        .store
        .log_room_event(&project, None, Some(&card_id), None, "card.deleted", "")
        .await;
    Ok(Json(json!({ "ok": true })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct RoomSearchQuery {
    q: String,
    limit: Option<i64>,
}

pub(super) async fn room_search(
    State(state): State<Arc<AppState>>,
    Path(project): Path<String>,
    Query(query): Query<RoomSearchQuery>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let project_row = state.store.project(&project).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    let visible = state
        .store
        .list_rooms(&project)
        .await?
        .into_iter()
        .filter(|room| room.members.iter().any(|member| member.id == me.id))
        .map(|room| room.id)
        .collect::<std::collections::HashSet<_>>();
    let limit = query.limit.unwrap_or(20).clamp(1, 50);
    let term = query.q.trim();
    if term.is_empty() {
        return Ok(Json(json!({ "messages": [], "cards": [], "rooms": [] })));
    }

    let fts = term
        .split_whitespace()
        .take(8)
        .map(|word| format!("\"{}\"", word.replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ");
    let message_rows = sqlx::query(
        "SELECT m.id,m.room_id,r.name AS room_name,m.text,m.created_at,
                p.handle AS author_handle,p.name AS author_name
         FROM room_message_fts f
         JOIN room_messages m ON m.seq = f.rowid
         JOIN rooms r ON r.id = m.room_id
         JOIN principals p ON p.id = m.author_id
         WHERE f.search @@ websearch_to_tsquery('simple', $1) AND r.project_id = $2
         ORDER BY ts_rank(f.search, websearch_to_tsquery('simple', $1)) DESC LIMIT $3",
    )
    .bind(&fts)
    .bind(&project)
    .bind(limit)
    .fetch_all(&state.store.pool)
    .await
    .unwrap_or_default();
    let messages = message_rows
        .iter()
        .filter(|row| {
            row.try_get::<String, _>("room_id")
                .map(|id| visible.contains(&id))
                .unwrap_or(false)
        })
        .map(|row| {
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "roomId": row.try_get::<String,_>("room_id").unwrap_or_default(),
                "roomName": row.try_get::<String,_>("room_name").unwrap_or_default(),
                "text": row.try_get::<String,_>("text").unwrap_or_default().chars().take(400).collect::<String>(),
                "createdAt": row.try_get::<i64,_>("created_at").unwrap_or_default(),
                "author": row.try_get::<String,_>("author_handle").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    let card_rows = sqlx::query(
        "SELECT id,title,description,column_name,room_id FROM cards
         WHERE project_id = $1 AND instr(lower(title || ' ' || description), lower($2)) > 0
         ORDER BY updated_at DESC LIMIT $3",
    )
    .bind(&project)
    .bind(term)
    .bind(limit)
    .fetch_all(&state.store.pool)
    .await
    .unwrap_or_default();
    let cards = card_rows
        .iter()
        .map(|row| {
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "title": row.try_get::<String,_>("title").unwrap_or_default(),
                "description": row.try_get::<String,_>("description").unwrap_or_default().chars().take(240).collect::<String>(),
                "column": row.try_get::<String,_>("column_name").unwrap_or_default(),
                "roomId": row.try_get::<Option<String>,_>("room_id").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    let room_rows = sqlx::query(
        "SELECT id,name,title FROM rooms
         WHERE project_id = $1 AND archived = 0
           AND (instr(lower(name), lower($2)) > 0 OR instr(lower(title), lower($3)) > 0)
         LIMIT $4",
    )
    .bind(&project)
    .bind(term)
    .bind(term)
    .bind(limit)
    .fetch_all(&state.store.pool)
    .await
    .unwrap_or_default();
    let rooms = room_rows
        .iter()
        .filter(|row| {
            row.try_get::<String, _>("id")
                .map(|id| visible.contains(&id))
                .unwrap_or(false)
        })
        .map(|row| {
            json!({
                "id": row.try_get::<String,_>("id").unwrap_or_default(),
                "name": row.try_get::<String,_>("name").unwrap_or_default(),
                "title": row.try_get::<String,_>("title").unwrap_or_default(),
            })
        })
        .collect::<Vec<_>>();

    let _ = project_row;
    Ok(Json(json!({
        "messages": messages,
        "cards": cards,
        "rooms": rooms,
    })))
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct EventsQuery {
    limit: Option<i64>,
}

pub(super) async fn room_events(
    State(state): State<Arc<AppState>>,
    Path((project, room_id)): Path<(String, String)>,
    Query(query): Query<EventsQuery>,
    Extension(auth): Extension<AuthContext>,
) -> AppResult<Json<Value>> {
    let room = state.store.room(&project, &room_id).await?;
    let me = state.store.ensure_human_principal(auth.user.id).await?;
    if !room.members.iter().any(|member| member.id == me.id) {
        return Err(AppError::Forbidden);
    }
    Ok(Json(json!({
        "events": state.store.room_events(&room.id, query.limit.unwrap_or(50)).await?,
    })))
}

pub(super) async fn card_events(
    State(state): State<Arc<AppState>>,
    Path((project, card_id)): Path<(String, String)>,
    Query(query): Query<EventsQuery>,
) -> AppResult<Json<Value>> {
    state.store.project(&project).await?;
    state.store.card(&project, &card_id).await?;
    Ok(Json(json!({
        "events": state.store.card_events(&card_id, query.limit.unwrap_or(50)).await?,
    })))
}
