use crate::errors::AppError;
use crate::errors::AppResult;
use crate::model::Invite;
use crate::model::Session;
use crate::model::User;
use crate::platform::store::map_not_found;
use crate::platform::store::now;
use crate::platform::store::Store;
use chrono::DateTime;
use chrono::Utc;

impl Store {
    pub async fn user_count(&self) -> AppResult<i64> {
        Ok(sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&self.pool)
            .await?)
    }

    pub async fn create_user(
        &self,
        username: &str,
        password_hash: &str,
        role: &str,
        display_name: &str,
    ) -> AppResult<User> {
        let created = now();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, password_hash, created_at, role, display_name, dev_access)
             VALUES ($1, $2, $3, $4, $5, $6) RETURNING id",
        )
        .bind(username)
        .bind(password_hash)
        .bind(&created)
        .bind(role)
        .bind(display_name)
        .bind(role == "admin")
        .fetch_one(&self.pool)
        .await?;
        Ok(User {
            id,
            username: username.to_string(),
            password_hash: password_hash.to_string(),
            created_at: created,
            role: role.to_string(),
            display_name: display_name.to_string(),
            activity: String::new(),
            dev_access: role == "admin",
            onboarded_at: None,
        })
    }

    pub async fn user_by_username(&self, username: &str) -> AppResult<User> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, password_hash, created_at, role, display_name, activity, dev_access, onboarded_at
             FROM users WHERE username = $1",
        )
        .bind(username)
        .fetch_one(&self.pool)
        .await
        .map_err(map_not_found)
    }

    pub async fn user_by_email(&self, email: &str) -> AppResult<User> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, password_hash, created_at, role, display_name, activity, dev_access, onboarded_at
             FROM users WHERE email = $1",
        )
        .bind(email)
        .fetch_one(&self.pool)
        .await
        .map_err(map_not_found)
    }

    pub async fn user_email(&self, id: i64) -> AppResult<Option<String>> {
        Ok(sqlx::query_scalar("SELECT email FROM users WHERE id = $1")
            .bind(id)
            .fetch_one(&self.pool)
            .await?)
    }

    /// Removes the installer-created `admin` from old versions when it was
    /// never claimed. The first registration then creates the admin normally,
    /// and an instance upgraded from the password era has no password to know.
    pub async fn remove_legacy_admin(&self) -> AppResult<()> {
        if self.user_count().await? != 1 {
            return Ok(());
        }
        let user = match self.list_users().await?.into_iter().next() {
            Some(user) => user,
            None => return Ok(()),
        };
        if user.username != "admin" || user.role != "admin" {
            return Ok(());
        }
        if self
            .user_email(user.id)
            .await?
            .is_some_and(|email| !email.trim().is_empty())
        {
            return Ok(());
        }
        if self.setting("onboarding.done").await.unwrap_or_default() == "1" {
            return Ok(());
        }
        self.delete_user(user.id).await?;
        Ok(())
    }

    pub async fn set_user_email(&self, id: i64, email: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET email = $1 WHERE id = $2")
            .bind(email)
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
        Ok(())
    }

    pub async fn set_user_password(&self, id: i64, password_hash: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET password_hash = $1 WHERE id = $2")
            .bind(password_hash)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_user_display_name(&self, id: i64, name: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET display_name = $1 WHERE id = $2")
            .bind(name)
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_email_user(
        &self,
        email: &str,
        role: &str,
        display_name: &str,
        password_hash: &str,
    ) -> AppResult<User> {
        let created = now();
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO users (username, email, password_hash, created_at, role, display_name, dev_access)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id",
        )
        .bind(email)
        .bind(email)
        .bind(password_hash)
        .bind(&created)
        .bind(role)
        .bind(display_name)
        .bind(role == "admin")
        .fetch_one(&self.pool)
        .await?;
        Ok(User {
            id,
            username: email.to_string(),
            password_hash: password_hash.to_string(),
            created_at: created,
            role: role.to_string(),
            display_name: display_name.to_string(),
            activity: String::new(),
            dev_access: role == "admin",
            onboarded_at: None,
        })
    }

    pub async fn user_by_id(&self, id: i64) -> AppResult<User> {
        sqlx::query_as::<_, User>(
            "SELECT id, username, password_hash, created_at, role, display_name, activity, dev_access, onboarded_at
             FROM users WHERE id = $1",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_not_found)
    }

    pub async fn list_users(&self) -> AppResult<Vec<User>> {
        Ok(sqlx::query_as::<_, User>(
            "SELECT id, username, password_hash, created_at, role, display_name, activity, dev_access, onboarded_at
             FROM users ORDER BY created_at",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn set_user_role(&self, id: i64, role: &str) -> AppResult<()> {
        if !["admin", "member"].contains(&role) {
            return Err(AppError::BadRequest("Papel inválido.".into()));
        }
        let affected = sqlx::query("UPDATE users SET role = $1 WHERE id = $2")
            .bind(role)
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn set_user_dev_access(&self, id: i64, allowed: bool) -> AppResult<()> {
        let affected = sqlx::query("UPDATE users SET dev_access = $1 WHERE id = $2")
            .bind(allowed)
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn delete_user(&self, id: i64) -> AppResult<()> {
        let affected = sqlx::query("DELETE FROM users WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn set_user_onboarded(&self, id: i64, activity: &str) -> AppResult<()> {
        sqlx::query("UPDATE users SET activity = $1, onboarded_at = $2 WHERE id = $3")
            .bind(activity)
            .bind(now())
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn create_invite(&self, created_by: i64, role: &str, days: i64) -> AppResult<Invite> {
        if !["admin", "member"].contains(&role) {
            return Err(AppError::BadRequest("Papel inválido.".into()));
        }
        let id = crate::crypto::new_id();
        let token = crate::crypto::new_id();
        let created = now();
        let expires = (Utc::now() + chrono::Duration::days(days.clamp(1, 90))).to_rfc3339();
        sqlx::query(
            "INSERT INTO invites(id, token, role, created_by, created_at, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6)",
        )
        .bind(&id)
        .bind(&token)
        .bind(role)
        .bind(created_by)
        .bind(&created)
        .bind(&expires)
        .execute(&self.pool)
        .await?;
        Ok(Invite {
            id,
            token,
            role: role.to_string(),
            created_by,
            created_at: created,
            expires_at: expires,
            used_at: None,
            used_by: None,
        })
    }

    pub async fn invites(&self) -> AppResult<Vec<Invite>> {
        Ok(sqlx::query_as::<_, Invite>(
            "SELECT id, token, role, created_by, created_at, expires_at, used_at, used_by
             FROM invites ORDER BY created_at DESC LIMIT 100",
        )
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn invite_by_token(&self, token: &str) -> AppResult<Invite> {
        sqlx::query_as::<_, Invite>(
            "SELECT id, token, role, created_by, created_at, expires_at, used_at, used_by
             FROM invites WHERE token = $1",
        )
        .bind(token)
        .fetch_one(&self.pool)
        .await
        .map_err(map_not_found)
    }

    pub async fn revoke_invite(&self, id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM invites WHERE id = $1")
            .bind(id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    /// The invite is consumed in the same transaction that creates the user,
    /// so a retried accept cannot create two accounts.
    pub async fn accept_invite(
        &self,
        token: &str,
        username: &str,
        password_hash: &str,
        display_name: &str,
    ) -> AppResult<User> {
        let now_text = now();
        let mut tx = self.pool.begin().await?;
        let invite = sqlx::query_as::<_, Invite>(
            "SELECT id, token, role, created_by, created_at, expires_at, used_at, used_by
             FROM invites WHERE token = $1 AND used_at IS NULL AND expires_at > $2",
        )
        .bind(token)
        .bind(&now_text)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or(AppError::NotFound)?;
        let created = now();
        let user_id: i64 = sqlx::query_scalar(
            "INSERT INTO users(username, password_hash, created_at, role, display_name)
             VALUES ($1, $2, $3, $4, $5) RETURNING id",
        )
        .bind(username)
        .bind(password_hash)
        .bind(&created)
        .bind(&invite.role)
        .bind(display_name)
        .fetch_one(&mut *tx)
        .await
        .map_err(|error| {
            if crate::platform::store::is_unique(&error) {
                AppError::Conflict
            } else {
                AppError::Database(error)
            }
        })?;
        sqlx::query("UPDATE invites SET used_at = $1, used_by = $2 WHERE id = $3")
            .bind(&now_text)
            .bind(user_id)
            .bind(&invite.id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        self.user_by_id(user_id).await
    }

    pub async fn add_project_member(&self, project_id: &str, user_id: i64) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO project_members(project_id, user_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING",
        )
        .bind(project_id)
        .bind(user_id)
        .bind(now())
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn remove_project_member(&self, project_id: &str, user_id: i64) -> AppResult<()> {
        sqlx::query("DELETE FROM project_members WHERE project_id = $1 AND user_id = $2")
            .bind(project_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn project_members(&self, project_id: &str) -> AppResult<Vec<User>> {
        Ok(sqlx::query_as::<_, User>(
            "SELECT u.id, u.username, u.password_hash, u.created_at, u.role, u.display_name,
                    u.activity, u.dev_access, u.onboarded_at
             FROM project_members m JOIN users u ON u.id = m.user_id
             WHERE m.project_id = $1 ORDER BY u.username",
        )
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?)
    }

    pub async fn user_can_see_project(
        &self,
        user_id: i64,
        is_admin: bool,
        project_id: &str,
    ) -> AppResult<bool> {
        if is_admin {
            return Ok(true);
        }
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM project_members WHERE project_id = $1 AND user_id = $2",
        )
        .bind(project_id)
        .bind(user_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub async fn create_session(
        &self,
        id: &str,
        user_id: i64,
        token_hash: &str,
        kind: &str,
        expires_at: DateTime<Utc>,
    ) -> AppResult<Session> {
        let created = now();
        let expiry = expires_at.to_rfc3339();
        sqlx::query(
            "INSERT INTO sessions (id, user_id, token_hash, kind, created_at, expires_at, last_seen_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7)",
        )
        .bind(id)
        .bind(user_id)
        .bind(token_hash)
        .bind(kind)
        .bind(&created)
        .bind(&expiry)
        .bind(&created)
        .execute(&self.pool)
        .await?;
        Ok(Session {
            id: id.to_string(),
            user_id,
            kind: kind.to_string(),
            created_at: created.clone(),
            expires_at: expiry,
            last_seen_at: created,
        })
    }

    pub async fn session_by_token_hash(&self, token_hash: &str) -> AppResult<(Session, User)> {
        let row = sqlx::query(
            "SELECT s.id, s.user_id, s.kind, s.created_at, s.expires_at, s.last_seen_at,
                    u.id AS user_id_value, u.username, u.password_hash, u.created_at AS user_created_at,
                    u.role AS user_role, u.display_name AS user_display_name,
                    u.activity AS user_activity, u.dev_access AS user_dev_access,
                    u.onboarded_at AS user_onboarded_at
             FROM sessions s JOIN users u ON u.id = s.user_id
             WHERE s.token_hash = $1",
        )
        .bind(token_hash)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;

        let session = Session {
            id: row.try_get("id")?,
            user_id: row.try_get("user_id")?,
            kind: row.try_get("kind")?,
            created_at: row.try_get("created_at")?,
            expires_at: row.try_get("expires_at")?,
            last_seen_at: row.try_get("last_seen_at")?,
        };
        let expires = DateTime::parse_from_rfc3339(&session.expires_at)
            .map_err(|_| AppError::NotFound)?
            .with_timezone(&Utc);
        if Utc::now() > expires {
            return Err(AppError::NotFound);
        }
        let user = User {
            id: row.try_get("user_id_value")?,
            username: row.try_get("username")?,
            password_hash: row.try_get("password_hash")?,
            created_at: row.try_get("user_created_at")?,
            role: row.try_get("user_role")?,
            display_name: row.try_get("user_display_name")?,
            activity: row.try_get("user_activity")?,
            dev_access: row.try_get("user_dev_access")?,
            onboarded_at: row.try_get("user_onboarded_at")?,
        };
        Ok((session, user))
    }

    pub async fn touch_session(&self, session_id: &str) -> AppResult<()> {
        sqlx::query("UPDATE sessions SET last_seen_at = $1 WHERE id = $2")
            .bind(now())
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn session_ids_for_user(&self, user_id: i64) -> AppResult<Vec<String>> {
        Ok(
            sqlx::query_scalar("SELECT id FROM sessions WHERE user_id = $1")
                .bind(user_id)
                .fetch_all(&self.pool)
                .await?,
        )
    }

    pub async fn delete_session(&self, session_id: &str) -> AppResult<()> {
        sqlx::query("DELETE FROM sessions WHERE id = $1")
            .bind(session_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}
use sqlx::Row;
