//! Embedded account pages, account-owned page sessions and verification handoff.
pub(crate) mod cdp;
pub(crate) mod douyin_browser;
pub(crate) mod embedded;
pub(crate) mod process;
pub(crate) mod verification;

// Retain the example-facing experimental API through the crate-root re-export.
pub mod login_experiment;
