//! Account deletion and operation startup share one atomic gate. Guards survive queued work.
use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};
#[derive(Default)]
pub struct UsageRegistry(Mutex<HashMap<String, Usage>>);
#[derive(Default)]
struct Usage {
    deleting: bool,
    reasons: HashMap<String, usize>,
}
pub struct AccountUse {
    registry: Arc<UsageRegistry>,
    id: String,
    reason: String,
}
pub struct AccountDeletion {
    registry: Arc<UsageRegistry>,
    id: String,
}
impl UsageRegistry {
    pub fn reasons(&self, id: &str) -> Vec<String> {
        let entries = self.0.lock().unwrap();
        let mut reasons: Vec<_> = entries
            .get(id)
            .map(|usage| usage.reasons.keys().cloned().collect())
            .unwrap_or_default();
        reasons.sort();
        reasons
    }
    pub fn acquire(self: &Arc<Self>, id: &str, reason: &str) -> Result<AccountUse, String> {
        let mut entries = self.0.lock().unwrap();
        let usage = entries.entry(id.into()).or_default();
        if usage.deleting {
            return Err("operation-cancelled:账号正在删除，请稍后重试。".into());
        }
        *usage.reasons.entry(reason.into()).or_default() += 1;
        Ok(AccountUse {
            registry: self.clone(),
            id: id.into(),
            reason: reason.into(),
        })
    }
    pub fn delete(self: &Arc<Self>, id: &str) -> Result<AccountDeletion, String> {
        let mut entries = self.0.lock().unwrap();
        let usage = entries.entry(id.into()).or_default();
        if usage.deleting {
            return Err("账号正在删除，请稍后重试。".into());
        }
        usage.deleting = true;
        Ok(AccountDeletion {
            registry: self.clone(),
            id: id.into(),
        })
    }
    pub fn is_deleting(&self, id: &str) -> bool {
        self.0
            .lock()
            .unwrap()
            .get(id)
            .is_some_and(|usage| usage.deleting)
    }
}
impl Drop for AccountUse {
    fn drop(&mut self) {
        let mut entries = self.registry.0.lock().unwrap();
        if let Some(usage) = entries.get_mut(&self.id) {
            if let Some(count) = usage.reasons.get_mut(&self.reason) {
                *count -= 1;
                if *count == 0 {
                    usage.reasons.remove(&self.reason);
                }
            }
            if usage.reasons.is_empty() && !usage.deleting {
                entries.remove(&self.id);
            }
        }
    }
}
impl Drop for AccountDeletion {
    fn drop(&mut self) {
        let mut entries = self.registry.0.lock().unwrap();
        if let Some(usage) = entries.get_mut(&self.id) {
            // Failed cleanup can be retried while old cancelled guards are still dropping.
            // Keep their counts until the last guard, so they cannot release a newer use.
            usage.deleting = false;
            if usage.reasons.is_empty() {
                entries.remove(&self.id);
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn deletion_allows_active_work_but_blocks_new_work_until_cleanup() {
        let registry = Arc::new(UsageRegistry::default());
        let first = registry.acquire("a", "播放").unwrap();
        let second = registry.acquire("a", "下载").unwrap();
        let deletion = registry.delete("a").unwrap();
        assert!(registry.is_deleting("a"));
        assert!(registry.acquire("a", "登录").is_err());
        assert!(registry.delete("a").is_err());
        assert!(registry.acquire("b", "搜索").is_ok());
        drop(deletion);
        let next = registry.acquire("a", "播放").unwrap();
        drop(first);
        drop(second);
        assert_eq!(registry.reasons("a"), vec!["播放"]);
        drop(next);
        assert!(registry.reasons("a").is_empty());
    }
}
