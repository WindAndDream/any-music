use am_plugin_net::{Scope, Target, public_address};

#[test]
fn special_numeric_translation_and_credential_targets_fail_closed() {
    for host in [
        "0.0.0.0",
        "10.0.0.1",
        "100.64.0.1",
        "127.0.0.1",
        "169.254.169.254",
        "172.16.0.1",
        "192.168.1.1",
        "192.0.0.9",
        "192.0.2.1",
        "198.18.0.1",
        "198.51.100.1",
        "203.0.113.1",
        "224.0.0.1",
        "255.255.255.255",
        "[::1]",
        "[::ffff:8.8.8.8]",
        "[64:ff9b::808:808]",
        "[2002:808:808::]",
        "[2001:db8::1]",
        "[3fff::1]",
        "[fc00::1]",
        "[fe80::1]",
        "[ff00::1]",
        "2130706433",
        "0x7f000001",
        "127.1",
        "0177.0.0.1",
        "localhost",
        "a.local",
        "a.internal",
        "a.test",
    ] {
        assert!(
            Target::parse(&format!("https://{host}/"), &Scope::Public).is_err(),
            "{host}"
        );
    }
    for input in [
        "http://example.com/",
        "https://a:password@example.com/",
        "https://example.com:8443/",
        "https://example.com/#fragment",
        "https://example.com/\r\nX:1",
        "https://example.com\\@evil.com/",
    ] {
        assert!(Target::parse(input, &Scope::Public).is_err(), "{input}");
    }
    for ip in ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"] {
        assert!(public_address(ip.parse().unwrap()));
    }
}
#[test]
fn normalized_hosts_keep_exact_scope_boundaries() {
    assert!(Target::parse("https://example.com../", &Scope::Public).is_err());
    assert!(Target::parse("https://[2606:4700:4700::1111]/", &Scope::Public).is_ok());
    let scope = Scope::Hosts(vec!["例子.中国:443".into(), "example.com".into()]);
    assert_eq!(
        Target::parse("https://EXAMPLE.COM.:443/a", &scope)
            .unwrap()
            .host(),
        "example.com"
    );
    assert!(Target::parse("https://例子.中国/", &scope).is_ok());
    for host in ["sub.example.com", "example.com.evil.com", "other.com"] {
        assert!(Target::parse(&format!("https://{host}/"), &scope).is_err());
    }
    assert!(
        Target::parse(
            "https://example.com/",
            &Scope::Hosts(vec!["*.example.com".into()])
        )
        .is_err()
    );
}
#[test]
fn every_dns_candidate_must_be_public() {
    let target = Target::parse("https://example.com/", &Scope::Public).unwrap();
    assert!(target.validate_addresses(&[]).is_err());
    assert!(
        target
            .validate_addresses(&["8.8.8.8".parse().unwrap(), "127.0.0.1".parse().unwrap()])
            .is_err()
    );
    assert!(
        target
            .validate_addresses(&["8.8.8.8".parse().unwrap(), "1.1.1.1".parse().unwrap()])
            .is_ok()
    );
}
