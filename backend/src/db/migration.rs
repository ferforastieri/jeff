use sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![
            Box::new(Schema),
            Box::new(UserEmail),
            Box::new(RoomRepos),
            Box::new(UserDevAccess),
            Box::new(ChannelCategories),
        ]
    }
}

/// The whole schema is one migration for now. Later changes append new
/// migrations instead of editing this one, so a database that already ran it
/// stays valid.
pub struct Schema;

impl MigrationName for Schema {
    fn name(&self) -> &str {
        "migration"
    }
}

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

/// Dev mode is a per-member permission, not a global server switch. Admins
/// keep it enabled by default so the first workspace can configure repos.
pub struct UserDevAccess;

impl MigrationName for UserDevAccess {
    fn name(&self) -> &str {
        "m20261123_000004_user_dev_access"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for UserDevAccess {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS dev_access BOOLEAN NOT NULL DEFAULT false;\
                 UPDATE users SET dev_access = true WHERE role = 'admin';",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE users DROP COLUMN IF EXISTS dev_access;")
            .await?;
        Ok(())
    }
}

/// Channel categories and public visibility: channels are top-level, organized in
/// the sidebar by user-created categories.
pub struct ChannelCategories;

impl MigrationName for ChannelCategories {
    fn name(&self) -> &str {
        "m20261124_000001_channel_categories"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for ChannelCategories {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "CREATE TABLE IF NOT EXISTS channel_categories (\
                    id TEXT PRIMARY KEY,\
                    name TEXT NOT NULL,\
                    position BIGINT NOT NULL DEFAULT 0,\
                    created_at BIGINT NOT NULL,\
                    updated_at BIGINT NOT NULL\
                 );\
                 ALTER TABLE rooms ADD COLUMN IF NOT EXISTS category_id TEXT REFERENCES channel_categories(id) ON DELETE SET NULL;\
                 ALTER TABLE rooms ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'private';",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE rooms DROP COLUMN IF EXISTS visibility;\
                 ALTER TABLE rooms DROP COLUMN IF EXISTS category_id;\
                 DROP TABLE IF EXISTS channel_categories;",
            )
            .await?;
        Ok(())
    }
}

pub struct RoomRepos;

impl MigrationName for RoomRepos {
    fn name(&self) -> &str {
        "m20261123_000003_room_repos"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for RoomRepos {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE rooms ADD COLUMN IF NOT EXISTS repos TEXT NOT NULL DEFAULT '[]';",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared("ALTER TABLE rooms DROP COLUMN IF EXISTS repos;")
            .await?;
        Ok(())
    }
}

/// Email is the login identity in the first-run flow. The admin created by the
/// installer has no email until the first person claims it.
pub struct UserEmail;

impl MigrationName for UserEmail {
    fn name(&self) -> &str {
        "m20261123_000002_user_email"
    }
}

#[async_trait::async_trait]
impl MigrationTrait for UserEmail {
    async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "ALTER TABLE users ADD COLUMN IF NOT EXISTS email TEXT;\
                 CREATE UNIQUE INDEX IF NOT EXISTS users_email_unique ON users(email) WHERE email IS NOT NULL;",
            )
            .await?;
        Ok(())
    }

    async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
        manager
            .get_connection()
            .execute_unprepared(
                "DROP INDEX IF EXISTS users_email_unique;\
                 ALTER TABLE users DROP COLUMN IF EXISTS email;",
            )
            .await?;
        Ok(())
    }
}
