//! The routine tick. One loop, every 30 seconds, is enough: the trigger row
//! carries the exact next instant, and the unique run key absorbs a tick that
//! races another one.

use std::time::Duration;

use crate::errors::AppResult;
use crate::features::rooms::models::*;
use crate::features::rooms::queue::RoomQueue;
use crate::features::rooms::schedule::{collapse_missed, Schedule};
use crate::platform::store::Store;

#[derive(Clone)]
pub struct RoutineScheduler {
    store: Store,
    rooms: RoomQueue,
}

impl RoutineScheduler {
    pub fn new(store: Store, rooms: RoomQueue) -> Self {
        Self { store, rooms }
    }

    pub fn spawn(&self) {
        let scheduler = self.clone();
        tokio::spawn(async move {
            if let Err(error) = scheduler.store.recover_missed_routines(now_ms()).await {
                tracing::warn!(%error, "routine recovery");
            }
            loop {
                if let Err(error) = scheduler.tick(now_ms()).await {
                    tracing::warn!(%error, "routine tick");
                }
                tokio::time::sleep(Duration::from_secs(30)).await;
            }
        });
    }

    pub fn start(store: Store, rooms: RoomQueue) {
        Self::new(store, rooms).spawn();
    }

    pub async fn tick(&self, now: i64) -> AppResult<usize> {
        let due = self.store.due_routines(now).await?;
        let mut started = 0;
        for listed in due {
            let Ok(current) = self.store.routine(&listed.project_id, &listed.id).await else {
                continue;
            };
            if !current.active
                || current.trigger.id != listed.trigger.id
                || current.trigger.next_run_at != listed.trigger.next_run_at
            {
                continue;
            }
            let Some(next_run_at) = current.trigger.next_run_at else {
                continue;
            };
            if next_run_at > now {
                continue;
            }

            if matches!(current.trigger.schedule, Schedule::Once { .. }) {
                let run = self
                    .store
                    .create_routine_run(&current, "scheduled", None, next_run_at)
                    .await?;
                self.store
                    .advance_routine_trigger(&current.id, &current.trigger.id, None)
                    .await?;
                if let Some(run) = run {
                    self.enqueue(&current, &run).await?;
                    started += 1;
                }
                continue;
            }

            let (scheduled_for, next) = match collapse_missed(
                &current.trigger.schedule,
                &current.timezone,
                next_run_at,
                now,
            ) {
                Ok(value) => value,
                Err(error) => {
                    tracing::warn!(%error, routine = %current.id, "routine collapse");
                    self.store
                        .advance_routine_trigger(&current.id, &current.trigger.id, None)
                        .await?;
                    continue;
                }
            };

            if self.store.has_live_routine_run(&current.id).await? {
                self.store
                    .record_skipped_routine_run(
                        &current,
                        scheduled_for,
                        "Já existe uma execução aberta.",
                    )
                    .await?;
                self.store
                    .advance_routine_trigger(&current.id, &current.trigger.id, Some(next))
                    .await?;
                continue;
            }

            let run = self
                .store
                .create_routine_run(&current, "scheduled", None, scheduled_for)
                .await?;
            self.store
                .advance_routine_trigger(&current.id, &current.trigger.id, Some(next))
                .await?;
            if let Some(run) = run {
                self.enqueue(&current, &run).await?;
                started += 1;
            }
        }
        Ok(started)
    }

    /// A manual test run, queued like a scheduled one.
    pub async fn run_now(&self, project_id: &str, routine_id: &str) -> AppResult<RoutineRun> {
        let routine = self.store.routine(project_id, routine_id).await?;
        let run = self
            .store
            .create_routine_run(&routine, "manual", Some("test"), now_ms())
            .await?
            .ok_or(crate::errors::AppError::Conflict)?;
        self.enqueue(&routine, &run).await?;
        Ok(run)
    }

    async fn enqueue(&self, routine: &Routine, run: &RoutineRun) -> AppResult<()> {
        let agent = match self.store.principal(&routine.agent_id).await {
            Ok(agent) if agent.kind == "bot" => agent,
            _ => {
                self.store
                    .set_routine_run_status(&run.id, "failed", "O bot da rotina não existe mais.")
                    .await
                    .ok();
                return Ok(());
            }
        };
        if !self
            .store
            .is_room_member(&routine.room_id, &agent.id)
            .await?
        {
            self.store
                .set_routine_run_status(&run.id, "failed", "O bot não é mais membro da sala.")
                .await?;
            return Ok(());
        }
        let text = format!("[Rotina: {}]\n{}", routine.name, routine.instruction);
        let message = match self
            .store
            .append_room_message(&routine.room_id, &agent.id, &text, "routine", None)
            .await
        {
            Ok(message) => message,
            Err(error) => {
                self.store
                    .set_routine_run_status(&run.id, "failed", &error.to_string())
                    .await?;
                return Ok(());
            }
        };
        let deliveries = match self
            .store
            .enqueue_room_deliveries(&routine.room_id, &message, &[agent.id.clone()])
            .await
        {
            Ok(deliveries) => deliveries,
            Err(error) => {
                self.store
                    .set_routine_run_status(&run.id, "failed", &error.to_string())
                    .await?;
                return Ok(());
            }
        };
        let Some(delivery) = deliveries.into_iter().next() else {
            self.store
                .set_routine_run_status(&run.id, "failed", "A entrega não foi criada.")
                .await?;
            return Ok(());
        };
        self.store
            .attach_routine_delivery(&run.id, &delivery.id)
            .await?;
        if let Ok(room) = self.store.room_by_id(&routine.room_id).await {
            if let Err(error) = self
                .store
                .create_card_from_message(&room, &message, &agent.id)
                .await
            {
                tracing::warn!(%error, "routine card");
            }
        }
        self.rooms.schedule(agent.id);
        Ok(())
    }
}
