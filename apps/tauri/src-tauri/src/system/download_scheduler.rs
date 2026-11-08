//! Native FIFO admission for complete download tasks, including renderer encoding/retries.
//! Permits stay native and transient; media, credentials and file paths are never stored here.
use crate::{browser::verification::require_main, state::RuntimeState};
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
use tauri::{State, WebviewWindow};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_util::sync::CancellationToken;

#[derive(Default)]
pub(crate) struct DownloadSchedules(Mutex<Option<Arc<Schedule>>>);

struct Schedule {
    id: String,
    pool: Arc<Semaphore>,
    slots: Mutex<HashMap<String, Slot>>,
}

struct Slot {
    cancelled: CancellationToken,
    _permit: Option<OwnedSemaphorePermit>,
}

impl DownloadSchedules {
    fn open(&self, concurrency: usize) -> Result<String, String> {
        if !(1..=5).contains(&concurrency) {
            return Err("下载并发必须为 1 至 5。".into());
        }
        let mut current = self.0.lock().unwrap();
        if current.is_some() {
            return Err("已有原生下载队列。".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        *current = Some(Arc::new(Schedule {
            id: id.clone(),
            pool: Arc::new(Semaphore::new(concurrency)),
            slots: Mutex::default(),
        }));
        Ok(id)
    }

    fn get(&self, id: &str) -> Result<Arc<Schedule>, String> {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .filter(|schedule| schedule.id == id)
            .cloned()
            .ok_or_else(|| "operation-cancelled:下载队列已关闭。".into())
    }

    pub(crate) fn clear(&self) {
        if let Some(schedule) = self.0.lock().unwrap().take() {
            schedule.pool.close();
            for slot in schedule.slots.lock().unwrap().drain().map(|(_, slot)| slot) {
                slot.cancelled.cancel();
            }
        }
    }
}

impl Schedule {
    async fn acquire(&self, task_id: String) -> Result<(), String> {
        if uuid::Uuid::parse_str(&task_id).is_err() {
            return Err("下载任务标识无效。".into());
        }
        let cancelled = CancellationToken::new();
        {
            let mut slots = self.slots.lock().unwrap();
            if slots
                .get(&task_id)
                .is_some_and(|slot| slot.cancelled.is_cancelled())
            {
                slots.remove(&task_id);
                return Err("operation-cancelled:下载任务已取消。".into());
            }
            if slots.len() >= 10_000 || slots.contains_key(&task_id) {
                return Err("下载队列超过预算或任务重复。".into());
            }
            slots.insert(
                task_id.clone(),
                Slot {
                    cancelled: cancelled.clone(),
                    _permit: None,
                },
            );
        }
        let acquired = tokio::select! {
            biased;
            () = cancelled.cancelled() => Err("operation-cancelled:下载任务已取消。".to_owned()),
            permit = self.pool.clone().acquire_owned() => permit.map_err(|_| "operation-cancelled:下载队列已关闭。".to_owned()),
        };
        let mut slots = self.slots.lock().unwrap();
        match acquired {
            Ok(permit) if !cancelled.is_cancelled() => {
                let slot = slots
                    .get_mut(&task_id)
                    .ok_or("operation-cancelled:下载任务已取消。")?;
                slot._permit = Some(permit);
                Ok(())
            }
            result => {
                slots.remove(&task_id);
                Err(result
                    .err()
                    .unwrap_or_else(|| "operation-cancelled:下载任务已取消。".into()))
            }
        }
    }

    fn release(&self, task_id: &str) {
        let mut slots = self.slots.lock().unwrap();
        if let Some(slot) = slots.remove(task_id) {
            slot.cancelled.cancel();
        } else if slots.len() < 10_000 && uuid::Uuid::parse_str(task_id).is_ok() {
            // IPC cancellation may arrive before its acquire command is registered.
            let cancelled = CancellationToken::new();
            cancelled.cancel();
            slots.insert(
                task_id.to_owned(),
                Slot {
                    cancelled,
                    _permit: None,
                },
            );
        }
    }
}

#[tauri::command]
pub async fn open_download_schedule(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    concurrency: usize,
) -> Result<String, String> {
    require_main(&window)?;
    state.download_schedules.open(concurrency)
}

#[tauri::command]
pub async fn acquire_download_slot(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    schedule_id: String,
    task_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    state
        .download_schedules
        .get(&schedule_id)?
        .acquire(task_id)
        .await
}

#[tauri::command]
pub async fn release_download_slot(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    schedule_id: String,
    task_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    if let Ok(schedule) = state.download_schedules.get(&schedule_id) {
        schedule.release(&task_id);
    }
    Ok(())
}

#[tauri::command]
pub async fn close_download_schedule(
    window: WebviewWindow,
    state: State<'_, RuntimeState>,
    schedule_id: String,
) -> Result<(), String> {
    require_main(&window)?;
    // A late close from an old renderer must never clear a newer queue.
    let mut current = state.download_schedules.0.lock().unwrap();
    if current
        .as_ref()
        .is_some_and(|schedule| schedule.id == schedule_id)
    {
        let schedule = current.take().unwrap();
        schedule.pool.close();
        for slot in schedule.slots.lock().unwrap().drain().map(|(_, slot)| slot) {
            slot.cancelled.cancel();
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn cancellation_before_registration_and_fifo_admission_are_preserved() {
        let schedules = DownloadSchedules::default();
        let id = schedules.open(1).unwrap();
        let schedule = schedules.get(&id).unwrap();
        let cancelled = uuid::Uuid::new_v4().to_string();
        schedule.release(&cancelled);
        assert!(schedule.acquire(cancelled).await.is_err());
        assert!(schedule.slots.lock().unwrap().is_empty());

        let first = uuid::Uuid::new_v4().to_string();
        let second = uuid::Uuid::new_v4().to_string();
        let third = uuid::Uuid::new_v4().to_string();
        schedule.acquire(first.clone()).await.unwrap();
        assert!(schedule.acquire(first.clone()).await.is_err());
        let waiting_second = tokio::spawn({
            let schedule = schedule.clone();
            let second = second.clone();
            async move { schedule.acquire(second).await }
        });
        tokio::task::yield_now().await;
        let waiting_third = tokio::spawn({
            let schedule = schedule.clone();
            let third = third.clone();
            async move { schedule.acquire(third).await }
        });
        tokio::task::yield_now().await;
        schedule.release(&first);
        waiting_second.await.unwrap().unwrap();
        assert!(!waiting_third.is_finished());
        schedule.release(&second);
        waiting_third.await.unwrap().unwrap();
        schedule.release(&third);
        assert_eq!(schedule.pool.available_permits(), 1);
    }

    #[tokio::test]
    async fn permits_bound_work_and_cancel_waiters_without_leaking_slots() {
        let schedules = DownloadSchedules::default();
        assert!(schedules.open(0).is_err());
        assert!(schedules.open(6).is_err());
        let id = schedules.open(1).unwrap();
        assert!(schedules.open(1).is_err());
        let schedule = schedules.get(&id).unwrap();
        let first = uuid::Uuid::new_v4().to_string();
        let second = uuid::Uuid::new_v4().to_string();
        schedule.acquire(first.clone()).await.unwrap();
        let waiting = tokio::spawn({
            let schedule = schedule.clone();
            let second = second.clone();
            async move { schedule.acquire(second).await }
        });
        tokio::task::yield_now().await;
        assert!(!waiting.is_finished());
        schedule.release(&second);
        assert!(waiting.await.unwrap().is_err());
        assert_eq!(schedule.pool.available_permits(), 0);
        schedule.release(&first);
        assert_eq!(schedule.pool.available_permits(), 1);
        schedule
            .acquire(uuid::Uuid::new_v4().to_string())
            .await
            .unwrap();
        schedules.clear();
        assert!(schedules.get(&id).is_err());
        assert!(schedule.pool.is_closed());
        assert!(schedule.slots.lock().unwrap().is_empty());
    }
}
