//! Managed skills: recipes available in every project. The row keeps the
//! project it was created in as its origin only; lookups never filter by
//! project, so switching projects never hides a skill. The full body never goes into the prompt: the agent reads it on demand with
//! `jeff_read_skill`, and proposes new ones with `jeff_propose_skill` for the
//! user to approve.

use super::models::now;
use crate::{
    crypto::new_id,
    errors::{bad_request, AppError, AppResult},
    store::Store,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sqlx::Row;

/// A recipe is read on demand, so it can be larger than a prompt section.
/// This is still a ceiling: the tool result has to fit in the model context.
pub const MAX_BODY_CHARS: usize = 100_000;
/// One agent cannot flood the review screen with proposals.
pub const MAX_PENDING: i64 = 5;
const MAX_NAME_CHARS: usize = 48;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSkill {
    pub id: String,
    /// Where the skill was created. It is not a visibility scope.
    pub project_id: String,
    pub name: String,
    pub description: String,
    pub body: String,
    /// Legacy assignment list. Skills are global now; kept for stored data.
    pub agents: Vec<String>,
    /// active, pending or archived.
    pub state: String,
    /// A pending change points at the active skill it would replace.
    pub replaces: Option<String>,
    pub proposed_by: Option<String>,
    pub reason: Option<String>,
    /// Set for a skill linked to a SKILL.md file outside the database.
    pub source: Option<String>,
    #[serde(default)]
    pub origin: String,
    #[serde(default)]
    pub icon: String,
    #[serde(default)]
    pub builtin: bool,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSkillVersion {
    pub id: i64,
    pub skill_id: String,
    pub name: String,
    pub description: String,
    pub body: String,
    /// "me" or the agent id whose proposal changed it.
    pub by: String,
    pub at: i64,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ManagedSkillInput {
    pub id: Option<String>,
    pub name: String,
    pub description: String,
    pub body: String,
    #[serde(default)]
    pub agents: Vec<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProposalInput {
    pub name: String,
    pub description: String,
    pub body: String,
    #[serde(default)]
    pub reason: String,
}

#[derive(Clone)]
pub struct Service(pub Store);

impl Service {
    pub fn new(store: Store) -> Self {
        Self(store)
    }

    fn row(row: &sqlx::sqlite::SqliteRow) -> AppResult<ManagedSkill> {
        let agents: String = row.get("agents");
        Ok(ManagedSkill {
            id: row.get("id"),
            project_id: row.get("project_id"),
            name: row.get("name"),
            description: row.get("description"),
            body: row.get("body"),
            agents: serde_json::from_str(&agents).unwrap_or_default(),
            state: row.get("state"),
            replaces: row.get("replaces"),
            proposed_by: row.get("proposed_by"),
            reason: row.get("reason"),
            source: row.get("source"),
            origin: if row.get::<Option<String>, _>("source").is_some() {
                "linked".into()
            } else {
                "user".into()
            },
            icon: "book".into(),
            builtin: false,
            created_at: row.get("created_at"),
            updated_at: row.get("updated_at"),
        })
    }

    fn builtin_records() -> Vec<ManagedSkill> {
        [
            ("browser", "Navegador", "globe"),
            ("terminal", "Terminal", "terminal"),
        ]
        .into_iter()
        .filter_map(|(id, name, icon)| {
            let (_, description, body) = super::skills::builtin_recipe(id)?;
            Some(ManagedSkill {
                id: id.to_string(),
                project_id: String::new(),
                name: name.to_string(),
                description,
                body,
                agents: Vec::new(),
                state: "active".into(),
                replaces: None,
                proposed_by: None,
                reason: None,
                source: None,
                origin: "integrated".into(),
                icon: icon.into(),
                builtin: true,
                created_at: 0,
                updated_at: 0,
            })
        })
        .collect()
    }

    fn builtin(id: &str) -> Option<ManagedSkill> {
        Self::builtin_records()
            .into_iter()
            .find(|skill| skill.id.eq_ignore_ascii_case(id) || skill.name.eq_ignore_ascii_case(id))
    }

    fn reserved(name: &str) -> bool {
        Self::builtin_records().iter().any(|skill| {
            skill.id.eq_ignore_ascii_case(name) || skill.name.eq_ignore_ascii_case(name)
        })
    }

    /// Every skill, across all projects, in stable name order.
    pub async fn list(&self) -> AppResult<Vec<ManagedSkill>> {
        let rows = sqlx::query(
            "SELECT id,project_id,name,description,body,agents,state,replaces,proposed_by,reason,source,created_at,updated_at \
             FROM agent_skills ORDER BY name",
        )
        .fetch_all(self.0.pool())
        .await?;
        let mut skills: Vec<ManagedSkill> = rows
            .iter()
            .map(Self::row)
            .collect::<AppResult<Vec<_>>>()?
            .into_iter()
            .filter(|skill| !Self::reserved(&skill.id) && !Self::reserved(&skill.name))
            .collect();
        skills.extend(Self::builtin_records());
        skills.sort_by(|left, right| left.name.cmp(&right.name));
        Ok(skills)
    }

    pub async fn get(&self, id: &str) -> AppResult<ManagedSkill> {
        if let Some(skill) = Self::builtin(id) {
            return Ok(skill);
        }
        let row = sqlx::query(
            "SELECT id,project_id,name,description,body,agents,state,replaces,proposed_by,reason,source,created_at,updated_at \
             FROM agent_skills WHERE id=$1",
        )
        .bind(id)
        .fetch_optional(self.0.pool())
        .await?
        .ok_or(AppError::NotFound)?;
        Self::row(&row)
    }

    async fn active_by_name(&self, name: &str) -> AppResult<Option<ManagedSkill>> {
        let row = sqlx::query(
            "SELECT id,project_id,name,description,body,agents,state,replaces,proposed_by,reason,source,created_at,updated_at \
             FROM agent_skills WHERE state='active' AND name=$1",
        )
        .bind(name)
        .fetch_optional(self.0.pool())
        .await?;
        row.as_ref().map(Self::row).transpose()
    }

    /// Active skills available to every Jeff, in stable name order.
    pub async fn available(&self) -> AppResult<Vec<ManagedSkill>> {
        Ok(self
            .list()
            .await?
            .into_iter()
            .filter(|skill| skill.state == "active")
            .collect())
    }

    /// The managed skill with this name or id, when it is active.
    pub async fn read(&self, name: &str) -> AppResult<Option<ManagedSkill>> {
        Ok(self.available().await?.into_iter().find(|skill| {
            skill.name.eq_ignore_ascii_case(name) || skill.id.eq_ignore_ascii_case(name)
        }))
    }

    async fn keep(&self, skill: &ManagedSkill, by: &str) -> AppResult<()> {
        sqlx::query(
            "INSERT INTO agent_skill_versions(skill_id,name,description,body,by,at) VALUES($1,$2,$3,$4,$5,$6)",
        )
        .bind(&skill.id)
        .bind(&skill.name)
        .bind(&skill.description)
        .bind(&skill.body)
        .bind(by)
        .bind(now())
        .execute(self.0.pool())
        .await?;
        Ok(())
    }

    fn validated(input: &ManagedSkillInput) -> AppResult<(String, String, String, Vec<String>)> {
        let name = normalize_name(&input.name)?;
        if Self::reserved(&name) {
            return Err(bad_request(
                "Browser e Terminal são skills integradas e não podem ser propostas.",
            ));
        }
        let description = input.description.trim().to_string();
        let body = input.body.trim().to_string();
        if description.is_empty() {
            return Err(bad_request("Diga quando usar a skill."));
        }
        if body.is_empty() {
            return Err(bad_request("Escreva a receita da skill."));
        }
        if body.chars().count() > MAX_BODY_CHARS {
            return Err(bad_request(format!(
                "A receita passou de {MAX_BODY_CHARS} caracteres."
            )));
        }
        Ok((name, description, body, unique(&input.agents)))
    }

    /// Creates or edits a skill from the Skills screen. Editing keeps the old
    /// version, so every change can be undone.
    pub async fn save(&self, project: &str, input: ManagedSkillInput) -> AppResult<ManagedSkill> {
        let (name, description, body, agents) = Self::validated(&input)?;
        if input.id.as_deref().is_some_and(Self::reserved) || Self::reserved(&name) {
            return Err(bad_request(
                "Browser e Terminal são skills integradas e não podem ser alteradas.",
            ));
        }
        let at = now();
        if let Some(id) = input.id.as_deref() {
            let previous = self.get(id).await?;
            if previous.source.is_some() {
                sqlx::query("UPDATE agent_skills SET agents=$1,updated_at=$2 WHERE id=$3")
                    .bind(json!(agents).to_string())
                    .bind(at)
                    .bind(id)
                    .execute(self.0.pool())
                    .await?;
                return self.get(id).await;
            }
            if previous.state == "active"
                && (previous.name != name
                    || previous.description != description
                    || previous.body != body)
            {
                self.keep(&previous, "me").await?;
            }
            if previous.name != name {
                if self.active_by_name(&name).await?.is_some() {
                    return Err(bad_request("Já existe uma skill ativa com esse nome."));
                }
            }
            sqlx::query(
                "UPDATE agent_skills SET name=$1,description=$2,body=$3,agents=$4,state='active',replaces=NULL,proposed_by=NULL,reason=NULL,updated_at=$5 \
                 WHERE id=$6",
            )
            .bind(&name)
            .bind(&description)
            .bind(&body)
            .bind(json!(agents).to_string())
            .bind(at)
            .bind(id)
            .execute(self.0.pool())
            .await?;
            return self.get(id).await;
        }
        if self.active_by_name(&name).await?.is_some() {
            return Err(bad_request("Já existe uma skill ativa com esse nome."));
        }
        let id = new_id();
        sqlx::query(
            "INSERT INTO agent_skills(id,project_id,name,description,body,agents,state,source,created_at,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9)",
        )
        .bind(&id)
        .bind(project)
        .bind(&name)
        .bind(&description)
        .bind(&body)
        .bind(json!(agents).to_string())
        .bind(input.source.as_deref())
        .bind(at)
        .bind(at)
        .execute(self.0.pool())
        .await?;
        self.get(&id).await
    }

    /// Links a `SKILL.md` that already exists on the machine. The recipe is
    /// read from the file on every use, so an edit in Claude Code, Codex or
    /// OpenCode applies to the next read; the database keeps the agent list.
    pub async fn link(
        &self,
        project: &str,
        root: &std::path::Path,
        source: &str,
        agents: Vec<String>,
    ) -> AppResult<ManagedSkill> {
        let found = super::skills::find_local(root, source).ok_or(AppError::NotFound)?;
        let canonical = std::fs::canonicalize(&found.source).map_err(|_| AppError::NotFound)?;
        let canonical = canonical.display().to_string();
        let agents = unique(&agents);
        if let Some(existing) = self
            .list()
            .await?
            .into_iter()
            .find(|skill| skill.source.as_deref() == Some(canonical.as_str()))
        {
            sqlx::query(
                "UPDATE agent_skills SET agents=$1,state='active',updated_at=$2 WHERE id=$3",
            )
            .bind(json!(agents).to_string())
            .bind(now())
            .bind(&existing.id)
            .execute(self.0.pool())
            .await?;
            return self.get(&existing.id).await;
        }
        let name = normalize_name(&found.name)?;
        if Self::reserved(&name) {
            return Err(bad_request(
                "Browser e Terminal são skills integradas e não podem ser duplicadas.",
            ));
        }
        if self.active_by_name(&name).await?.is_some() {
            return Err(bad_request(
                "Já existe uma skill ativa com esse nome. Renomeie uma das duas.",
            ));
        }
        let description = if found.description.trim().is_empty() {
            format!("Skill de {}", found.origin)
        } else {
            found.description.clone()
        };
        let body = super::skills::read_local(&canonical, None)?;
        let at = now();
        let id = new_id();
        sqlx::query(
            "INSERT INTO agent_skills(id,project_id,name,description,body,agents,state,source,created_at,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9)",
        )
        .bind(&id)
        .bind(project)
        .bind(&name)
        .bind(&description)
        .bind(&body)
        .bind(json!(agents).to_string())
        .bind(&canonical)
        .bind(at)
        .bind(at)
        .execute(self.0.pool())
        .await?;
        self.get(&id).await
    }

    /// Migrates a skill enabled through the old per-agent project list into a
    /// managed skill. It is idempotent: an existing skill with the same name
    /// only gains the agent, so the old toggle keeps working and shows up in
    /// the Skills screen.
    pub async fn ensure_legacy(
        &self,
        project: &str,
        agent: &str,
        name: &str,
        description: &str,
        body: &str,
        source: Option<&str>,
    ) -> AppResult<()> {
        let name = normalize_name(name)?;
        if let Some(existing) = self.active_by_name(&name).await? {
            let same_source = match (existing.source.as_deref(), source) {
                (None, None) => true,
                (Some(left), Some(right)) => left == right,
                _ => false,
            };
            if !same_source {
                return Ok(());
            }
            if existing.agents.is_empty() || existing.agents.iter().any(|id| id == agent) {
                return Ok(());
            }
            let mut agents = existing.agents.clone();
            agents.push(agent.to_string());
            sqlx::query(
                "UPDATE agent_skills SET agents=$1,state='active',updated_at=$2 WHERE id=$3",
            )
            .bind(json!(agents).to_string())
            .bind(now())
            .bind(&existing.id)
            .execute(self.0.pool())
            .await?;
            return Ok(());
        }
        let at = now();
        let id = new_id();
        sqlx::query(
            "INSERT INTO agent_skills(id,project_id,name,description,body,agents,state,source,created_at,updated_at) \
             VALUES($1,$2,$3,$4,$5,$6,'active',$7,$8,$9)",
        )
        .bind(&id)
        .bind(project)
        .bind(&name)
        .bind(description.trim())
        .bind(body.trim())
        .bind(json!([agent]).to_string())
        .bind(source)
        .bind(at)
        .bind(at)
        .execute(self.0.pool())
        .await?;
        Ok(())
    }

    /// `jeff_propose_skill`: an agent proposes a new skill or a change to one
    /// of its own. The proposal only becomes active after the user approves it.
    pub async fn propose(
        &self,
        project: &str,
        agent: &str,
        input: ProposalInput,
    ) -> AppResult<Value> {
        let name = normalize_name(&input.name)?;
        if Self::reserved(&name) {
            return Err(bad_request(
                "Browser e Terminal são skills integradas e não podem ser propostas.",
            ));
        }
        let description = input.description.trim().to_string();
        let body = input.body.trim().to_string();
        let reason = input.reason.trim().to_string();
        if description.is_empty() || body.is_empty() {
            return Err(bad_request("Faltou quando_usar ou receita."));
        }
        if body.chars().count() > MAX_BODY_CHARS {
            return Err(bad_request(format!(
                "A receita passou de {MAX_BODY_CHARS} caracteres."
            )));
        }
        let pending: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM agent_skills WHERE state='pending' AND proposed_by=$1",
        )
        .bind(agent)
        .fetch_one(self.0.pool())
        .await?;
        if pending >= MAX_PENDING {
            return Err(bad_request(format!(
                "Você já tem {MAX_PENDING} propostas esperando revisão. Espere o usuário decidir."
            )));
        }
        let current = self.active_by_name(&name).await?;
        if let Some(current) = &current {
            if current.source.is_some() {
                return Err(bad_request(
                    "Essa skill vem de um arquivo do usuário: ela muda lá, não aqui.",
                ));
            }
            if current.description == description && current.body == body {
                return Ok(json!({"message":"Essa skill já está assim.", "skill":current}));
            }
        }
        let waiting = sqlx::query(
            "SELECT id FROM agent_skills WHERE state='pending' AND proposed_by=$1 AND name=$2",
        )
        .bind(agent)
        .bind(&name)
        .fetch_optional(self.0.pool())
        .await?;
        let at = now();
        let id = if let Some(row) = waiting {
            let id: String = row.get("id");
            sqlx::query(
                "UPDATE agent_skills SET description=$1,body=$2,agents=$3,replaces=$4,reason=$5,updated_at=$6 \
                 WHERE id=$7",
            )
            .bind(&description)
            .bind(&body)
            .bind(json!(current.as_ref().map(|skill| skill.agents.clone()).unwrap_or_else(|| vec![agent.to_string()])).to_string())
            .bind(current.as_ref().map(|skill| skill.id.clone()))
            .bind(if reason.is_empty() { None } else { Some(reason) })
            .bind(at)
            .bind(&id)
            .execute(self.0.pool())
            .await?;
            id
        } else {
            let id = new_id();
            sqlx::query(
                "INSERT INTO agent_skills(id,project_id,name,description,body,agents,state,replaces,proposed_by,reason,created_at,updated_at) \
                 VALUES($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$10,$11)",
            )
            .bind(&id)
            .bind(project)
            .bind(&name)
            .bind(&description)
            .bind(&body)
            .bind(json!(current.as_ref().map(|skill| skill.agents.clone()).unwrap_or_else(|| vec![agent.to_string()])).to_string())
            .bind(current.as_ref().map(|skill| skill.id.clone()))
            .bind(agent)
            .bind(if reason.is_empty() { None } else { Some(reason) })
            .bind(at)
            .bind(at)
            .execute(self.0.pool())
            .await?;
            id
        };
        let skill = self.get(&id).await?;
        Ok(json!({
            "message": "Proposta enviada. Ela só vale depois que o usuário aprovar, na tela de Skills.",
            "skill": skill
        }))
    }

    /// The user approves or refuses a pending proposal.
    pub async fn decide(&self, id: &str, approve: bool) -> AppResult<Option<ManagedSkill>> {
        if Self::builtin(id).is_some() {
            return Err(bad_request("Browser e Terminal são skills integradas."));
        }
        let pending = self.get(id).await?;
        if pending.state != "pending" {
            return Err(AppError::NotFound);
        }
        if !approve {
            self.remove(id).await?;
            return Ok(None);
        }
        if let Some(target_id) = pending.replaces.as_deref() {
            let target = self.get(target_id).await?;
            if target.state == "active" {
                self.keep(&target, pending.proposed_by.as_deref().unwrap_or("me"))
                    .await?;
                sqlx::query(
                    "UPDATE agent_skills SET description=$1,body=$2,updated_at=$3 WHERE id=$4",
                )
                .bind(&pending.description)
                .bind(&pending.body)
                .bind(now())
                .bind(target_id)
                .execute(self.0.pool())
                .await?;
                self.remove(id).await?;
                return Ok(Some(self.get(target_id).await?));
            }
        }
        if self.active_by_name(&pending.name).await?.is_some() {
            return Err(bad_request("Já existe uma skill ativa com esse nome."));
        }
        sqlx::query(
            "UPDATE agent_skills SET state='active',replaces=NULL,proposed_by=NULL,reason=NULL,updated_at=$1 \
             WHERE id=$2",
        )
        .bind(now())
        .bind(id)
        .execute(self.0.pool())
        .await?;
        Ok(Some(self.get(id).await?))
    }

    pub async fn versions(&self, id: &str) -> AppResult<Vec<ManagedSkillVersion>> {
        if Self::builtin(id).is_some() {
            return Ok(Vec::new());
        }
        self.get(id).await?;
        let rows = sqlx::query(
            "SELECT id,skill_id,name,description,body,by,at FROM agent_skill_versions WHERE skill_id=$1 ORDER BY at DESC,id DESC",
        )
        .bind(id)
        .fetch_all(self.0.pool())
        .await?;
        Ok(rows
            .iter()
            .map(|row| ManagedSkillVersion {
                id: row.get("id"),
                skill_id: row.get("skill_id"),
                name: row.get("name"),
                description: row.get("description"),
                body: row.get("body"),
                by: row.get("by"),
                at: row.get("at"),
            })
            .collect())
    }

    /// Restores a previous version. The current one is kept too, so this can
    /// be undone as well.
    pub async fn restore(&self, id: &str, version_id: i64) -> AppResult<ManagedSkill> {
        if Self::builtin(id).is_some() {
            return Err(bad_request(
                "Browser e Terminal são skills integradas e não têm versões.",
            ));
        }
        let current = self.get(id).await?;
        let version = sqlx::query(
            "SELECT name,description,body FROM agent_skill_versions WHERE id=$1 AND skill_id=$2",
        )
        .bind(version_id)
        .bind(id)
        .fetch_optional(self.0.pool())
        .await?
        .ok_or(AppError::NotFound)?;
        let name: String = version.get("name");
        let name = if name != current.name && self.active_by_name(&name).await?.is_some() {
            current.name.clone()
        } else {
            name
        };
        self.keep(&current, "me").await?;
        sqlx::query(
            "UPDATE agent_skills SET name=$1,description=$2,body=$3,updated_at=$4 WHERE id=$5",
        )
        .bind(&name)
        .bind(version.get::<String, _>("description"))
        .bind(version.get::<String, _>("body"))
        .bind(now())
        .bind(id)
        .execute(self.0.pool())
        .await?;
        self.get(id).await
    }

    pub async fn archive(&self, id: &str, archived: bool) -> AppResult<ManagedSkill> {
        if Self::builtin(id).is_some() {
            return Err(bad_request(
                "Browser e Terminal são skills integradas e não podem ser arquivadas.",
            ));
        }
        let skill = self.get(id).await?;
        if skill.state == "pending" {
            return Err(AppError::NotFound);
        }
        if !archived && self.active_by_name(&skill.name).await?.is_some() {
            return Err(bad_request("Já existe uma skill ativa com esse nome."));
        }
        sqlx::query("UPDATE agent_skills SET state=$1,updated_at=$2 WHERE id=$3")
            .bind(if archived { "archived" } else { "active" })
            .bind(now())
            .bind(id)
            .execute(self.0.pool())
            .await?;
        self.get(id).await
    }

    pub async fn remove(&self, id: &str) -> AppResult<()> {
        if Self::builtin(id).is_some() {
            return Err(bad_request(
                "Browser e Terminal são skills integradas e não podem ser apagadas.",
            ));
        }
        self.get(id).await?;
        sqlx::query("DELETE FROM agent_skill_versions WHERE skill_id=$1")
            .bind(id)
            .execute(self.0.pool())
            .await?;
        sqlx::query("DELETE FROM agent_skills WHERE id=$1")
            .bind(id)
            .execute(self.0.pool())
            .await?;
        Ok(())
    }
}

/// Names become short, unique handles ("testes do core" -> "testes-do-core").
pub fn normalize_name(raw: &str) -> AppResult<String> {
    let name: String = raw
        .trim()
        .to_lowercase()
        .chars()
        .map(|c| match c {
            'a'..='z' | '0'..='9' | '-' | '_' => c,
            'á' | 'à' | 'â' | 'ã' | 'ä' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'í' | 'ì' | 'î' | 'ï' => 'i',
            'ó' | 'ò' | 'ô' | 'õ' | 'ö' => 'o',
            'ú' | 'ù' | 'û' | 'ü' => 'u',
            'ç' => 'c',
            _ => '-',
        })
        .collect();
    let name = name
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(MAX_NAME_CHARS)
        .collect::<String>();
    if name.is_empty() {
        return Err(bad_request("Dê um nome para a skill."));
    }
    Ok(name)
}

fn unique(ids: &[String]) -> Vec<String> {
    let mut out = Vec::new();
    for id in ids {
        let id = id.trim();
        if !id.is_empty() && !out.iter().any(|seen| seen == id) {
            out.push(id.to_string());
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_become_stable_slugs() {
        assert_eq!(normalize_name("Testes do Core").unwrap(), "testes-do-core");
        assert_eq!(
            normalize_name("  Revisão   de código ").unwrap(),
            "revisao-de-codigo"
        );
        assert!(normalize_name("...").is_err());
    }

    #[test]
    fn duplicate_agent_ids_are_removed() {
        assert_eq!(
            unique(&["a".into(), "a".into(), " ".into(), "b".into()]),
            vec!["a".to_string(), "b".to_string()]
        );
    }
}
