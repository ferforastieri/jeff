//! PostgreSQL access for the new runtime. Phase 1 only opens the connection and
//! applies the schema.

use std::sync::atomic::{AtomicU64, Ordering};

use sea_orm::{Database as SeaDatabase, DatabaseConnection};
use sea_orm_migration::MigratorTrait;

use crate::errors::{AppError, AppResult};

mod migration;

static TEST_SCHEMA: AtomicU64 = AtomicU64::new(1);

#[derive(Clone)]
pub struct Database {
    connection: DatabaseConnection,
}

/// Tests get one schema per Store so they can run in parallel without
/// truncating each other. Production uses the URL as-is.
fn test_url(url: &str) -> Option<String> {
    if std::env::var("JEFF_TEST_SCHEMA").as_deref() != Ok("1") {
        return None;
    }
    let schema = format!(
        "test_{}_{}",
        std::process::id(),
        TEST_SCHEMA.fetch_add(1, Ordering::SeqCst)
    );
    let separator = if url.contains('?') { '&' } else { '?' };
    Some(format!("{url}{separator}options=-csearch_path%3D{schema}"))
}

async fn ensure_schema(url: &str, schema_url: &str) -> AppResult<()> {
    let schema = schema_url
        .split("search_path%3D")
        .nth(1)
        .unwrap_or_default()
        .to_string();
    if schema.is_empty() {
        return Ok(());
    }
    let admin = sqlx::postgres::PgPoolOptions::new()
        .max_connections(1)
        .connect(url)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("postgres: {error}")))?;
    sqlx::query(&format!("CREATE SCHEMA IF NOT EXISTS \"{schema}\""))
        .execute(&admin)
        .await
        .map_err(|error| AppError::Internal(anyhow::anyhow!("postgres schema: {error}")))?;
    admin.close().await;
    Ok(())
}

impl Database {
    pub async fn connect(url: &str) -> AppResult<Self> {
        let target = test_url(url);
        if let Some(schema_url) = &target {
            ensure_schema(url, schema_url).await?;
        }
        let url = target.as_deref().unwrap_or(url);
        let connection = SeaDatabase::connect(url)
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!("postgres: {error}")))?;
        migration::Migrator::up(&connection, None)
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!("postgres migration: {error}")))?;
        Ok(Self { connection })
    }

    pub fn connection(&self) -> &DatabaseConnection {
        &self.connection
    }

    pub fn pool(&self) -> &sqlx::PgPool {
        self.connection.get_postgres_connection_pool()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn applies_the_postgres_schema() {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            return;
        };
        if url.trim().is_empty() {
            return;
        }
        let db = Database::connect(&url).await.unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert!(count >= 0);
    }
}
