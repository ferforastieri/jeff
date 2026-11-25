use std::path::Path;

use chrono::Utc;
use sqlx::SqlitePool;

use crate::db::Database;
use crate::errors::{AppError, AppResult};
pub use crate::features::conversations::repository::{
    WorkspaceMessageCursor, WorkspaceMessagePage,
};

/// The application database. SQLite only: the schema and its migrations
/// belong to `crate::db`, and the pool is shared with the SeaORM connection.
#[derive(Clone)]
pub struct Store {
    pub(crate) pool: SqlitePool,
    _database: Database,
}

impl Store {
    pub async fn connect(path: &Path) -> AppResult<Self> {
        let database = Database::connect(path).await?;
        let pool = database.pool().clone();
        Ok(Self {
            pool,
            _database: database,
        })
    }

    /// Test helper: the same SQLite file the test already created in its temp
    /// directory.
    pub async fn open(path: &Path) -> AppResult<Self> {
        Self::connect(path).await
    }

    pub fn pool(&self) -> &SqlitePool {
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
