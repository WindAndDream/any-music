//! Anonymous, bounded native exits. The native host supplies authority; URLs never go to WebView.
#![forbid(unsafe_code)]
mod request;
mod resources;
mod target;
mod transport;

pub use request::{Exit, Request, Route, Scope};
pub use resources::{ResourceRef, Resources};
pub use target::{ADDRESS_POLICY_VERSION, Target, public_address};
pub use transport::{Gate, Network, Resolver, Response, Sink, SystemResolver};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    Target,
    Headers,
    Budget,
    Denied,
    Cancelled,
    Timeout,
    Network,
    Redirect,
    Unsupported,
}

#[cfg(test)]
#[path = "../tests/transport.rs"]
mod tests;
