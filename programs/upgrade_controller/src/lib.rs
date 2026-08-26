//! Bootstrap V1 state, policy, and approval kernel for the independent Amoeba
//! upgrade controller.
//!
//! The sole executable instruction records one runtime-authenticated council
//! seat approval. Loader CPI, gate mutation, initialization, and every later
//! lifecycle instruction remain deliberately absent.

pub mod authorization;
pub mod council;
pub mod digest;
#[cfg(not(feature = "no-entrypoint"))]
pub mod entrypoint;
pub mod error;
pub mod instruction;
pub mod pda;
pub mod policy;
pub mod processor;
pub mod proposal;
pub mod state;

pub use error::{GovernanceError, GovernanceResult};

#[cfg(test)]
mod tests;
