use solana_program::program_error::ProgramError;
use thiserror::Error;

pub type GovernanceResult<T> = Result<T, GovernanceError>;

/// Stable Phase 1 error codes. New variants must be appended, never reordered.
#[derive(Clone, Copy, Debug, Eq, Error, PartialEq)]
#[repr(u32)]
pub enum GovernanceError {
    #[error("invalid account discriminator")]
    InvalidDiscriminator = 10_000,
    #[error("unsupported account version")]
    UnsupportedVersion = 10_001,
    #[error("account is not initialized")]
    Uninitialized = 10_002,
    #[error("reserved bytes must be zero")]
    NonzeroReserved = 10_003,
    #[error("a required public key is the default key")]
    DefaultPubkey = 10_004,
    #[error("optional public key encoding is not canonical")]
    InvalidOptionalPubkey = 10_005,
    #[error("council seat order or class composition is invalid")]
    InvalidCouncilComposition = 10_006,
    #[error("council contains a duplicate signer")]
    DuplicateCouncilSigner = 10_007,
    #[error("council seat appointment metadata is invalid")]
    InvalidAppointment = 10_008,
    #[error("council seat affiliation metadata is invalid")]
    InvalidAffiliation = 10_009,
    #[error("council seat is inactive or outside its term")]
    InactiveCouncilSeat = 10_010,
    #[error("council activation or deactivation range is invalid")]
    InvalidCouncilActivation = 10_011,
    #[error("council threshold policy is invalid")]
    InvalidCouncilThreshold = 10_012,
    #[error("council set hash does not match its canonical fields")]
    CouncilHashMismatch = 10_013,
    #[error("governance policy is invalid")]
    InvalidPolicy = 10_014,
    #[error("governance policy hash does not match its canonical fields")]
    PolicyHashMismatch = 10_015,
    #[error("proposal references a stale council version")]
    StaleCouncilVersion = 10_016,
    #[error("proposal council hash does not match the supplied council")]
    ProposalCouncilHashMismatch = 10_017,
    #[error("approval bitset contains an unknown seat")]
    InvalidApprovalBitset = 10_018,
    #[error("approval count does not match the approval bitset")]
    ApprovalCountMismatch = 10_019,
    #[error("signer does not occupy a council seat")]
    UnknownCouncilSigner = 10_020,
    #[error("council seat has already approved")]
    DuplicateApproval = 10_021,
    #[error("council quorum is not satisfied")]
    QuorumNotSatisfied = 10_022,
    #[error("proposal state transition is not permitted")]
    InvalidStateTransition = 10_024,
    #[error("proposal timing commitments are invalid")]
    InvalidProposalTiming = 10_025,
    #[error("proposal epoch commitments are invalid")]
    InvalidProposalEpoch = 10_026,
    #[error("proposal capacity arithmetic is invalid")]
    InvalidCapacityPlan = 10_027,
    #[error("proposal static fields are internally inconsistent")]
    InvalidProposalCommitment = 10_028,
    #[error("proposal digest does not match its canonical commitments")]
    ProposalDigestMismatch = 10_029,
    #[error("arithmetic overflow")]
    ArithmeticOverflow = 10_030,
    #[error("controller configuration is internally inconsistent")]
    InvalidControllerConfig = 10_031,
    #[error("protocol gate state is internally inconsistent")]
    InvalidGateState = 10_032,
    #[error("proposal class is scaffolded but has no safe Phase 1 execution path")]
    UnsupportedProposalClass = 10_033,
}

impl From<GovernanceError> for ProgramError {
    fn from(value: GovernanceError) -> Self {
        ProgramError::Custom(value as u32)
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::*;

    #[test]
    fn custom_error_codes_are_unique_and_map_exactly() {
        let values = [
            GovernanceError::InvalidDiscriminator,
            GovernanceError::UnsupportedVersion,
            GovernanceError::Uninitialized,
            GovernanceError::NonzeroReserved,
            GovernanceError::DefaultPubkey,
            GovernanceError::InvalidOptionalPubkey,
            GovernanceError::InvalidCouncilComposition,
            GovernanceError::DuplicateCouncilSigner,
            GovernanceError::InvalidAppointment,
            GovernanceError::InvalidAffiliation,
            GovernanceError::InactiveCouncilSeat,
            GovernanceError::InvalidCouncilActivation,
            GovernanceError::InvalidCouncilThreshold,
            GovernanceError::CouncilHashMismatch,
            GovernanceError::InvalidPolicy,
            GovernanceError::PolicyHashMismatch,
            GovernanceError::StaleCouncilVersion,
            GovernanceError::ProposalCouncilHashMismatch,
            GovernanceError::InvalidApprovalBitset,
            GovernanceError::ApprovalCountMismatch,
            GovernanceError::UnknownCouncilSigner,
            GovernanceError::DuplicateApproval,
            GovernanceError::QuorumNotSatisfied,
            GovernanceError::InvalidStateTransition,
            GovernanceError::InvalidProposalTiming,
            GovernanceError::InvalidProposalEpoch,
            GovernanceError::InvalidCapacityPlan,
            GovernanceError::InvalidProposalCommitment,
            GovernanceError::ProposalDigestMismatch,
            GovernanceError::ArithmeticOverflow,
            GovernanceError::InvalidControllerConfig,
            GovernanceError::InvalidGateState,
            GovernanceError::UnsupportedProposalClass,
        ];
        let codes = values.iter().map(|value| *value as u32).collect::<Vec<_>>();
        assert_eq!(codes.iter().collect::<BTreeSet<_>>().len(), codes.len());
        for value in values {
            assert_eq!(
                ProgramError::from(value),
                ProgramError::Custom(value as u32)
            );
        }
    }
}
