/// Native callers supply these identities from their channel, never from a plugin DTO.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Subject<'a> {
    pub install_id: &'a str,
    pub session_id: &'a str,
    pub permission_epoch: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Operation {
    StateRead,
    StateWrite,
    PublicHttps,
    Sha256,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum DataLevel {
    Public,
    UserLinked,
    Private,
    Secret,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Budget {
    pub requests: u64,
    pub bytes: u64,
    pub concurrent: u64,
}

pub struct PolicySnapshot<'a> {
    pub subject: Subject<'a>,
    pub enabled: bool,
    pub expires_at_ms: u64,
    pub scopes: &'a [&'a str],
    pub grants: &'a [Operation],
    pub data_ceiling: DataLevel,
    /// Highest level ever delivered or stored; narrowing the current selection cannot lower it.
    pub historical_data_level: DataLevel,
    pub exfiltration_approved: bool,
    pub limit: Budget,
    pub used: Budget,
}

pub struct PolicyCall<'a> {
    pub subject: Subject<'a>,
    pub operation: Operation,
    pub scope: &'a str,
    pub deadline_ms: u64,
    pub data_level: DataLevel,
    pub cost: Budget,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Denial {
    Subject,
    Disabled,
    Expired,
    Scope,
    Capability,
    Data,
    PrivateEgress,
    Budget,
}

/// A decision value for a native dispatcher, not a serializable authorization token.
/// The future runtime must serialize reservation/commit with revocation and retain provenance.
pub fn evaluate(
    snapshot: &PolicySnapshot<'_>,
    call: &PolicyCall<'_>,
    now_ms: u64,
) -> Result<(), Denial> {
    if snapshot.subject != call.subject
        || call.subject.install_id.is_empty()
        || call.subject.session_id.is_empty()
    {
        return Err(Denial::Subject);
    }
    if !snapshot.enabled {
        return Err(Denial::Disabled);
    }
    if now_ms >= snapshot.expires_at_ms || now_ms >= call.deadline_ms {
        return Err(Denial::Expired);
    }
    if call.scope.is_empty() || !snapshot.scopes.contains(&call.scope) {
        return Err(Denial::Scope);
    }
    if !snapshot.grants.contains(&call.operation) {
        return Err(Denial::Capability);
    }
    // Selected private data remains L2; destination restrictions do not reduce this risk.
    let data_level = snapshot.historical_data_level.max(call.data_level);
    if data_level == DataLevel::Secret || call.data_level > snapshot.data_ceiling {
        return Err(Denial::Data);
    }
    if snapshot.grants.contains(&Operation::PublicHttps)
        && data_level >= DataLevel::Private
        && !snapshot.exfiltration_approved
    {
        return Err(Denial::PrivateEgress);
    }
    for (used, cost, limit) in [
        (
            snapshot.used.requests,
            call.cost.requests,
            snapshot.limit.requests,
        ),
        (snapshot.used.bytes, call.cost.bytes, snapshot.limit.bytes),
        (
            snapshot.used.concurrent,
            call.cost.concurrent,
            snapshot.limit.concurrent,
        ),
    ] {
        if used.checked_add(cost).is_none_or(|total| total > limit) {
            return Err(Denial::Budget);
        }
    }
    Ok(())
}
