use am_plugin_protocol::{
    CAPABILITIES, CONTRIBUTION_VERSION, DATA_SCHEMA_VERSION, HostCapabilities,
    PACKAGE_FORMAT_VERSION, PluginManifest, RUNTIME_PROFILE_VERSION, WIRE_VERSION,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NegotiatedContract {
    pub wire_version: i64,
    pub runtime_profile_version: i64,
    pub contribution_version: i64,
    pub package_format_version: i64,
    pub data_schema_version: i64,
    pub capabilities: Vec<String>,
    pub skipped_capabilities: Vec<String>,
    pub skipped_contributions: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CompatibilityError {
    UnsupportedVersion,
    CapabilityUnavailable,
}

fn version(value: &str) -> Result<[u32; 3], CompatibilityError> {
    let mut result = [0; 3];
    let parts: Vec<_> = value.split('.').collect();
    if parts.len() != 3 {
        return Err(CompatibilityError::UnsupportedVersion);
    }
    for (index, part) in parts.iter().enumerate() {
        if part.is_empty()
            || part.len() > 6
            || !part.bytes().all(|byte| byte.is_ascii_digit())
            || (part.len() > 1 && part.starts_with('0'))
        {
            return Err(CompatibilityError::UnsupportedVersion);
        }
        result[index] = part
            .parse()
            .map_err(|_| CompatibilityError::UnsupportedVersion)?;
    }
    Ok(result)
}

/// Compatibility intersects actual host capabilities; it does not authorize activation.
/// Both inputs must first pass am_plugin_protocol::decode at the trust boundary.
pub fn negotiate(
    manifest: &PluginManifest,
    host: &HostCapabilities,
) -> Result<NegotiatedContract, CompatibilityError> {
    let unsupported = CompatibilityError::UnsupportedVersion;
    if !host.manifest_versions.contains(&manifest.manifest_version)
        || version(&host.sdk_version)? < version(&manifest.sdk.minimum)?
        || version(&host.sdk_version)? >= version(&manifest.sdk.maximum_exclusive)?
    {
        return Err(unsupported);
    }
    for (required, supported, known) in [
        (
            manifest.runtime_profile_version,
            &host.runtime_profile_versions,
            RUNTIME_PROFILE_VERSION,
        ),
        (
            manifest.contribution_version,
            &host.contribution_versions,
            CONTRIBUTION_VERSION,
        ),
        (
            manifest.package_format_version,
            &host.package_format_versions,
            PACKAGE_FORMAT_VERSION,
        ),
        (
            manifest.data_schema_version,
            &host.data_schema_versions,
            DATA_SCHEMA_VERSION,
        ),
    ] {
        if required != known || !supported.contains(&required) {
            return Err(unsupported);
        }
    }
    if !manifest.wire_versions.contains(&WIRE_VERSION)
        || !host.wire_versions.contains(&WIRE_VERSION)
        || !manifest
            .forms
            .iter()
            .any(|form| form.as_str() == host.form.as_str())
        || host.external_plugins.as_str() == "none"
        || (manifest.execution.as_str() == "sandbox-code"
            && (host.external_plugins.as_str() != "sandbox-code" || !host.sandbox_available))
    {
        return Err(unsupported);
    }
    let mut result = NegotiatedContract {
        wire_version: WIRE_VERSION,
        runtime_profile_version: manifest.runtime_profile_version,
        contribution_version: manifest.contribution_version,
        package_format_version: manifest.package_format_version,
        data_schema_version: manifest.data_schema_version,
        capabilities: Vec::new(),
        skipped_capabilities: Vec::new(),
        skipped_contributions: Vec::new(),
    };
    for requirement in &manifest.capabilities {
        let available = CAPABILITIES.contains(&requirement.id.as_str())
            && requirement.version == 1
            && host.capabilities.iter().any(|entry| {
                entry.id == requirement.id && entry.versions.contains(&requirement.version)
            });
        if available {
            result.capabilities.push(requirement.id.clone());
        } else if requirement.required {
            return Err(CompatibilityError::CapabilityUnavailable);
        } else {
            result.skipped_capabilities.push(requirement.id.clone());
        }
    }
    for contribution in &manifest.contributions {
        if host.extension_points.iter().any(|entry| {
            entry.id == contribution.point_id.as_str()
                && entry.versions.contains(&contribution.contract_version)
        }) {
            continue;
        }
        if contribution.required {
            return Err(unsupported);
        }
        result
            .skipped_contributions
            .push(contribution.contribution_id.clone());
    }
    Ok(result)
}
