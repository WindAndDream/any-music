//! S01 wire contracts for trusted native consumers. No transport or business authority.
//! Always decode untrusted bytes here before using serde DTOs; serde alone cannot enforce
//! duplicate-key, canonical-number or resource limits.

#![forbid(unsafe_code)]

mod boundary;
mod generated;
mod semantics;

pub use generated::*;
use serde::de::DeserializeOwned;
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProtocolError;

impl std::fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Invalid or unsupported plugin protocol input")
    }
}
impl std::error::Error for ProtocolError {}

/// Implemented by Schema-generated DTOs, without allowing arbitrary schema selection in IPC.
pub trait ProtocolDto: DeserializeOwned {
    const SCHEMA: &'static str;
}

pub fn decode<T: ProtocolDto>(source: &[u8]) -> Result<T, ProtocolError> {
    serde_json::from_value(decode_value(T::SCHEMA, source)?).map_err(|_| ProtocolError)
}

/// Bounded JSON for inert package assets; no plugin-supplied schema or executable parser.
pub fn parse_json(source: &[u8]) -> Result<Value, ProtocolError> {
    boundary::parse(source)
}

/// Named Schema entry point used by the cross-language corpus runner.
pub fn decode_value(name: &str, source: &[u8]) -> Result<Value, ProtocolError> {
    let value = boundary::parse(source)?;
    if !generated::validate(name, &value) || !semantics::validate(name, &value) {
        return Err(ProtocolError);
    }
    Ok(value)
}
