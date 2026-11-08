//! Manual rollback consumes a verified native preview under the same transaction as revoke.
//! Crash recovery remains independent of user confirmation and never restores grants.
use crate::authority::validate;
use crate::install::{accepts, clear_grants};
use crate::*;

impl<S: Store, C: Clock, I: Ids> Runtime<S, C, I> {
    pub fn preview_rollback(
        &mut self,
        id: &str,
        policy: &InstallPolicy,
        files: &mut impl InstallFiles,
    ) -> Result<RollbackPreview, Error> {
        let now = self.clock.now_ms();
        self.store.transaction(|ledger| {
            validate(ledger)?;
            let current = ledger.packages.get(id).ok_or(Error::Denied)?;
            let install = ledger.installs.get(id).ok_or(Error::Denied)?;
            let record = current.rollback.as_deref().ok_or(Error::Denied)?;
            if !current.installed
                || current.identity != install.identity
                || !accepts(&record.candidate, policy)
                || ledger.revocations.denies(&record.candidate)
                || ledger
                    .install_journal
                    .values()
                    .any(|j| !j.committed && j.candidate.identity.install_id == id)
            {
                return Err(Error::Denied);
            }
            files.verify_pair(record)?;
            Ok(RollbackPreview {
                previous: install.identity.clone(),
                record: record.clone(),
                epoch: install.epoch,
                revocation_sequence: ledger.revocations.sequence,
                expires_at_ms: now.saturating_add(MAX_LIFETIME_MS),
            })
        })
    }

    /// The host supplies explicit approval by consuming this opaque preview. Recheck policy,
    /// verified bytes and every mutable binding before changing either data or authority.
    pub fn rollback_package(
        &mut self,
        preview: RollbackPreview,
        policy: &InstallPolicy,
        files: &mut impl InstallFiles,
        cancelled: impl Fn() -> bool,
    ) -> Result<(), Error> {
        if !accepts(&preview.record.candidate, policy) || cancelled() {
            return Err(Error::Denied);
        }
        if self.clock.now_ms() >= preview.expires_at_ms {
            return Err(Error::Expired);
        }
        let clock = &self.clock;
        self.store.transaction(|ledger| {
            validate(ledger)?;
            let id = &preview.previous.install_id;
            let current = ledger.packages.get(id).ok_or(Error::Denied)?;
            let install = ledger.installs.get(id).ok_or(Error::Denied)?;
            let record = current.rollback.as_deref().ok_or(Error::Denied)?;
            if !current.installed
                || current.identity != preview.previous
                || install.identity != preview.previous
                || install.epoch != preview.epoch
                || ledger.revocations.sequence != preview.revocation_sequence
                || ledger.revocations.denies(&record.candidate)
                || record.identity != preview.record.identity
                || record.candidate != preview.record.candidate
                || record.data_hash != preview.record.data_hash
                || ledger
                    .install_journal
                    .values()
                    .any(|j| !j.committed && j.candidate.identity.install_id == *id)
            {
                return Err(Error::Conflict);
            }
            files.verify_pair(record)?;
            let mut data = files.load_data(record)?;
            let mut record = record.clone();
            let generation = install
                .identity
                .generation
                .checked_add(1)
                .ok_or(Error::Corrupt)?;
            let epoch = install.epoch.checked_add(1).ok_or(Error::Corrupt)?;
            if cancelled() {
                return Err(Error::Denied);
            }
            if clock.now_ms() >= preview.expires_at_ms {
                return Err(Error::Expired);
            }
            record.identity.generation = generation;
            record.identity.data_generation = generation;
            for value in data.values_mut() {
                value.provenance.generation = generation;
                value.provenance.data_generation = generation;
            }
            record.granted_capabilities.clear();
            clear_grants(ledger, id);
            let install = ledger.installs.get_mut(id).ok_or(Error::Denied)?;
            install.enabled = false;
            install.epoch = epoch;
            install.identity = record.identity.clone();
            ledger.packages.insert(id.clone(), record);
            ledger.namespaces.insert(id.clone(), data);
            Ok(())
        })
    }
}
