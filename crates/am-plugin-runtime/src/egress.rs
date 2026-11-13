use crate::{authority::*, model::*};

pub(crate) fn combination(
    ledger: &Ledger,
    session: &Session,
    level: Level,
    now: u64,
) -> Result<(), Error> {
    let Some(grant) = ledger.network_grants.get(&session.identity.install_id) else {
        return Ok(());
    };
    let level = level
        .max(historical(
            ledger,
            &ledger.installs[&session.identity.install_id],
        ))
        .max(ledger.grants[&session.identity.install_id].read_ceiling);
    if grant.identity != session.identity
        || now >= grant.expires_at_ms
        || now < grant.last_used_at_ms
        || now - grant.last_used_at_ms >= NETWORK_IDLE_MS
        || level > grant.ceiling
        || level == Level::Secret
        || level >= Level::L1 && !grant.user_linked_approved
        || level >= Level::L2 && !(grant.private_egress_declared && grant.private_egress_approved)
    {
        return Err(Error::Denied);
    }
    Ok(())
}
impl<S: Store, C: Clock, I: Ids> Runtime<S, C, I> {
    /// No authority comes from the request URL or plugin-reported data level.
    pub fn begin_exit(
        &mut self,
        caller: &Caller,
        context_id: &str,
        kind: ExitKind,
    ) -> Result<ExitPermit, Error> {
        let id = self.ids.next_id();
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            let (session, context) = bound_context(ledger, caller, context_id, now)?;
            if matches!(
                kind,
                ExitKind::ExternalLink | ExitKind::Export | ExitKind::HostWrite
            ) {
                // First version exposes no unreviewed OS/browser/file or arbitrary host write exit.
                return Err(Error::Denied);
            }
            if !ledger
                .network_grants
                .contains_key(&session.identity.install_id)
                || !valid_id(&id)
                || ledger.exits.contains_key(&id)
                || ledger.exits.len() >= MAX_LEDGER_ROWS
                || ledger
                    .exits
                    .values()
                    .filter(|e| e.active && e.identity.install_id == session.identity.install_id)
                    .count()
                    >= 4
                || ledger.exits.values().filter(|e| e.active).count() >= 16
            {
                return Err(Error::Budget);
            }
            let level = crate::data::selection_level(ledger, &session, &context)?;
            combination(ledger, &session, level, now)?;
            let install_id = session.identity.install_id.clone();
            ledger.exits.insert(
                id.clone(),
                ExitReservation {
                    id: id.clone(),
                    session_id: session.id,
                    context_id: context.id,
                    identity: session.identity,
                    epoch: session.epoch,
                    kind,
                    requests: 0,
                    bytes: 0,
                    active: true,
                },
            );
            Ok(ExitPermit { id, install_id })
        })
    }
    pub fn check_exit(
        &mut self,
        caller: &Caller,
        permit: &ExitPermit,
        kind: ExitKind,
        requests: u64,
        bytes: u64,
    ) -> Result<NetworkScope, Error> {
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            validate(ledger)?;
            let exit = ledger.exits.get(&permit.id).cloned().ok_or(Error::Denied)?;
            let (session, context) = bound_context(ledger, caller, &exit.context_id, now)?;
            if !exit.active
                || session.identity != exit.identity
                || session.id != exit.session_id
                || session.epoch != exit.epoch
                || kind != exit.kind
            {
                return Err(Error::Denied);
            }
            let level = crate::data::selection_level(ledger, &session, &context)?;
            combination(ledger, &session, level, now)?;
            let own: Vec<_> = ledger
                .exits
                .values()
                .filter(|e| e.session_id == session.id)
                .collect();
            let used_requests: u64 = own.iter().map(|e| e.requests).sum();
            let used_bytes: u64 = own.iter().map(|e| e.bytes).sum();
            if used_requests.checked_add(requests).is_none_or(|n| n > 64)
                || used_bytes
                    .checked_add(bytes)
                    .is_none_or(|n| n > 128 * 1024 * 1024)
            {
                return Err(Error::Budget);
            }
            let exit = ledger.exits.get_mut(&permit.id).ok_or(Error::Denied)?;
            exit.requests = exit.requests.checked_add(requests).ok_or(Error::Budget)?;
            exit.bytes = exit.bytes.checked_add(bytes).ok_or(Error::Budget)?;
            let grant = ledger
                .network_grants
                .get_mut(&session.identity.install_id)
                .ok_or(Error::Denied)?;
            if requests > 0 || bytes > 0 {
                grant.last_used_at_ms = now;
            }
            Ok(grant.scope.clone())
        })
    }
    /// Redacted per-hop/denial evidence, including resources that retain the lease for reuse.
    pub fn record_exit(
        &mut self,
        permit: &ExitPermit,
        host_tag: &str,
        status: u16,
        denied: bool,
    ) -> Result<(), Error> {
        let id = self.ids.next_id();
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            validate(ledger)?;
            let exit = ledger.exits.get(&permit.id).cloned().ok_or(Error::Denied)?;
            write_audit(ledger, id, &exit, host_tag, status, denied, clock.now_ms())
        })
    }
    pub fn finish_exit(
        &mut self,
        permit: ExitPermit,
        host_tag: &str,
        status: u16,
        denied: bool,
    ) -> Result<(), Error> {
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            validate(ledger)?;
            let Some(exit) = ledger.exits.get(&permit.id).cloned() else {
                return Ok(());
            };
            ledger
                .exits
                .get_mut(&permit.id)
                .ok_or(Error::Denied)?
                .active = false;
            write_audit(
                ledger,
                permit.id,
                &exit,
                host_tag,
                status,
                denied,
                clock.now_ms(),
            )
        })
    }
}

fn write_audit(
    ledger: &mut Ledger,
    id: String,
    exit: &ExitReservation,
    host_tag: &str,
    status: u16,
    denied: bool,
    now: u64,
) -> Result<(), Error> {
    if !valid_id(&id) || host_tag.len() != 64 || !host_tag.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err(Error::Denied);
    }
    ledger
        .outbound_audit
        .retain(|_, a| now.saturating_sub(a.time_ms) < 30 * 24 * 60 * 60 * 1000);
    if ledger.outbound_audit.len() >= 1024
        && let Some(id) = ledger
            .outbound_audit
            .iter()
            .min_by_key(|(_, a)| a.time_ms)
            .map(|(id, _)| id.clone())
    {
        ledger.outbound_audit.remove(&id);
    }
    ledger.outbound_audit.insert(
        id,
        Audit {
            install_id: exit.identity.install_id.clone(),
            time_ms: now,
            host_class: host_tag.into(),
            kind: exit.kind,
            status_class: status / 100,
            bytes: exit.bytes,
            denied,
        },
    );
    Ok(())
}
