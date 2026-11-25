use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(Schema)]
    }
}

/// The whole schema is one migration. There is no compatibility with the old
/// PostgreSQL database: a new install starts with an empty SQLite file.
pub struct Schema;

impl MigrationName for Schema {
    fn name(&self) -> &str {
        "m20261125_000001_sqlite"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for Schema {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let sql = include_str!("../../schema/sqlite.sql");
        manager.get_connection().execute_unprepared(sql).await?;
        Ok(())
    }

    async fn down(&self, _manager: &SchemaManager) -> Result<(), DbErr> {
        // Forward-only: an install is a fresh file.
        Ok(())
    }
}
