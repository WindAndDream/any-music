use serde_json::Value;
use std::collections::HashSet;

// Match the SDK's non-structural checks. Cross-language differential tests guard these rules.
pub(crate) fn validate(name: &str, value: &Value) -> bool {
    match name {
        "PluginManifest" => manifest(value),
        "SourceAuthentication" => authentication(value),
        "PluginTask" => value
            .get("total")
            .is_none_or(|total| value["completed"].as_i64() <= total.as_i64()),
        "WireMedia" => {
            let qualities = value["availableQualities"]
                .as_array()
                .expect("validated array");
            let ids: HashSet<_> = qualities.iter().map(|quality| &quality["id"]).collect();
            ids.len() == qualities.len() && ids.contains(&value["quality"]["id"])
        }
        _ => true,
    }
}

fn manifest(value: &Value) -> bool {
    if let Some(auth) = value.get("sourceAuthentication")
        && !(authentication(auth)
            && value["execution"] == "declarative"
            && value["commands"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["id"] == "search")
            && value["contributions"]
                .as_array()
                .unwrap()
                .iter()
                .any(|c| c["pointId"] == "music.sources" && c["providerId"] == value["id"])
            && ["source.authentication", "network.publicHttps"]
                .iter()
                .all(|id| {
                    value["capabilities"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .any(|c| c["id"] == *id && c["required"] == true && c["version"] == 1)
                }))
    {
        return false;
    }
    let id = value["id"].as_str().expect("validated string");
    if id.split('.').count() < 2
        || !id.split('.').all(|part| {
            part.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
    {
        return false;
    }
    if (value["execution"] == "sandbox-code") != value.get("entry").is_some() {
        return false;
    }
    for (field, key) in [
        ("commands", "id"),
        ("contributions", "contributionId"),
        ("capabilities", "id"),
    ] {
        let entries = value[field].as_array().expect("validated array");
        if entries
            .iter()
            .map(|entry| &entry[key])
            .collect::<HashSet<_>>()
            .len()
            != entries.len()
        {
            return false;
        }
    }
    let commands: HashSet<_> = value["commands"]
        .as_array()
        .expect("validated array")
        .iter()
        .map(|entry| &entry["id"])
        .collect();
    let contributions = value["contributions"].as_array().expect("validated array");
    let views: HashSet<_> = contributions
        .iter()
        .filter(|entry| entry["pointId"] == "workspace.views")
        .map(|entry| &entry["viewId"])
        .collect();
    contributions.iter().all(|entry| {
        if entry
            .get("commandId")
            .is_some_and(|command| !commands.contains(command))
        {
            return false;
        }
        match entry["pointId"].as_str().expect("validated point") {
            "navigation.sidebar" => entry.get("viewId").is_some_and(|view| views.contains(view)),
            "workspace.views" => entry.get("viewId").is_some(),
            "music.sources" => entry.get("providerId").is_some(),
            "track.actions.secondary" | "trackList.operator.actions" => {
                entry.get("commandId").is_some()
            }
            _ => true,
        }
    })
}

fn authentication(value: &Value) -> bool {
    let methods = value["methods"].as_array().unwrap();
    let fields = value["credentialFields"].as_array().unwrap();
    let Some((host, path)) = value["apiBaseUrl"]
        .as_str()
        .unwrap()
        .strip_prefix("https://")
        .and_then(|v| v.split_once('/'))
    else {
        return false;
    };
    let host = host.strip_suffix(":443").unwrap_or(host);
    !host.is_empty()
        && host
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || matches!(b, b'.' | b'-'))
        && (path.is_empty()
            || path.ends_with('/')
                && path[..path.len() - 1].split('/').all(|s| {
                    !s.is_empty()
                        && s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
                }))
        && (value["allowUnauthenticated"] == true || !methods.is_empty())
        && methods.iter().collect::<HashSet<_>>().len() == methods.len()
        && methods.iter().any(|m| m == "credentials") != fields.is_empty()
        && fields
            .iter()
            .map(|f| &f["id"])
            .collect::<HashSet<_>>()
            .len()
            == fields.len()
        && fields.iter().all(|f| {
            let id = f["id"].as_str().unwrap();
            !matches!(id, "constructor" | "prototype")
                && id.as_bytes()[0].is_ascii_lowercase()
                && id
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
        })
}
