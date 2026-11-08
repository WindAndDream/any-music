use crate::model::*;
use am_plugin_policy::{
    Budget, DataLevel, Operation, PolicyCall, PolicySnapshot, Subject, evaluate,
};

pub struct Runtime<S, C, I> {
    pub(crate) store: S,
    pub(crate) clock: C,
    pub(crate) ids: I,
}

impl<S: Store, C: Clock, I: Ids> Runtime<S, C, I> {
    /// Startup invalidates all old channels before exposing any authority snapshot.
    pub fn recover(mut store: S, clock: C, ids: I) -> Result<Self, Error> {
        store.transaction(|ledger| {
            validate(ledger)?;
            for install in ledger.installs.values_mut() {
                install.epoch = install.epoch.checked_add(1).ok_or(Error::Corrupt)?;
            }
            ledger.sessions.clear();
            ledger.exits.clear();
            ledger.contexts.clear();
            ledger
                .tasks
                .retain(|_, task| task.committed_version.is_some());
            Ok(())
        })?;
        Ok(Self { store, clock, ids })
    }

    pub fn snapshot(&mut self) -> Result<Vec<InstallSnapshot>, Error> {
        self.store.transaction(|ledger| {
            validate(ledger)?;
            Ok(ledger
                .installs
                .values()
                .map(|install| InstallSnapshot {
                    install_id: install.identity.install_id.clone(),
                    plugin_id: install.identity.plugin_id.clone(),
                    content_hash: install.identity.content_hash.clone(),
                    publisher: install.identity.publisher.clone(),
                    generation: install.identity.generation,
                    data_generation: install.identity.data_generation,
                    permission_epoch: install.epoch,
                    enabled: install.enabled,
                    historical_level: historical(ledger, install),
                })
                .collect())
        })
    }

    /// Host-only API: the app never exposes install/grant/session creation over IPC in S12.
    pub fn host_session(&mut self, install_id: &str, caller: Caller) -> Result<String, Error> {
        self.create_session(install_id, caller, None)
    }

    /// External package loads cannot use the S12 fixture/session path. Validate immutable
    /// code/data on every load, then bind that proof to the exact identity and current epoch.
    pub fn host_package_session(
        &mut self,
        install_id: &str,
        caller: Caller,
        files: &mut impl crate::InstallFiles,
        policy: &crate::InstallPolicy,
    ) -> Result<crate::LoadedPackage, Error> {
        let proof = self.store.transaction(|l| {
            validate(l)?;
            let record = l.packages.get(install_id).ok_or(Error::Denied)?;
            let install = l.installs.get(install_id).ok_or(Error::Denied)?;
            if !record.installed
                || !install.enabled
                || l.revocations.denies(&record.candidate)
                || !crate::install::accepts(&record.candidate, policy)
            {
                return Err(Error::Denied);
            }
            let bytes = files.verify_pair(record)?;
            Ok((install.identity.clone(), install.epoch, bytes))
        })?;
        let session_id = self.create_session(install_id, caller, Some((proof.0, proof.1)))?;
        Ok(crate::LoadedPackage {
            session_id,
            package_bytes: proof.2,
        })
    }

    fn create_session(
        &mut self,
        install_id: &str,
        caller: Caller,
        package_proof: Option<(Identity, u64)>,
    ) -> Result<String, Error> {
        let id = self.ids.next_id();
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            validate(ledger)?;
            let expired: Vec<_> = ledger
                .sessions
                .values()
                .filter(|session| now >= session.expires_at_ms)
                .map(|session| session.id.clone())
                .collect();
            ledger
                .sessions
                .retain(|_, session| !expired.contains(&session.id));
            ledger
                .contexts
                .retain(|_, context| !expired.contains(&context.session_id));
            ledger.exits.retain(|_, e| !expired.contains(&e.session_id));
            ledger.tasks.retain(|_, task| {
                !expired.contains(&task.session_id) || task.committed_version.is_some()
            });
            if !valid_id(&id)
                || caller.channel.is_empty()
                || caller.channel.len() > 200
                || caller.document.is_empty()
                || caller.document.len() > 2048
                || !valid_id(&caller.account_scope)
                || ledger.sessions.len() >= 16
                || ledger.sessions.contains_key(&id)
                || ledger
                    .sessions
                    .values()
                    .any(|s| s.channel == caller.channel)
            {
                return Err(Error::Denied);
            }
            let install = ledger.installs.get(install_id).ok_or(Error::Denied)?;
            if ledger.packages.contains_key(install_id)
                && package_proof.as_ref().is_none_or(|(identity, epoch)| {
                    identity != &install.identity || *epoch != install.epoch
                })
            {
                return Err(Error::Denied);
            }
            let grant = ledger.grants.get(install_id).ok_or(Error::Denied)?;
            if !install.enabled || now >= grant.expires_at_ms {
                return Err(Error::Denied);
            }
            let session = Session {
                id: id.clone(),
                identity: install.identity.clone(),
                epoch: install.epoch,
                channel: caller.channel,
                document: caller.document,
                account_scope: caller.account_scope,
                expires_at_ms: now.saturating_add(MAX_LIFETIME_MS).min(grant.expires_at_ms),
            };
            ledger.sessions.insert(id.clone(), session);
            Ok(id)
        })
    }

    /// The product supplies only selected field projections, never a repository/runtime object.
    /// Unknown input provenance must be encoded as Level::L2 by the host adapter.
    pub fn host_publish(&mut self, mut object: HostObject) -> Result<(), Error> {
        self.store.transaction(|ledger| {
            validate(ledger)?;
            if !valid_id(&object.id)
                || !valid_id(&object.account_scope)
                || object.version == 0
                || object.fields.is_empty()
                || object
                    .fields
                    .values()
                    .any(|v| v.text.len() > MAX_VALUE_BYTES)
            {
                return Err(Error::Budget);
            }
            let key = object_key(&object.account_scope, &object.id);
            if let Some(old) = ledger.objects.get(&key)
                && (object.version < old.version
                    || serde_json::to_value(old).ok() != serde_json::to_value(&object).ok()
                        && object.version <= version(ledger, old))
            {
                return Err(Error::Conflict);
            }
            if !ledger.objects.contains_key(&key) && ledger.objects.len() >= MAX_LEDGER_ROWS {
                return Err(Error::Budget);
            }
            if let Some(old) = ledger.objects.get(&key) {
                for (field, value) in &mut object.fields {
                    if let Some(previous) = old.fields.get(field)
                        && previous.provenance.level > value.provenance.level
                    {
                        value.provenance = previous.provenance.clone();
                    }
                }
            }
            // An untrusted remote refresh cannot erase labels on accepted host annotations.
            ledger.objects.insert(key, object);
            Ok(())
        })
    }

    pub fn host_context(
        &mut self,
        session_id: &str,
        task_id: &str,
        selection: Vec<Selection>,
    ) -> Result<String, Error> {
        let id = self.ids.next_id();
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            validate(ledger)?;
            let session = ledger
                .sessions
                .get(session_id)
                .cloned()
                .ok_or(Error::Denied)?;
            check_session(ledger, &session, now)?;
            if !valid_id(&id)
                || !valid_id(task_id)
                || selection.is_empty()
                || selection.len() > MAX_OBJECTS
                || ledger.contexts.contains_key(&id)
                || ledger.contexts.len() >= MAX_LEDGER_ROWS
            {
                return Err(Error::Budget);
            }
            let mut seen = std::collections::BTreeSet::new();
            for selected in &selection {
                if !seen.insert(&selected.id)
                    || selected.fields.is_empty()
                    || selected.fields.len() > 3
                {
                    return Err(Error::Denied);
                }
                let object = ledger
                    .objects
                    .get(&object_key(&session.account_scope, &selected.id))
                    .ok_or(Error::Denied)?;
                if selected.version != version(ledger, object)
                    || selected
                        .fields
                        .iter()
                        .any(|f| !object.fields.contains_key(f))
                {
                    return Err(Error::Conflict);
                }
            }
            // A new foreground selection closes old contexts and their uncommitted reservations.
            ledger.contexts.retain(|_, c| c.session_id != session_id);
            ledger
                .tasks
                .retain(|_, t| t.session_id != session_id || t.committed_version.is_some());
            ledger.contexts.insert(
                id.clone(),
                Context {
                    id: id.clone(),
                    session_id: session_id.into(),
                    task_id: task_id.into(),
                    expires_at_ms: session.expires_at_ms,
                    selection,
                },
            );
            Ok(id)
        })
    }

    pub fn host_close_context(&mut self, context_id: &str) -> Result<(), Error> {
        self.store.transaction(|ledger| {
            validate(ledger)?;
            ledger.contexts.remove(context_id);
            ledger
                .tasks
                .retain(|_, t| t.request.context_id != context_id || t.committed_version.is_some());
            Ok(())
        })
    }

    /// Executor teardown closes transient authority without revoking durable user grants.
    pub fn host_end_session(&mut self, session_id: &str) -> Result<(), Error> {
        self.store.transaction(|ledger| {
            validate(ledger)?;
            ledger.sessions.remove(session_id);
            ledger.contexts.retain(|_, c| c.session_id != session_id);
            ledger.exits.retain(|_, e| e.session_id != session_id);
            ledger
                .tasks
                .retain(|_, t| t.session_id != session_id || t.committed_version.is_some());
            Ok(())
        })
    }

    /// Trusted adapter cleanup for an ephemeral projection after closing its session.
    pub fn host_forget_object(&mut self, account: &str, id: &str) -> Result<(), Error> {
        self.store.transaction(|l| {
            validate(l)?;
            if l.contexts
                .values()
                .any(|c| c.selection.iter().any(|s| s.id == id))
            {
                return Err(Error::Conflict);
            }
            l.objects.remove(&object_key(account, id));
            Ok(())
        })
    }

    pub fn check_context(&mut self, caller: &Caller, context_id: &str) -> Result<(), Error> {
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            // Store admission may wait past a grant, session or context deadline.
            let now = clock.now_ms();
            let (session, context) = bound_context(ledger, caller, context_id, now)?;
            let level = crate::data::selection_level(ledger, &session, &context)?;
            crate::egress::combination(ledger, &session, level, now)
        })
    }
    pub fn check_capability(
        &mut self,
        caller: &Caller,
        context_id: &str,
        capability: &str,
    ) -> Result<(), Error> {
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            let now = clock.now_ms();
            let (session, _) = bound_context(ledger, caller, context_id, now)?;
            if !ledger
                .packages
                .get(&session.identity.install_id)
                .is_some_and(|p| p.granted_capabilities.contains(capability))
            {
                return Err(Error::Denied);
            }
            Ok(())
        })
    }
    pub fn package_records(&mut self) -> Result<Vec<crate::PackageRecord>, Error> {
        self.store.transaction(|ledger| {
            validate(ledger)?;
            Ok(ledger.packages.values().cloned().collect())
        })
    }

    /// Revocation and data commit use the same store transaction; confirmation is durable.
    pub fn revoke(&mut self, install_id: &str) -> Result<(), Error> {
        let journal_id = format!("revoke:{install_id}");
        self.store.transaction(|ledger| {
            validate(ledger)?;
            // Keep the latest revocation per install. A full diagnostic journal must not prevent revocation.
            if ledger.journal.len() >= MAX_LEDGER_ROWS
                && !ledger.journal.contains_key(&journal_id)
                && let Some(oldest) = ledger.journal.keys().next().cloned()
            {
                ledger.journal.remove(&oldest);
            }
            let install = ledger.installs.get_mut(install_id).ok_or(Error::Denied)?;
            install.epoch = install.epoch.checked_add(1).ok_or(Error::Corrupt)?;
            install.enabled = false;
            ledger.grants.remove(install_id);
            ledger.network_grants.remove(install_id);
            for exit in ledger
                .exits
                .values_mut()
                .filter(|e| e.identity.install_id == install_id)
            {
                exit.active = false;
            }
            let epoch = install.epoch;
            let sessions: Vec<_> = ledger
                .sessions
                .values()
                .filter(|s| s.identity.install_id == install_id)
                .map(|s| s.id.clone())
                .collect();
            ledger
                .sessions
                .retain(|_, s| s.identity.install_id != install_id);
            ledger
                .contexts
                .retain(|_, c| !sessions.contains(&c.session_id));
            ledger
                .tasks
                .retain(|_, t| !sessions.contains(&t.session_id) || t.committed_version.is_some());
            ledger.journal.insert(
                journal_id,
                JournalEntry {
                    install_id: install_id.into(),
                    epoch,
                    action: "revoke".into(),
                },
            );
            Ok(())
        })
    }
}

pub(crate) fn validate(ledger: &Ledger) -> Result<(), Error> {
    if ledger.installs.len() > 128
        || ledger.sessions.len() > 16
        || [
            ledger.contexts.len(),
            ledger.tasks.len(),
            ledger.objects.len(),
            ledger.annotations.len(),
            ledger.deliveries.len(),
            ledger.journal.len(),
            ledger.history.len(),
            ledger.network_grants.len(),
            ledger.exits.len(),
            ledger.outbound_audit.len(),
            ledger.packages.len(),
            ledger.install_journal.len(),
        ]
        .into_iter()
        .any(|n| n > MAX_LEDGER_ROWS)
    {
        return Err(Error::Corrupt);
    }
    for (id, p) in &ledger.packages {
        if ledger
            .installs
            .get(id)
            .is_none_or(|i| i.identity != p.identity)
            || p.identity.content_hash != p.candidate.package_hash
            || p.identity.plugin_id != p.candidate.plugin_id
            || p.rollback
                .as_ref()
                .is_some_and(|old| old.rollback.is_some() || old.identity.install_id != *id)
            || p.granted_capabilities
                .iter()
                .any(|c| !p.candidate.capabilities.contains(c))
        {
            return Err(Error::Corrupt);
        }
    }
    for (key, install) in &ledger.installs {
        let i = &install.identity;
        if key != &i.install_id
            || !valid_id(key)
            || !valid_id(&i.plugin_id)
            || !valid_id(&i.publisher)
            || i.content_hash.len() != 64
            || !i.content_hash.bytes().all(|b| b.is_ascii_hexdigit())
            || i.generation == 0
            || i.data_generation == 0
            || install.epoch == 0
            || install.enabled && !ledger.grants.contains_key(key)
        {
            return Err(Error::Corrupt);
        }
    }
    for (key, grant) in &ledger.grants {
        if !ledger.installs.contains_key(key)
            || ledger.installs[key].identity != grant.identity
            || grant.expires_at_ms == 0
            || grant.read_ceiling == Level::Secret
        {
            return Err(Error::Corrupt);
        }
    }
    for (key, grant) in &ledger.network_grants {
        if ledger
            .installs
            .get(key)
            .is_none_or(|i| i.identity != grant.identity)
            || grant.expires_at_ms == 0
            || grant.ceiling == Level::Secret
        {
            return Err(Error::Corrupt);
        }
        match &grant.scope {
            NetworkScope::Public => {}
            NetworkScope::Hosts(hosts) => {
                if hosts.is_empty()
                    || hosts.len() > 128
                    || hosts
                        .iter()
                        .any(|h| h.len() > 512 || h.chars().any(char::is_control))
                {
                    return Err(Error::Corrupt);
                }
            }
        }
    }
    if ledger
        .exits
        .values()
        .any(|e| e.requests > 64 || e.bytes > 128 * 1024 * 1024)
    {
        return Err(Error::Corrupt);
    }
    Ok(())
}

pub(crate) fn historical(ledger: &Ledger, install: &Install) -> Level {
    let retained = ledger
        .namespaces
        .get(&install.identity.install_id)
        .into_iter()
        .flat_map(|n| n.values())
        .map(|v| v.provenance.level)
        .max()
        .unwrap_or(Level::L0);
    install.historical_level.max(retained).max(
        *ledger
            .history
            .get(&lineage(&install.identity))
            .unwrap_or(&Level::L2),
    )
}

pub(crate) fn remember(ledger: &mut Ledger, session: &Session, level: Level) -> Provenance {
    let install = ledger
        .installs
        .get_mut(&session.identity.install_id)
        .expect("checked installation");
    install.historical_level = install.historical_level.max(level);
    ledger
        .history
        .entry(lineage(&session.identity))
        .and_modify(|old| *old = (*old).max(level))
        .or_insert(level);
    Provenance {
        level,
        source_install: session.identity.install_id.clone(),
        source_context: String::new(),
        generation: session.identity.generation,
        data_generation: session.identity.data_generation,
    }
}

pub(crate) fn check_session(ledger: &Ledger, session: &Session, now: u64) -> Result<(), Error> {
    let install = ledger
        .installs
        .get(&session.identity.install_id)
        .ok_or(Error::Denied)?;
    let grant = ledger
        .grants
        .get(&session.identity.install_id)
        .ok_or(Error::Denied)?;
    if !install.enabled || session.identity != install.identity || session.epoch != install.epoch {
        return Err(Error::Denied);
    }
    if now >= session.expires_at_ms || now >= grant.expires_at_ms {
        return Err(Error::Expired);
    }
    Ok(())
}

pub(crate) fn bound_context(
    ledger: &Ledger,
    caller: &Caller,
    context_id: &str,
    now: u64,
) -> Result<(Session, Context), Error> {
    validate(ledger)?;
    let context = ledger.contexts.get(context_id).ok_or(Error::Denied)?;
    let session = ledger
        .sessions
        .get(&context.session_id)
        .ok_or(Error::Denied)?;
    if caller.channel != session.channel
        || caller.document != session.document
        || caller.account_scope != session.account_scope
    {
        return Err(Error::Denied);
    }
    check_session(ledger, session, now)?;
    if now >= context.expires_at_ms {
        return Err(Error::Expired);
    }
    Ok((session.clone(), context.clone()))
}

pub(crate) fn authorize(
    ledger: &Ledger,
    session: &Session,
    context: &Context,
    operation: Operation,
    level: Level,
    now: u64,
) -> Result<(), Error> {
    crate::egress::combination(ledger, session, level, now)?;
    let install = &ledger.installs[&session.identity.install_id];
    let grant = &ledger.grants[&session.identity.install_id];
    let subject = Subject {
        install_id: &session.identity.install_id,
        session_id: &session.id,
        permission_epoch: session.epoch,
    };
    let mut operations = vec![Operation::StateRead];
    if grant.state || grant.annotate {
        operations.push(Operation::StateWrite);
    }
    let snapshot = PolicySnapshot {
        subject,
        enabled: install.enabled,
        expires_at_ms: session.expires_at_ms.min(grant.expires_at_ms),
        scopes: &["offline"],
        grants: &operations,
        data_ceiling: policy_level(grant.read_ceiling),
        historical_data_level: policy_level(historical(ledger, install)),
        exfiltration_approved: false,
        limit: Budget {
            requests: 1,
            bytes: MAX_NAMESPACE_BYTES as u64,
            concurrent: 1,
        },
        used: Budget {
            requests: 0,
            bytes: 0,
            concurrent: 0,
        },
    };
    evaluate(
        &snapshot,
        &PolicyCall {
            subject,
            operation,
            scope: "offline",
            deadline_ms: context.expires_at_ms,
            data_level: policy_level(level),
            cost: Budget {
                requests: 1,
                bytes: 0,
                concurrent: 1,
            },
        },
        now,
    )
    .map_err(|_| Error::Denied)
}
fn policy_level(level: Level) -> DataLevel {
    match level {
        Level::L0 => DataLevel::Public,
        Level::L1 => DataLevel::UserLinked,
        Level::L2 => DataLevel::Private,
        Level::Secret => DataLevel::Secret,
    }
}
pub(crate) fn version(ledger: &Ledger, object: &HostObject) -> u64 {
    ledger
        .annotations
        .get(&object_key(&object.account_scope, &object.id))
        .map_or(object.version, |a| a.version.max(object.version))
}
