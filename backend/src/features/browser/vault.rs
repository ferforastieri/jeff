use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use serde_json::{json, Value};
use sqlx::Row;

use crate::crypto::{decrypt, encrypt, load_or_create_key};
use crate::errors::{bad_request, AppError, AppResult};
use crate::platform::store::Store;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultItem {
    pub id: String,
    pub project_id: String,
    pub kind: String,
    pub name: String,
    pub username: String,
    pub meta: Value,
    pub created_at: i64,
    pub updated_at: i64,
}

struct Inner {
    store: Store,
    key: Vec<u8>,
}

#[derive(Clone)]
pub struct VaultService {
    inner: Arc<Inner>,
}

impl VaultService {
    pub fn new(store: Store, key_path: &Path) -> AppResult<Self> {
        Ok(Self {
            inner: Arc::new(Inner {
                store,
                key: load_or_create_key(key_path)?,
            }),
        })
    }

    fn item(row: &sqlx::sqlite::SqliteRow) -> AppResult<VaultItem> {
        let meta: String = row.try_get("meta")?;
        Ok(VaultItem {
            id: row.try_get("id")?,
            project_id: row.try_get("project_id")?,
            kind: row.try_get("kind")?,
            name: row.try_get("name")?,
            username: row.try_get("username")?,
            meta: serde_json::from_str(&meta).unwrap_or_else(|_| json!({})),
            created_at: row.try_get("created_at")?,
            updated_at: row.try_get("updated_at")?,
        })
    }

    pub async fn list(&self, project_id: &str) -> AppResult<Vec<VaultItem>> {
        let rows = sqlx::query(
            "SELECT id,project_id,kind,name,username,meta,created_at,updated_at
             FROM vault_items WHERE project_id = $1 ORDER BY name",
        )
        .bind(project_id)
        .fetch_all(&self.inner.store.pool)
        .await?;
        rows.iter().map(Self::item).collect()
    }

    pub async fn add(
        &self,
        project_id: &str,
        kind: &str,
        name: &str,
        username: &str,
        secret: &str,
        meta: Value,
    ) -> AppResult<VaultItem> {
        if !["login", "card"].contains(&kind) {
            return Err(bad_request("kind deve ser login ou card."));
        }
        if name.trim().is_empty() || secret.is_empty() {
            return Err(bad_request("Nome e segredo são obrigatórios."));
        }
        let encrypted =
            encrypt(&self.inner.key, secret).map_err(|error| AppError::Internal(error.into()))?;
        let id = crate::crypto::new_id();
        let now = crate::features::rooms::models::now_ms();
        sqlx::query(
            "INSERT INTO vault_items(id,project_id,kind,name,username,secret_enc,meta,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",
        )
        .bind(&id)
        .bind(project_id)
        .bind(kind)
        .bind(name.trim())
        .bind(username.trim())
        .bind(encrypted)
        .bind(meta.to_string())
        .bind(now)
        .bind(now)
        .execute(&self.inner.store.pool)
        .await?;
        self.item_by_id(&id).await
    }

    pub async fn delete(&self, project_id: &str, id: &str) -> AppResult<()> {
        let affected = sqlx::query("DELETE FROM vault_items WHERE id = $1 AND project_id = $2")
            .bind(id)
            .bind(project_id)
            .execute(&self.inner.store.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    async fn item_by_id(&self, id: &str) -> AppResult<VaultItem> {
        let row = sqlx::query(
            "SELECT id,project_id,kind,name,username,meta,created_at,updated_at
             FROM vault_items WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.inner.store.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        Self::item(&row)
    }

    /// The secret only leaves this service to be typed into the page.
    pub async fn secret(&self, project_id: &str, id: &str) -> AppResult<(VaultItem, String)> {
        let row = sqlx::query(
            "SELECT id,project_id,kind,name,username,meta,created_at,updated_at,secret_enc
             FROM vault_items WHERE id = $1 AND project_id = $2",
        )
        .bind(id)
        .bind(project_id)
        .fetch_optional(&self.inner.store.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        let item = Self::item(&row)?;
        let encrypted: String = row.try_get("secret_enc")?;
        let secret = decrypt(&self.inner.key, &encrypted)
            .map_err(|_| AppError::ServiceUnavailable("Cofre ilegível.".into()))?;
        Ok((item, secret))
    }
}
