use crate::errors::AppError;
use crate::errors::AppResult;
use crate::model::Project;
use crate::platform::store::is_unique;
use crate::platform::store::map_not_found;
use crate::platform::store::now;
use crate::platform::store::Store;

/// Old brand accents stay in rows created before the rebrand. Reads return the
/// current blue so avatars and project marks never flash the retired amber/red.
fn current_brand_color(color: String) -> String {
    match color.trim().to_ascii_uppercase().as_str() {
        "#FFB547" | "#F01F31" | "#FF5C69" | "#FF98A1" | "#0F766E" | "#14B8A6" | "#5EEAD4" => {
            "#0063D1".into()
        }
        _ => color,
    }
}

impl Store {
    pub async fn list_projects(&self) -> AppResult<Vec<Project>> {
        let rows = sqlx::query_as::<_, Project>(
            "SELECT id, name, root, color, created_at, updated_at FROM projects ORDER BY name",
        )
        .fetch_all(&self.pool)
        .await?;
        Ok(rows
            .into_iter()
            .map(|project| Project {
                color: current_brand_color(project.color),
                ..project
            })
            .collect())
    }

    pub async fn project(&self, id: &str) -> AppResult<Project> {
        let mut project = sqlx::query_as::<_, Project>(
            "SELECT id, name, root, color, created_at, updated_at FROM projects WHERE id = ?",
        )
        .bind(id)
        .fetch_one(&self.pool)
        .await
        .map_err(map_not_found)?;
        project.color = current_brand_color(project.color);
        Ok(project)
    }

    pub async fn project_by_root(&self, root: &str) -> AppResult<Project> {
        let mut project = sqlx::query_as::<_, Project>(
            "SELECT id, name, root, color, created_at, updated_at FROM projects WHERE root = ?",
        )
        .bind(root)
        .fetch_one(&self.pool)
        .await
        .map_err(map_not_found)?;
        project.color = current_brand_color(project.color);
        Ok(project)
    }

    pub async fn create_project(&self, project: Project) -> AppResult<Project> {
        let project = Project {
            color: current_brand_color(project.color),
            ..project
        };
        let created = now();
        let result = sqlx::query(
            "INSERT INTO projects (id, name, root, color, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(&project.id)
        .bind(&project.name)
        .bind(&project.root)
        .bind(&project.color)
        .bind(&created)
        .bind(&created)
        .execute(&self.pool)
        .await;
        match result {
            Ok(_) => Ok(Project {
                created_at: created.clone(),
                updated_at: created,
                ..project
            }),
            Err(error) if is_unique(&error) => Err(AppError::Conflict),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn update_project(&self, project: Project) -> AppResult<Project> {
        let project = Project {
            color: current_brand_color(project.color),
            ..project
        };
        let updated = now();
        let result = sqlx::query(
            "UPDATE projects SET name = ?, root = ?, color = ?, updated_at = ? WHERE id = ?",
        )
        .bind(&project.name)
        .bind(&project.root)
        .bind(&project.color)
        .bind(&updated)
        .bind(&project.id)
        .execute(&self.pool)
        .await;
        match result {
            Ok(result) if result.rows_affected() == 0 => Err(AppError::NotFound),
            Ok(_) => Ok(Project {
                updated_at: updated,
                ..project
            }),
            Err(error) if is_unique(&error) => Err(AppError::Conflict),
            Err(error) => Err(error.into()),
        }
    }

    pub async fn delete_project(&self, id: &str) -> AppResult<()> {
        let result = sqlx::query("DELETE FROM projects WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await?;
        if result.rows_affected() == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }
}
