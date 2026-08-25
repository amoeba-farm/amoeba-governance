//! Phase 1 state and policy scaffold for the independent Amoeba upgrade controller.
//!
//! This crate deliberately has no Solana entrypoint or instruction processor.
//! It is not deployable and cannot sign or invoke the upgradeable loader.

pub mod council;
pub mod digest;
pub mod error;
pub mod pda;
pub mod policy;
pub mod proposal;
pub mod state;

pub use error::{GovernanceError, GovernanceResult};

#[cfg(test)]
mod tests;
