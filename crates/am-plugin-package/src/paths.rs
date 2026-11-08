use crate::Error;
use unicode_normalization::UnicodeNormalization;

pub(crate) fn validate(path: &str) -> Result<String, Error> {
    if path.is_empty()
        || path.len() > 240
        || path.split('/').count() > 8
        || path.nfc().collect::<String>() != path
        || path
            .chars()
            .any(|c| c.is_control() || "\\:<>\"|?*".contains(c))
    {
        return Err(Error::Path);
    }
    let key = path
        .nfkc()
        .flat_map(char::to_uppercase)
        .flat_map(char::to_lowercase)
        .collect::<String>();
    for part in key.split('/') {
        let base = part.split('.').next().unwrap_or("");
        if part.is_empty()
            || matches!(part, "." | "..")
            || part.ends_with(['.', ' '])
            || matches!(base, "con" | "prn" | "aux" | "nul" | "clock$")
            || ["com", "lpt"].iter().any(|prefix| {
                base.strip_prefix(prefix)
                    .is_some_and(|n| n.len() == 1 && matches!(n.as_bytes()[0], b'1'..=b'9'))
            })
        {
            return Err(Error::Path);
        }
    }
    Ok(key)
}

pub(crate) fn allowed(path: &str) -> bool {
    matches!(
        path,
        "manifest.json"
            | "integrity.json"
            | "signature.json"
            | "dist/main.js"
            | "dist/main.js.map"
            | "sbom.json"
    ) || path.starts_with("assets/")
        && [".json", ".png", ".jpg", ".jpeg", ".webp"]
            .iter()
            .any(|s| path.ends_with(s))
        || path.starts_with("LICENSES/") && (path.ends_with(".txt") || path.ends_with(".json"))
}
