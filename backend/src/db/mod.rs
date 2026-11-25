//! SQLite access for the runtime. The schema and its migrations belong to
//! `crate::db`; the pool is shared with the SeaORM connection.

use std::path::Path;
use std::time::Duration;

use sea_orm::{DatabaseConnection, SqlxSqliteConnector};
use sea_orm_migration::MigratorTrait;
use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};

use crate::errors::{AppError, AppResult};

mod migration;

#[derive(Clone)]
pub struct Database {
    connection: DatabaseConnection,
}

impl Database {
    pub async fn connect(path: &Path) -> AppResult<Self> {
        // SQLite is the single store for both the server and desktop local
        // mode. WAL keeps readers from blocking behind the writer.
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true)
            .journal_mode(SqliteJournalMode::Wal)
            .synchronous(SqliteSynchronous::Normal)
            .busy_timeout(Duration::from_secs(5))
            .foreign_keys(true)
            .pragma("temp_store", "MEMORY")
            .pragma("cache_size", "-16000")
            .pragma("mmap_size", "134217728");
        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(options)
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!("sqlite: {error}")))?;
        let connection = SqlxSqliteConnector::from_sqlx_sqlite_pool(pool);
        migration::Migrator::up(&connection, None)
            .await
            .map_err(|error| AppError::Internal(anyhow::anyhow!("sqlite migration: {error}")))?;
        Ok(Self { connection })
    }

    pub fn connection(&self) -> &DatabaseConnection {
        &self.connection
    }

    pub fn pool(&self) -> &sqlx::SqlitePool {
        self.connection.get_sqlite_connection_pool()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn applies_the_sqlite_schema() {
        let dir = tempfile::tempdir().unwrap();
        let db = Database::connect(&dir.path().join("jeff.db"))
            .await
            .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT count(*) FROM users")
            .fetch_one(db.pool())
            .await
            .unwrap();
        assert!(count >= 0);
    }
}
