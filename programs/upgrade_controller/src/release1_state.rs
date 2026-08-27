//! Fixed-width Release 1 governance account schemas.
//!
//! These types are data contracts only.  No processor in this module creates,
//! mutates, or executes them.  `UpgradeProposalV1` and every other existing V1
//! byte remain defined in `state.rs` without reinterpretation.

use std::io::{Error, ErrorKind, Read, Write};

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::pubkey::Pubkey;

use crate::{
    artifact_merkle::{
        artifact_chunk_count, is_release1_chunk_size, ARTIFACT_MERKLE_SCHEME_ID,
        MAX_ARTIFACT_BYTES_V1, MAX_ARTIFACT_CHUNKS_V1,
    },
    council::VALID_APPROVAL_MASK,
    state::{GateStatusV1, OptionalPubkeyV1, ProposalClassV1, VoteRequirementV1},
    GovernanceError, GovernanceResult,
};

pub const UPGRADE_PROPOSAL_V2_DISCRIMINATOR: [u8; 8] = *b"AGVPRP02";
pub const BUFFER_VERIFICATION_V1_DISCRIMINATOR: [u8; 8] = *b"AGVBFV01";
pub const PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR: [u8; 8] = *b"AGVPDV01";
pub const STATE_CHECKPOINT_V1_DISCRIMINATOR: [u8; 8] = *b"AGVCKP01";
pub const COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR: [u8; 8] = *b"AGVROT01";
pub const EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR: [u8; 8] = *b"AGVEFR01";

pub const ACCOUNT_VERSION_V2: u8 = 2;
pub const RELEASE1_ACCOUNT_VERSION_V1: u8 = 1;
pub const RELEASE1_APPROVAL_THRESHOLD: u8 = 3;
pub const BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1: u16 = 1;

pub const UPGRADE_PROPOSAL_V2_RESERVED_LEN: usize = 146;
pub const BUFFER_VERIFICATION_V1_RESERVED_LEN: usize = 72;
pub const PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN: usize = 119;
pub const STATE_CHECKPOINT_V1_RESERVED_LEN: usize = 37;
pub const COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN: usize = 84;
pub const EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN: usize = 91;
pub const VERIFICATION_BITMAP_BYTES_V1: usize = MAX_ARTIFACT_CHUNKS_V1 / 8;

macro_rules! fixed_u8_enum_borsh {
    ($name:ident { $($variant:ident = $value:expr),+ $(,)? }) => {
        impl BorshSerialize for $name {
            fn serialize<W: Write>(&self, writer: &mut W) -> std::io::Result<()> {
                writer.write_all(&[*self as u8])
            }
        }

        impl BorshDeserialize for $name {
            fn deserialize_reader<R: Read>(reader: &mut R) -> std::io::Result<Self> {
                let mut byte = [0u8; 1];
                reader.read_exact(&mut byte)?;
                match byte[0] {
                    $($value => Ok(Self::$variant),)+
                    value => Err(Error::new(
                        ErrorKind::InvalidData,
                        format!("unknown {} discriminant {value}", stringify!($name)),
                    )),
                }
            }
        }
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ProposalStateV2 {
    Draft = 0,
    BufferAdopted = 1,
    BufferVerified = 2,
    CouncilApproved = 3,
    TokenReviewOpen = 4,
    GovernanceSatisfied = 5,
    Timelocked = 6,
    Frozen = 7,
    Extended = 8,
    UpgradeExecuted = 9,
    ProgramDataVerified = 10,
    PoststateAccepted = 11,
    UnfreezeApproved = 12,
    Completed = 13,
    Cancelled = 14,
    Expired = 15,
    SupersededByRollback = 16,
    Retired = 17,
}
fixed_u8_enum_borsh!(ProposalStateV2 {
    Draft = 0,
    BufferAdopted = 1,
    BufferVerified = 2,
    CouncilApproved = 3,
    TokenReviewOpen = 4,
    GovernanceSatisfied = 5,
    Timelocked = 6,
    Frozen = 7,
    Extended = 8,
    UpgradeExecuted = 9,
    ProgramDataVerified = 10,
    PoststateAccepted = 11,
    UnfreezeApproved = 12,
    Completed = 13,
    Cancelled = 14,
    Expired = 15,
    SupersededByRollback = 16,
    Retired = 17,
});

impl Default for ProposalStateV2 {
    fn default() -> Self {
        Self::Draft
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum BufferVerificationStatusV1 {
    Adopted = 0,
    Verifying = 1,
    Verified = 2,
    ConsumedByUpgrade = 3,
    ClosedAbandoned = 4,
}
fixed_u8_enum_borsh!(BufferVerificationStatusV1 {
    Adopted = 0,
    Verifying = 1,
    Verified = 2,
    ConsumedByUpgrade = 3,
    ClosedAbandoned = 4,
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum ProgramDataVerificationStatusV1 {
    Verifying = 0,
    Verified = 1,
}
fixed_u8_enum_borsh!(ProgramDataVerificationStatusV1 {
    Verifying = 0,
    Verified = 1,
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum StateCheckpointPhaseV1 {
    Prestate = 0,
    Poststate = 1,
    Emergency = 2,
}
fixed_u8_enum_borsh!(StateCheckpointPhaseV1 {
    Prestate = 0,
    Poststate = 1,
    Emergency = 2,
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum CouncilRotationStateV1 {
    Draft = 0,
    CouncilApproved = 1,
    Timelocked = 2,
    Activated = 3,
    Cancelled = 4,
    Expired = 5,
}
fixed_u8_enum_borsh!(CouncilRotationStateV1 {
    Draft = 0,
    CouncilApproved = 1,
    Timelocked = 2,
    Activated = 3,
    Cancelled = 4,
    Expired = 5,
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum EmergencyFreezeResolutionStateV1 {
    Draft = 0,
    CouncilApproved = 1,
    Timelocked = 2,
    Executed = 3,
    Cancelled = 4,
    Expired = 5,
}
fixed_u8_enum_borsh!(EmergencyFreezeResolutionStateV1 {
    Draft = 0,
    CouncilApproved = 1,
    Timelocked = 2,
    Executed = 3,
    Cancelled = 4,
    Expired = 5,
});

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum EmergencyFreezeResolutionKindV1 {
    ResumeWithoutUpgrade = 0,
}
fixed_u8_enum_borsh!(EmergencyFreezeResolutionKindV1 {
    ResumeWithoutUpgrade = 0,
});

/// Release 1 code-upgrade proposal.  The field order is the wire order.
#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct UpgradeProposalV2 {
    pub discriminator: [u8; 8],
    pub account_version: u8,
    pub bump: u8,
    pub initialized: bool,
    pub proposal_class: ProposalClassV1,
    pub state: ProposalStateV2,
    pub creation_gate_status: GateStatusV1,
    pub zero_tail_required: bool,
    pub proposal_flags: u8,
    pub proposal_id: u64,
    pub target_nonce: u64,
    pub creation_slot: u64,
    pub cluster_domain: [u8; 32],
    pub controller_program: Pubkey,
    pub controller_config: Pubkey,
    pub protocol_gate: Pubkey,
    pub policy_version: u64,
    pub policy_hash: [u8; 32],
    pub creation_council_version: u64,
    pub creation_council_hash: [u8; 32],
    pub creation_gate_epoch: u64,
    pub freeze_gate_epoch: u64,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub upgradeable_loader: Pubkey,
    pub authority_pda: Pubkey,
    pub canonical_spill_treasury: Pubkey,
    pub buffer_pubkey: Pubkey,
    pub buffer_loader_owner: Pubkey,
    pub buffer_uploader_authority: Pubkey,
    pub buffer_final_authority: Pubkey,
    pub buffer_verification: Pubkey,
    pub programdata_verification: Pubkey,
    pub artifact_length: u64,
    pub artifact_sha256: [u8; 32],
    pub artifact_chunk_merkle_root: [u8; 32],
    pub chunk_hash_domain: [u8; 32],
    pub chunk_size: u32,
    pub chunk_count: u32,
    pub source_commit_hash: [u8; 32],
    pub source_tree_hash: [u8; 32],
    pub build_input_inventory_hash: [u8; 32],
    pub reproducible_build_receipt_hash: [u8; 32],
    pub package_receipt_hash: [u8; 32],
    pub release_intent_hash: [u8; 32],
    pub expected_execution_pre_payload_hash: [u8; 32],
    pub expected_execution_pre_chunk_root: [u8; 32],
    pub current_raw_programdata_hash: [u8; 32],
    pub deployed_slot: u64,
    pub current_capacity: u64,
    pub extension_delta: u64,
    pub expected_post_capacity: u64,
    pub prestate_checkpoint: Pubkey,
    pub required_poststate_checkpoint: Pubkey,
    pub checkpoint_schema_id: [u8; 32],
    pub checkpoint_policy_hash: [u8; 32],
    pub primary_proposal: OptionalPubkeyV1,
    pub rollback_proposal: OptionalPubkeyV1,
    pub rollback_buffer: OptionalPubkeyV1,
    pub rollback_artifact_sha256: [u8; 32],
    pub rollback_artifact_chunk_root: [u8; 32],
    pub vote_requirement: VoteRequirementV1,
    pub vote_program: Pubkey,
    pub vote_result_pda: Pubkey,
    pub review_start_slot: u64,
    pub review_end_slot: u64,
    pub not_before_slot: u64,
    pub expiry_slot: u64,
    pub first_approval_slot: u64,
    pub council_approved_slot: u64,
    pub governance_satisfied_slot: u64,
    pub queued_slot: u64,
    pub frozen_slot: u64,
    pub extension_executed_slot: u64,
    pub upgrade_executed_slot: u64,
    pub programdata_verified_slot: u64,
    pub poststate_accepted_slot: u64,
    pub unfreeze_approved_slot: u64,
    pub terminal_slot: u64,
    pub council_approval_bitset: u8,
    pub council_approval_count: u8,
    pub cancellation_council_version: u64,
    pub cancellation_council_hash: [u8; 32],
    pub cancellation_approval_bitset: u8,
    pub cancellation_approval_count: u8,
    pub unfreeze_council_version: u64,
    pub unfreeze_council_hash: [u8; 32],
    pub unfreeze_approval_bitset: u8,
    pub unfreeze_approval_count: u8,
    pub proposal_digest: [u8; 32],
    pub cancellation_reason_code: u16,
    pub terminal_reason_code: u16,
    pub reserved: [u8; UPGRADE_PROPOSAL_V2_RESERVED_LEN],
}

impl UpgradeProposalV2 {
    pub const LEN: usize = 1_792;

    pub fn validate_schema(&self) -> GovernanceResult<()> {
        validate_header(
            &self.discriminator,
            &UPGRADE_PROPOSAL_V2_DISCRIMINATOR,
            self.account_version,
            ACCOUNT_VERSION_V2,
            self.initialized,
            &self.reserved,
        )?;
        if self.proposal_flags != 0
            || !self.zero_tail_required
            || matches!(self.state, ProposalStateV2::TokenReviewOpen)
            || !matches!(
                self.creation_gate_status,
                GateStatusV1::Active | GateStatusV1::EmergencyFrozen
            )
        {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        require_nondefault_keys(&[
            self.controller_program,
            self.controller_config,
            self.protocol_gate,
            self.target_program,
            self.target_programdata,
            self.upgradeable_loader,
            self.authority_pda,
            self.canonical_spill_treasury,
            self.buffer_pubkey,
            self.buffer_loader_owner,
            self.buffer_uploader_authority,
            self.buffer_final_authority,
            self.buffer_verification,
            self.programdata_verification,
            self.prestate_checkpoint,
            self.required_poststate_checkpoint,
        ])?;
        if self.cluster_domain == [0; 32]
            || self.policy_version == 0
            || self.policy_hash == [0; 32]
            || self.creation_council_version == 0
            || self.creation_council_hash == [0; 32]
            || self.creation_gate_epoch == 0
            || self.freeze_gate_epoch == 0
            || self.proposal_id == 0
            || self.target_nonce == 0
            || self.creation_slot == 0
            || self.artifact_length == 0
            || self.artifact_length > MAX_ARTIFACT_BYTES_V1
            || self.artifact_sha256 == [0; 32]
            || self.artifact_chunk_merkle_root == [0; 32]
            || self.chunk_hash_domain != ARTIFACT_MERKLE_SCHEME_ID
            || !is_release1_chunk_size(self.chunk_size)
            || self.chunk_count != artifact_chunk_count(self.artifact_length, self.chunk_size)?
            || self.buffer_loader_owner != self.upgradeable_loader
            || self.buffer_final_authority != self.authority_pda
            || self.checkpoint_schema_id == [0; 32]
            || self.checkpoint_policy_hash == [0; 32]
            || self.proposal_digest == [0; 32]
        {
            return Err(GovernanceError::InvalidProposalCommitment);
        }
        for commitment in [
            self.source_commit_hash,
            self.source_tree_hash,
            self.build_input_inventory_hash,
            self.reproducible_build_receipt_hash,
            self.package_receipt_hash,
            self.release_intent_hash,
            self.expected_execution_pre_payload_hash,
            self.expected_execution_pre_chunk_root,
        ] {
            if commitment == [0; 32] {
                return Err(GovernanceError::InvalidProposalCommitment);
            }
        }
        if self
            .current_capacity
            .checked_add(self.extension_delta)
            .ok_or(GovernanceError::ArithmeticOverflow)?
            != self.expected_post_capacity
            || self.current_capacity == 0
            || self.artifact_length > self.expected_post_capacity
            || self.expected_post_capacity > MAX_ARTIFACT_BYTES_V1
        {
            return Err(GovernanceError::InvalidCapacityPlan);
        }
        if self.creation_slot > self.review_start_slot
            || self.review_start_slot >= self.review_end_slot
            || self.review_end_slot > self.not_before_slot
            || self.not_before_slot >= self.expiry_slot
        {
            return Err(GovernanceError::InvalidProposalTiming);
        }
        self.primary_proposal.validate()?;
        self.rollback_proposal.validate()?;
        self.rollback_buffer.validate()?;
        let rollback_present = self.rollback_proposal.present;
        if rollback_present != self.rollback_buffer.present
            || rollback_present != (self.rollback_artifact_sha256 != [0; 32])
            || rollback_present != (self.rollback_artifact_chunk_root != [0; 32])
        {
            return Err(GovernanceError::InvalidProposalCommitment);
        }
        match self.proposal_class {
            ProposalClassV1::EmergencyRollback => {
                if !self.primary_proposal.present
                    || rollback_present
                    || self.deployed_slot != 0
                    || self.current_raw_programdata_hash != [0; 32]
                {
                    return Err(GovernanceError::InvalidProposalCommitment);
                }
            }
            ProposalClassV1::RoutineUpgrade
            | ProposalClassV1::EconomicChange
            | ProposalClassV1::ConstitutionalChange => {
                if self.primary_proposal.present
                    || !rollback_present
                    || self.deployed_slot == 0
                    || self.current_raw_programdata_hash == [0; 32]
                {
                    return Err(GovernanceError::InvalidProposalCommitment);
                }
            }
            ProposalClassV1::CouncilSetRotation | ProposalClassV1::TargetImmutability => {
                return Err(GovernanceError::UnsupportedProposalClass);
            }
        }
        if self.vote_requirement != VoteRequirementV1::None
            || self.vote_program != Pubkey::default()
            || self.vote_result_pda != Pubkey::default()
        {
            return Err(GovernanceError::InvalidProposalCommitment);
        }
        validate_approval_pair(self.council_approval_bitset, self.council_approval_count)?;
        validate_versioned_approval(
            self.cancellation_council_version,
            &self.cancellation_council_hash,
            self.cancellation_approval_bitset,
            self.cancellation_approval_count,
        )?;
        validate_versioned_approval(
            self.unfreeze_council_version,
            &self.unfreeze_council_hash,
            self.unfreeze_approval_bitset,
            self.unfreeze_approval_count,
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct BufferVerificationV1 {
    pub discriminator: [u8; 8],
    pub account_version: u8,
    pub bump: u8,
    pub initialized: bool,
    pub status: BufferVerificationStatusV1,
    pub controller_config: Pubkey,
    pub proposal: Pubkey,
    pub upgradeable_loader: Pubkey,
    pub buffer: Pubkey,
    pub expected_uploader_authority: Pubkey,
    pub controller_authority: Pubkey,
    pub artifact_length: u64,
    pub artifact_sha256: [u8; 32],
    pub artifact_chunk_merkle_root: [u8; 32],
    pub chunk_hash_domain: [u8; 32],
    pub chunk_size: u32,
    pub chunk_count: u32,
    pub verified_chunk_bitmap: [u8; VERIFICATION_BITMAP_BYTES_V1],
    pub verified_chunk_count: u32,
    pub adopted_slot: u64,
    pub finalized_slot: u64,
    pub sealed_buffer_header_hash: [u8; 32],
    pub terminal_slot: u64,
    pub reserved: [u8; BUFFER_VERIFICATION_V1_RESERVED_LEN],
}

impl BufferVerificationV1 {
    pub const LEN: usize = 512;

    pub fn validate_schema(&self) -> GovernanceResult<()> {
        validate_header(
            &self.discriminator,
            &BUFFER_VERIFICATION_V1_DISCRIMINATOR,
            self.account_version,
            RELEASE1_ACCOUNT_VERSION_V1,
            self.initialized,
            &self.reserved,
        )?;
        require_nondefault_keys(&[
            self.controller_config,
            self.proposal,
            self.upgradeable_loader,
            self.buffer,
            self.expected_uploader_authority,
            self.controller_authority,
        ])?;
        validate_artifact_commitment(
            self.artifact_length,
            &self.artifact_sha256,
            &self.artifact_chunk_merkle_root,
            &self.chunk_hash_domain,
            self.chunk_size,
            self.chunk_count,
        )?;
        validate_bitmap(
            &self.verified_chunk_bitmap,
            self.chunk_count,
            self.verified_chunk_count,
        )?;
        if self.adopted_slot == 0 || self.sealed_buffer_header_hash == [0; 32] {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        let status_is_canonical = match self.status {
            BufferVerificationStatusV1::Adopted => {
                self.verified_chunk_count == 0
                    && self.finalized_slot == 0
                    && self.terminal_slot == 0
            }
            BufferVerificationStatusV1::Verifying => {
                self.verified_chunk_count > 0
                    && self.verified_chunk_count < self.chunk_count
                    && self.finalized_slot == 0
                    && self.terminal_slot == 0
            }
            BufferVerificationStatusV1::Verified => {
                self.verified_chunk_count == self.chunk_count
                    && self.finalized_slot != 0
                    && self.terminal_slot == 0
            }
            BufferVerificationStatusV1::ConsumedByUpgrade => {
                self.verified_chunk_count == self.chunk_count
                    && self.finalized_slot != 0
                    && self.terminal_slot != 0
            }
            BufferVerificationStatusV1::ClosedAbandoned => {
                self.terminal_slot != 0
                    && ((self.finalized_slot == 0 && self.verified_chunk_count < self.chunk_count)
                        || (self.finalized_slot != 0
                            && self.verified_chunk_count == self.chunk_count))
            }
        };
        if !status_is_canonical {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct ProgramDataVerificationV1 {
    pub discriminator: [u8; 8],
    pub account_version: u8,
    pub bump: u8,
    pub initialized: bool,
    pub status: ProgramDataVerificationStatusV1,
    pub controller_config: Pubkey,
    pub proposal: Pubkey,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub upgradeable_loader: Pubkey,
    pub controller_authority: Pubkey,
    pub artifact_length: u64,
    pub artifact_sha256: [u8; 32],
    pub artifact_chunk_merkle_root: [u8; 32],
    pub chunk_hash_domain: [u8; 32],
    pub chunk_size: u32,
    pub payload_chunk_count: u32,
    pub verified_payload_chunk_bitmap: [u8; VERIFICATION_BITMAP_BYTES_V1],
    pub verified_payload_chunk_count: u32,
    pub deployed_slot: u64,
    pub capacity: u64,
    pub tail_length: u64,
    pub tail_chunk_count: u32,
    pub verified_tail_chunk_bitmap: [u8; VERIFICATION_BITMAP_BYTES_V1],
    pub verified_tail_chunk_count: u32,
    pub raw_programdata_hash: [u8; 32],
    pub zero_tail_verified: bool,
    pub finalized_slot: u64,
    pub reserved: [u8; PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN],
}

impl ProgramDataVerificationV1 {
    pub const LEN: usize = 640;

    pub fn validate_schema(&self) -> GovernanceResult<()> {
        validate_header(
            &self.discriminator,
            &PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
            self.account_version,
            RELEASE1_ACCOUNT_VERSION_V1,
            self.initialized,
            &self.reserved,
        )?;
        require_nondefault_keys(&[
            self.controller_config,
            self.proposal,
            self.target_program,
            self.target_programdata,
            self.upgradeable_loader,
            self.controller_authority,
        ])?;
        validate_artifact_commitment(
            self.artifact_length,
            &self.artifact_sha256,
            &self.artifact_chunk_merkle_root,
            &self.chunk_hash_domain,
            self.chunk_size,
            self.payload_chunk_count,
        )?;
        if self.deployed_slot == 0
            || self.capacity < self.artifact_length
            || self.capacity > MAX_ARTIFACT_BYTES_V1
            || self.tail_length != self.capacity - self.artifact_length
            || self.tail_chunk_count
                != artifact_chunk_count_allow_empty(self.tail_length, self.chunk_size)?
            || self.raw_programdata_hash == [0; 32]
        {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        validate_bitmap(
            &self.verified_payload_chunk_bitmap,
            self.payload_chunk_count,
            self.verified_payload_chunk_count,
        )?;
        validate_bitmap(
            &self.verified_tail_chunk_bitmap,
            self.tail_chunk_count,
            self.verified_tail_chunk_count,
        )?;
        let complete = self.verified_payload_chunk_count == self.payload_chunk_count
            && self.verified_tail_chunk_count == self.tail_chunk_count;
        match self.status {
            ProgramDataVerificationStatusV1::Verifying => {
                if complete || self.zero_tail_verified || self.finalized_slot != 0 {
                    return Err(GovernanceError::InvalidRelease1Account);
                }
            }
            ProgramDataVerificationStatusV1::Verified => {
                if !complete || !self.zero_tail_verified || self.finalized_slot == 0 {
                    return Err(GovernanceError::InvalidRelease1Account);
                }
            }
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct StateCheckpointV1 {
    pub discriminator: [u8; 8],
    pub account_version: u8,
    pub bump: u8,
    pub initialized: bool,
    pub phase: StateCheckpointPhaseV1,
    pub controller_config: Pubkey,
    pub proposal: Pubkey,
    pub emergency_resolution: Pubkey,
    pub subject_digest: [u8; 32],
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub finalized_observation_slot: u64,
    pub gate_epoch: u64,
    pub target_programdata_slot: u64,
    pub target_payload_commitment: [u8; 32],
    pub target_raw_programdata_commitment: [u8; 32],
    pub target_capacity: u64,
    pub program_owned_state_root: [u8; 32],
    pub program_owned_state_count: u64,
    pub logical_compressed_state_root: [u8; 32],
    pub logical_compressed_state_count: u64,
    pub semantic_custody_accounting_root: [u8; 32],
    pub hard_combined_root: [u8; 32],
    pub external_metadata_observation_root: [u8; 32],
    pub external_raw_balance_observation_root: [u8; 32],
    pub schema_identifier: [u8; 32],
    pub admitted_positive_donation_root: [u8; 32],
    pub admitted_positive_donation_count: u64,
    pub forbidden_drift_count: u32,
    pub approval_council_version: u64,
    pub approval_council_hash: [u8; 32],
    pub checkpoint_digest: [u8; 32],
    pub approval_bitset: u8,
    pub approval_count: u8,
    pub accepted: bool,
    pub accepted_slot: u64,
    pub reserved: [u8; STATE_CHECKPOINT_V1_RESERVED_LEN],
}

impl StateCheckpointV1 {
    pub const LEN: usize = 704;

    pub fn validate_schema(&self) -> GovernanceResult<()> {
        validate_header(
            &self.discriminator,
            &STATE_CHECKPOINT_V1_DISCRIMINATOR,
            self.account_version,
            RELEASE1_ACCOUNT_VERSION_V1,
            self.initialized,
            &self.reserved,
        )?;
        require_nondefault_keys(&[
            self.controller_config,
            self.target_program,
            self.target_programdata,
        ])?;
        let subject_shape = match self.phase {
            StateCheckpointPhaseV1::Prestate | StateCheckpointPhaseV1::Poststate => {
                self.proposal != Pubkey::default() && self.emergency_resolution == Pubkey::default()
            }
            StateCheckpointPhaseV1::Emergency => {
                self.proposal == Pubkey::default() && self.emergency_resolution != Pubkey::default()
            }
        };
        if !subject_shape
            || self.subject_digest == [0; 32]
            || self.finalized_observation_slot == 0
            || self.gate_epoch == 0
            || self.target_programdata_slot == 0
            || self.target_payload_commitment == [0; 32]
            || self.target_raw_programdata_commitment == [0; 32]
            || self.target_capacity == 0
            || self.program_owned_state_root == [0; 32]
            || self.logical_compressed_state_root == [0; 32]
            || self.semantic_custody_accounting_root == [0; 32]
            || self.schema_identifier == [0; 32]
            || self.hard_combined_root == [0; 32]
            || self.external_metadata_observation_root == [0; 32]
            || self.external_raw_balance_observation_root == [0; 32]
            || self.forbidden_drift_count != 0
            || self.checkpoint_digest == [0; 32]
            || (self.admitted_positive_donation_count == 0)
                != (self.admitted_positive_donation_root == [0; 32])
        {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        validate_versioned_approval(
            self.approval_council_version,
            &self.approval_council_hash,
            self.approval_bitset,
            self.approval_count,
        )?;
        if self.accepted {
            if self.approval_count < RELEASE1_APPROVAL_THRESHOLD || self.accepted_slot == 0 {
                return Err(GovernanceError::InvalidRelease1Account);
            }
        } else if self.accepted_slot != 0 || self.approval_count >= RELEASE1_APPROVAL_THRESHOLD {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct CouncilRotationProposalV1 {
    pub discriminator: [u8; 8],
    pub account_version: u8,
    pub bump: u8,
    pub initialized: bool,
    pub state: CouncilRotationStateV1,
    pub controller_config: Pubkey,
    pub target_program: Pubkey,
    pub current_council: Pubkey,
    pub current_council_version: u64,
    pub current_council_hash: [u8; 32],
    pub candidate_council: Pubkey,
    pub candidate_council_version: u64,
    pub candidate_council_hash: [u8; 32],
    pub creation_slot: u64,
    pub not_before_slot: u64,
    pub expiry_slot: u64,
    pub target_nonce: u64,
    pub approval_bitset: u8,
    pub approval_count: u8,
    pub cancellation_approval_bitset: u8,
    pub cancellation_approval_count: u8,
    pub rotation_digest: [u8; 32],
    pub activated_slot: u64,
    pub cancellation_reason_code: u16,
    pub terminal_reason_code: u16,
    pub reserved: [u8; COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN],
}

impl CouncilRotationProposalV1 {
    pub const LEN: usize = 384;

    pub fn validate_schema(&self) -> GovernanceResult<()> {
        validate_header(
            &self.discriminator,
            &COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
            self.account_version,
            RELEASE1_ACCOUNT_VERSION_V1,
            self.initialized,
            &self.reserved,
        )?;
        require_nondefault_keys(&[
            self.controller_config,
            self.target_program,
            self.current_council,
            self.candidate_council,
        ])?;
        if self.current_council_version == 0
            || self.candidate_council_version
                != self
                    .current_council_version
                    .checked_add(1)
                    .ok_or(GovernanceError::ArithmeticOverflow)?
            || self.current_council_hash == [0; 32]
            || self.candidate_council_hash == [0; 32]
            || self.target_nonce == 0
            || self.creation_slot >= self.not_before_slot
            || self.not_before_slot >= self.expiry_slot
            || self.rotation_digest == [0; 32]
        {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        validate_approval_pair(self.approval_bitset, self.approval_count)?;
        validate_approval_pair(
            self.cancellation_approval_bitset,
            self.cancellation_approval_count,
        )?;
        let activated = matches!(self.state, CouncilRotationStateV1::Activated);
        if activated != (self.activated_slot != 0) {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct EmergencyFreezeResolutionV1 {
    pub discriminator: [u8; 8],
    pub account_version: u8,
    pub bump: u8,
    pub initialized: bool,
    pub state: EmergencyFreezeResolutionStateV1,
    pub controller_config: Pubkey,
    pub protocol_gate: Pubkey,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub frozen_epoch: u64,
    pub freeze_slot: u64,
    pub freeze_reason_code: u16,
    pub resolution_kind: EmergencyFreezeResolutionKindV1,
    pub creation_slot: u64,
    pub not_before_slot: u64,
    pub expiry_slot: u64,
    pub target_nonce: u64,
    pub observed_programdata_slot: u64,
    pub observed_payload_hash: [u8; 32],
    pub observed_raw_programdata_hash: [u8; 32],
    pub observed_capacity: u64,
    pub observed_authority: Pubkey,
    pub emergency_checkpoint: Pubkey,
    pub approval_council_version: u64,
    pub approval_council_hash: [u8; 32],
    pub approval_bitset: u8,
    pub approval_count: u8,
    pub resolution_digest: [u8; 32],
    pub executed_slot: u64,
    pub cancellation_reason_code: u16,
    pub terminal_reason_code: u16,
    pub reserved: [u8; EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN],
}

impl EmergencyFreezeResolutionV1 {
    pub const LEN: usize = 512;

    pub fn validate_schema(&self) -> GovernanceResult<()> {
        validate_header(
            &self.discriminator,
            &EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
            self.account_version,
            RELEASE1_ACCOUNT_VERSION_V1,
            self.initialized,
            &self.reserved,
        )?;
        require_nondefault_keys(&[
            self.controller_config,
            self.protocol_gate,
            self.target_program,
            self.target_programdata,
            self.observed_authority,
            self.emergency_checkpoint,
        ])?;
        if self.frozen_epoch == 0
            || self.freeze_slot == 0
            || self.freeze_reason_code == 0
            || self.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
            || self.creation_slot >= self.not_before_slot
            || self.not_before_slot >= self.expiry_slot
            || self.target_nonce == 0
            || self.observed_programdata_slot == 0
            || self.observed_payload_hash == [0; 32]
            || self.observed_raw_programdata_hash == [0; 32]
            || self.observed_capacity == 0
            || self.resolution_digest == [0; 32]
        {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        validate_versioned_approval(
            self.approval_council_version,
            &self.approval_council_hash,
            self.approval_bitset,
            self.approval_count,
        )?;
        let executed = matches!(self.state, EmergencyFreezeResolutionStateV1::Executed);
        if executed != (self.executed_slot != 0) {
            return Err(GovernanceError::InvalidRelease1Account);
        }
        Ok(())
    }
}

pub mod upgrade_proposal_v2_offset {
    pub const DISCRIMINATOR: usize = 0;
    pub const ACCOUNT_VERSION: usize = 8;
    pub const INITIALIZED: usize = 10;
    pub const PROPOSAL_CLASS: usize = 11;
    pub const STATE: usize = 12;
    pub const PROPOSAL_ID: usize = 16;
    pub const CLUSTER_DOMAIN: usize = 40;
    pub const BUFFER: usize = 424;
    pub const ARTIFACT_LENGTH: usize = 616;
    pub const CHUNK_SIZE: usize = 720;
    pub const FIRST_APPROVAL_SLOT: usize = 1436;
    pub const PROPOSAL_DIGEST: usize = 1610;
    pub const RESERVED: usize = 1646;
}

pub mod buffer_verification_v1_offset {
    pub const STATUS: usize = 11;
    pub const ARTIFACT_LENGTH: usize = 204;
    pub const BITMAP: usize = 316;
    pub const VERIFIED_COUNT: usize = 380;
    pub const TERMINAL_SLOT: usize = 432;
    pub const RESERVED: usize = 440;
}

pub mod programdata_verification_v1_offset {
    pub const STATUS: usize = 11;
    pub const PAYLOAD_BITMAP: usize = 316;
    pub const TAIL_LENGTH: usize = 400;
    pub const TAIL_BITMAP: usize = 412;
    pub const RAW_HASH: usize = 480;
    pub const ZERO_TAIL_VERIFIED: usize = 512;
    pub const RESERVED: usize = 521;
}

pub mod state_checkpoint_v1_offset {
    pub const PHASE: usize = 11;
    pub const CONTROLLER_CONFIG: usize = 12;
    pub const SUBJECT_DIGEST: usize = 108;
    pub const HARD_COMBINED_ROOT: usize = 412;
    pub const FORBIDDEN_DRIFT_COUNT: usize = 580;
    pub const CHECKPOINT_DIGEST: usize = 624;
    pub const ACCEPTED: usize = 658;
    pub const RESERVED: usize = 667;
}

pub mod council_rotation_v1_offset {
    pub const STATE: usize = 11;
    pub const CONTROLLER_CONFIG: usize = 12;
    pub const TARGET_NONCE: usize = 244;
    pub const ROTATION_DIGEST: usize = 256;
    pub const RESERVED: usize = 300;
}

pub mod emergency_resolution_v1_offset {
    pub const STATE: usize = 11;
    pub const CONTROLLER_CONFIG: usize = 12;
    pub const FROZEN_EPOCH: usize = 140;
    pub const RESOLUTION_KIND: usize = 158;
    pub const RESOLUTION_DIGEST: usize = 377;
    pub const RESERVED: usize = 421;
}

fn validate_header<const N: usize>(
    actual_discriminator: &[u8; 8],
    expected_discriminator: &[u8; 8],
    actual_version: u8,
    expected_version: u8,
    initialized: bool,
    reserved: &[u8; N],
) -> GovernanceResult<()> {
    if actual_discriminator != expected_discriminator {
        return Err(GovernanceError::InvalidDiscriminator);
    }
    if actual_version != expected_version {
        return Err(GovernanceError::UnsupportedVersion);
    }
    if !initialized {
        return Err(GovernanceError::Uninitialized);
    }
    if reserved.iter().any(|byte| *byte != 0) {
        return Err(GovernanceError::NonzeroReserved);
    }
    Ok(())
}

fn require_nondefault_keys(keys: &[Pubkey]) -> GovernanceResult<()> {
    if keys.iter().any(|key| *key == Pubkey::default()) {
        Err(GovernanceError::DefaultPubkey)
    } else {
        Ok(())
    }
}

fn validate_approval_pair(bitset: u8, count: u8) -> GovernanceResult<()> {
    if bitset & !VALID_APPROVAL_MASK != 0 {
        return Err(GovernanceError::InvalidApprovalBitset);
    }
    if bitset.count_ones() as u8 != count {
        return Err(GovernanceError::ApprovalCountMismatch);
    }
    Ok(())
}

fn validate_versioned_approval(
    council_version: u64,
    council_hash: &[u8; 32],
    bitset: u8,
    count: u8,
) -> GovernanceResult<()> {
    validate_approval_pair(bitset, count)?;
    let empty = council_version == 0 && *council_hash == [0; 32] && bitset == 0 && count == 0;
    let pinned = council_version != 0 && *council_hash != [0; 32] && count != 0;
    if empty || pinned {
        Ok(())
    } else {
        Err(GovernanceError::InvalidRelease1Account)
    }
}

fn validate_artifact_commitment(
    artifact_length: u64,
    artifact_sha256: &[u8; 32],
    artifact_root: &[u8; 32],
    scheme_id: &[u8; 32],
    chunk_size: u32,
    chunk_count: u32,
) -> GovernanceResult<()> {
    if artifact_length == 0
        || artifact_length > MAX_ARTIFACT_BYTES_V1
        || *artifact_sha256 == [0; 32]
        || *artifact_root == [0; 32]
        || *scheme_id != ARTIFACT_MERKLE_SCHEME_ID
        || !is_release1_chunk_size(chunk_size)
        || chunk_count != artifact_chunk_count(artifact_length, chunk_size)?
    {
        Err(GovernanceError::InvalidMerkleParameters)
    } else {
        Ok(())
    }
}

fn artifact_chunk_count_allow_empty(length: u64, chunk_size: u32) -> GovernanceResult<u32> {
    if length == 0 {
        Ok(0)
    } else {
        artifact_chunk_count(length, chunk_size)
    }
}

fn validate_bitmap(
    bitmap: &[u8; VERIFICATION_BITMAP_BYTES_V1],
    bit_count: u32,
    stored_count: u32,
) -> GovernanceResult<()> {
    if bit_count > MAX_ARTIFACT_CHUNKS_V1 as u32 {
        return Err(GovernanceError::InvalidRelease1Bitmap);
    }
    let actual_count = bitmap.iter().map(|byte| byte.count_ones()).sum::<u32>();
    if actual_count != stored_count {
        return Err(GovernanceError::InvalidRelease1Bitmap);
    }
    for index in bit_count..MAX_ARTIFACT_CHUNKS_V1 as u32 {
        if bitmap[(index / 8) as usize] & (1 << (index % 8)) != 0 {
            return Err(GovernanceError::InvalidRelease1Bitmap);
        }
    }
    Ok(())
}
