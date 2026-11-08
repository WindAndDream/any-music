use am_plugin_package::{INTEGRITY_DOMAIN, verify, verify_signature};
use am_plugin_protocol::PackageSignature;
use serde_json::Value;
// Corpus is SDK-owned raw bytes, never a Rust-generated approximation of a malicious archive.
fn base64(s: &str) -> Vec<u8> {
    let alphabet = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut buffer = 0u32;
    let mut bits = 0;
    let mut output = Vec::new();
    for byte in s.bytes().filter(|b| *b != b'=') {
        let value = alphabet.iter().position(|b| *b == byte).unwrap() as u32;
        buffer = (buffer << 6) | value;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    output
}
#[test]
fn shared_package_corpus_and_node_ed25519_vectors() {
    let corpus: Vec<Value> = serde_json::from_str(include_str!(
        "../../../packages/plugin-sdk/test/fixtures/packages/corpus.json"
    ))
    .unwrap();
    assert!(corpus.iter().filter(|c| c["ok"] == true).count() >= 4);
    for case in corpus {
        let result = verify(base64(case["base64"].as_str().unwrap()), || false);
        assert_eq!(
            result.is_ok(),
            case["ok"].as_bool().unwrap(),
            "{}: {:?}",
            case["name"],
            result.err()
        );
        if let Err(error) = result {
            assert_eq!(
                format!("{error:?}"),
                case["error"].as_str().unwrap(),
                "{}",
                case["name"]
            );
        }
    }
    let golden: Value = serde_json::from_str(include_str!(
        "../../../packages/plugin-sdk/test/fixtures/packages/golden.json"
    ))
    .unwrap();
    let envelope: PackageSignature = serde_json::from_value(golden["envelope"].clone()).unwrap();
    let raw = base64(golden["raw"].as_str().unwrap());
    assert!(verify_signature(INTEGRITY_DOMAIN, &raw, &envelope).is_ok());
    assert!(verify_signature(b"wrong-domain", &raw, &envelope).is_err());
    let mut edited = raw;
    edited.push(b' ');
    assert!(verify_signature(INTEGRITY_DOMAIN, &edited, &envelope).is_err());
}
#[test]
fn cancellation_is_checked_before_parser_allocation() {
    assert!(matches!(
        verify(vec![], || true),
        Err(am_plugin_package::Error::Cancelled)
    ));
}
