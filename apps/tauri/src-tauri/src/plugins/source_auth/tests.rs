use super::*;
use crate::state::RuntimeState;
use base64::Engine;

#[test]
fn ordinary_packages_return_no_auth_context_and_release_the_preparation_session() {
    let directory =
        std::env::temp_dir().join(format!("am-source-ordinary-{}", uuid::Uuid::new_v4()));
    let mut authority = PluginAuthority::new(directory.clone());
    Arc::get_mut(&mut authority).unwrap().admitted = true;
    let corpus: Vec<Json> = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/plugin-sdk/test/fixtures/packages/corpus.json"
    )))
    .unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(
            corpus
                .iter()
                .find(|item| item["name"] == "unsigned-store")
                .unwrap()["base64"]
                .as_str()
                .unwrap(),
        )
        .unwrap();
    let preview = authority.preview_package(bytes).unwrap();
    let installed = authority
        .commit_preview(
            &preview.token,
            am_plugin_runtime::InstallConsent {
                capabilities: Default::default(),
                pin_publisher: false,
                transfer_data: false,
                read_ceiling: Level::L0,
                user_linked_network: false,
                private_network: false,
            },
        )
        .unwrap();
    assert!(
        Context::try_open(authority.clone(), &installed.install_id, "query", Level::L1)
            .unwrap()
            .is_none()
    );
    assert!(authority.source_contexts.lock().unwrap().is_empty());
    assert!(authority.with(|r| r.snapshot()).unwrap()[0].enabled);
    drop(authority);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn verified_gateway_context_requires_real_grants_and_rechecks_revocation() {
    let directory = std::env::temp_dir().join(format!("am-source-gate-{}", uuid::Uuid::new_v4()));
    let mut authority = PluginAuthority::new(directory.clone());
    Arc::get_mut(&mut authority).unwrap().admitted = true;
    let fixture: Json = serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../../packages/plugin-sdk/test/fixtures/packages/source-gateway.json"
    )))
    .unwrap();
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(fixture["base64"].as_str().unwrap())
        .unwrap();
    let preview = authority.preview_package(bytes).unwrap();
    let installed = authority
        .commit_preview(
            &preview.token,
            am_plugin_runtime::InstallConsent {
                capabilities: ["source.authentication".into(), "network.publicHttps".into()].into(),
                pin_publisher: false,
                transfer_data: false,
                read_ceiling: Level::L1,
                user_linked_network: true,
                private_network: false,
            },
        )
        .unwrap();
    let context = Context::open(
        authority.clone(),
        &installed.install_id,
        "public search",
        Level::L1,
    )
    .unwrap();
    let gate = context.gate().unwrap();
    assert!(context.require_binding(Some(&context.binding)).is_ok());
    assert!(context.require_binding(Some("outdated-display")).is_err());
    assert!(context.require_binding(None).is_err());
    assert!(gate.check(Exit::Sandbox).is_ok());
    // Distinct native operations must not collide on a shared executor channel.
    let parallel =
        Context::open(authority.clone(), &installed.install_id, "other", Level::L0).unwrap();
    assert!(parallel.gate().unwrap().check(Exit::Sandbox).is_ok());
    cancel_contexts(&authority, &installed.install_id).unwrap();
    assert!(gate.check(Exit::Sandbox).is_err());
    let after_cancel = Context::open(
        authority.clone(),
        &installed.install_id,
        "new foreground request",
        Level::L1,
    )
    .unwrap();
    assert!(after_cancel.gate().unwrap().check(Exit::Sandbox).is_ok());
    authority.with(|r| r.revoke(&installed.install_id)).unwrap();
    assert!(
        gate.deliver(Exit::Sandbox, 0, &mut || panic!("revoked delivery"))
            .is_err()
    );
    assert!(Context::open(authority.clone(), &installed.install_id, "late", Level::L0).is_err());
    drop(gate);
    drop(context);
    drop(parallel);
    drop(after_cancel);
    drop(authority);
    std::fs::remove_dir_all(directory).unwrap();
}

fn pending(login: &str) -> Pending {
    let now = Instant::now();
    Pending {
        login: login.into(),
        method: "credentials".into(),
        challenge: "challenge".into(),
        expires: now + Duration::from_secs(60),
        next_poll: now,
        next_sms: now,
    }
}

#[test]
fn source_operations_serialize_and_old_cancellation_cannot_stop_a_replacement() {
    let state = AuthState::default();
    state
        .pending
        .lock()
        .unwrap()
        .insert("account".into(), pending("new"));
    let flight = state.acquire("account", "new").unwrap();
    assert!(state.acquire("account", "other").is_err());
    state.cancel_login("account", "old");
    assert!(!flight.cancel.is_cancelled());
    assert!(state.pending.lock().unwrap().contains_key("account"));
    state.cancel_login("account", "new");
    assert!(flight.cancel.is_cancelled());
    assert!(state.pending.lock().unwrap().is_empty());
    drop(flight);
    assert!(state.acquire("account", "retry").is_ok());
}

#[test]
fn sms_cooldown_survives_cancellation_reselection_and_new_login_ids() {
    let state = AuthState::default();
    let now = Instant::now();
    state.reserve_sms("account", now).unwrap();
    state.cancel("account");
    assert!(
        state
            .reserve_sms("account", now + Duration::from_secs(59))
            .is_err()
    );
    assert!(state.reserve_sms("other", now).is_ok());
    assert!(
        state
            .reserve_sms("account", now + Duration::from_secs(60))
            .is_ok()
    );
}

fn draft(state: &RuntimeState, name: &str) -> crate::model::Account {
    let account=serde_json::from_value::<crate::model::Account>(json!({
        "id":uuid::Uuid::new_v4().to_string(),"platformId":"external:installation", "name":name,
        "status":"signed-out","state":{"login":"signed-out","verification":"not-required","connection":"unknown"},
        "enabled":true,"authentication":"credential","pending":true,"userAgent":"","webId":"","proxyId":null,"backupProxyIds":[]
    })).unwrap();
    state
        .mutate(|s| {
            s.accounts.push(account.clone());
            Ok(())
        })
        .unwrap();
    account
}

#[test]
fn native_confirmation_admits_once_and_encrypts_credentials_without_snapshot_secrets() {
    let directory = std::env::temp_dir().join(format!("am-source-auth-{}", uuid::Uuid::new_v4()));
    let state = RuntimeState::new(directory.clone()).unwrap();
    *state.key.lock().unwrap() = Some([7; 32]);
    let a = draft(&state, "first");
    let b = draft(&state, "second");
    assert!(state.snapshot.lock().unwrap().account_history.is_empty());
    let secret = Credential {
        binding: "config-a".into(),
        token: "synthetic-private-token".into(),
        user_id: "user@example".into(),
    };
    for account in [&a, &b] {
        state
            .source_auth
            .pending
            .lock()
            .unwrap()
            .insert(account.id.clone(), pending("login"));
    }
    let cancelled = CancellationToken::new();
    cancelled.cancel();
    assert!(commit(&state, &a.id, "login", &secret, &cancelled).is_err());
    assert!(!directory.join(format!("{}.vault", a.id)).exists());
    commit(&state, &a.id, "login", &secret, &CancellationToken::new()).unwrap();
    assert!(!state.account(&a.id).unwrap().pending);
    assert_eq!(state.snapshot.lock().unwrap().account_history.len(), 1);
    let stored = std::fs::read_to_string(directory.join("accounts.json")).unwrap();
    assert!(!stored.contains(&secret.token));
    let vault = std::fs::read(directory.join(format!("{}.vault", a.id))).unwrap();
    assert!(
        !vault
            .windows(secret.token.len())
            .any(|b| b == secret.token.as_bytes())
    );
    let current = state.account(&a.id).unwrap();
    assert_eq!(
        read_credential(&state, &current, "config-a").unwrap().token,
        secret.token
    );
    assert!(read_credential(&state, &current, "config-b").is_err());
    assert_eq!(
        state.account(&a.id).unwrap().state.login,
        crate::accounts::state::LoginState::SignedOut
    );
    assert!(commit(&state, &b.id, "login", &secret, &CancellationToken::new()).is_err());
    assert!(!directory.join(format!("{}.vault", b.id)).exists());
    let deletion = state.usage.delete(&b.id).unwrap();
    let other = Credential {
        user_id: "other".into(),
        ..secret
    };
    assert!(commit(&state, &b.id, "login", &other, &CancellationToken::new()).is_err());
    drop(deletion);
    drop(state);
    std::fs::remove_dir_all(directory).unwrap();
}

#[test]
fn credential_fields_and_phone_inputs_are_bounded_before_transport() {
    let config:SourceAuthentication=am_plugin_protocol::decode(serde_json::to_vec(&json!({
        "protocolVersion":1,"apiBaseUrl":"https://api.example.com/music/","allowUnauthenticated":false,
        "methods":["credentials"],"credentialFields":[{"id":"token","label":{"en":"Token","zh-CN":"Token"},"secret":true}]
    })).unwrap().as_slice()).unwrap();
    assert!(validate_fields(&config, &[("token".into(), "secret".into())].into()).is_ok());
    assert!(validate_fields(&config, &BTreeMap::new()).is_err());
    assert!(validate_fields(&config, &[("token".into(), "x".repeat(4097))].into()).is_err());
    assert!(validate_fields(&config, &[("extra".into(), "x".into())].into()).is_err());
    assert!(valid_phone("+8613800000000"));
    for phone in ["+", "123", "+86 13800000000", "１２３４５６７８"] {
        assert!(!valid_phone(phone));
    }
}
