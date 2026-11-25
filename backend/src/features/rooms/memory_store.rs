use serde_json::json;
use sqlx::Row;

use crate::errors::{bad_request, AppError, AppResult};
use crate::features::rooms::models::*;
use crate::platform::store::Store;

pub fn normalize_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn memory_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<Memory> {
    Ok(Memory {
        id: row.try_get("id")?,
        agent_id: row.try_get("agent_id")?,
        text: row.try_get("text")?,
        origin: row.try_get("origin")?,
        source_message_id: row.try_get("source_message_id")?,
        site: row.try_get("site")?,
        inclusion: row.try_get("inclusion")?,
        user_controlled: row.try_get::<i64, _>("user_controlled")? != 0,
        revision: row.try_get("revision")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

const MEMORY_SELECT: &str = "SELECT m.id,m.agent_id,m.text,m.origin,m.source_message_id,m.site,
        m.created_at,m.updated_at,
        COALESCE(s.inclusion,'searchable') AS inclusion,
        COALESCE(s.user_controlled,0) AS user_controlled,
        COALESCE(s.revision,0) AS revision
 FROM bot_memories m LEFT JOIN bot_memory_selections s ON s.memory_id = m.id";

fn validate_text(value: &str) -> AppResult<String> {
    let text = value.trim();
    if text.is_empty() {
        return Err(bad_request("A memória está vazia."));
    }
    if text.chars().count() > MEMORY_TEXT_LIMIT {
        return Err(bad_request(format!(
            "A memória vai até {MEMORY_TEXT_LIMIT} caracteres."
        )));
    }
    Ok(text.to_string())
}

fn validate_inclusion(value: &str) -> AppResult<()> {
    if !["essential", "searchable"].contains(&value) {
        return Err(bad_request("inclusion deve ser essential ou searchable."));
    }
    Ok(())
}

async fn upsert_selection(
    pool: &sqlx::SqlitePool,
    memory_id: &str,
    inclusion: &str,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO bot_memory_selections(memory_id,inclusion,user_controlled,revision)
         VALUES($1,$2,1,1)
         ON CONFLICT(memory_id) DO UPDATE SET
           inclusion = excluded.inclusion,
           user_controlled = 1,
           revision = bot_memory_selections.revision + 1",
    )
    .bind(memory_id)
    .bind(inclusion)
    .execute(pool)
    .await?;
    Ok(())
}

impl Store {
    pub async fn remember_memory(
        &self,
        agent_id: &str,
        input: CreateMemoryInput,
    ) -> AppResult<Memory> {
        let agent = self.principal(agent_id).await?;
        if agent.kind != "bot" {
            return Err(bad_request("Memória pertence a um bot."));
        }
        let text = validate_text(&input.text)?;
        let normalized = normalize_text(&text);
        if let Some(inclusion) = &input.inclusion {
            validate_inclusion(inclusion)?;
        }
        let now = now_ms();

        let existing: Option<String> = sqlx::query_scalar(
            "SELECT id FROM bot_memories WHERE agent_id = $1 AND normalized_text = $2",
        )
        .bind(agent_id)
        .bind(&normalized)
        .fetch_optional(&self.pool)
        .await?;

        let id = match existing {
            Some(id) => {
                sqlx::query(
                    "UPDATE bot_memories SET text = $1, site = COALESCE($2, site), updated_at = $3
                     WHERE id = $4",
                )
                .bind(&text)
                .bind(&input.site)
                .bind(now)
                .bind(&id)
                .execute(&self.pool)
                .await?;
                // A repeated remember must not change how the memory is
                // selected; only an explicit inclusion does.
                if let Some(inclusion) = &input.inclusion {
                    upsert_selection(&self.pool, &id, inclusion).await?;
                }
                id
            }
            None => {
                let id = crate::crypto::new_id();
                sqlx::query(
                    "INSERT INTO bot_memories(id,agent_id,text,normalized_text,origin,source_message_id,site,created_at,updated_at)
                     VALUES($1,$2,$3,$4,'manual',NULL,$5,$6,$7)",
                )
                .bind(&id)
                .bind(agent_id)
                .bind(&text)
                .bind(&normalized)
                .bind(&input.site)
                .bind(now)
                .bind(now)
                .execute(&self.pool)
                .await?;
                let inclusion = input.inclusion.unwrap_or_else(|| "searchable".into());
                upsert_selection(&self.pool, &id, &inclusion).await?;
                id
            }
        };
        self.memory(&id).await
    }

    pub async fn memory(&self, id: &str) -> AppResult<Memory> {
        let row = sqlx::query(&format!("{MEMORY_SELECT} WHERE m.id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)?;
        memory_from_row(&row)
    }

    pub async fn memories(&self, agent_id: &str) -> AppResult<Vec<Memory>> {
        let rows = sqlx::query(&format!(
            "{MEMORY_SELECT} WHERE m.agent_id = $1 ORDER BY m.updated_at DESC"
        ))
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(memory_from_row).collect()
    }

    pub async fn essential_memories(&self, agent_id: &str) -> AppResult<Vec<Memory>> {
        let rows = sqlx::query(&format!(
            "{MEMORY_SELECT} WHERE m.agent_id = $1 AND COALESCE(s.inclusion,'searchable') = 'essential'
             ORDER BY m.updated_at DESC"
        ))
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(memory_from_row).collect()
    }

    pub async fn search_memories(
        &self,
        agent_id: &str,
        query: &str,
        limit: i64,
    ) -> AppResult<Vec<Memory>> {
        let rows = sqlx::query(&format!(
            "{MEMORY_SELECT} WHERE m.agent_id = $1 AND instr(lower(m.text), lower($2)) > 0
             ORDER BY m.updated_at DESC LIMIT $3"
        ))
        .bind(agent_id)
        .bind(query)
        .bind(limit.clamp(1, 20))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(memory_from_row).collect()
    }

    pub async fn update_memory(&self, id: &str, input: UpdateMemoryInput) -> AppResult<Memory> {
        if let Some(text) = input.text {
            let text = validate_text(&text)?;
            let normalized = normalize_text(&text);
            sqlx::query(
                "UPDATE bot_memories SET text = $1, normalized_text = $2, updated_at = $3 WHERE id = $4",
            )
            .bind(&text)
            .bind(&normalized)
            .bind(now_ms())
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|error| {
                if crate::platform::store::is_unique(&error) {
                    AppError::Conflict
                } else {
                    AppError::Database(error)
                }
            })?;
        }
        if let Some(inclusion) = input.inclusion {
            validate_inclusion(&inclusion)?;
            sqlx::query(
                "INSERT INTO bot_memory_selections(memory_id,inclusion,user_controlled,revision)
                 VALUES($1,$2,1,1)
                 ON CONFLICT(memory_id) DO UPDATE SET
                   inclusion = excluded.inclusion,
                   user_controlled = 1,
                   revision = bot_memory_selections.revision + 1",
            )
            .bind(id)
            .bind(&inclusion)
            .execute(&self.pool)
            .await?;
        }
        self.memory(id).await
    }

    pub async fn delete_memory(&self, id: &str) -> AppResult<()> {
        let affected = sqlx::query("DELETE FROM bot_memories WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}

/// The essential block that goes into every prompt. It never grows past the
/// byte budget; the most recent memories that do not fit stay out.
pub fn essential_prompt(memories: &[Memory]) -> Option<String> {
    let mut entries = Vec::new();
    let mut bytes = 0usize;
    for memory in memories {
        let entry = json!({
            "id": memory.id,
            "text": memory.text,
            "origin": memory.origin,
            "site": memory.site,
        });
        let size = entry.to_string().len() + 2;
        if bytes + size + 64 > MEMORY_BUDGET_BYTES {
            break;
        }
        bytes += size;
        entries.push(entry);
    }
    if entries.is_empty() {
        return None;
    }
    Some(format!(
        "<agent_memories count=\"{}\">\n{}\n</agent_memories>",
        entries.len(),
        serde_json::to_string(&entries).unwrap_or_else(|_| "[]".into())
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalization_collapses_case_and_spaces() {
        assert_eq!(normalize_text("  Prefere  Rust\n"), "prefere rust");
    }

    #[test]
    fn budget_keeps_the_most_recent_that_fit() {
        let memory = |id: &str, text: &str| Memory {
            id: id.into(),
            agent_id: "a".into(),
            text: text.into(),
            origin: "manual".into(),
            source_message_id: None,
            site: None,
            inclusion: "essential".into(),
            user_controlled: true,
            revision: 1,
            created_at: 0,
            updated_at: 0,
        };
        let small = essential_prompt(&[memory("1", "curto")]).unwrap();
        assert!(small.contains("curto"));
        let huge = "x".repeat(9_000);
        assert!(essential_prompt(&[memory("1", "ok"), memory("2", &huge)])
            .unwrap()
            .contains("ok"));
    }
}
