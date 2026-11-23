use serde_json::json;
use sqlx::Row;

use crate::errors::{bad_request, AppError, AppResult};
use crate::features::rooms::models::*;
use crate::platform::store::Store;

fn principal_from_row(row: &sqlx::postgres::PgRow) -> AppResult<Principal> {
    let avatar: String = row.try_get("avatar")?;
    let bot: Option<String> = row.try_get("bot")?;
    Ok(Principal {
        id: row.try_get("id")?,
        kind: row.try_get("kind")?,
        user_id: row.try_get("user_id")?,
        name: row.try_get("name")?,
        handle: row.try_get("handle")?,
        avatar: serde_json::from_str(&avatar).unwrap_or_else(|_| json!({})),
        bot: bot.and_then(|raw| serde_json::from_str(&raw).ok()),
        created_at: row.try_get("created_at")?,
    })
}

const PRINCIPAL_COLUMNS: &str = "id, kind, user_id, name, handle, avatar, bot, created_at";

fn author_of(principal: &Principal) -> Author {
    Author {
        id: principal.id.clone(),
        name: principal.name.clone(),
        handle: principal.handle.clone(),
        kind: principal.kind.clone(),
    }
}

impl Store {
    /// The participant row that represents a person. Created on first use so
    /// every existing install gets one without a migration step.
    pub async fn ensure_human_principal(&self, user_id: i64) -> AppResult<Principal> {
        if let Some(row) = sqlx::query(&format!(
            "SELECT {PRINCIPAL_COLUMNS} FROM principals WHERE user_id = $1"
        ))
        .bind(user_id)
        .fetch_optional(&self.pool)
        .await?
        {
            return principal_from_row(&row);
        }
        let username: String = sqlx::query_scalar("SELECT username FROM users WHERE id = $1")
            .bind(user_id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)?;
        let mut handle = normalize_handle(&username);
        let taken: i64 = sqlx::query_scalar("SELECT count(*) FROM principals WHERE handle = $1")
            .bind(&handle)
            .fetch_one(&self.pool)
            .await?;
        if taken > 0 {
            handle = format!("{handle}-{user_id}");
        }
        let id = crate::crypto::new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO principals(id,kind,user_id,name,handle,avatar,bot,created_at,updated_at)
             VALUES($1, 'human', $2, $3, $4, '{}', NULL, $5, $6)",
        )
        .bind(&id)
        .bind(user_id)
        .bind(&username)
        .bind(&handle)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        self.principal(&id).await
    }

    pub async fn principal(&self, id: &str) -> AppResult<Principal> {
        let row = sqlx::query(&format!(
            "SELECT {PRINCIPAL_COLUMNS} FROM principals WHERE id = $1"
        ))
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        principal_from_row(&row)
    }

    pub async fn list_bots(&self) -> AppResult<Vec<Principal>> {
        let rows = sqlx::query(&format!(
            "SELECT {PRINCIPAL_COLUMNS} FROM principals WHERE kind = 'bot' ORDER BY name"
        ))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(principal_from_row).collect()
    }

    pub async fn create_bot(&self, input: CreateBotInput) -> AppResult<Principal> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(bad_request("O bot precisa de um nome."));
        }
        let wanted = if input.handle.trim().is_empty() {
            normalize_handle(name)
        } else {
            normalize_handle(&input.handle)
        };
        let taken: i64 = sqlx::query_scalar("SELECT count(*) FROM principals WHERE handle = $1")
            .bind(&wanted)
            .fetch_one(&self.pool)
            .await?;
        if taken > 0 {
            return Err(AppError::Conflict);
        }
        let config = BotConfig {
            engine: input.engine,
            model: input.model,
            effort: input.effort,
            title: input.title,
            persona: input.persona,
            folders: Vec::new(),
            proxy: input.proxy,
        };
        let id = crate::crypto::new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO principals(id,kind,user_id,name,handle,avatar,bot,created_at,updated_at)
             VALUES($1, 'bot', NULL, $2, $3, '{}', $4, $5, $6)",
        )
        .bind(&id)
        .bind(name)
        .bind(&wanted)
        .bind(serde_json::to_string(&config)?)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        self.principal(&id).await
    }

    pub async fn create_room(
        &self,
        project_id: &str,
        creator: &Principal,
        input: CreateRoomInput,
    ) -> AppResult<Room> {
        let name = input.name.trim();
        if name.is_empty() {
            return Err(bad_request("A sala precisa de um nome."));
        }
        let id = crate::crypto::new_id();
        let now = now_ms();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO rooms(id,project_id,kind,name,title,instructions,lead_id,isolated,archived,created_at,updated_at)
             VALUES($1, $2, 'room', $3, $4, $5, $6, 0, 0, $7, $8)",
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(input.title.trim())
        .bind(input.instructions.trim())
        .bind(input.lead_id.as_deref())
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "INSERT INTO room_members(room_id,principal_id,joined_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        )
        .bind(&id)
        .bind(&creator.id)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        for member in &input.member_ids {
            if member == &creator.id {
                continue;
            }
            let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM principals WHERE id = $1")
                .bind(member)
                .fetch_one(&mut *tx)
                .await?;
            if exists == 0 {
                return Err(bad_request("Membro desconhecido."));
            }
            sqlx::query(
                "INSERT INTO room_members(room_id,principal_id,joined_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(member)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
        if let Some(lead) = &input.lead_id {
            sqlx::query(
                "INSERT INTO room_members(room_id,principal_id,joined_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(lead)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.room(project_id, &id).await
    }

    /// A direct conversation: two participants, no lead, no title.
    pub async fn create_dm_room(
        &self,
        project_id: &str,
        name: &str,
        member_ids: &[String],
    ) -> AppResult<Room> {
        let id = crate::crypto::new_id();
        let now = now_ms();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO rooms(id,project_id,kind,name,title,instructions,lead_id,isolated,archived,created_at,updated_at)
             VALUES($1,$2,'dm',$3,'','',NULL,0,0,$4,$5)",
        )
        .bind(&id)
        .bind(project_id)
        .bind(name)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        for member in member_ids {
            sqlx::query(
                "INSERT INTO room_members(room_id,principal_id,joined_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(member)
            .bind(now)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        self.room(project_id, &id).await
    }

    pub async fn list_rooms(&self, project_id: &str) -> AppResult<Vec<Room>> {
        let rows = sqlx::query(
            "SELECT id,project_id,kind,name,title,instructions,lead_id,isolated,archived,created_at,updated_at
             FROM rooms WHERE project_id = $1 AND archived = 0 ORDER BY updated_at DESC",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        let mut rooms = Vec::with_capacity(rows.len());
        for row in rows {
            let mut room = self.room_from_row(&row)?;
            room.members = self.room_members(&room.id).await?;
            rooms.push(room);
        }
        Ok(rooms)
    }

    fn room_from_row(&self, row: &sqlx::postgres::PgRow) -> AppResult<Room> {
        Ok(Room {
            id: row.try_get("id")?,
            project_id: row.try_get("project_id")?,
            kind: row.try_get("kind")?,
            name: row.try_get("name")?,
            title: row.try_get("title")?,
            instructions: row.try_get("instructions")?,
            lead_id: row.try_get("lead_id")?,
            isolated: row.try_get::<i64, _>("isolated")? != 0,
            archived: row.try_get::<i64, _>("archived")? != 0,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
            members: Vec::new(),
        })
    }

    pub async fn room(&self, project_id: &str, room_id: &str) -> AppResult<Room> {
        let row = sqlx::query(
            "SELECT id,project_id,kind,name,title,instructions,lead_id,isolated,archived,created_at,updated_at
             FROM rooms WHERE id = $1 AND project_id = $2",
        )
        .bind(room_id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        let mut room = self.room_from_row(&row)?;
        room.members = self.room_members(room_id).await?;
        Ok(room)
    }

    /// The queue only knows the room id, so it loads the room without the
    /// project check the HTTP route already did.
    pub async fn room_by_id(&self, room_id: &str) -> AppResult<Room> {
        let row = sqlx::query(
            "SELECT id,project_id,kind,name,title,instructions,lead_id,isolated,archived,created_at,updated_at
             FROM rooms WHERE id = $1",
        )
        .bind(room_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        let mut room = self.room_from_row(&row)?;
        room.members = self.room_members(room_id).await?;
        Ok(room)
    }

    pub async fn room_message(&self, id: &str) -> AppResult<Message> {
        let row = sqlx::query(
            "SELECT m.seq,m.id,m.room_id,m.author_id,m.text,m.kind,m.reply_to,m.task_id,m.created_at,
                    p.name AS author_name,p.handle AS author_handle,p.kind AS author_kind
             FROM room_messages m JOIN principals p ON p.id = m.author_id
             WHERE m.id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        Ok(Message {
            seq: row.try_get("seq")?,
            id: row.try_get("id")?,
            room_id: row.try_get("room_id")?,
            author: Author {
                id: row.try_get("author_id")?,
                name: row.try_get("author_name")?,
                handle: row.try_get("author_handle")?,
                kind: row.try_get("author_kind")?,
            },
            text: row.try_get("text")?,
            kind: row.try_get("kind")?,
            reply_to: row.try_get("reply_to")?,
            task_id: row.try_get("task_id")?,
            created_at: row.try_get("created_at")?,
        })
    }

    pub async fn room_members(&self, room_id: &str) -> AppResult<Vec<Principal>> {
        let rows = sqlx::query(&format!(
            "SELECT p.id,p.kind,p.user_id,p.name,p.handle,p.avatar,p.bot,p.created_at
             FROM room_members m JOIN principals p ON p.id = m.principal_id
             WHERE m.room_id = $1 ORDER BY p.kind DESC, p.name"
        ))
        .bind(room_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(principal_from_row).collect()
    }

    pub async fn is_room_member(&self, room_id: &str, principal_id: &str) -> AppResult<bool> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM room_members WHERE room_id = $1 AND principal_id = $2",
        )
        .bind(room_id)
        .bind(principal_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub async fn add_room_member(&self, room_id: &str, principal_id: &str) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO room_members(room_id,principal_id,joined_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        )
        .bind(room_id)
        .bind(principal_id)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn delete_room(&self, project_id: &str, room_id: &str) -> AppResult<()> {
        let affected = sqlx::query("DELETE FROM rooms WHERE id = $1 AND project_id = $2")
            .bind(room_id)
            .bind(project_id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn room_messages(
        &self,
        room_id: &str,
        before_seq: Option<i64>,
        limit: i64,
    ) -> AppResult<Vec<Message>> {
        let limit = limit.clamp(1, 200);
        let rows = sqlx::query(
            "SELECT m.seq,m.id,m.room_id,m.author_id,m.text,m.kind,m.reply_to,m.task_id,m.created_at,
                    p.name AS author_name,p.handle AS author_handle,p.kind AS author_kind
             FROM room_messages m JOIN principals p ON p.id = m.author_id
             WHERE m.room_id = $1 AND m.seq < $2
             ORDER BY m.seq DESC LIMIT $3",
        )
        .bind(room_id)
        .bind(before_seq.unwrap_or(i64::MAX))
        .bind(limit)
        .fetch_all(&self.pool)
        .await?;
        let mut messages: Vec<Message> = rows
            .iter()
            .map(|row| {
                Ok(Message {
                    seq: row.try_get("seq")?,
                    id: row.try_get("id")?,
                    room_id: row.try_get("room_id")?,
                    author: Author {
                        id: row.try_get("author_id")?,
                        name: row.try_get("author_name")?,
                        handle: row.try_get("author_handle")?,
                        kind: row.try_get("author_kind")?,
                    },
                    text: row.try_get("text")?,
                    kind: row.try_get("kind")?,
                    reply_to: row.try_get("reply_to")?,
                    task_id: row.try_get("task_id")?,
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect::<AppResult<Vec<_>>>()?;
        messages.reverse();
        Ok(messages)
    }

    pub async fn append_room_message(
        &self,
        room_id: &str,
        author_id: &str,
        text: &str,
        kind: &str,
        reply_to: Option<&str>,
    ) -> AppResult<Message> {
        let author = self.principal(author_id).await?;
        let id = crate::crypto::new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO room_messages(id,room_id,author_id,text,kind,reply_to,task_id,created_at)
             VALUES($1,$2,$3,$4,$5,$6,NULL,$7)",
        )
        .bind(&id)
        .bind(room_id)
        .bind(author_id)
        .bind(text)
        .bind(kind)
        .bind(reply_to)
        .bind(now)
        .execute(&self.pool)
        .await?;
        sqlx::query("UPDATE rooms SET updated_at = $1 WHERE id = $2")
            .bind(now)
            .bind(room_id)
            .execute(&self.pool)
            .await?;
        let seq: i64 = sqlx::query_scalar("SELECT seq FROM room_messages WHERE id = $1")
            .bind(&id)
            .fetch_one(&self.pool)
            .await?;
        Ok(Message {
            seq,
            id,
            room_id: room_id.into(),
            author: author_of(&author),
            text: text.into(),
            kind: kind.into(),
            reply_to: reply_to.map(str::to_owned),
            task_id: None,
            created_at: now,
        })
    }

    /// Creates one delivery per recipient. The idempotency key makes a retried
    /// send of the same message a no-op instead of a second turn.
    pub async fn enqueue_room_deliveries(
        &self,
        room_id: &str,
        message: &Message,
        recipients: &[String],
    ) -> AppResult<Vec<Delivery>> {
        let mut created = Vec::new();
        for recipient in recipients {
            let next: i64 = sqlx::query_scalar(
                "SELECT COALESCE(MAX(position), 0) + 1 FROM room_deliveries
                 WHERE recipient_id = $1 AND status = 'queued'",
            )
            .bind(recipient)
            .fetch_one(&self.pool)
            .await?;
            let id = crate::crypto::new_id();
            let affected = sqlx::query(
                "INSERT INTO room_deliveries
                 (id,room_id,message_id,recipient_id,sender_kind,sender_id,reply_to,idempotency_key,status,position,turn_id,error,created_at,updated_at)
                 VALUES($1,$2,$3,$4,$5,$6,$7,$8, 'queued', $9, NULL, '', $10, $11) ON CONFLICT DO NOTHING",
            )
            .bind(&id)
            .bind(room_id)
            .bind(&message.id)
            .bind(recipient)
            .bind(&message.author.kind)
            .bind(&message.author.id)
            .bind(message.reply_to.as_deref())
            .bind(format!("message:{}", message.id))
            .bind(next)
            .bind(now_ms())
            .bind(now_ms())
            .execute(&self.pool)
            .await?
            .rows_affected();
            if affected == 0 {
                continue;
            }
            created.push(Delivery {
                id,
                room_id: room_id.into(),
                message_id: message.id.clone(),
                recipient_id: recipient.clone(),
                sender_kind: message.author.kind.clone(),
                sender_id: Some(message.author.id.clone()),
                reply_to: message.reply_to.clone(),
                status: "queued".into(),
                position: next,
                created_at: now_ms(),
            });
        }
        Ok(created)
    }

    pub async fn room_delivery(&self, id: &str) -> AppResult<Delivery> {
        let row = sqlx::query(
            "SELECT id,room_id,message_id,recipient_id,sender_kind,sender_id,reply_to,status,position,created_at
             FROM room_deliveries WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        Ok(Delivery {
            id: row.try_get("id")?,
            room_id: row.try_get("room_id")?,
            message_id: row.try_get("message_id")?,
            recipient_id: row.try_get("recipient_id")?,
            sender_kind: row.try_get("sender_kind")?,
            sender_id: row.try_get("sender_id")?,
            reply_to: row.try_get("reply_to")?,
            status: row.try_get("status")?,
            position: row.try_get("position")?,
            created_at: row.try_get("created_at")?,
        })
    }

    pub async fn next_room_delivery(&self, recipient_id: &str) -> AppResult<Option<Delivery>> {
        let row = sqlx::query(
            "SELECT id,room_id,message_id,recipient_id,sender_kind,sender_id,reply_to,status,position,created_at
             FROM room_deliveries
             WHERE recipient_id = $1 AND status = 'queued'
             ORDER BY position, created_at LIMIT 1",
        )
        .bind(recipient_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        Ok(Some(Delivery {
            id: row.try_get("id")?,
            room_id: row.try_get("room_id")?,
            message_id: row.try_get("message_id")?,
            recipient_id: row.try_get("recipient_id")?,
            sender_kind: row.try_get("sender_kind")?,
            sender_id: row.try_get("sender_id")?,
            reply_to: row.try_get("reply_to")?,
            status: row.try_get("status")?,
            position: row.try_get("position")?,
            created_at: row.try_get("created_at")?,
        }))
    }

    pub async fn mark_room_delivery(&self, id: &str, status: &str, error: &str) -> AppResult<()> {
        sqlx::query(
            "UPDATE room_deliveries SET status = $1, error = $2, updated_at = $3 WHERE id = $4",
        )
        .bind(status)
        .bind(error)
        .bind(now_ms())
        .bind(id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn cancel_room_delivery(
        &self,
        recipient_id: &str,
        delivery_id: &str,
    ) -> AppResult<()> {
        let affected = sqlx::query(
            "UPDATE room_deliveries SET status = 'cancelled', updated_at = $1
             WHERE id = $2 AND recipient_id = $3 AND status = 'queued'",
        )
        .bind(now_ms())
        .bind(delivery_id)
        .bind(recipient_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if affected == 0 {
            return Err(AppError::Conflict);
        }
        let _ = self.cancel_routine_runs_for_delivery(delivery_id).await;
        Ok(())
    }

    pub async fn room_queue_paused(&self, principal_id: &str) -> AppResult<bool> {
        let paused: Option<i64> =
            sqlx::query_scalar("SELECT paused FROM room_queue_state WHERE principal_id = $1")
                .bind(principal_id)
                .fetch_optional(&self.pool)
                .await?;
        Ok(paused.unwrap_or(0) != 0)
    }

    pub async fn set_room_queue_paused(&self, principal_id: &str, paused: bool) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO room_queue_state(principal_id,paused,hold,updated_at) VALUES($1,$2,NULL,$3)
             ON CONFLICT(principal_id) DO UPDATE SET paused = excluded.paused, updated_at = excluded.updated_at",
        )
        .bind(principal_id)
        .bind(if paused { 1 } else { 0 })
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn room_session(
        &self,
        principal_id: &str,
        room_id: &str,
    ) -> AppResult<Option<(String, String)>> {
        let row = sqlx::query(
            "SELECT engine, session_id FROM room_sessions WHERE principal_id = $1 AND room_id = $2",
        )
        .bind(principal_id)
        .bind(room_id)
        .fetch_optional(&self.pool)
        .await?;
        let Some(row) = row else { return Ok(None) };
        Ok(Some((row.try_get("engine")?, row.try_get("session_id")?)))
    }

    pub async fn save_room_session(
        &self,
        principal_id: &str,
        room_id: &str,
        engine: &str,
        session_id: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO room_sessions(principal_id,room_id,engine,session_id,updated_at) VALUES($1,$2,$3,$4,$5)
             ON CONFLICT(principal_id,room_id) DO UPDATE SET engine = excluded.engine, session_id = excluded.session_id, updated_at = excluded.updated_at",
        )
        .bind(principal_id)
        .bind(room_id)
        .bind(engine)
        .bind(session_id)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// Bots that are members of the room, capped so a room cannot fan out to
    /// an unbounded number of CLI turns per message.
    pub async fn room_bot_members(&self, room_id: &str) -> AppResult<Vec<Principal>> {
        let mut members = self.room_members(room_id).await?;
        members.retain(|principal| principal.kind == "bot");
        members.truncate(8);
        Ok(members)
    }

    /// A restart cannot know whether a running CLI finished its side effects,
    /// so those deliveries become interrupted. Queued ones are safe to resume.
    pub async fn recover_room_deliveries(&self) -> AppResult<Vec<String>> {
        sqlx::query(
            "UPDATE room_deliveries
             SET status = 'interrupted', error = 'O servidor reiniciou durante a execução.', updated_at = $1
             WHERE status IN ('starting','running')",
        )
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        sqlx::query(
            "UPDATE routine_runs
             SET status = 'interrupted', error = 'O servidor reiniciou durante a execução.', updated_at = $1
             WHERE status IN ('queued','running') AND delivery_id IN
               (SELECT id FROM room_deliveries WHERE status = 'interrupted')",
        )
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        let recipients = sqlx::query_scalar::<_, String>(
            "SELECT DISTINCT recipient_id FROM room_deliveries WHERE status = 'queued'",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(recipients)
    }
    fn card_from_row(&self, row: &sqlx::postgres::PgRow) -> AppResult<Card> {
        let owner_id: Option<String> = row.try_get("owner_id")?;
        let owner = match &owner_id {
            Some(_) => row
                .try_get::<Option<String>, _>("owner_name")?
                .map(|name| Author {
                    id: owner_id.clone().unwrap_or_default(),
                    name,
                    handle: row
                        .try_get::<Option<String>, _>("owner_handle")
                        .unwrap_or_default()
                        .unwrap_or_default(),
                    kind: row
                        .try_get::<Option<String>, _>("owner_kind")
                        .unwrap_or_default()
                        .unwrap_or_else(|| "bot".into()),
                }),
            None => None,
        };
        let attachments: String = row.try_get("attachments")?;
        Ok(Card {
            id: row.try_get("id")?,
            project_id: row.try_get("project_id")?,
            room_id: row.try_get("room_id")?,
            message_id: row.try_get("message_id")?,
            task_id: row.try_get("task_id")?,
            title: row.try_get("title")?,
            description: row.try_get("description")?,
            owner_id,
            owner,
            due_at: row.try_get("due_at")?,
            priority: row.try_get("priority")?,
            attachments: serde_json::from_str(&attachments).unwrap_or_else(|_| json!([])),
            column: row.try_get("column_name")?,
            created_by: row.try_get("created_by")?,
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn create_card(
        &self,
        project_id: &str,
        input: CreateCardInput,
        created_by: &str,
    ) -> AppResult<Card> {
        let title = input.title.trim();
        if title.is_empty() {
            return Err(bad_request("O card precisa de um título."));
        }
        let priority = input.priority.unwrap_or_else(|| "normal".into());
        if !["low", "normal", "high", "urgent"].contains(&priority.as_str()) {
            return Err(bad_request("Prioridade inválida."));
        }
        if let Some(owner) = &input.owner_id {
            let exists: i64 = sqlx::query_scalar("SELECT count(*) FROM principals WHERE id = $1")
                .bind(owner)
                .fetch_one(&self.pool)
                .await?;
            if exists == 0 {
                return Err(bad_request("Responsável desconhecido."));
            }
        }
        let id = crate::crypto::new_id();
        let now = now_ms();
        sqlx::query(
            "INSERT INTO cards
             (id,project_id,room_id,message_id,task_id,title,description,owner_id,due_at,priority,attachments,column_name,created_by,created_at,updated_at)
             VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,'todo',$11,$12,$13)",
        )
        .bind(&id)
        .bind(project_id)
        .bind(&input.room_id)
        .bind(&input.message_id)
        .bind(title)
        .bind(input.description.trim())
        .bind(&input.owner_id)
        .bind(input.due_at)
        .bind(&priority)
        .bind("[]")
        .bind(created_by)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await
        .map_err(|error| {
            if crate::platform::store::is_unique(&error) {
                AppError::Conflict
            } else {
                AppError::Database(error)
            }
        })?;
        self.card(project_id, &id).await
    }

    /// A work request in a room opens one card per bot that was asked. The
    /// unique index on (message, owner) makes a retried send harmless.
    pub async fn create_card_from_message(
        &self,
        room: &Room,
        message: &Message,
        owner_id: &str,
    ) -> AppResult<Option<Card>> {
        let title = message
            .text
            .lines()
            .find(|line| !line.trim().is_empty())
            .unwrap_or("Pedido na sala")
            .trim()
            .chars()
            .take(120)
            .collect::<String>();
        let id = crate::crypto::new_id();
        let now = now_ms();
        let inserted = sqlx::query(
            "INSERT INTO cards
             (id,project_id,room_id,message_id,task_id,title,description,owner_id,due_at,priority,attachments,column_name,created_by,created_at,updated_at)
             VALUES($1,$2,$3,$4,NULL,$5,$6,$7,NULL,'normal','[]','todo',$8,$9,$10) ON CONFLICT DO NOTHING",
        )
        .bind(&id)
        .bind(&room.project_id)
        .bind(&room.id)
        .bind(&message.id)
        .bind(&title)
        .bind(&message.text)
        .bind(owner_id)
        .bind(&message.author.id)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if inserted > 0 {
            return Ok(Some(self.card(&room.project_id, &id).await?));
        }
        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM cards WHERE message_id = $1 AND owner_id = $2 LIMIT 1",
        )
        .bind(&message.id)
        .bind(owner_id)
        .fetch_optional(&self.pool)
        .await?;
        match existing {
            Some(existing) => Ok(Some(self.card(&room.project_id, &existing).await?)),
            None => Ok(None),
        }
    }

    pub async fn list_cards(&self, project_id: &str) -> AppResult<Vec<Card>> {
        let rows = sqlx::query(
            "SELECT c.id,c.project_id,c.room_id,c.message_id,c.task_id,c.title,c.description,c.owner_id,
                    c.due_at,c.priority,c.attachments,c.column_name,c.created_by,c.created_at,c.updated_at,
                    o.name AS owner_name,o.handle AS owner_handle,o.kind AS owner_kind
             FROM cards c LEFT JOIN principals o ON o.id = c.owner_id
             WHERE c.project_id = $1 ORDER BY c.updated_at DESC",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(|row| self.card_from_row(row)).collect()
    }

    pub async fn card(&self, project_id: &str, id: &str) -> AppResult<Card> {
        let row = sqlx::query(
            "SELECT c.id,c.project_id,c.room_id,c.message_id,c.task_id,c.title,c.description,c.owner_id,
                    c.due_at,c.priority,c.attachments,c.column_name,c.created_by,c.created_at,c.updated_at,
                    o.name AS owner_name,o.handle AS owner_handle,o.kind AS owner_kind
             FROM cards c LEFT JOIN principals o ON o.id = c.owner_id
             WHERE c.id = $1 AND c.project_id = $2",
        )
        .bind(id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        self.card_from_row(&row)
    }

    pub async fn update_card(
        &self,
        project_id: &str,
        id: &str,
        input: UpdateCardInput,
    ) -> AppResult<Card> {
        let current = self.card(project_id, id).await?;
        let title = match input.title {
            Some(title) => {
                let title = title.trim().to_string();
                if title.is_empty() {
                    return Err(bad_request("O card precisa de um título."));
                }
                title
            }
            None => current.title,
        };
        let description = input.description.unwrap_or(current.description);
        let owner_id = match input.owner_id {
            Some(owner) if owner.trim().is_empty() => None,
            Some(owner) => Some(owner),
            None => current.owner_id,
        };
        let due_at = match input.due_at {
            Some(0) => None,
            Some(due) => Some(due),
            None => current.due_at,
        };
        let priority = input.priority.unwrap_or(current.priority);
        if !["low", "normal", "high", "urgent"].contains(&priority.as_str()) {
            return Err(bad_request("Prioridade inválida."));
        }
        let column = input.column.unwrap_or(current.column);
        if !valid_column(&column) {
            return Err(bad_request("Coluna inválida."));
        }
        sqlx::query(
            "UPDATE cards SET title = $1, description = $2, owner_id = $3, due_at = $4, priority = $5,
                    column_name = $6, updated_at = $7 WHERE id = $8 AND project_id = $9",
        )
        .bind(&title)
        .bind(&description)
        .bind(&owner_id)
        .bind(due_at)
        .bind(&priority)
        .bind(&column)
        .bind(now_ms())
        .bind(id)
        .bind(project_id)
        .execute(&self.pool)
        .await?;
        self.card(project_id, id).await
    }

    pub async fn move_card(&self, project_id: &str, id: &str, column: &str) -> AppResult<Card> {
        if !valid_column(column) {
            return Err(bad_request("Coluna inválida."));
        }
        let affected = sqlx::query(
            "UPDATE cards SET column_name = $1, updated_at = $2 WHERE id = $3 AND project_id = $4",
        )
        .bind(column)
        .bind(now_ms())
        .bind(id)
        .bind(project_id)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        self.card(project_id, id).await
    }

    pub async fn delete_card(&self, project_id: &str, id: &str) -> AppResult<()> {
        let affected = sqlx::query("DELETE FROM cards WHERE id = $1 AND project_id = $2")
            .bind(id)
            .bind(project_id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::features::rooms::models::{CreateBotInput, CreateRoomInput};

    async fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("jeff.db")).await.unwrap();
        sqlx::query(
            "INSERT INTO users(id,username,password_hash,created_at) VALUES(1,'fer','x','now')",
        )
        .execute(&store.pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO projects(id,name,root,color,created_at,updated_at) VALUES('p1','P','/tmp/jeff-room-test','#000','0','0')",
        )
        .execute(&store.pool)
        .await
        .unwrap();
        (dir, store)
    }

    fn bot(name: &str) -> CreateBotInput {
        CreateBotInput {
            name: name.into(),
            handle: name.to_ascii_lowercase(),
            title: String::new(),
            persona: String::new(),
            engine: "claude".into(),
            model: String::new(),
            effort: String::new(),
            proxy: String::new(),
        }
    }

    #[tokio::test]
    async fn human_principal_is_created_once() {
        let (_dir, store) = store().await;
        let first = store.ensure_human_principal(1).await.unwrap();
        let second = store.ensure_human_principal(1).await.unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(first.kind, "human");
    }

    #[tokio::test]
    async fn room_message_fans_out_once() {
        let (_dir, store) = store().await;
        let me = store.ensure_human_principal(1).await.unwrap();
        let ana = store.create_bot(bot("ana")).await.unwrap();
        let room = store
            .create_room(
                "p1",
                &me,
                CreateRoomInput {
                    name: "Geral".into(),
                    title: String::new(),
                    instructions: String::new(),
                    lead_id: Some(ana.id.clone()),
                    member_ids: Vec::new(),
                },
            )
            .await
            .unwrap();
        assert_eq!(room.members.len(), 2);
        assert_eq!(room.lead_id.as_deref(), Some(ana.id.as_str()));

        let message = store
            .append_room_message(&room.id, &me.id, "olá", "message", None)
            .await
            .unwrap();
        let first = store
            .enqueue_room_deliveries(&room.id, &message, &[ana.id.clone()])
            .await
            .unwrap();
        assert_eq!(first.len(), 1);
        let retry = store
            .enqueue_room_deliveries(&room.id, &message, &[ana.id.clone()])
            .await
            .unwrap();
        assert!(retry.is_empty(), "a repeated send must not queue twice");

        let next = store.next_room_delivery(&ana.id).await.unwrap().unwrap();
        assert_eq!(next.message_id, message.id);
        store
            .mark_room_delivery(&next.id, "completed", "")
            .await
            .unwrap();
        assert!(store.next_room_delivery(&ana.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn queued_delivery_can_be_cancelled() {
        let (_dir, store) = store().await;
        let me = store.ensure_human_principal(1).await.unwrap();
        let ana = store.create_bot(bot("ana")).await.unwrap();
        let room = store
            .create_room(
                "p1",
                &me,
                CreateRoomInput {
                    name: "Geral".into(),
                    title: String::new(),
                    instructions: String::new(),
                    lead_id: None,
                    member_ids: vec![ana.id.clone()],
                },
            )
            .await
            .unwrap();
        let message = store
            .append_room_message(&room.id, &me.id, "tarefa", "message", None)
            .await
            .unwrap();
        let deliveries = store
            .enqueue_room_deliveries(&room.id, &message, &[ana.id.clone()])
            .await
            .unwrap();
        store
            .cancel_room_delivery(&ana.id, &deliveries[0].id)
            .await
            .unwrap();
        assert!(store.next_room_delivery(&ana.id).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn work_request_opens_one_card_per_bot() {
        let (_dir, store) = store().await;
        let me = store.ensure_human_principal(1).await.unwrap();
        let ana = store.create_bot(bot("ana")).await.unwrap();
        let beto = store.create_bot(bot("beto")).await.unwrap();
        let room = store
            .create_room(
                "p1",
                &me,
                CreateRoomInput {
                    name: "Geral".into(),
                    title: String::new(),
                    instructions: String::new(),
                    lead_id: Some(ana.id.clone()),
                    member_ids: vec![ana.id.clone(), beto.id.clone()],
                },
            )
            .await
            .unwrap();
        let message = store
            .append_room_message(
                &room.id,
                &me.id,
                "revise o diff\ncom urgência",
                "message",
                None,
            )
            .await
            .unwrap();
        for owner in [&ana.id, &beto.id] {
            let card = store
                .create_card_from_message(&room, &message, owner)
                .await
                .unwrap()
                .unwrap();
            assert_eq!(card.column, "todo");
            assert_eq!(card.title, "revise o diff");
            assert_eq!(card.owner_id.as_deref(), Some(owner.as_str()));
        }
        let again = store
            .create_card_from_message(&room, &message, &ana.id)
            .await
            .unwrap()
            .unwrap();
        let cards = store.list_cards("p1").await.unwrap();
        assert_eq!(cards.len(), 2, "a retried send must not duplicate the card");
        assert!(cards.iter().any(|card| card.id == again.id));
    }

    #[tokio::test]
    async fn card_moves_and_clears_its_owner() {
        let (_dir, store) = store().await;
        let me = store.ensure_human_principal(1).await.unwrap();
        let ana = store.create_bot(bot("ana")).await.unwrap();
        let card = store
            .create_card(
                "p1",
                CreateCardInput {
                    title: "Revisar".into(),
                    description: String::new(),
                    owner_id: Some(ana.id.clone()),
                    due_at: None,
                    priority: None,
                    room_id: None,
                    message_id: None,
                },
                &me.id,
            )
            .await
            .unwrap();
        let moved = store.move_card("p1", &card.id, "review").await.unwrap();
        assert_eq!(moved.column, "review");
        let cleared = store
            .update_card(
                "p1",
                &card.id,
                UpdateCardInput {
                    title: None,
                    description: None,
                    owner_id: Some(String::new()),
                    due_at: None,
                    priority: Some("high".into()),
                    column: None,
                },
            )
            .await
            .unwrap();
        assert!(cleared.owner_id.is_none());
        assert!(cleared.owner.is_none());
        assert_eq!(cleared.priority, "high");
        assert!(store.move_card("p1", &card.id, "nope").await.is_err());
    }
}

impl Store {
    /// Audit trail for work that is not itself a message (cards, rooms,
    /// routines). Messages already have the transcript and the FTS index.
    pub async fn log_room_event(
        &self,
        project_id: &str,
        room_id: Option<&str>,
        card_id: Option<&str>,
        actor_id: Option<&str>,
        kind: &str,
        detail: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO room_events(id,project_id,room_id,card_id,actor_id,kind,detail,created_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(crate::crypto::new_id())
        .bind(project_id)
        .bind(room_id)
        .bind(card_id)
        .bind(actor_id)
        .bind(kind)
        .bind(detail)
        .bind(now_ms())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn room_events(&self, room_id: &str, limit: i64) -> AppResult<Vec<RoomEvent>> {
        self.events(
            "WHERE e.room_id = ? ORDER BY e.created_at DESC LIMIT ?",
            Some(room_id),
            limit,
        )
        .await
    }

    pub async fn card_events(&self, card_id: &str, limit: i64) -> AppResult<Vec<RoomEvent>> {
        self.events(
            "WHERE e.card_id = ? ORDER BY e.created_at DESC LIMIT ?",
            Some(card_id),
            limit,
        )
        .await
    }

    async fn events(
        &self,
        clause: &str,
        key: Option<&str>,
        limit: i64,
    ) -> AppResult<Vec<RoomEvent>> {
        let rows = sqlx::query(&format!(
            "SELECT e.id,e.room_id,e.card_id,e.actor_id,e.kind,e.detail,e.created_at,
                    p.name AS actor_name,p.handle AS actor_handle
             FROM room_events e LEFT JOIN principals p ON p.id = e.actor_id {clause}"
        ))
        .bind(key)
        .bind(limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        rows.iter()
            .map(|row| {
                Ok(RoomEvent {
                    id: row.try_get("id")?,
                    room_id: row.try_get("room_id")?,
                    card_id: row.try_get("card_id")?,
                    actor_id: row.try_get("actor_id")?,
                    actor_name: row.try_get("actor_name")?,
                    actor_handle: row.try_get("actor_handle")?,
                    kind: row.try_get("kind")?,
                    detail: row.try_get("detail")?,
                    created_at: row.try_get("created_at")?,
                })
            })
            .collect()
    }
}
