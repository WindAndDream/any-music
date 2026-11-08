//! Local test harness only; stdin is a trusted, bounded test batch, never product IPC.
use am_plugin_policy::negotiate;
use am_plugin_protocol::{HostCapabilities, PluginManifest, decode, decode_value};
use serde::Deserialize;
use serde_json::{Value, json};
use std::io::Read;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Case {
    schema: String,
    source: String,
    host: Option<Value>,
}

fn main() {
    let mut input = String::new();
    std::io::stdin()
        .take(32 * 1024 * 1024)
        .read_to_string(&mut input)
        .unwrap();
    let cases: Vec<Case> = serde_json::from_str(&input).unwrap();
    let output: Vec<_> = cases.into_iter().map(|case| {
        let value = match decode_value(&case.schema, case.source.as_bytes()) { Ok(value) => value, Err(_) => return json!({"accepted": false}) };
        if let Some(host) = case.host {
            let manifest: PluginManifest = match decode(case.source.as_bytes()) { Ok(manifest) => manifest, Err(_) => return json!({"accepted": false}) };
            let host: HostCapabilities = match decode(&serde_json::to_vec(&host).unwrap()) { Ok(host) => host, Err(_) => return json!({"accepted": false}) };
            return match negotiate(&manifest, &host) {
                Ok(contract) => json!({"accepted": true, "contract": {"wireVersion": contract.wire_version, "runtimeProfileVersion": contract.runtime_profile_version, "contributionVersion": contract.contribution_version, "packageFormatVersion": contract.package_format_version, "dataSchemaVersion": contract.data_schema_version, "capabilities": contract.capabilities, "skippedCapabilities": contract.skipped_capabilities, "skippedContributions": contract.skipped_contributions}}),
                Err(_) => json!({"accepted": false}),
            };
        }
        json!({"accepted": true, "value": value})
    }).collect();
    println!("{}", serde_json::to_string(&output).unwrap());
}
