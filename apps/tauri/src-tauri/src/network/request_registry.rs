use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
use tokio_util::sync::CancellationToken;

struct RequestEntry {
    token: CancellationToken,
    active: bool,
    created: Instant,
}

/// IPC cancellation can arrive before its async request starts. Keep bounded tombstones for that order.
#[derive(Default)]
pub struct RequestRegistry(HashMap<String, RequestEntry>);
impl RequestRegistry {
    fn prune(&mut self) {
        self.0
            .retain(|_, entry| entry.active || entry.created.elapsed() < Duration::from_secs(120));
    }
    pub fn begin(&mut self, id: &str) -> Result<CancellationToken, String> {
        self.prune();
        if self.0.values().filter(|entry| entry.active).count() >= 64 {
            return Err("limit-exceeded:请求并发超过预算。".into());
        }
        if let Some(entry) = self.0.get_mut(id) {
            if entry.active {
                return Err("invalid-input:请求标识重复。".into());
            }
            entry.active = true;
            return Ok(entry.token.clone());
        }
        let token = CancellationToken::new();
        self.0.insert(
            id.into(),
            RequestEntry {
                token: token.clone(),
                active: true,
                created: Instant::now(),
            },
        );
        Ok(token)
    }
    pub fn cancel(&mut self, id: &str) {
        self.prune();
        if let Some(entry) = self.0.get(id) {
            entry.token.cancel();
            return;
        }
        if self.0.values().filter(|entry| !entry.active).count() >= 128 {
            return;
        }
        let token = CancellationToken::new();
        token.cancel();
        self.0.insert(
            id.into(),
            RequestEntry {
                token,
                active: false,
                created: Instant::now(),
            },
        );
    }
    pub fn finish(&mut self, id: &str) {
        self.0.remove(id);
    }
    pub fn cancel_all(&self) {
        for entry in self.0.values() {
            entry.token.cancel();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_before_registration_prevents_late_work() {
        let mut requests = RequestRegistry::default();
        requests.cancel("early");
        assert!(requests.begin("early").unwrap().is_cancelled());
        requests.finish("early");
        let active = requests.begin("active").unwrap();
        requests.cancel("active");
        assert!(active.is_cancelled());
    }
    #[test]
    fn duplicate_and_abandoned_entries_have_bounded_budgets() {
        let mut requests = RequestRegistry::default();
        requests.begin("duplicate").unwrap();
        assert!(requests.begin("duplicate").is_err());
        for i in 0..200 {
            requests.cancel(&format!("pending-{i}"));
        }
        assert_eq!(requests.0.len(), 129);
        for entry in requests.0.values_mut().filter(|entry| !entry.active) {
            entry.created = Instant::now() - Duration::from_secs(121);
        }
        requests.prune();
        assert_eq!(requests.0.len(), 1);
    }
}
