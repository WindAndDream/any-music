use am_plugin_protocol::{HostRequest, HostResponse, PluginManifest, decode, decode_value};
use serde_json::Value;
use std::path::PathBuf;

fn corpus() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/plugin-sdk/test/fixtures/corpus")
}

#[test]
fn consumes_sdk_raw_schema_corpus() {
    let directory = corpus();
    let cases: Vec<Value> =
        serde_json::from_slice(&std::fs::read(directory.join("index.json")).unwrap()).unwrap();
    for case in cases {
        let source = std::fs::read(directory.join(case["file"].as_str().unwrap())).unwrap();
        let result = decode_value(case["schema"].as_str().unwrap(), &source);
        // Compatibility failures still have valid structural schemas (except literal versions).
        if case["stage"] == "schema" || case["accepted"] == true {
            assert_eq!(result.is_ok(), case["accepted"] == true, "{}", case["id"]);
        }
    }
}

#[test]
fn typed_dtos_deny_unknown_fields_and_round_trip() {
    let source = std::fs::read(corpus().join("manifest-valid.txt")).unwrap();
    let manifest: PluginManifest = decode(&source).unwrap();
    assert_eq!(
        serde_json::to_value(manifest).unwrap(),
        decode_value("PluginManifest", &source).unwrap()
    );
    let request = std::fs::read(corpus().join("valid-host-request.txt")).unwrap();
    let _: HostRequest = decode(&request).unwrap();
    assert!(serde_json::from_str::<HostRequest>(r#"{"wireVersion":1,"requestId":"r","contextRef":"c","deadlineMs":1,"operation":"state.get","input":{"key":"k"},"pluginId":"forged"}"#).is_err());
}

#[test]
fn operation_literals_select_the_correct_serde_union_branch() {
    let source = br#"{"wireVersion":1,"requestId":"r","operation":"state.set","ok":true,"result":{"value":"updated","version":1}}"#;
    let response: HostResponse = decode(source).unwrap();
    assert!(matches!(response, HostResponse::V2(_)));
    assert_eq!(
        serde_json::to_value(response).unwrap(),
        decode_value("HostResponse", source).unwrap()
    );
    let source = br#"{"wireVersion":1,"requestId":"r","operation":"state.set","ok":false,"error":{"code":"access-denied","message":"denied","isRetryable":false}}"#;
    assert!(matches!(
        decode::<HostResponse>(source).unwrap(),
        HostResponse::V3(_)
    ));
    let source = br#"{"wireVersion":1,"requestId":"r","contextRef":"c","deadlineMs":1,"operation":"network.releaseResponse","input":{"responseRef":"ref"}}"#;
    assert!(matches!(
        decode::<HostRequest>(source).unwrap(),
        HostRequest::V4(_)
    ));
}

#[test]
fn rejects_invalid_utf8_bom_trailing_tokens_and_noncanonical_numbers() {
    for source in [
        b"\xff".as_slice(),
        b"\xef\xbb\xbf{}",
        b"{}{}",
        b"{\"listingRef\":\"ok\",\"listingRef\":\"bad\"}",
        b"{\"listingRef\":\"\\uD800\"}",
        b"1e0",
        b"1.0",
        b"-0",
        b"01",
        b"+1",
        b"9007199254740992",
    ] {
        assert!(decode_value("MusicListingInput", source).is_err());
    }
    assert!(decode_value("UnknownSchema", b"{}").is_err());
}
