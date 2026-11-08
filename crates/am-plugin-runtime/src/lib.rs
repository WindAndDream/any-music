//! Native authority and verified install orchestration through injected durability/time/IDs.
//! No concrete IO, network transport or renderer-provided identity is accepted here.
#![forbid(unsafe_code)]

mod authority;
mod data;
mod egress;
mod install;
mod install_model;
mod model;
mod rollback;

pub use authority::Runtime;
pub use install_model::*;
pub use model::*;
