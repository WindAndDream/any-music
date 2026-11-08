//! Host-wide admission survives individual WebView lifetimes. A new realm cannot reset
//! request rate or crash history; three 128 MiB slots bound aggregate VM memory to 384 MiB.
use std::{
    collections::{BTreeMap, VecDeque},
    time::{Duration, Instant},
};
#[derive(Default)]
pub(super) struct Budget {
    calls: VecDeque<(Instant, String)>,
    failures: BTreeMap<String, VecDeque<Instant>>,
}
impl Budget {
    pub fn admit(&mut self, id: &str, now: Instant) -> Result<(), String> {
        self.calls
            .retain(|(at, _)| now.duration_since(*at) < Duration::from_secs(60));
        self.failures.retain(|_, values| {
            values.retain(|at| now.duration_since(*at) < Duration::from_secs(600));
            !values.is_empty()
        });
        if self.calls.len() >= 240
            || self
                .calls
                .iter()
                .filter(|(_, subject)| subject == id)
                .count()
                >= 60
        {
            return Err("插件调用频率预算已用尽。".into());
        }
        if let Some(failures) = self.failures.get(id) {
            let delay = [1, 4, 16][failures.len().saturating_sub(1).min(2)];
            if failures.len() >= 3
                || failures
                    .back()
                    .is_some_and(|at| now.duration_since(*at) < Duration::from_secs(delay))
            {
                return Err("插件重复失败，已暂时隔离。".into());
            }
        }
        self.calls.push_back((now, id.into()));
        Ok(())
    }
    pub fn failed(&mut self, id: &str, now: Instant) {
        if self.failures.len() < 1024 || self.failures.contains_key(id) {
            let failures = self.failures.entry(id.into()).or_default();
            if failures.len() < 3 {
                failures.push_back(now);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rates_are_shared_across_realms_and_expire_without_resetting_subjects() {
        let now = Instant::now();
        let mut b = Budget::default();
        for _ in 0..60 {
            b.admit("one", now).unwrap();
        }
        assert!(b.admit("one", now).is_err());
        for id in ["two", "three", "four"] {
            for _ in 0..60 {
                b.admit(id, now).unwrap();
            }
        }
        assert!(b.admit("five", now).is_err());
        assert!(b.admit("one", now + Duration::from_secs(60)).is_ok());
    }
    #[test]
    fn crashes_back_off_then_quarantine_until_window_expires() {
        let start = Instant::now();
        let mut b = Budget::default();
        b.failed("one", start);
        assert!(b.admit("one", start).is_err());
        let next = start + Duration::from_secs(2);
        b.admit("one", next).unwrap();
        b.failed("one", next);
        assert!(b.admit("one", next + Duration::from_secs(3)).is_err());
        let third = next + Duration::from_secs(5);
        b.failed("one", third);
        assert!(b.admit("one", third + Duration::from_secs(60)).is_err());
        assert!(b.admit("other", third).is_ok());
        assert!(b.admit("one", third + Duration::from_secs(600)).is_ok());
    }
}
