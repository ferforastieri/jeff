use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(Schema)]
    }
}

/// The whole schema is one migration for now. Later changes append new
/// migrations instead of editing this one, so a database that already ran it
/// stays valid.
#[derive(DeriveMigrationName)]
pub struct Schema;

#[async_trait::async_trait]
impl MigrationTrait for Schema {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        let sql = include_str!("../../schema/postgres.sql");
        manager.get_connection().execute_unprepared(sql).await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
            .await?;
        Ok(())
    }
}
