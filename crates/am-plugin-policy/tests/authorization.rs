use am_plugin_policy::*;

#[test]
fn rejects_stale_subject_scope_expiry_and_missing_grants() {
    let subject = Subject {
        install_id: "install",
        session_id: "session",
        permission_epoch: 2,
    };
    let mut snapshot = PolicySnapshot {
        subject,
        enabled: true,
        expires_at_ms: 100,
        scopes: &["context:selection"],
        grants: &[Operation::StateRead],
        data_ceiling: DataLevel::Private,
        historical_data_level: DataLevel::Public,
        exfiltration_approved: false,
        limit: Budget {
            requests: 2,
            bytes: 64,
            concurrent: 1,
        },
        used: Budget {
            requests: 1,
            bytes: 32,
            concurrent: 0,
        },
    };
    let mut call = PolicyCall {
        subject,
        operation: Operation::StateRead,
        scope: "context:selection",
        deadline_ms: 100,
        data_level: DataLevel::Public,
        cost: Budget {
            requests: 1,
            bytes: 32,
            concurrent: 1,
        },
    };
    assert_eq!(evaluate(&snapshot, &call, 99), Ok(()));
    for forged in [
        Subject {
            install_id: "other",
            ..subject
        },
        Subject {
            session_id: "other",
            ..subject
        },
        Subject {
            permission_epoch: 1,
            ..subject
        },
    ] {
        call.subject = forged;
        assert_eq!(evaluate(&snapshot, &call, 1), Err(Denial::Subject));
    }
    call.subject = subject;
    assert_eq!(evaluate(&snapshot, &call, 100), Err(Denial::Expired));
    call.scope = "context:guessed";
    assert_eq!(evaluate(&snapshot, &call, 1), Err(Denial::Scope));
    call.scope = "context:selection";
    call.operation = Operation::StateWrite;
    assert_eq!(evaluate(&snapshot, &call, 1), Err(Denial::Capability));
    call.operation = Operation::StateRead;
    snapshot.enabled = false;
    assert_eq!(evaluate(&snapshot, &call, 1), Err(Denial::Disabled));
    snapshot.enabled = true;
    snapshot.expires_at_ms = 1;
    assert_eq!(evaluate(&snapshot, &call, 1), Err(Denial::Expired));
}

#[test]
fn private_history_and_new_private_reads_require_egress_approval() {
    let subject = Subject {
        install_id: "install",
        session_id: "session",
        permission_epoch: 1,
    };
    let budget = Budget {
        requests: 1,
        bytes: 1,
        concurrent: 1,
    };
    let zero = Budget {
        requests: 0,
        bytes: 0,
        concurrent: 0,
    };
    let mut snapshot = PolicySnapshot {
        subject,
        enabled: true,
        expires_at_ms: 100,
        scopes: &["selected"],
        grants: &[Operation::PublicHttps, Operation::StateRead],
        data_ceiling: DataLevel::Private,
        historical_data_level: DataLevel::Private,
        exfiltration_approved: false,
        limit: budget,
        used: zero,
    };
    let mut call = PolicyCall {
        subject,
        operation: Operation::PublicHttps,
        scope: "selected",
        deadline_ms: 100,
        data_level: DataLevel::Public,
        cost: budget,
    };
    assert_eq!(evaluate(&snapshot, &call, 0), Err(Denial::PrivateEgress));
    snapshot.historical_data_level = DataLevel::Public;
    call.operation = Operation::StateRead;
    call.data_level = DataLevel::Private;
    assert_eq!(evaluate(&snapshot, &call, 0), Err(Denial::PrivateEgress));
    snapshot.exfiltration_approved = true;
    assert_eq!(evaluate(&snapshot, &call, 0), Ok(()));
    snapshot.data_ceiling = DataLevel::UserLinked;
    assert_eq!(evaluate(&snapshot, &call, 0), Err(Denial::Data));
    snapshot.data_ceiling = DataLevel::Secret;
    call.data_level = DataLevel::Secret;
    assert_eq!(evaluate(&snapshot, &call, 0), Err(Denial::Data));
    call.data_level = DataLevel::UserLinked;
    snapshot.exfiltration_approved = false;
    assert_eq!(evaluate(&snapshot, &call, 0), Ok(()));
}

#[test]
fn cumulative_limits_and_overflow_fail_closed() {
    let subject = Subject {
        install_id: "i",
        session_id: "s",
        permission_epoch: 1,
    };
    let mut snapshot = PolicySnapshot {
        subject,
        enabled: true,
        expires_at_ms: 10,
        scopes: &["c"],
        grants: &[Operation::Sha256],
        data_ceiling: DataLevel::Public,
        historical_data_level: DataLevel::Public,
        exfiltration_approved: false,
        limit: Budget {
            requests: 1,
            bytes: 1,
            concurrent: 1,
        },
        used: Budget {
            requests: 0,
            bytes: 0,
            concurrent: 0,
        },
    };
    let call = PolicyCall {
        subject,
        operation: Operation::Sha256,
        scope: "c",
        deadline_ms: 10,
        data_level: DataLevel::Public,
        cost: Budget {
            requests: 1,
            bytes: 1,
            concurrent: 1,
        },
    };
    for used in [
        Budget {
            requests: 1,
            bytes: 0,
            concurrent: 0,
        },
        Budget {
            requests: 0,
            bytes: 1,
            concurrent: 0,
        },
        Budget {
            requests: 0,
            bytes: 0,
            concurrent: 1,
        },
        Budget {
            requests: u64::MAX,
            bytes: 0,
            concurrent: 0,
        },
    ] {
        snapshot.used = used;
        assert_eq!(evaluate(&snapshot, &call, 0), Err(Denial::Budget));
    }
}
