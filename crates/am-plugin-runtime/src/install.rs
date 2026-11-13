use crate::authority::{historical, validate};
use crate::*;
use std::collections::BTreeSet;

pub(crate) fn accepts(candidate: &Candidate, policy: &InstallPolicy) -> bool {
    candidate.compatible
        && candidate.data_schema == 1
        && match candidate.execution.as_str() {
            "declarative" => policy.declarative,
            "sandbox-code" => policy.sandbox_code,
            _ => false,
        }
        && candidate
            .required_capabilities
            .iter()
            .all(|id| policy.capabilities.contains(id))
}
fn invalidate(ledger: &mut Ledger, id: &str) {
    let sessions: BTreeSet<_> = ledger
        .sessions
        .values()
        .filter(|s| s.identity.install_id == id)
        .map(|s| s.id.clone())
        .collect();
    ledger.sessions.retain(|_, s| s.identity.install_id != id);
    ledger
        .contexts
        .retain(|_, c| !sessions.contains(&c.session_id));
    ledger
        .tasks
        .retain(|_, t| !sessions.contains(&t.session_id) || t.committed_version.is_some());
    ledger.exits.retain(|_, e| e.identity.install_id != id);
}
pub(crate) fn clear_grants(ledger: &mut Ledger, id: &str) {
    ledger.grants.remove(id);
    ledger.network_grants.remove(id);
    invalidate(ledger, id);
}
fn good_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

impl<S: Store, C: Clock, I: Ids> Runtime<S, C, I> {
    pub fn preview_install(
        &mut self,
        candidate: Candidate,
        policy: &InstallPolicy,
    ) -> Result<InstallPreview, Error> {
        if !crate::model::valid_id(&candidate.plugin_id)
            || !good_hash(&candidate.package_hash)
            || candidate.signer.as_ref().is_some_and(|s| !good_hash(s))
            || candidate.capabilities.len() > 64
            || candidate.required_capabilities.len() > 64
            || candidate
                .required_capabilities
                .iter()
                .any(|c| !candidate.capabilities.contains(c))
        {
            return Err(Error::Corrupt);
        }
        let now = self.clock.now_ms();
        self.store.transaction(|l| {
            validate(l)?;
            if l.revocations.denies(&candidate) {
                return Err(Error::Denied);
            }
            let old = l
                .packages
                .values()
                .find(|p| p.candidate.plugin_id == candidate.plugin_id);
            let install = old.and_then(|p| l.installs.get(&p.identity.install_id));
            let pinned = candidate.signer.as_ref().is_some_and(|s| {
                l.revocations.pinned_publishers.get(&candidate.plugin_id) == Some(s)
            });
            let continuous = pinned
                && old.is_some_and(|p| {
                    p.candidate.signer == candidate.signer
                        && (p.candidate.version != candidate.version
                            || p.candidate.package_hash == candidate.package_hash)
                });
            // Only currently granted, unchanged capabilities may be inherited. A revoked grant
            // is never recovered from package metadata or rollback snapshots.
            let inherited = if continuous
                && install.is_some_and(|i| {
                    l.grants
                        .get(&i.identity.install_id)
                        .is_some_and(|g| now < g.expires_at_ms)
                }) {
                old.expect("continuous old record")
                    .granted_capabilities
                    .clone()
            } else {
                BTreeSet::new()
            };
            Ok(InstallPreview {
                allowed: accepts(&candidate, policy),
                candidate,
                previous: old.map(|p| p.identity.clone()),
                epoch: install.map_or(0, |i| i.epoch),
                revocation_sequence: l.revocations.sequence,
                historical_level: install.map_or(Level::L0, |i| historical(l, i)),
                inherited,
                pinned,
                expires_at_ms: now.saturating_add(MAX_LIFETIME_MS),
            })
        })
    }

    pub fn install_package(
        &mut self,
        preview: InstallPreview,
        consent: InstallConsent,
        policy: &InstallPolicy,
        files: &mut impl InstallFiles,
        migration: DataMigration,
        cancelled: impl Fn() -> bool,
    ) -> Result<Identity, Error> {
        if !preview.allowed || !accepts(&preview.candidate, policy) || cancelled() {
            return Err(Error::Denied);
        }
        let now = self.clock.now_ms();
        if now >= preview.expires_at_ms || consent.read_ceiling == Level::Secret {
            return Err(Error::Expired);
        }
        let journal_id = self.ids.next_id();
        let install_id = preview
            .previous
            .as_ref()
            .map(|i| i.install_id.clone())
            .unwrap_or_else(|| self.ids.next_id());
        let mut journal = self.store.transaction(|l| {
            validate(l)?;
            if l.revocations.sequence != preview.revocation_sequence
                || l.revocations.denies(&preview.candidate)
                || l.install_journal.values().any(|j| {
                    !j.committed && j.candidate.candidate.plugin_id == preview.candidate.plugin_id
                })
                || l.install_journal.len() >= 128
            {
                return Err(Error::Conflict);
            }
            let old = l.packages.get(&install_id).cloned();
            if !l.installs.contains_key(&install_id) && l.installs.len() >= 128 {
                return Err(Error::Budget);
            }
            let install = l.installs.get(&install_id);
            if old.as_ref().map(|p| &p.identity) != preview.previous.as_ref()
                || install.map_or(0, |i| i.epoch) != preview.epoch
            {
                return Err(Error::Conflict);
            }
            let unchanged_publisher = preview.pinned
                && old
                    .as_ref()
                    .is_some_and(|p| p.candidate.signer == preview.candidate.signer);
            if old.is_some() && !unchanged_publisher && !consent.transfer_data {
                return Err(Error::Denied);
            }
            let selected: BTreeSet<_> = preview
                .candidate
                .capabilities
                .iter()
                .filter(|c| {
                    policy.capabilities.contains(*c)
                        && (consent.capabilities.contains(*c) || preview.inherited.contains(*c))
                })
                .cloned()
                .collect();
            if preview
                .candidate
                .required_capabilities
                .iter()
                .any(|c| !selected.contains(c))
            {
                return Err(Error::Denied);
            }
            let level = install.map_or(Level::L0, |i| historical(l, i));
            if level > preview.historical_level {
                return Err(Error::Conflict);
            }
            if selected.contains("network.publicHttps")
                && (level.max(consent.read_ceiling) >= Level::L1 && !consent.user_linked_network
                    || level.max(consent.read_ceiling) >= Level::L2)
            {
                return Err(Error::Denied);
            }
            let old_data = l.namespaces.get(&install_id).cloned().unwrap_or_default();
            let mut data = old_data.clone();
            match migration {
                DataMigration::Copy => {}
                DataMigration::Rename { from, to } => {
                    if !crate::model::valid_id(&from)
                        || !crate::model::valid_id(&to)
                        || data.contains_key(&to)
                    {
                        return Err(Error::Conflict);
                    }
                    if let Some(value) = data.remove(&from) {
                        data.insert(to, value);
                    }
                }
            }
            let generation = old.as_ref().map_or(Ok(1), |p| {
                p.identity.generation.checked_add(1).ok_or(Error::Corrupt)
            })?;
            for value in data.values_mut() {
                value.provenance.generation = generation;
                value.provenance.data_generation = generation;
            }
            let identity = Identity {
                install_id: install_id.clone(),
                plugin_id: preview.candidate.plugin_id.clone(),
                content_hash: preview.candidate.package_hash.clone(),
                publisher: preview.candidate.signer.clone().unwrap_or_else(|| {
                    format!("unverified:{}", &preview.candidate.package_hash[..32])
                }),
                generation,
                data_generation: generation,
            };
            let was_enabled = install.is_some_and(|i| i.enabled);
            let suspended_epoch = preview.epoch.checked_add(1).ok_or(Error::Corrupt)?;
            if let Some(install) = l.installs.get_mut(&install_id) {
                install.enabled = false;
                install.epoch = suspended_epoch;
            }
            invalidate(l, &install_id);
            let journal = InstallJournal {
                candidate: PackageRecord {
                    identity,
                    candidate: preview.candidate.clone(),
                    data_hash: String::new(),
                    rollback: None,
                    installed: true,
                    granted_capabilities: selected,
                },
                old,
                old_data,
                data,
                suspended_epoch,
                was_enabled,
                committed: false,
            };
            l.install_journal
                .insert(journal_id.clone(), journal.clone());
            Ok(journal)
        })?;
        files.checkpoint(InstallPoint::Prepared)?;
        if let Some(old) = &mut journal.old {
            old.data_hash = files.publish_data(&journal.old_data)?;
            old.rollback = None;
        }
        files.checkpoint(InstallPoint::OldDataDurable)?;
        if cancelled() {
            return Err(Error::Expired);
        }
        files.publish_code(&journal.candidate.candidate)?;
        files.checkpoint(InstallPoint::CodeDurable)?;
        journal.candidate.data_hash = files.publish_data(&journal.data)?;
        files.checkpoint(InstallPoint::DataDurable)?;
        journal.candidate.rollback = journal.old.clone().map(Box::new);
        files.verify_pair(&journal.candidate)?;
        files.checkpoint(InstallPoint::Published)?;
        self.store.transaction(|l| {
            l.install_journal
                .insert(journal_id.clone(), journal.clone());
            Ok(())
        })?;
        files.checkpoint(InstallPoint::BeforeCommit)?;
        if self.clock.now_ms() >= preview.expires_at_ms {
            return Err(Error::Expired);
        }
        if cancelled() {
            return Err(Error::Expired);
        }
        let identity = journal.candidate.identity.clone();
        self.store.transaction(|l| {
            validate(l)?;
            if l.revocations.sequence != preview.revocation_sequence
                || l.revocations.denies(&journal.candidate.candidate)
                || l.installs
                    .get(&install_id)
                    .is_some_and(|i| i.epoch != journal.suspended_epoch)
            {
                return Err(Error::Conflict);
            }
            clear_grants(l, &install_id);
            let mut actual = journal.candidate.clone();
            // Persist only effective capabilities. Optional unavailable/unconfirmed rights disappear.
            actual.granted_capabilities.retain(|c| {
                policy.capabilities.contains(c)
                    && (consent.capabilities.contains(c) || preview.inherited.contains(c))
            });
            let level = preview.historical_level.max(
                journal
                    .data
                    .values()
                    .map(|v| v.provenance.level)
                    .max()
                    .unwrap_or(Level::L0),
            );
            l.history
                .entry(crate::model::lineage(&identity))
                .and_modify(|v| *v = (*v).max(level))
                .or_insert(level);
            l.installs.insert(
                install_id.clone(),
                Install {
                    identity: identity.clone(),
                    epoch: journal
                        .suspended_epoch
                        .checked_add(1)
                        .ok_or(Error::Corrupt)?,
                    enabled: true,
                    historical_level: level,
                },
            );
            l.grants.insert(
                install_id.clone(),
                Grant {
                    identity: identity.clone(),
                    read_ceiling: consent.read_ceiling,
                    state: actual.granted_capabilities.contains("state.write")
                        || actual.granted_capabilities.contains("state.read"),
                    annotate: false,
                    expires_at_ms: now.saturating_add(NETWORK_IDLE_MS),
                },
            );
            if actual.granted_capabilities.contains("network.publicHttps") {
                l.network_grants.insert(
                    install_id.clone(),
                    NetworkGrant {
                        identity: identity.clone(),
                        scope: NetworkScope::Public,
                        ceiling: consent.read_ceiling,
                        user_linked_approved: consent.user_linked_network,
                        // Until the SDK has a private-egress declaration, L2 egress remains closed.
                        private_egress_declared: false,
                        private_egress_approved: false,
                        expires_at_ms: now.saturating_add(NETWORK_IDLE_MS),
                        last_used_at_ms: now,
                    },
                );
            }
            if consent.pin_publisher
                && let Some(signer) = &actual.candidate.signer
            {
                l.revocations
                    .pinned_publishers
                    .insert(identity.plugin_id.clone(), signer.clone());
            }
            l.namespaces
                .insert(install_id.clone(), journal.data.clone());
            l.packages.insert(install_id.clone(), actual);
            l.install_journal
                .get_mut(&journal_id)
                .ok_or(Error::Corrupt)?
                .committed = true;
            Ok(())
        })?;
        files.checkpoint(InstallPoint::Committed)?;
        self.store.transaction(|l| {
            l.install_journal.remove(&journal_id);
            Ok(())
        })?;
        Ok(identity)
    }

    /// Must run at startup and before every executable load. Pair verification is repeated
    /// from owned package bytes; missing/tampered artifacts disable without deleting data.
    pub fn recover_packages(&mut self, files: &mut impl InstallFiles) -> Result<(), Error> {
        self.store.transaction(|l| {
            let journals = std::mem::take(&mut l.install_journal);
            for journal in journals.values().filter(|j| !j.committed) {
                let id = &journal.candidate.identity.install_id;
                if let Some(old) = &journal.old {
                    let can_resume = l
                        .installs
                        .get(id)
                        .is_some_and(|i| i.identity == old.identity)
                        && l.grants.contains_key(id);
                    l.packages.insert(id.clone(), old.clone());
                    l.namespaces.insert(id.clone(), journal.old_data.clone());
                    if let Some(install) = l.installs.get_mut(id) {
                        install.enabled = journal.was_enabled && can_resume;
                        install.epoch = install.epoch.checked_add(1).ok_or(Error::Corrupt)?;
                    }
                }
            }
            let records = l.packages.clone();
            for (id, record) in &records {
                if l.revocations.denies(&record.candidate) || files.verify_pair(record).is_err() {
                    if let Some(install) = l.installs.get_mut(id) {
                        install.enabled = false;
                        install.epoch = install.epoch.checked_add(1).ok_or(Error::Corrupt)?;
                        if let Some(mut old) = record.rollback.as_deref().cloned()
                            && !l.revocations.denies(&old.candidate)
                            && files.verify_pair(&old).is_ok()
                        {
                            let mut data = files.load_data(&old)?;
                            old.identity.generation = install
                                .identity
                                .generation
                                .checked_add(1)
                                .ok_or(Error::Corrupt)?;
                            old.identity.data_generation = old.identity.generation;
                            for value in data.values_mut() {
                                value.provenance.generation = old.identity.generation;
                                value.provenance.data_generation = old.identity.data_generation;
                            }
                            install.identity = old.identity.clone();
                            old.granted_capabilities.clear();
                            l.packages.insert(id.clone(), old);
                            l.namespaces.insert(id.clone(), data);
                        }
                    }
                    l.grants.remove(id);
                    l.network_grants.remove(id);
                }
            }
            // Sessions are never resurrected by recovery, including successful committed pairs.
            l.sessions.clear();
            l.contexts.clear();
            l.exits.clear();
            l.tasks.retain(|_, t| t.committed_version.is_some());
            validate(l)
        })?;
        files.checkpoint(InstallPoint::Recovered)
    }

    /// Only a package-verifier-checked, app-root-signed list enters this host-only API.
    /// Known revocations are unioned forever, including while offline/refresh disabled.
    pub fn apply_revocations(
        &mut self,
        list: am_plugin_protocol::PackageRevocations,
    ) -> Result<(), Error> {
        let now = self.clock.now_ms();
        self.store.transaction(|l| {
            if list.sequence as u64 <= l.revocations.sequence
                || list.issued_at_ms < 0
                || list.issued_at_ms as u64 > now
                || list.expires_at_ms <= list.issued_at_ms
                || list.expires_at_ms as u64 <= now
                || (list.issued_at_ms as u64) < l.revocations.issued_at_ms
            {
                return Err(Error::Replay);
            }
            let r = &mut l.revocations;
            r.sequence = list.sequence as u64;
            r.issued_at_ms = list.issued_at_ms as u64;
            r.expires_at_ms = list.expires_at_ms as u64;
            r.plugin_ids.extend(list.plugin_ids);
            r.hashes.extend(list.package_hashes);
            r.publishers.extend(list.publisher_keys);
            if r.plugin_ids.len() + r.hashes.len() + r.publishers.len() > MAX_LEDGER_ROWS {
                return Err(Error::Budget);
            }
            let denied: Vec<_> = l
                .packages
                .iter()
                .filter(|(_, p)| l.revocations.denies(&p.candidate))
                .map(|(id, _)| id.clone())
                .collect();
            for id in denied {
                let i = l.installs.get_mut(&id).ok_or(Error::Corrupt)?;
                i.enabled = false;
                i.epoch = i.epoch.checked_add(1).ok_or(Error::Corrupt)?;
                clear_grants(l, &id);
            }
            Ok(())
        })
    }

    pub fn uninstall_package(&mut self, id: &str) -> Result<(), Error> {
        self.revoke(id)?;
        self.store.transaction(|l| {
            l.packages.get_mut(id).ok_or(Error::Denied)?.installed = false;
            Ok(())
        })
    }
    pub fn delete_package_data(&mut self, id: &str) -> Result<(), Error> {
        self.store.transaction(|l| {
            let install = l.installs.get(id).ok_or(Error::Denied)?;
            if install.enabled
                || l.packages.get(id).is_some_and(|p| p.installed)
                || l.install_journal
                    .values()
                    .any(|j| j.candidate.identity.install_id == id)
            {
                return Err(Error::Denied);
            }
            l.namespaces.remove(id);
            // Erasure does not erase revocations/history or create a new trusted publisher.
            if let Some(record) = l.packages.get_mut(id) {
                record.rollback = None;
                record.data_hash.clear();
            }
            Ok(())
        })
    }
    pub fn gc_packages(&mut self, files: &mut impl InstallFiles) -> Result<(), Error> {
        self.store.transaction(|l| {
            let mut code = BTreeSet::new();
            let mut data = BTreeSet::new();
            fn keep(p: &PackageRecord, code: &mut BTreeSet<String>, data: &mut BTreeSet<String>) {
                code.insert(p.candidate.package_hash.clone());
                data.insert(p.data_hash.clone());
                if let Some(old) = &p.rollback {
                    keep(old, code, data);
                }
            }
            for p in l.packages.values() {
                keep(p, &mut code, &mut data);
            }
            for j in l.install_journal.values() {
                keep(&j.candidate, &mut code, &mut data);
                if let Some(p) = &j.old {
                    keep(p, &mut code, &mut data);
                }
            }
            files.gc(&code, &data)
        })
    }
}
