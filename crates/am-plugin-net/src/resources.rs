use crate::{Error, Exit, Gate, Network, Request, Resolver, Response, Scope, Sink, Target};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tokio_util::sync::CancellationToken;

/// Transient host handle, deliberately not Serialize/Deserialize or a URL.
#[derive(Debug, Clone)]
pub struct ResourceRef(String);
struct Resource {
    url: String,
    gate: Arc<dyn Gate>,
    exit: Exit,
    cancel: CancellationToken,
}
#[derive(Default)]
pub struct Resources {
    entries: Mutex<BTreeMap<String, Arc<Resource>>>,
}
struct ResourceGate(Arc<Resource>);
impl Gate for ResourceGate {
    fn scope(&self) -> Scope {
        self.0.gate.scope()
    }
    fn check(&self, exit: Exit) -> Result<(), Error> {
        if self.0.cancel.is_cancelled() || exit != self.0.exit {
            return Err(Error::Denied);
        }
        self.0.gate.check(exit)
    }
    fn charge(&self, requests: u64, bytes: u64) -> Result<(), Error> {
        self.0.gate.charge(requests, bytes)
    }
    fn cancellation(&self) -> CancellationToken {
        self.0.cancel.clone()
    }
    fn audit(&self, host: &str, status: u16, denied: bool) {
        self.0.gate.audit(host, status, denied)
    }
    fn deliver(
        &self,
        exit: Exit,
        bytes: u64,
        action: &mut dyn FnMut() -> Result<(), Error>,
    ) -> Result<(), Error> {
        self.check(exit)?;
        self.0.gate.deliver(exit, bytes, action)
    }
}
impl Resources {
    pub fn register(
        &self,
        gate: Arc<dyn Gate>,
        url: &str,
        exit: Exit,
    ) -> Result<ResourceRef, Error> {
        if !matches!(exit, Exit::Image | Exit::Media | Exit::Download) {
            return Err(Error::Denied);
        }
        gate.check(exit)?;
        let target = Target::parse(url, &gate.scope())?;
        let mut entries = self.entries.lock().map_err(|_| Error::Denied)?;
        entries.retain(|_, r| !r.cancel.is_cancelled());
        if entries.len() >= 32 {
            return Err(Error::Budget);
        }
        let id = uuid::Uuid::new_v4().to_string();
        let cancel = gate.cancellation().child_token();
        entries.insert(
            id.clone(),
            Arc::new(Resource {
                url: target.url().into(),
                gate,
                exit,
                cancel,
            }),
        );
        Ok(ResourceRef(id))
    }
    /// Range requests, retries and bounded full reads keep the same authority lease and budget.
    pub async fn read<R: Resolver>(
        &self,
        network: &Network<R>,
        reference: &ResourceRef,
        range: Option<(u64, u64)>,
        max_bytes: usize,
        sink: &mut dyn Sink,
    ) -> Result<Response, Error> {
        let resource = self
            .entries
            .lock()
            .map_err(|_| Error::Denied)?
            .get(&reference.0)
            .cloned()
            .ok_or(Error::Denied)?;
        let mut request = Request::get(resource.url.clone(), resource.exit);
        request.max_bytes = max_bytes;
        if let Some((a, b)) = range {
            request
                .headers
                .push(("Range".into(), format!("bytes={a}-{b}")))
        }
        network
            .execute(&ResourceGate(resource), request, sink)
            .await
    }
    pub fn release(&self, reference: ResourceRef) {
        if let Ok(mut entries) = self.entries.lock()
            && let Some(r) = entries.remove(&reference.0)
        {
            r.cancel.cancel()
        }
    }
    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            for r in entries.values() {
                r.cancel.cancel()
            }
            entries.clear()
        }
    }
}
impl Drop for Resources {
    fn drop(&mut self) {
        self.clear()
    }
}
