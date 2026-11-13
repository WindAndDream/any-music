# Verified plugin package bytes

- This crate owns bounded ZIP/JSON, payload integrity and Ed25519 verification. It never extracts into user paths, grants authority, opens a network connection or executes plugin code.
- SDK Schema is the DTO authority. Sign the domain prefix plus original integrity/list bytes, never reserialized JSON. A valid self-signature is not a trusted publisher.
- Return owned verified bytes; loading and preview must use that same snapshot. Preserve STORE/DEFLATE-only limits and fail closed on ambiguous ZIP headers, paths and resources.
- Tests consume the SDK-owned raw package corpus and public golden vectors. No private keys belong in fixtures.
