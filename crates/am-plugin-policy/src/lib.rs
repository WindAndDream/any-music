//! Pure decisions over trusted snapshots. No clock, IO, global state or bearer authority.
#![forbid(unsafe_code)]

mod authorization;
mod negotiation;
pub use authorization::*;
pub use negotiation::*;
