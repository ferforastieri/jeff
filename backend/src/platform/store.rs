use std::path::Path;

use chrono::Utc;
use sqlx::PgPool;

use crate::db::Database;
use crate::errors::{AppError, AppResult};
pub use crate::features::conversations::repository::{
    WorkspaceMessageCursor, WorkspaceMessagePage,
};

/// The application database. PostgreSQL only: the schema and its migrations
/// belong to `crate::db`, and the pool is shared with the SeaORM connection.
#[derive(Clone)]
pub struct Store {
    pub(crate) pool: PgPool,
    _database: Database,
}

impl Store {
    pub async fn connect(url: &str) -> AppResult<Self> {
        let database = Database::connect(url).await?;
        let pool = database.pool().clone();
        Ok(Self {
            pool,
            _database: database,
        })
    }

    /// Test helper. The path is ignored; tests connect to `TEST_DATABASE_URL`
    /// (or `JEFF_DATABASE_URL`) and, with `JEFF_TEST_SCHEMA=1`, each Store gets
    /// its own schema so tests can run in parallel.
    pub async fn open(_path: &Path) -> AppResult<Self> {
        let url = std::env::var("TEST_DATABASE_URL")
            .or_else(|_| std::env::var("JEFF_DATABASE_URL"))
            .map_err(|_| {
                AppError::ServiceUnavailable(
                    "TEST_DATABASE_URL or JEFF_DATABASE_URL is required".into(),
                )
            })?;
        if url.trim().is_empty() {
            return Err(AppError::ServiceUnavailable(
                "TEST_DATABASE_URL is empty".into(),
            ));
        }
        Self::connect(&url).await
    }

    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    pub async fn close(&self) {
        self.pool.close().await;
    }
}

pub(crate) fn now() -> String {
    Utc::now().to_rfc3339()
}

pub(crate) fn map_not_found(error: sqlx::Error) -> AppError {
    match error {
        sqlx::Error::RowNotFound => AppError::NotFound,
        other => other.into(),
    }
}

pub(crate) fn is_unique(error: &sqlx::Error) -> bool {
    error
        .as_database_error()
        .map(|error| error.is_unique_violation())
        .unwrap_or(false)
}
