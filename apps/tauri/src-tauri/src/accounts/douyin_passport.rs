//! Public Passport SDK request authentication, independent of browser risk/device state.
use hkdf::Hkdf;
use hmac::{Hmac, Mac};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

// Public client configuration in Douyin's web bundle, not an account credential.
const APP_KEY: &str = "163e7ce78d58971a41f5b969996d85c2";

// The passport endpoints validate only sixteen scattered bits of the decoded a_bogus payload and
// ignore every other byte. Measured live with a deterministic rig: payloads from 32 to 200 bytes
// with arbitrary filler are accepted as long as these bits carry this value, while flipping any
// one checked bit returns 4031 and a neighbouring value (0x8839) is already rejected. The whole
// a_bogus algorithm therefore does not have to be reproduced, only this constant does.
// Evidence: apps/tauri/test/fixtures/douyin-a-bogus-checked-bits.json.
const ABOGUS_ALPHABET: &[u8; 64] =
    b"Dkdpgh2ZmsQB80/MfvV36XI1R45-WUAlEixNLwoqYTOPuzKFjJnry79HbGcaStCe";
const ABOGUS_CHECKED_VALUE: u16 = 0x8838;
/// Checked bit positions as (byte index, bit index from the least significant bit), in the order
/// the sixteen bits are read into `ABOGUS_CHECKED_VALUE` with the first as its most significant.
const ABOGUS_CHECKED_BITS: [(usize, u8); 16] = [
    (0, 0),
    (0, 2),
    (0, 4),
    (0, 6),
    (1, 1),
    (1, 3),
    (1, 5),
    (1, 7),
    (2, 0),
    (2, 2),
    (2, 4),
    (2, 6),
    (3, 1),
    (3, 3),
    (3, 5),
    (3, 7),
];
/// Payload length used for minted tokens; any length of at least four bytes is accepted.
const ABOGUS_BYTES: usize = 137;

/// Builds an `a_bogus` the passport QR endpoints accept. Only the checked bits matter, so the
/// filler is deterministic rather than random and the browser algorithm is deliberately not
/// reproduced. Verified accepted by the live poll endpoint from a plain native HTTP client.
pub fn mint_abogus() -> String {
    let mut bytes = vec![0_u8; ABOGUS_BYTES];
    set_checked_bits(&mut bytes);
    encode_abogus(&bytes)
}

fn set_checked_bits(bytes: &mut [u8]) {
    for (position, (byte, bit)) in ABOGUS_CHECKED_BITS.iter().enumerate() {
        let wanted = ((ABOGUS_CHECKED_VALUE >> (15 - position)) & 1) as u8;
        bytes[*byte] = (bytes[*byte] & !(1 << bit)) | (wanted << bit);
    }
}

/// Same custom Base64 the browser SDK uses: three bytes become four alphabet characters, padded
/// to a multiple of four.
fn encode_abogus(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let value = (u32::from(chunk[0]) << 16)
            | (u32::from(chunk.get(1).copied().unwrap_or(0)) << 8)
            | u32::from(chunk.get(2).copied().unwrap_or(0));
        for (part, shift) in [18_u32, 12, 6, 0].into_iter().enumerate() {
            if (part == 2 && chunk.len() < 2) || (part == 3 && chunk.len() < 3) {
                break;
            }
            out.push(ABOGUS_ALPHABET[((value >> shift) & 0x3f) as usize] as char);
        }
    }
    while !out.len().is_multiple_of(4) {
        out.push('=');
    }
    out
}

#[cfg(test)]
fn decode_abogus(value: &str) -> Option<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = 0_u32;
    let mut bits = 0_u32;
    for character in value.trim_end_matches('=').bytes() {
        let index = ABOGUS_ALPHABET
            .iter()
            .position(|entry| *entry == character)? as u32;
        buffer = (buffer << 6) | index;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            bytes.push(((buffer >> bits) & 0xff) as u8);
        }
    }
    Some(bytes)
}

#[cfg(test)]
fn checked_value_of(bytes: &[u8]) -> u16 {
    ABOGUS_CHECKED_BITS
        .iter()
        .fold(0_u16, |value, (byte, bit)| {
            (value << 1) | u16::from((bytes[*byte] >> bit) & 1)
        })
}

pub struct SignedRequest {
    pub query: BTreeMap<String, String>,
    pub aid_sign: String,
}

pub fn sign(
    path: &str,
    mut query: BTreeMap<String, String>,
    form: &BTreeMap<String, String>,
    epoch_seconds: u64,
) -> SignedRequest {
    // The SDK uses noon of the current UTC day, rather than the request's current timestamp.
    let ts = (epoch_seconds / 86_400 * 86_400 + 43_200).to_string();
    query.insert("ts".into(), ts.clone());
    let keys = query.keys().take(10).cloned().collect::<Vec<_>>();
    let query_content = keys
        .iter()
        .map(|key| format!("{key}={}", query[key]))
        .collect::<Vec<_>>()
        .join("&");
    let form_content = form
        .iter()
        .map(|(key, value)| format!("{key}={value}"))
        .collect::<Vec<_>>()
        .join("&");
    let content = format!("{query_content}&{form_content}&app_key={APP_KEY}");
    query.insert("sign".into(), format!("{:x}", Sha256::digest(content)));
    query.insert("qs".into(), mix_ascii(&keys.join(",")));

    let mut key = [0_u8; 32];
    Hkdf::<Sha256>::new(Some(ts.as_bytes()), APP_KEY.as_bytes())
        .expand(&[], &mut key)
        .expect("32-byte HKDF output");
    let mut mac = Hmac::<Sha256>::new_from_slice(&key).expect("HMAC accepts a 32-byte key");
    mac.update(format!("aid=6383&path={path}&ts={ts}").as_bytes());
    let aid_sign = mac
        .finalize()
        .into_bytes()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    SignedRequest { query, aid_sign }
}

pub fn mix_ascii(value: &str) -> String {
    value
        .bytes()
        .map(|byte| format!("{:x}", byte ^ 5))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn minted_abogus_carries_the_checked_constant_for_every_length() {
        // The live endpoint accepted 32 to 200 byte payloads with arbitrary filler, so only the
        // sixteen checked bits are part of the contract.
        for length in [32_usize, 124, 137, 200] {
            let mut bytes = vec![0_u8; length];
            set_checked_bits(&mut bytes);
            assert_eq!(checked_value_of(&bytes), ABOGUS_CHECKED_VALUE);
            let encoded = encode_abogus(&bytes);
            let decoded = decode_abogus(&encoded).expect("alphabet round trip");
            assert_eq!(decoded, bytes);
            assert_eq!(decoded.len(), length);
        }
        // Filler is irrelevant: a payload of ones decodes to the same checked value.
        let mut ones = vec![0xff_u8; ABOGUS_BYTES];
        set_checked_bits(&mut ones);
        assert_eq!(checked_value_of(&ones), ABOGUS_CHECKED_VALUE);
        // Every single checked bit is load-bearing, matching the live rejections.
        for &(byte, bit) in &ABOGUS_CHECKED_BITS {
            let mut bytes = vec![0_u8; ABOGUS_BYTES];
            set_checked_bits(&mut bytes);
            bytes[byte] ^= 1 << bit;
            assert_ne!(checked_value_of(&bytes), ABOGUS_CHECKED_VALUE);
        }
        assert_eq!(mint_abogus().len(), 184);
        assert!(
            mint_abogus()
                .chars()
                .all(|value| value == '=' || ABOGUS_ALPHABET.contains(&(value as u8)))
        );
    }

    #[test]
    fn signer_matches_the_live_verified_vector_for_a_minimal_request() {
        // The expected values were produced by the JavaScript implementation that was checked
        // bit-for-bit against the live Passport SDK's own signing input, so this pins the Rust
        // signer to that verified algorithm instead of only to itself.
        let query = BTreeMap::from([
            ("account_sdk_source".to_owned(), "web".to_owned()),
            ("aid".to_owned(), "6383".to_owned()),
        ]);
        let form = BTreeMap::from([("token".to_owned(), "synthetic".to_owned())]);
        let signed = sign("/passport/web/check_qrconnect/", query, &form, 0);
        assert_eq!(signed.query["ts"], "43200");
        assert_eq!(
            signed.query["sign"],
            "6c5a9593b4bab9c7ebb7021483f5cee07ef6cef8c8aa38992b84afe9938f896a"
        );
        assert_eq!(
            signed.query["qs"],
            "6466666a706b715a76616e5a766a7077666029646c61297176"
        );
        assert_eq!(
            signed.aid_sign,
            "8e6e804b02edb9db2b0543b3b0709bcc1c4af55e395c1641f6d507445e74426e"
        );
    }

    #[test]
    fn utc_day_and_path_bind_the_header_while_form_binds_the_query_signature() {
        let query = BTreeMap::from([("aid".into(), "6383".into())]);
        let form = BTreeMap::from([("token".into(), "synthetic".into())]);
        let first = sign(
            "/passport/web/check_qrconnect/",
            query.clone(),
            &form,
            86_401,
        );
        let later = sign(
            "/passport/web/check_qrconnect/",
            query.clone(),
            &form,
            172_799,
        );
        assert_eq!(first.query, later.query);
        assert_eq!(first.aid_sign, later.aid_sign);
        assert_eq!(first.query["ts"], "129600");
        // Offline synthetic vectors cross-checked with Web Crypto HKDF/HMAC/SHA-256.
        assert_eq!(
            first.query["sign"],
            "227fad7de8e0e06faa3d348f960d63aed734f2f4001977641cb2c25a5573d984"
        );
        assert_eq!(
            first.aid_sign,
            "fb405a9af75ab2a3c2129e562dd811bf24eaee0f048d4b62eb8b23b6dccea6ce"
        );
        let next_day = sign(
            "/passport/web/check_qrconnect/",
            query.clone(),
            &form,
            172_800,
        );
        assert_ne!(first.aid_sign, next_day.aid_sign);
        let other_path = sign("/passport/web/send_code/", query.clone(), &form, 86_401);
        assert_ne!(first.aid_sign, other_path.aid_sign);
        let other_form = sign(
            "/passport/web/check_qrconnect/",
            query,
            &BTreeMap::new(),
            86_401,
        );
        assert_eq!(first.aid_sign, other_form.aid_sign);
        assert_ne!(first.query["sign"], other_form.query["sign"]);
    }

    #[test]
    fn signature_uses_ten_sorted_unencoded_query_fields_and_every_form_field() {
        let query = (0..12)
            .map(|index| (format!("key{index:02}"), format!("value {index}")))
            .collect::<BTreeMap<_, _>>();
        let form = BTreeMap::from([("code".into(), "synthetic".into())]);
        let first = sign("/passport/web/validate_code/", query.clone(), &form, 1);
        let mut changed = query.clone();
        changed.insert("key11".into(), "ignored".into());
        assert_eq!(
            first.query["sign"],
            sign("/passport/web/validate_code/", changed, &form, 1).query["sign"]
        );
        let keys = (0..10)
            .map(|index| format!("key{index:02}"))
            .collect::<Vec<_>>()
            .join(",");
        assert_eq!(first.query["qs"], mix_ascii(&keys));
        let content = (0..10)
            .map(|index| format!("key{index:02}=value {index}"))
            .collect::<Vec<_>>()
            .join("&");
        let expected = format!(
            "{:x}",
            Sha256::digest(format!("{content}&code=synthetic&app_key={APP_KEY}"))
        );
        assert_eq!(first.query["sign"], expected);
    }
}
