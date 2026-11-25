use sqlx::Row;

use crate::errors::{bad_request, AppError, AppResult};
use crate::features::rooms::models::*;
use crate::features::rooms::schedule::Schedule;
use crate::platform::store::Store;

fn routine_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<Routine> {
    let raw: String = row.try_get("trigger_schedule")?;
    let schedule: Schedule = serde_json::from_str(&raw)
        .map_err(|error| bad_request(format!("Agendamento inválido: {error}")))?;
    Ok(Routine {
        id: row.try_get("id")?,
        project_id: row.try_get("project_id")?,
        room_id: row.try_get("room_id")?,
        agent_id: row.try_get("agent_id")?,
        name: row.try_get("name")?,
        instruction: row.try_get("instruction")?,
        active: row.try_get::<i64, _>("active")? != 0,
        timezone: row.try_get("timezone")?,
        limit_policy: row.try_get("limit_policy")?,
        missed_policy: row.try_get("missed_policy")?,
        trigger: RoutineTrigger {
            id: row.try_get("trigger_id")?,
            schedule,
            next_run_at: row.try_get("next_run_at")?,
        },
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

fn run_from_row(row: &sqlx::sqlite::SqliteRow) -> AppResult<RoutineRun> {
    Ok(RoutineRun {
        id: row.try_get("id")?,
        routine_id: row.try_get("routine_id")?,
        trigger_id: row.try_get("trigger_id")?,
        agent_id: row.try_get("agent_id")?,
        room_id: row.try_get("room_id")?,
        kind: row.try_get("kind")?,
        source: row.try_get("source")?,
        scheduled_for: row.try_get("scheduled_for")?,
        routine_name: row.try_get("routine_name")?,
        instruction: row.try_get("instruction")?,
        status: row.try_get("status")?,
        error: row.try_get("error")?,
        no_update: row.try_get::<i64, _>("no_update")? != 0,
        delivery_id: row.try_get("delivery_id")?,
        created_at: row.try_get("created_at")?,
        updated_at: row.try_get("updated_at")?,
    })
}

const ROUTINE_SELECT: &str =
    "SELECT r.id,r.project_id,r.room_id,r.agent_id,r.name,r.instruction,r.active,
        r.timezone,r.limit_policy,r.missed_policy,r.created_at,r.updated_at,
        t.id AS trigger_id,t.schedule AS trigger_schedule,t.next_run_at
 FROM routines r JOIN routine_triggers t ON t.routine_id = r.id";

const RUN_SELECT: &str =
    "SELECT id,routine_id,trigger_id,agent_id,room_id,kind,source,scheduled_for,
        routine_name,instruction,status,error,no_update,delivery_id,created_at,updated_at FROM routine_runs";

fn check_policies(limit: &str, missed: &str) -> AppResult<()> {
    if !["wait", "skip"].contains(&limit) {
        return Err(bad_request("limitPolicy deve ser wait ou skip."));
    }
    if !["skip", "run-once"].contains(&missed) {
        return Err(bad_request("missedPolicy deve ser skip ou run-once."));
    }
    Ok(())
}

impl Store {
    pub async fn create_routine(
        &self,
        project_id: &str,
        room_id: &str,
        input: CreateRoutineInput,
    ) -> AppResult<Routine> {
        let name = input.name.trim();
        if name.is_empty() || name.chars().count() > 80 {
            return Err(bad_request(
                "O nome da rotina é obrigatório e vai até 80 caracteres.",
            ));
        }
        let instruction = input.instruction.trim();
        if instruction.is_empty() || instruction.chars().count() > 100_000 {
            return Err(bad_request("A instrução da rotina é obrigatória."));
        }
        let timezone = if input.timezone.trim().is_empty() {
            "UTC".to_string()
        } else {
            input.timezone.trim().to_string()
        };
        input.schedule.validate(&timezone).map_err(bad_request)?;
        let limit_policy = input.limit_policy.unwrap_or_else(|| "wait".into());
        let missed_policy = input.missed_policy.unwrap_or_else(|| "skip".into());
        check_policies(&limit_policy, &missed_policy)?;

        let agent = self.principal(&input.agent_id).await?;
        if agent.kind != "bot" {
            return Err(bad_request("A rotina precisa rodar em um bot."));
        }
        if !self.is_room_member(room_id, &agent.id).await? {
            return Err(bad_request("O bot não é membro da sala."));
        }

        let now = now_ms();
        let next = input
            .schedule
            .next_occurrence(&timezone, now)
            .map_err(bad_request)?;
        let id = crate::crypto::new_id();
        let trigger_id = crate::crypto::new_id();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "INSERT INTO routines(id,project_id,room_id,agent_id,name,instruction,active,timezone,
                    limit_policy,missed_policy,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",
        )
        .bind(&id)
        .bind(project_id)
        .bind(room_id)
        .bind(&agent.id)
        .bind(name)
        .bind(instruction)
        .bind(if input.active { 1 } else { 0 })
        .bind(&timezone)
        .bind(&limit_policy)
        .bind(&missed_policy)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            if crate::platform::store::is_unique(&error) {
                AppError::Conflict
            } else {
                AppError::Database(error)
            }
        })?;
        sqlx::query(
            "INSERT INTO routine_triggers(id,routine_id,schedule,next_run_at,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6)",
        )
        .bind(&trigger_id)
        .bind(&id)
        .bind(serde_json::to_string(&input.schedule)?)
        .bind(if input.active { Some(next) } else { None })
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.routine(project_id, &id).await
    }

    pub async fn routine(&self, project_id: &str, id: &str) -> AppResult<Routine> {
        let row = sqlx::query(&format!(
            "{ROUTINE_SELECT} WHERE r.id = $1 AND r.project_id = $2"
        ))
        .bind(id)
        .bind(project_id)
        .fetch_optional(&self.pool)
        .await?
        .ok_or(AppError::NotFound)?;
        routine_from_row(&row)
    }

    pub async fn routines_for_room(&self, room_id: &str) -> AppResult<Vec<Routine>> {
        let rows = sqlx::query(&format!(
            "{ROUTINE_SELECT} WHERE r.room_id = $1 ORDER BY r.name"
        ))
        .bind(room_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(routine_from_row).collect()
    }

    pub async fn routines_for_agent(&self, agent_id: &str) -> AppResult<Vec<Routine>> {
        let rows = sqlx::query(&format!(
            "{ROUTINE_SELECT} WHERE r.agent_id = $1 ORDER BY r.name"
        ))
        .bind(agent_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(routine_from_row).collect()
    }

    pub async fn routines_for_project(&self, project_id: &str) -> AppResult<Vec<Routine>> {
        let rows = sqlx::query(&format!(
            "{ROUTINE_SELECT} WHERE r.project_id = $1
             ORDER BY (t.next_run_at IS NULL), t.next_run_at, r.name"
        ))
        .bind(project_id)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(routine_from_row).collect()
    }

    pub async fn update_routine(
        &self,
        project_id: &str,
        id: &str,
        input: UpdateRoutineInput,
    ) -> AppResult<Routine> {
        let current = self.routine(project_id, id).await?;
        let name = input
            .name
            .map(|value| value.trim().to_string())
            .unwrap_or(current.name);
        if name.is_empty() || name.chars().count() > 80 {
            return Err(bad_request(
                "O nome da rotina é obrigatório e vai até 80 caracteres.",
            ));
        }
        let instruction = input
            .instruction
            .map(|value| value.trim().to_string())
            .unwrap_or(current.instruction);
        if instruction.is_empty() || instruction.chars().count() > 100_000 {
            return Err(bad_request("A instrução da rotina é obrigatória."));
        }
        let timezone = input
            .timezone
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .unwrap_or(current.timezone.clone());
        let schedule = input.schedule.unwrap_or(current.trigger.schedule.clone());
        schedule.validate(&timezone).map_err(bad_request)?;
        let limit_policy = input.limit_policy.unwrap_or(current.limit_policy.clone());
        let missed_policy = input.missed_policy.unwrap_or(current.missed_policy.clone());
        check_policies(&limit_policy, &missed_policy)?;
        let active = input.active.unwrap_or(current.active);

        let schedule_changed =
            serde_json::to_string(&schedule)? != serde_json::to_string(&current.trigger.schedule)?;
        let next = if !active {
            None
        } else if schedule_changed
            || timezone != current.timezone
            || (active && !current.active)
            || current.trigger.next_run_at.is_none()
        {
            Some(
                schedule
                    .next_occurrence(&timezone, now_ms())
                    .map_err(bad_request)?,
            )
        } else {
            current.trigger.next_run_at
        };

        let now = now_ms();
        let mut tx = self.pool.begin().await?;
        sqlx::query(
            "UPDATE routines SET name=$1,instruction=$2,active=$3,timezone=$4,limit_policy=$5,
                    missed_policy=$6,updated_at=$7 WHERE id=$8 AND project_id=$9",
        )
        .bind(&name)
        .bind(&instruction)
        .bind(if active { 1 } else { 0 })
        .bind(&timezone)
        .bind(&limit_policy)
        .bind(&missed_policy)
        .bind(now)
        .bind(id)
        .bind(project_id)
        .execute(&mut *tx)
        .await?;
        sqlx::query(
            "UPDATE routine_triggers SET schedule=$1,next_run_at=$2,updated_at=$3 WHERE routine_id=$4",
        )
        .bind(serde_json::to_string(&schedule)?)
        .bind(next)
        .bind(now)
        .bind(id)
        .execute(&mut *tx)
        .await?;
        tx.commit().await?;
        self.routine(project_id, id).await
    }

    pub async fn delete_routine(&self, project_id: &str, id: &str) -> AppResult<()> {
        let affected = sqlx::query("DELETE FROM routines WHERE id = $1 AND project_id = $2")
            .bind(id)
            .bind(project_id)
            .execute(&self.pool)
            .await?
            .rows_affected();
        if affected == 0 {
            return Err(AppError::NotFound);
        }
        Ok(())
    }

    pub async fn due_routines(&self, now: i64) -> AppResult<Vec<Routine>> {
        let rows = sqlx::query(&format!(
            "{ROUTINE_SELECT} WHERE r.active = 1 AND t.next_run_at IS NOT NULL AND t.next_run_at <= $1
             ORDER BY t.next_run_at LIMIT 50"
        ))
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(routine_from_row).collect()
    }

    pub async fn advance_routine_trigger(
        &self,
        routine_id: &str,
        trigger_id: &str,
        next: Option<i64>,
    ) -> AppResult<()> {
        sqlx::query("UPDATE routine_triggers SET next_run_at = $1, updated_at = $2 WHERE id = $3 AND routine_id = $4")
            .bind(next)
            .bind(now_ms())
            .bind(trigger_id)
            .bind(routine_id)
            .execute(&self.pool)
            .await?;
        if next.is_none() {
            sqlx::query("UPDATE routines SET active = 0, updated_at = $1 WHERE id = $2")
                .bind(now_ms())
                .bind(routine_id)
                .execute(&self.pool)
                .await?;
        }
        Ok(())
    }

    pub async fn create_routine_run(
        &self,
        routine: &Routine,
        kind: &str,
        source: Option<&str>,
        scheduled_for: i64,
    ) -> AppResult<Option<RoutineRun>> {
        let id = crate::crypto::new_id();
        let now = now_ms();
        let trigger_id = if kind == "scheduled" {
            Some(routine.trigger.id.clone())
        } else {
            None
        };
        let inserted = sqlx::query(
            "INSERT INTO routine_runs
             (id,routine_id,trigger_id,agent_id,room_id,kind,source,scheduled_for,routine_name,
              instruction,status,error,delivery_id,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'queued','',NULL,$11,$12) ON CONFLICT DO NOTHING",
        )
        .bind(&id)
        .bind(&routine.id)
        .bind(&trigger_id)
        .bind(&routine.agent_id)
        .bind(&routine.room_id)
        .bind(kind)
        .bind(source)
        .bind(scheduled_for)
        .bind(&routine.name)
        .bind(&routine.instruction)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?
        .rows_affected();
        if inserted == 0 {
            return Ok(None);
        }
        Ok(Some(self.routine_run(&id).await?))
    }

    pub async fn attach_routine_delivery(&self, run_id: &str, delivery_id: &str) -> AppResult<()> {
        sqlx::query("UPDATE routine_runs SET delivery_id = $1, updated_at = $2 WHERE id = $3")
            .bind(delivery_id)
            .bind(now_ms())
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn finish_routine_run(
        &self,
        delivery_id: &str,
        status: &str,
        error: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE routine_runs SET status = $1, error = $2, updated_at = $3 WHERE delivery_id = $4",
        )
        .bind(status)
        .bind(error)
        .bind(now_ms())
        .bind(delivery_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn routine_run_by_delivery(
        &self,
        delivery_id: &str,
    ) -> AppResult<Option<RoutineRun>> {
        let row = sqlx::query(&format!("{RUN_SELECT} WHERE delivery_id = $1"))
            .bind(delivery_id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(run_from_row).transpose()
    }

    pub async fn set_routine_no_update(&self, run_id: &str) -> AppResult<()> {
        sqlx::query("UPDATE routine_runs SET no_update = 1, updated_at = $1 WHERE id = $2")
            .bind(now_ms())
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    pub async fn set_routine_run_status(
        &self,
        run_id: &str,
        status: &str,
        error: &str,
    ) -> AppResult<()> {
        sqlx::query(
            "UPDATE routine_runs SET status = $1, error = $2, updated_at = $3 WHERE id = $4",
        )
        .bind(status)
        .bind(error)
        .bind(now_ms())
        .bind(run_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    pub async fn routine_run(&self, id: &str) -> AppResult<RoutineRun> {
        let row = sqlx::query(&format!("{RUN_SELECT} WHERE id = $1"))
            .bind(id)
            .fetch_optional(&self.pool)
            .await?
            .ok_or(AppError::NotFound)?;
        run_from_row(&row)
    }

    pub async fn routine_runs(&self, routine_id: &str, limit: i64) -> AppResult<Vec<RoutineRun>> {
        let rows = sqlx::query(&format!(
            "{RUN_SELECT} WHERE routine_id = $1 ORDER BY created_at DESC LIMIT $2"
        ))
        .bind(routine_id)
        .bind(limit.clamp(1, 200))
        .fetch_all(&self.pool)
        .await?;
        rows.iter().map(run_from_row).collect()
    }

    pub async fn has_live_routine_run(&self, routine_id: &str) -> AppResult<bool> {
        let count: i64 = sqlx::query_scalar(
            "SELECT count(*) FROM routine_runs r
             JOIN room_deliveries d ON d.id = r.delivery_id
             WHERE r.routine_id = $1
               AND r.status IN ('queued','running','needs-attention')
               AND d.status IN ('queued','starting','running')",
        )
        .bind(routine_id)
        .fetch_one(&self.pool)
        .await?;
        Ok(count > 0)
    }

    pub async fn cancel_routine_runs_for_delivery(&self, delivery_id: &str) -> AppResult<()> {
        sqlx::query(
            "UPDATE routine_runs SET status = 'cancelled', error = 'Cancelada na fila.', updated_at = $1
             WHERE delivery_id = $2 AND status = 'queued'",
        )
        .bind(now_ms())
        .bind(delivery_id)
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    /// At boot, a schedule that slept while the server was off either skips
    /// everything it missed or keeps the latest one to run once.
    pub async fn recover_missed_routines(&self, now: i64) -> AppResult<usize> {
        let rows = sqlx::query(&format!(
            "{ROUTINE_SELECT} WHERE r.active = 1 AND t.next_run_at IS NOT NULL AND t.next_run_at <= $1"
        ))
        .bind(now)
        .fetch_all(&self.pool)
        .await?;
        let mut adjusted = 0;
        for row in rows {
            let routine = routine_from_row(&row)?;
            if routine.missed_policy == "run-once" {
                continue;
            }
            match routine
                .trigger
                .schedule
                .next_occurrence(&routine.timezone, now)
            {
                Ok(next) => {
                    self.advance_routine_trigger(&routine.id, &routine.trigger.id, Some(next))
                        .await?;
                    adjusted += 1;
                }
                Err(_) => {
                    self.advance_routine_trigger(&routine.id, &routine.trigger.id, None)
                        .await?;
                    adjusted += 1;
                }
            }
        }
        Ok(adjusted)
    }
}

impl Store {
    /// A skipped occurrence is still recorded, so the room can show why a run
    /// did not happen. It never gets a delivery.
    pub async fn record_skipped_routine_run(
        &self,
        routine: &Routine,
        scheduled_for: i64,
        reason: &str,
    ) -> AppResult<()> {
        let now = now_ms();
        sqlx::query(
            "INSERT INTO routine_runs
             (id,routine_id,trigger_id,agent_id,room_id,kind,source,scheduled_for,routine_name,
              instruction,status,error,delivery_id,created_at,updated_at)
             VALUES($1,$2,$3,$4,$5,'scheduled',NULL,$6,$7,$8,'cancelled',$9,NULL,$10,$11) ON CONFLICT DO NOTHING",
        )
        .bind(crate::crypto::new_id())
        .bind(&routine.id)
        .bind(&routine.trigger.id)
        .bind(&routine.agent_id)
        .bind(&routine.room_id)
        .bind(scheduled_for)
        .bind(&routine.name)
        .bind(&routine.instruction)
        .bind(reason)
        .bind(now)
        .bind(now)
        .execute(&self.pool)
        .await?;
        Ok(())
    }
}
