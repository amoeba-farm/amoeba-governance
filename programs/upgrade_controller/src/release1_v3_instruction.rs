//! Closed fixed-wire instructions for the capacity-safe Release 1 lifecycle.
//!
//! Tags 39..=52 belong to the scalable observation and authority-ceremony
//! protocols.  This module begins at 53 and exposes only typed payloads and
//! fixed account contracts.  It contains no arbitrary CPI bytes, program IDs,
//! account vectors, or persisted dynamic collections.

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    council::VALID_APPROVAL_MASK,
    release1_authority_instruction::CeremonyEnvelopeV1,
    release1_ceremony_digest::{
        validate_capacity_policy_digest_v1, validate_controller_release_digest_v1,
    },
    release1_ceremony_state::{ControllerReleaseCommitmentV1, ProgramDataCapacityPolicyV1},
    release1_state::{
        EmergencyFreezeResolutionStateV1, ProposalStateV2, StateCheckpointPhaseV1,
        RELEASE1_APPROVAL_THRESHOLD,
    },
    release1_v3_digest::{
        validate_emergency_freeze_observation_digest_v2,
        validate_emergency_freeze_resolution_digest_v2,
        validate_programdata_failure_observation_digest_v2,
        validate_programdata_verification_digest_v2, validate_state_checkpoint_digest_v2,
        validate_upgrade_proposal_digest_v3,
    },
    release1_v3_state::{
        EmergencyFreezeObservationV2, EmergencyFreezeResolutionV2, ProgramDataFailureObservationV2,
        ProgramDataVerificationStatusV2, ProgramDataVerificationV2, StateCheckpointV2,
        UpgradeProposalV3,
    },
    state::GateStatusV1,
};

pub const INITIALIZE_CONTROLLER_V2_TAG: u8 = 53;
pub const CREATE_PROPOSAL_V3_TAG: u8 = 54;
pub const APPROVE_PROPOSAL_V3_TAG: u8 = 55;
pub const FINALIZE_GOVERNANCE_V3_TAG: u8 = 56;
pub const QUEUE_PROPOSAL_V3_TAG: u8 = 57;
pub const FREEZE_PROPOSAL_V3_TAG: u8 = 58;
pub const CANCEL_PROPOSAL_V3_TAG: u8 = 59;
pub const EXPIRE_PROPOSAL_V3_TAG: u8 = 60;
pub const GUARDIAN_FREEZE_V2_TAG: u8 = 61;
pub const CREATE_EMERGENCY_RESOLUTION_V2_TAG: u8 = 62;
pub const APPROVE_EMERGENCY_RESOLUTION_V2_TAG: u8 = 63;
pub const QUEUE_EMERGENCY_RESOLUTION_V2_TAG: u8 = 64;
pub const EXECUTE_EMERGENCY_RESOLUTION_V2_TAG: u8 = 65;
pub const EXPIRE_EMERGENCY_RESOLUTION_V2_TAG: u8 = 66;
pub const CREATE_CHECKPOINT_V2_TAG: u8 = 67;
pub const RECAST_CHECKPOINT_V2_TAG: u8 = 68;
pub const FINALIZE_CHECKPOINT_V2_TAG: u8 = 69;
pub const BIND_PROGRAMDATA_VERIFICATION_V2_TAG: u8 = 70;
pub const FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG: u8 = 71;
pub const OBSERVE_PROGRAMDATA_FAILURE_V2_TAG: u8 = 72;
pub const APPROVE_UNFREEZE_V2_TAG: u8 = 73;
pub const EXECUTE_UNFREEZE_V2_TAG: u8 = 74;

pub const MAX_RELEASE1_V3_INSTRUCTION_DATA_LEN: usize = 16_384;
pub const INITIALIZE_CONTROLLER_V2_ACCOUNT_COUNT: usize = 22;

#[derive(Clone, Copy, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct SeatTermV2 {
    pub term_start_slot: u64,
    pub term_end_slot: u64,
}

impl SeatTermV2 {
    pub const LEN: usize = 16;

    fn validate(&self) -> Result<(), ProgramError> {
        if self.term_end_slot <= self.term_start_slot {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct ProposalGuardV3 {
    pub expected_proposal_digest: [u8; 32],
    pub expected_state: ProposalStateV2,
    pub expected_gate_status: GateStatusV1,
    pub expected_gate_epoch: u64,
    pub expected_target_nonce: u64,
    pub expected_capacity_policy_digest: [u8; 32],
    pub expected_current_deployment_digest: [u8; 32],
    pub expected_current_deployment_generation: u64,
}

impl ProposalGuardV3 {
    pub const LEN: usize = 122;

    fn validate(&self) -> Result<(), ProgramError> {
        require_hashes(&[
            self.expected_proposal_digest,
            self.expected_capacity_policy_digest,
            self.expected_current_deployment_digest,
        ])?;
        if self.expected_gate_epoch == 0
            || self.expected_target_nonce == 0
            || self.expected_current_deployment_generation == 0
            || self.expected_state == ProposalStateV2::TokenReviewOpen
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct EmergencyResolutionGuardV2 {
    pub expected_resolution_digest: [u8; 32],
    pub expected_state: EmergencyFreezeResolutionStateV1,
    pub expected_gate_status: GateStatusV1,
    pub expected_gate_epoch: u64,
    pub expected_target_nonce: u64,
    pub expected_capacity_policy_digest: [u8; 32],
    pub expected_current_deployment_digest: [u8; 32],
    pub expected_current_deployment_generation: u64,
    pub expected_freeze_observation_digest: [u8; 32],
    pub expected_programdata_observation_digest: [u8; 32],
    pub expected_observation_generation: u64,
    pub expected_checkpoint_digest: [u8; 32],
}

impl EmergencyResolutionGuardV2 {
    pub const LEN: usize = 226;

    fn validate(&self) -> Result<(), ProgramError> {
        require_hashes(&[
            self.expected_resolution_digest,
            self.expected_capacity_policy_digest,
            self.expected_current_deployment_digest,
            self.expected_freeze_observation_digest,
            self.expected_programdata_observation_digest,
            self.expected_checkpoint_digest,
        ])?;
        if self.expected_gate_status != GateStatusV1::EmergencyFrozen
            || self.expected_gate_epoch == 0
            || self.expected_target_nonce == 0
            || self.expected_current_deployment_generation == 0
            || self.expected_observation_generation == 0
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct CheckpointGuardV2 {
    pub expected_checkpoint_digest: [u8; 32],
    pub expected_checkpoint_generation: u64,
    pub expected_phase: StateCheckpointPhaseV1,
    pub expected_subject_digest: [u8; 32],
    pub expected_gate_epoch: u64,
    pub expected_capacity_policy_digest: [u8; 32],
    pub expected_current_deployment_digest: [u8; 32],
    pub expected_current_deployment_generation: u64,
    pub expected_observation_digest: [u8; 32],
    pub expected_observation_generation: u64,
    pub expected_council_version: u64,
    pub expected_council_hash: [u8; 32],
    pub expected_approval_bitset: u8,
    pub expected_approval_count: u8,
    pub expected_accepted: bool,
}

impl CheckpointGuardV2 {
    pub const LEN: usize = 236;

    fn validate(&self) -> Result<(), ProgramError> {
        require_hashes(&[
            self.expected_checkpoint_digest,
            self.expected_subject_digest,
            self.expected_capacity_policy_digest,
            self.expected_current_deployment_digest,
            self.expected_observation_digest,
            self.expected_council_hash,
        ])?;
        validate_approval_pair(self.expected_approval_bitset, self.expected_approval_count)?;
        if self.expected_checkpoint_generation == 0
            || self.expected_gate_epoch == 0
            || self.expected_current_deployment_generation == 0
            || self.expected_observation_generation == 0
            || self.expected_council_version == 0
            || self.expected_approval_count != RELEASE1_APPROVAL_THRESHOLD
            || !self.expected_accepted
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct ProgramDataVerificationGuardV2 {
    pub expected_proposal_digest: [u8; 32],
    pub expected_verification_digest: [u8; 32],
    pub expected_verification_generation: u64,
    pub expected_status: ProgramDataVerificationStatusV2,
    pub expected_gate_epoch: u64,
    pub expected_target_nonce: u64,
    pub expected_capacity_policy_digest: [u8; 32],
    pub expected_current_deployment_digest: [u8; 32],
    pub expected_current_deployment_generation: u64,
    pub expected_observation_digest: [u8; 32],
    pub expected_observation_generation: u64,
    pub expected_actual_capacity: u64,
    pub expected_authority: Pubkey,
}

impl ProgramDataVerificationGuardV2 {
    pub const LEN: usize = 241;

    pub fn validate(&self) -> Result<(), ProgramError> {
        require_hashes(&[
            self.expected_proposal_digest,
            self.expected_verification_digest,
            self.expected_capacity_policy_digest,
            self.expected_current_deployment_digest,
            self.expected_observation_digest,
        ])?;
        if self.expected_verification_generation == 0
            || self.expected_gate_epoch == 0
            || self.expected_target_nonce == 0
            || self.expected_current_deployment_generation == 0
            || self.expected_observation_generation == 0
            || self.expected_actual_capacity == 0
            || self.expected_authority == Pubkey::default()
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

#[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
pub struct UnfreezeGuardV2 {
    pub expected_proposal_digest: [u8; 32],
    pub expected_checkpoint_digest: [u8; 32],
    pub expected_checkpoint_generation: u64,
    pub expected_verification_digest: [u8; 32],
    pub expected_verification_generation: u64,
    pub expected_original_council_version: u64,
    pub expected_original_council_hash: [u8; 32],
    pub expected_current_council_version: u64,
    pub expected_current_council_hash: [u8; 32],
    pub expected_gate_epoch: u64,
    pub expected_target_nonce: u64,
    pub expected_current_deployment_digest: [u8; 32],
    pub expected_current_deployment_generation: u64,
    pub expected_artifact_sha256: [u8; 32],
    pub expected_artifact_merkle_root: [u8; 32],
    pub expected_actual_capacity: u64,
    pub expected_approval_bitset: u8,
    pub expected_approval_count: u8,
}

impl UnfreezeGuardV2 {
    pub const LEN: usize = 322;

    fn validate(&self) -> Result<(), ProgramError> {
        require_hashes(&[
            self.expected_proposal_digest,
            self.expected_checkpoint_digest,
            self.expected_verification_digest,
            self.expected_original_council_hash,
            self.expected_current_council_hash,
            self.expected_current_deployment_digest,
            self.expected_artifact_sha256,
            self.expected_artifact_merkle_root,
        ])?;
        validate_approval_pair(self.expected_approval_bitset, self.expected_approval_count)?;
        if self.expected_checkpoint_generation == 0
            || self.expected_verification_generation == 0
            || self.expected_original_council_version == 0
            || self.expected_current_council_version == 0
            || self.expected_gate_epoch == 0
            || self.expected_target_nonce == 0
            || self.expected_current_deployment_generation == 0
            || self.expected_actual_capacity == 0
            || self.expected_approval_count > RELEASE1_APPROVAL_THRESHOLD
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

trait WireValidate {
    fn validate_wire(&self) -> Result<(), ProgramError>;
}

macro_rules! fixed_instruction {
    ($name:ident, $tag:ident, $tag_value:expr, $payload_len:expr, { $($field:ident: $ty:ty),* $(,)? }) => {
        pub const $tag: u8 = $tag_value;

        #[derive(Clone, Debug, Eq, PartialEq, BorshDeserialize, BorshSerialize)]
        pub struct $name {
            $(pub $field: $ty,)*
        }

        impl $name {
            pub const TAG: u8 = $tag;
            pub const PAYLOAD_LEN: usize = $payload_len;
            pub const LEN: usize = 1 + Self::PAYLOAD_LEN;

            pub fn pack(&self) -> Result<Vec<u8>, ProgramError> {
                self.validate_wire()?;
                let payload = self
                    .try_to_vec()
                    .map_err(|_| ProgramError::InvalidInstructionData)?;
                if payload.len() != Self::PAYLOAD_LEN || Self::LEN > MAX_RELEASE1_V3_INSTRUCTION_DATA_LEN {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut data = Vec::with_capacity(Self::LEN);
                data.push(Self::TAG);
                data.extend_from_slice(&payload);
                Ok(data)
            }

            pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
                if data.len() != Self::LEN
                    || data.len() > MAX_RELEASE1_V3_INSTRUCTION_DATA_LEN
                    || data.first().copied() != Some(Self::TAG)
                {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let value = Self::try_from_slice(&data[1..])
                    .map_err(|_| ProgramError::InvalidInstructionData)?;
                value.validate_wire()?;
                Ok(value)
            }
        }
    };
}

fixed_instruction!(
    InitializeControllerV2,
    INITIALIZE_CONTROLLER_V2_TAG_ALIAS,
    INITIALIZE_CONTROLLER_V2_TAG,
    1_424,
    {
        cluster_domain: [u8; 32],
        initial_policy_version: u64,
        initial_council_version: u64,
        next_proposal_id: u64,
        target_nonce: u64,
        initial_gate_epoch: u64,
        policy_activation_slot: u64,
        routine_delay_slots: u64,
        major_delay_slots: u64,
        rollback_delay_slots: u64,
        terminal_delay_slots: u64,
        vote_review_slots: u64,
        proposal_expiry_slots: u64,
        expected_policy_hash: [u8; 32],
        expected_council_hash: [u8; 32],
        seat_terms: [SeatTermV2; 5],
        capacity_policy: ProgramDataCapacityPolicyV1,
        controller_release: ControllerReleaseCommitmentV1
    }
);

fixed_instruction!(
    CreateProposalV3,
    CREATE_PROPOSAL_V3_TAG_ALIAS,
    CREATE_PROPOSAL_V3_TAG,
    UpgradeProposalV3::LEN,
    { candidate: UpgradeProposalV3 }
);

fixed_instruction!(
    ApproveProposalV3,
    APPROVE_PROPOSAL_V3_TAG_ALIAS,
    APPROVE_PROPOSAL_V3_TAG,
    ProposalGuardV3::LEN + 8 + 32 + 1 + 1,
    {
        expected: ProposalGuardV3,
        expected_creation_council_version: u64,
        expected_creation_council_hash: [u8; 32],
        expected_approval_bitset: u8,
        expected_approval_count: u8
    }
);

fixed_instruction!(
    FinalizeGovernanceV3,
    FINALIZE_GOVERNANCE_V3_TAG_ALIAS,
    FINALIZE_GOVERNANCE_V3_TAG,
    ProposalGuardV3::LEN + 1 + 1,
    {
        expected: ProposalGuardV3,
        expected_approval_bitset: u8,
        expected_approval_count: u8
    }
);

fixed_instruction!(QueueProposalV3, QUEUE_PROPOSAL_V3_TAG_ALIAS, QUEUE_PROPOSAL_V3_TAG, ProposalGuardV3::LEN, {
    expected: ProposalGuardV3
});

fixed_instruction!(FreezeProposalV3, FREEZE_PROPOSAL_V3_TAG_ALIAS, FREEZE_PROPOSAL_V3_TAG, ProposalGuardV3::LEN + 8, {
    expected: ProposalGuardV3,
    expected_next_gate_epoch: u64
});

fixed_instruction!(CancelProposalV3, CANCEL_PROPOSAL_V3_TAG_ALIAS, CANCEL_PROPOSAL_V3_TAG, ProposalGuardV3::LEN + 8 + 32 + 1 + 1 + 2, {
    expected: ProposalGuardV3,
    expected_cancellation_council_version: u64,
    expected_cancellation_council_hash: [u8; 32],
    expected_cancellation_approval_bitset: u8,
    expected_cancellation_approval_count: u8,
    cancellation_reason_code: u16
});

fixed_instruction!(ExpireProposalV3, EXPIRE_PROPOSAL_V3_TAG_ALIAS, EXPIRE_PROPOSAL_V3_TAG, ProposalGuardV3::LEN, {
    expected: ProposalGuardV3
});

fixed_instruction!(GuardianFreezeV2, GUARDIAN_FREEZE_V2_TAG_ALIAS, GUARDIAN_FREEZE_V2_TAG, EmergencyFreezeObservationV2::LEN, {
    candidate: EmergencyFreezeObservationV2
});

fixed_instruction!(CreateEmergencyResolutionV2, CREATE_EMERGENCY_RESOLUTION_V2_TAG_ALIAS, CREATE_EMERGENCY_RESOLUTION_V2_TAG, EmergencyFreezeResolutionV2::LEN, {
    candidate: EmergencyFreezeResolutionV2
});

fixed_instruction!(ApproveEmergencyResolutionV2, APPROVE_EMERGENCY_RESOLUTION_V2_TAG_ALIAS, APPROVE_EMERGENCY_RESOLUTION_V2_TAG, EmergencyResolutionGuardV2::LEN + 1 + 1, {
    expected: EmergencyResolutionGuardV2,
    expected_approval_bitset: u8,
    expected_approval_count: u8
});

fixed_instruction!(QueueEmergencyResolutionV2, QUEUE_EMERGENCY_RESOLUTION_V2_TAG_ALIAS, QUEUE_EMERGENCY_RESOLUTION_V2_TAG, EmergencyResolutionGuardV2::LEN, {
    expected: EmergencyResolutionGuardV2
});

fixed_instruction!(ExecuteEmergencyResolutionV2, EXECUTE_EMERGENCY_RESOLUTION_V2_TAG_ALIAS, EXECUTE_EMERGENCY_RESOLUTION_V2_TAG, EmergencyResolutionGuardV2::LEN + CeremonyEnvelopeV1::LEN, {
    expected: EmergencyResolutionGuardV2,
    envelope: CeremonyEnvelopeV1
});

fixed_instruction!(ExpireEmergencyResolutionV2, EXPIRE_EMERGENCY_RESOLUTION_V2_TAG_ALIAS, EXPIRE_EMERGENCY_RESOLUTION_V2_TAG, EmergencyResolutionGuardV2::LEN, {
    expected: EmergencyResolutionGuardV2
});

fixed_instruction!(CreateCheckpointV2, CREATE_CHECKPOINT_V2_TAG_ALIAS, CREATE_CHECKPOINT_V2_TAG, StateCheckpointV2::LEN, {
    candidate: StateCheckpointV2
});

fixed_instruction!(RecastCheckpointV2, RECAST_CHECKPOINT_V2_TAG_ALIAS, RECAST_CHECKPOINT_V2_TAG, 32 + StateCheckpointV2::LEN, {
    expected_previous_checkpoint_digest: [u8; 32],
    candidate: StateCheckpointV2
});

fixed_instruction!(FinalizeCheckpointV2, FINALIZE_CHECKPOINT_V2_TAG_ALIAS, FINALIZE_CHECKPOINT_V2_TAG, CheckpointGuardV2::LEN, {
    expected: CheckpointGuardV2
});

fixed_instruction!(BindProgramDataVerificationV2, BIND_PROGRAMDATA_VERIFICATION_V2_TAG_ALIAS, BIND_PROGRAMDATA_VERIFICATION_V2_TAG, ProgramDataVerificationV2::LEN, {
    candidate: ProgramDataVerificationV2
});

fixed_instruction!(FinalizeProgramDataVerificationV2, FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG_ALIAS, FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG, 32 + ProgramDataVerificationV2::LEN, {
    expected_bound_verification_digest: [u8; 32],
    finalized: ProgramDataVerificationV2
});

fixed_instruction!(ObserveProgramDataFailureV2, OBSERVE_PROGRAMDATA_FAILURE_V2_TAG_ALIAS, OBSERVE_PROGRAMDATA_FAILURE_V2_TAG, ProgramDataFailureObservationV2::LEN, {
    candidate: ProgramDataFailureObservationV2
});

fixed_instruction!(ApproveUnfreezeV2, APPROVE_UNFREEZE_V2_TAG_ALIAS, APPROVE_UNFREEZE_V2_TAG, UnfreezeGuardV2::LEN, {
    expected: UnfreezeGuardV2
});

fixed_instruction!(ExecuteUnfreezeV2, EXECUTE_UNFREEZE_V2_TAG_ALIAS, EXECUTE_UNFREEZE_V2_TAG, UnfreezeGuardV2::LEN + 32 + CeremonyEnvelopeV1::LEN, {
    expected: UnfreezeGuardV2,
    linked_proposal: Pubkey,
    envelope: CeremonyEnvelopeV1
});

impl WireValidate for InitializeControllerV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        require_hashes(&[
            self.cluster_domain,
            self.expected_policy_hash,
            self.expected_council_hash,
        ])?;
        if self.initial_policy_version == 0
            || self.initial_council_version == 0
            || self.next_proposal_id == 0
            || self.next_proposal_id == u64::MAX
            || self.target_nonce == 0
            || self.target_nonce == u64::MAX
            || self.initial_gate_epoch != 1
            || self.policy_activation_slot == 0
            || self.routine_delay_slots == 0
            || self.major_delay_slots < self.routine_delay_slots
            || self.rollback_delay_slots == 0
            || self.terminal_delay_slots < self.major_delay_slots
            || self.vote_review_slots == 0
            || self.proposal_expiry_slots <= self.major_delay_slots
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        for term in &self.seat_terms {
            term.validate()?;
        }
        self.capacity_policy
            .validate_static()
            .map_err(ProgramError::from)?;
        validate_capacity_policy_digest_v1(&self.capacity_policy).map_err(ProgramError::from)?;
        self.controller_release
            .validate_static()
            .map_err(ProgramError::from)?;
        validate_controller_release_digest_v1(&self.controller_release).map_err(ProgramError::from)
    }
}

impl WireValidate for CreateProposalV3 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_upgrade_proposal_digest_v3(&self.candidate).map_err(ProgramError::from)?;
        if self.candidate.state != ProposalStateV2::Draft {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for ApproveProposalV3 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        validate_approval_pair(self.expected_approval_bitset, self.expected_approval_count)?;
        if self.expected.expected_state != ProposalStateV2::BufferVerified
            || self.expected_creation_council_version == 0
            || self.expected_creation_council_hash == [0; 32]
            || self.expected_approval_count >= RELEASE1_APPROVAL_THRESHOLD
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for FinalizeGovernanceV3 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        validate_approval_pair(self.expected_approval_bitset, self.expected_approval_count)?;
        if self.expected.expected_state != ProposalStateV2::CouncilApproved
            || self.expected_approval_count != RELEASE1_APPROVAL_THRESHOLD
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for QueueProposalV3 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        require_proposal_state(&self.expected, ProposalStateV2::GovernanceSatisfied)
    }
}

impl WireValidate for FreezeProposalV3 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        require_proposal_state(&self.expected, ProposalStateV2::Timelocked)?;
        let expected_next = self
            .expected
            .expected_gate_epoch
            .checked_add(1)
            .ok_or(ProgramError::InvalidInstructionData)?;
        if self.expected_next_gate_epoch != expected_next
            || !matches!(
                self.expected.expected_gate_status,
                GateStatusV1::Active | GateStatusV1::EmergencyFrozen
            )
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for CancelProposalV3 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        validate_approval_pair(
            self.expected_cancellation_approval_bitset,
            self.expected_cancellation_approval_count,
        )?;
        if !is_prefreeze_proposal_state(self.expected.expected_state)
            || self.expected_cancellation_council_version == 0
            || self.expected_cancellation_council_hash == [0; 32]
            || self.expected_cancellation_approval_count >= RELEASE1_APPROVAL_THRESHOLD
            || self.cancellation_reason_code == 0
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for ExpireProposalV3 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        if !is_prefreeze_proposal_state(self.expected.expected_state) {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for GuardianFreezeV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_emergency_freeze_observation_digest_v2(&self.candidate).map_err(ProgramError::from)
    }
}

impl WireValidate for CreateEmergencyResolutionV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_emergency_freeze_resolution_digest_v2(&self.candidate)
            .map_err(ProgramError::from)?;
        if self.candidate.state != EmergencyFreezeResolutionStateV1::Draft
            || self.candidate.approval_count != 0
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for ApproveEmergencyResolutionV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        validate_approval_pair(self.expected_approval_bitset, self.expected_approval_count)?;
        if self.expected.expected_state != EmergencyFreezeResolutionStateV1::Draft
            || self.expected_approval_count >= RELEASE1_APPROVAL_THRESHOLD
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for QueueEmergencyResolutionV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        require_resolution_state(
            &self.expected,
            EmergencyFreezeResolutionStateV1::CouncilApproved,
        )
    }
}

impl WireValidate for ExecuteEmergencyResolutionV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        require_resolution_state(&self.expected, EmergencyFreezeResolutionStateV1::Timelocked)?;
        self.envelope.validate()
    }
}

impl WireValidate for ExpireEmergencyResolutionV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        if !matches!(
            self.expected.expected_state,
            EmergencyFreezeResolutionStateV1::Draft
                | EmergencyFreezeResolutionStateV1::CouncilApproved
                | EmergencyFreezeResolutionStateV1::Timelocked
        ) {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for CreateCheckpointV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_state_checkpoint_digest_v2(&self.candidate).map_err(ProgramError::from)?;
        if self.candidate.checkpoint_generation != 1
            || self.candidate.previous_checkpoint_digest != [0; 32]
            || self.candidate.approval_count != 0
            || self.candidate.accepted
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for RecastCheckpointV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_state_checkpoint_digest_v2(&self.candidate).map_err(ProgramError::from)?;
        if self.expected_previous_checkpoint_digest == [0; 32]
            || self.candidate.checkpoint_generation <= 1
            || self.candidate.previous_checkpoint_digest != self.expected_previous_checkpoint_digest
            || self.candidate.approval_count != 0
            || self.candidate.accepted
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for FinalizeCheckpointV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()
    }
}

impl WireValidate for BindProgramDataVerificationV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_programdata_verification_digest_v2(&self.candidate).map_err(ProgramError::from)?;
        if self.candidate.status != ProgramDataVerificationStatusV2::ObservationBound {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for FinalizeProgramDataVerificationV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_programdata_verification_digest_v2(&self.finalized).map_err(ProgramError::from)?;
        if self.expected_bound_verification_digest == [0; 32]
            || self.finalized.status != ProgramDataVerificationStatusV2::Verified
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for ObserveProgramDataFailureV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        validate_programdata_failure_observation_digest_v2(&self.candidate)
            .map_err(ProgramError::from)
    }
}

impl WireValidate for ApproveUnfreezeV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        if self.expected.expected_approval_count >= RELEASE1_APPROVAL_THRESHOLD {
            return Err(ProgramError::InvalidInstructionData);
        }
        Ok(())
    }
}

impl WireValidate for ExecuteUnfreezeV2 {
    fn validate_wire(&self) -> Result<(), ProgramError> {
        self.expected.validate()?;
        if self.expected.expected_approval_count != RELEASE1_APPROVAL_THRESHOLD
            || self.linked_proposal == Pubkey::default()
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        self.envelope.validate()
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Release1V3Instruction {
    InitializeController(Box<InitializeControllerV2>),
    CreateProposal(Box<CreateProposalV3>),
    ApproveProposal(ApproveProposalV3),
    FinalizeGovernance(FinalizeGovernanceV3),
    QueueProposal(QueueProposalV3),
    FreezeProposal(FreezeProposalV3),
    CancelProposal(CancelProposalV3),
    ExpireProposal(ExpireProposalV3),
    GuardianFreeze(Box<GuardianFreezeV2>),
    CreateEmergencyResolution(Box<CreateEmergencyResolutionV2>),
    ApproveEmergencyResolution(ApproveEmergencyResolutionV2),
    QueueEmergencyResolution(QueueEmergencyResolutionV2),
    ExecuteEmergencyResolution(ExecuteEmergencyResolutionV2),
    ExpireEmergencyResolution(ExpireEmergencyResolutionV2),
    CreateCheckpoint(Box<CreateCheckpointV2>),
    RecastCheckpoint(Box<RecastCheckpointV2>),
    FinalizeCheckpoint(FinalizeCheckpointV2),
    BindProgramDataVerification(Box<BindProgramDataVerificationV2>),
    FinalizeProgramDataVerification(Box<FinalizeProgramDataVerificationV2>),
    ObserveProgramDataFailure(Box<ObserveProgramDataFailureV2>),
    ApproveUnfreeze(ApproveUnfreezeV2),
    ExecuteUnfreeze(ExecuteUnfreezeV2),
}

impl Release1V3Instruction {
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() || data.len() > MAX_RELEASE1_V3_INSTRUCTION_DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }
        match data[0] {
            INITIALIZE_CONTROLLER_V2_TAG => InitializeControllerV2::unpack(data)
                .map(Box::new)
                .map(Self::InitializeController),
            CREATE_PROPOSAL_V3_TAG => CreateProposalV3::unpack(data)
                .map(Box::new)
                .map(Self::CreateProposal),
            APPROVE_PROPOSAL_V3_TAG => ApproveProposalV3::unpack(data).map(Self::ApproveProposal),
            FINALIZE_GOVERNANCE_V3_TAG => {
                FinalizeGovernanceV3::unpack(data).map(Self::FinalizeGovernance)
            }
            QUEUE_PROPOSAL_V3_TAG => QueueProposalV3::unpack(data).map(Self::QueueProposal),
            FREEZE_PROPOSAL_V3_TAG => FreezeProposalV3::unpack(data).map(Self::FreezeProposal),
            CANCEL_PROPOSAL_V3_TAG => CancelProposalV3::unpack(data).map(Self::CancelProposal),
            EXPIRE_PROPOSAL_V3_TAG => ExpireProposalV3::unpack(data).map(Self::ExpireProposal),
            GUARDIAN_FREEZE_V2_TAG => GuardianFreezeV2::unpack(data)
                .map(Box::new)
                .map(Self::GuardianFreeze),
            CREATE_EMERGENCY_RESOLUTION_V2_TAG => CreateEmergencyResolutionV2::unpack(data)
                .map(Box::new)
                .map(Self::CreateEmergencyResolution),
            APPROVE_EMERGENCY_RESOLUTION_V2_TAG => {
                ApproveEmergencyResolutionV2::unpack(data).map(Self::ApproveEmergencyResolution)
            }
            QUEUE_EMERGENCY_RESOLUTION_V2_TAG => {
                QueueEmergencyResolutionV2::unpack(data).map(Self::QueueEmergencyResolution)
            }
            EXECUTE_EMERGENCY_RESOLUTION_V2_TAG => {
                ExecuteEmergencyResolutionV2::unpack(data).map(Self::ExecuteEmergencyResolution)
            }
            EXPIRE_EMERGENCY_RESOLUTION_V2_TAG => {
                ExpireEmergencyResolutionV2::unpack(data).map(Self::ExpireEmergencyResolution)
            }
            CREATE_CHECKPOINT_V2_TAG => CreateCheckpointV2::unpack(data)
                .map(Box::new)
                .map(Self::CreateCheckpoint),
            RECAST_CHECKPOINT_V2_TAG => RecastCheckpointV2::unpack(data)
                .map(Box::new)
                .map(Self::RecastCheckpoint),
            FINALIZE_CHECKPOINT_V2_TAG => {
                FinalizeCheckpointV2::unpack(data).map(Self::FinalizeCheckpoint)
            }
            BIND_PROGRAMDATA_VERIFICATION_V2_TAG => BindProgramDataVerificationV2::unpack(data)
                .map(Box::new)
                .map(Self::BindProgramDataVerification),
            FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG => {
                FinalizeProgramDataVerificationV2::unpack(data)
                    .map(Box::new)
                    .map(Self::FinalizeProgramDataVerification)
            }
            OBSERVE_PROGRAMDATA_FAILURE_V2_TAG => ObserveProgramDataFailureV2::unpack(data)
                .map(Box::new)
                .map(Self::ObserveProgramDataFailure),
            APPROVE_UNFREEZE_V2_TAG => ApproveUnfreezeV2::unpack(data).map(Self::ApproveUnfreeze),
            EXECUTE_UNFREEZE_V2_TAG => ExecuteUnfreezeV2::unpack(data).map(Self::ExecuteUnfreeze),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }
}

macro_rules! account_meta {
    ($key:expr, readonly) => {
        AccountMeta::new_readonly($key, false)
    };
    ($key:expr, writable) => {
        AccountMeta::new($key, false)
    };
    ($key:expr, signer_readonly) => {
        AccountMeta::new_readonly($key, true)
    };
    ($key:expr, signer_writable) => {
        AccountMeta::new($key, true)
    };
}

macro_rules! closed_builder {
    (
        $accounts:ident { $($field:ident: $mode:ident),* $(,)? },
        $function:ident,
        $instruction:ty
    ) => {
        #[derive(Clone, Copy, Debug, Eq, PartialEq)]
        pub struct $accounts {
            $(pub $field: Pubkey,)*
        }

        pub fn $function(
            controller_program: Pubkey,
            accounts: $accounts,
            instruction: $instruction,
        ) -> Result<Instruction, ProgramError> {
            Ok(Instruction {
                program_id: controller_program,
                accounts: vec![
                    $(account_meta!(accounts.$field, $mode),)*
                ],
                data: instruction.pack()?,
            })
        }
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InitializeControllerV2Accounts {
    pub payer: Pubkey,
    pub initializer: Pubkey,
    pub controller_program: Pubkey,
    pub controller_programdata: Pubkey,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub upgradeable_loader: Pubkey,
    pub controller_config: Pubkey,
    pub authority_pda: Pubkey,
    pub protocol_gate: Pubkey,
    pub policy: Pubkey,
    pub council: Pubkey,
    pub capacity_policy: Pubkey,
    pub controller_release: Pubkey,
    pub canonical_spill_treasury: Pubkey,
    pub guardian: Pubkey,
    pub seat_authorities: [Pubkey; 5],
    pub system_program: Pubkey,
}

pub fn initialize_controller_v2_instruction(
    controller_program_id: Pubkey,
    accounts: InitializeControllerV2Accounts,
    instruction: InitializeControllerV2,
) -> Result<Instruction, ProgramError> {
    let mut metas = vec![
        account_meta!(accounts.payer, signer_writable),
        account_meta!(accounts.initializer, signer_readonly),
        account_meta!(accounts.controller_program, readonly),
        account_meta!(accounts.controller_programdata, readonly),
        account_meta!(accounts.target_program, readonly),
        account_meta!(accounts.target_programdata, readonly),
        account_meta!(accounts.upgradeable_loader, readonly),
        account_meta!(accounts.controller_config, writable),
        account_meta!(accounts.authority_pda, readonly),
        account_meta!(accounts.protocol_gate, writable),
        account_meta!(accounts.policy, writable),
        account_meta!(accounts.council, writable),
        account_meta!(accounts.capacity_policy, writable),
        account_meta!(accounts.controller_release, writable),
        account_meta!(accounts.canonical_spill_treasury, readonly),
        account_meta!(accounts.guardian, readonly),
    ];
    metas.extend(
        accounts
            .seat_authorities
            .into_iter()
            .map(|authority| account_meta!(authority, readonly)),
    );
    metas.push(account_meta!(accounts.system_program, readonly));
    Ok(Instruction {
        program_id: controller_program_id,
        accounts: metas,
        data: instruction.pack()?,
    })
}

closed_builder!(
    CreateProposalV3Accounts {
        payer: signer_writable,
        creator_seat_authority: signer_readonly,
        controller_config: writable,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        target_program: readonly,
        target_programdata: readonly,
        upgradeable_loader: readonly,
        authority_pda: readonly,
        canonical_spill_treasury: readonly,
        buffer: readonly,
        buffer_uploader_authority: readonly,
        proposal: writable,
        system_program: readonly,
    },
    create_proposal_v3_instruction,
    CreateProposalV3
);

closed_builder!(
    ApproveProposalV3Accounts {
        controller_config: readonly,
        policy: readonly,
        creation_council: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        proposal: writable,
        buffer_verification: readonly,
        seat_authority: signer_readonly,
    },
    approve_proposal_v3_instruction,
    ApproveProposalV3
);

closed_builder!(
    FinalizeGovernanceV3Accounts {
        controller_config: readonly,
        policy: readonly,
        creation_council: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        proposal: writable,
    },
    finalize_governance_v3_instruction,
    FinalizeGovernanceV3
);

closed_builder!(
    QueueProposalV3Accounts {
        controller_config: readonly,
        policy: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        proposal: writable,
    },
    queue_proposal_v3_instruction,
    QueueProposalV3
);

closed_builder!(
    FreezeProposalV3Accounts {
        controller_config: writable,
        policy: readonly,
        creation_council: readonly,
        protocol_gate: writable,
        capacity_policy: readonly,
        current_deployment: readonly,
        proposal: writable,
        target_program: readonly,
        target_programdata: readonly,
        upgradeable_loader: readonly,
        authority_pda: readonly,
        rollback_proposal: readonly,
        rollback_buffer_verification: readonly,
        rollback_buffer: readonly,
    },
    freeze_proposal_v3_instruction,
    FreezeProposalV3
);

closed_builder!(
    CancelProposalV3Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        proposal: writable,
        seat_authority: signer_readonly,
    },
    cancel_proposal_v3_instruction,
    CancelProposalV3
);

closed_builder!(
    ExpireProposalV3Accounts {
        controller_config: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        proposal: writable,
    },
    expire_proposal_v3_instruction,
    ExpireProposalV3
);

closed_builder!(
    GuardianFreezeV2Accounts {
        payer: signer_writable,
        controller_config: readonly,
        protocol_gate: writable,
        capacity_policy: readonly,
        current_deployment: readonly,
        target_program: readonly,
        target_programdata: readonly,
        upgradeable_loader: readonly,
        authority_pda: readonly,
        guardian: signer_readonly,
        emergency_freeze_observation: writable,
        system_program: readonly,
    },
    guardian_freeze_v2_instruction,
    GuardianFreezeV2
);

closed_builder!(
    CreateEmergencyResolutionV2Accounts {
        payer: signer_writable,
        creator_seat_authority: signer_readonly,
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        emergency_freeze_observation: readonly,
        programdata_observation: readonly,
        emergency_resolution: writable,
        system_program: readonly,
    },
    create_emergency_resolution_v2_instruction,
    CreateEmergencyResolutionV2
);

closed_builder!(
    ApproveEmergencyResolutionV2Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        emergency_freeze_observation: readonly,
        programdata_observation: readonly,
        emergency_checkpoint: readonly,
        emergency_resolution: writable,
        seat_authority: signer_readonly,
    },
    approve_emergency_resolution_v2_instruction,
    ApproveEmergencyResolutionV2
);

closed_builder!(
    QueueEmergencyResolutionV2Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        emergency_freeze_observation: readonly,
        programdata_observation: readonly,
        emergency_checkpoint: readonly,
        emergency_resolution: writable,
    },
    queue_emergency_resolution_v2_instruction,
    QueueEmergencyResolutionV2
);

closed_builder!(
    ExecuteEmergencyResolutionV2Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        protocol_gate: writable,
        capacity_policy: readonly,
        current_deployment: readonly,
        emergency_resolution: writable,
        emergency_freeze_observation: readonly,
        programdata_observation: readonly,
        emergency_checkpoint: readonly,
        target_program: readonly,
        target_programdata: readonly,
        upgradeable_loader: readonly,
        authority_pda: readonly,
        instructions_sysvar: readonly,
    },
    execute_emergency_resolution_v2_instruction,
    ExecuteEmergencyResolutionV2
);

closed_builder!(
    ExpireEmergencyResolutionV2Accounts {
        controller_config: readonly,
        protocol_gate: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        emergency_resolution: writable,
    },
    expire_emergency_resolution_v2_instruction,
    ExpireEmergencyResolutionV2
);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CheckpointMutationV2Accounts {
    pub payer: Pubkey,
    pub controller_config: Pubkey,
    pub policy: Pubkey,
    pub current_council: Pubkey,
    pub protocol_gate: Pubkey,
    pub subject: Pubkey,
    pub capacity_policy: Pubkey,
    pub current_deployment: Pubkey,
    pub programdata_observation: Pubkey,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub checkpoint: Pubkey,
    pub seat_authorities: [Pubkey; 3],
    pub system_program: Pubkey,
}

fn checkpoint_mutation_instruction(
    controller_program: Pubkey,
    accounts: CheckpointMutationV2Accounts,
    data: Vec<u8>,
) -> Instruction {
    let mut metas = vec![
        account_meta!(accounts.payer, signer_writable),
        account_meta!(accounts.controller_config, readonly),
        account_meta!(accounts.policy, readonly),
        account_meta!(accounts.current_council, readonly),
        account_meta!(accounts.protocol_gate, readonly),
        account_meta!(accounts.subject, readonly),
        account_meta!(accounts.capacity_policy, readonly),
        account_meta!(accounts.current_deployment, readonly),
        account_meta!(accounts.programdata_observation, readonly),
        account_meta!(accounts.target_program, readonly),
        account_meta!(accounts.target_programdata, readonly),
        account_meta!(accounts.checkpoint, writable),
    ];
    metas.extend(
        accounts
            .seat_authorities
            .into_iter()
            .map(|authority| account_meta!(authority, signer_readonly)),
    );
    metas.push(account_meta!(accounts.system_program, readonly));
    Instruction {
        program_id: controller_program,
        accounts: metas,
        data,
    }
}

pub fn create_checkpoint_v2_instruction(
    controller_program: Pubkey,
    accounts: CheckpointMutationV2Accounts,
    instruction: CreateCheckpointV2,
) -> Result<Instruction, ProgramError> {
    Ok(checkpoint_mutation_instruction(
        controller_program,
        accounts,
        instruction.pack()?,
    ))
}

pub fn recast_checkpoint_v2_instruction(
    controller_program: Pubkey,
    accounts: CheckpointMutationV2Accounts,
    instruction: RecastCheckpointV2,
) -> Result<Instruction, ProgramError> {
    Ok(checkpoint_mutation_instruction(
        controller_program,
        accounts,
        instruction.pack()?,
    ))
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FinalizeCheckpointV2Accounts {
    pub controller_config: Pubkey,
    pub policy: Pubkey,
    pub current_council: Pubkey,
    pub protocol_gate: Pubkey,
    pub subject: Pubkey,
    pub capacity_policy: Pubkey,
    pub current_deployment: Pubkey,
    pub programdata_observation: Pubkey,
    pub target_program: Pubkey,
    pub target_programdata: Pubkey,
    pub checkpoint: Pubkey,
}

pub fn finalize_checkpoint_v2_instruction(
    controller_program: Pubkey,
    accounts: FinalizeCheckpointV2Accounts,
    instruction: FinalizeCheckpointV2,
) -> Result<Instruction, ProgramError> {
    let subject = if instruction.expected.expected_phase == StateCheckpointPhaseV1::Poststate {
        account_meta!(accounts.subject, writable)
    } else {
        account_meta!(accounts.subject, readonly)
    };
    Ok(Instruction {
        program_id: controller_program,
        accounts: vec![
            account_meta!(accounts.controller_config, readonly),
            account_meta!(accounts.policy, readonly),
            account_meta!(accounts.current_council, readonly),
            account_meta!(accounts.protocol_gate, readonly),
            subject,
            account_meta!(accounts.capacity_policy, readonly),
            account_meta!(accounts.current_deployment, readonly),
            account_meta!(accounts.programdata_observation, readonly),
            account_meta!(accounts.target_program, readonly),
            account_meta!(accounts.target_programdata, readonly),
            account_meta!(accounts.checkpoint, writable),
        ],
        data: instruction.pack()?,
    })
}

closed_builder!(
    BindProgramDataVerificationV2Accounts {
        payer: signer_writable,
        controller_config: readonly,
        protocol_gate: readonly,
        proposal: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        programdata_observation: readonly,
        target_program: readonly,
        target_programdata: readonly,
        authority_pda: readonly,
        upgradeable_loader: readonly,
        programdata_verification: writable,
        system_program: readonly,
    },
    bind_programdata_verification_v2_instruction,
    BindProgramDataVerificationV2
);

closed_builder!(
    FinalizeProgramDataVerificationV2Accounts {
        controller_config: readonly,
        protocol_gate: readonly,
        proposal: writable,
        capacity_policy: readonly,
        current_deployment: readonly,
        programdata_observation: readonly,
        target_program: readonly,
        target_programdata: readonly,
        authority_pda: readonly,
        upgradeable_loader: readonly,
        programdata_verification: writable,
    },
    finalize_programdata_verification_v2_instruction,
    FinalizeProgramDataVerificationV2
);

closed_builder!(
    ObserveProgramDataFailureV2Accounts {
        payer: signer_writable,
        controller_config: readonly,
        protocol_gate: readonly,
        primary_proposal: readonly,
        programdata_verification: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        programdata_observation: readonly,
        target_program: readonly,
        target_programdata: readonly,
        authority_pda: readonly,
        upgradeable_loader: readonly,
        failure_observation: writable,
        system_program: readonly,
    },
    observe_programdata_failure_v2_instruction,
    ObserveProgramDataFailureV2
);

closed_builder!(
    ApproveUnfreezeV2Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        protocol_gate: readonly,
        proposal: writable,
        poststate_checkpoint: readonly,
        programdata_verification: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        target_program: readonly,
        target_programdata: readonly,
        authority_pda: readonly,
        upgradeable_loader: readonly,
        seat_authority: signer_readonly,
    },
    approve_unfreeze_v2_instruction,
    ApproveUnfreezeV2
);

closed_builder!(
    ExecuteUnfreezeV2Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        protocol_gate: writable,
        proposal: writable,
        linked_proposal: writable,
        poststate_checkpoint: readonly,
        programdata_verification: readonly,
        capacity_policy: readonly,
        current_deployment: readonly,
        target_program: readonly,
        target_programdata: readonly,
        authority_pda: readonly,
        upgradeable_loader: readonly,
        instructions_sysvar: readonly,
    },
    execute_unfreeze_v2_instruction,
    ExecuteUnfreezeV2
);

fn require_hashes(values: &[[u8; 32]]) -> Result<(), ProgramError> {
    if values.iter().any(|value| *value == [0; 32]) {
        Err(ProgramError::InvalidInstructionData)
    } else {
        Ok(())
    }
}

fn validate_approval_pair(bitset: u8, count: u8) -> Result<(), ProgramError> {
    if bitset & !VALID_APPROVAL_MASK != 0 || bitset.count_ones() as u8 != count {
        Err(ProgramError::InvalidInstructionData)
    } else {
        Ok(())
    }
}

fn require_proposal_state(
    guard: &ProposalGuardV3,
    expected: ProposalStateV2,
) -> Result<(), ProgramError> {
    if guard.expected_state == expected {
        Ok(())
    } else {
        Err(ProgramError::InvalidInstructionData)
    }
}

fn require_resolution_state(
    guard: &EmergencyResolutionGuardV2,
    expected: EmergencyFreezeResolutionStateV1,
) -> Result<(), ProgramError> {
    if guard.expected_state == expected {
        Ok(())
    } else {
        Err(ProgramError::InvalidInstructionData)
    }
}

fn is_prefreeze_proposal_state(state: ProposalStateV2) -> bool {
    matches!(
        state,
        ProposalStateV2::Draft
            | ProposalStateV2::BufferAdopted
            | ProposalStateV2::BufferVerified
            | ProposalStateV2::CouncilApproved
            | ProposalStateV2::GovernanceSatisfied
            | ProposalStateV2::Timelocked
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        release1_ceremony_state::ProgramDataObservationPurposeV1, state::OptionalPubkeyV1,
    };

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn proposal_guard(state: ProposalStateV2) -> ProposalGuardV3 {
        ProposalGuardV3 {
            expected_proposal_digest: [1; 32],
            expected_state: state,
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 2,
            expected_target_nonce: 3,
            expected_capacity_policy_digest: [4; 32],
            expected_current_deployment_digest: [5; 32],
            expected_current_deployment_generation: 1,
        }
    }

    fn resolution_guard(state: EmergencyFreezeResolutionStateV1) -> EmergencyResolutionGuardV2 {
        EmergencyResolutionGuardV2 {
            expected_resolution_digest: [1; 32],
            expected_state: state,
            expected_gate_status: GateStatusV1::EmergencyFrozen,
            expected_gate_epoch: 2,
            expected_target_nonce: 3,
            expected_capacity_policy_digest: [4; 32],
            expected_current_deployment_digest: [5; 32],
            expected_current_deployment_generation: 1,
            expected_freeze_observation_digest: [6; 32],
            expected_programdata_observation_digest: [7; 32],
            expected_observation_generation: 1,
            expected_checkpoint_digest: [8; 32],
        }
    }

    fn checkpoint_guard(phase: StateCheckpointPhaseV1) -> CheckpointGuardV2 {
        CheckpointGuardV2 {
            expected_checkpoint_digest: [1; 32],
            expected_checkpoint_generation: 1,
            expected_phase: phase,
            expected_subject_digest: [2; 32],
            expected_gate_epoch: 3,
            expected_capacity_policy_digest: [4; 32],
            expected_current_deployment_digest: [5; 32],
            expected_current_deployment_generation: 1,
            expected_observation_digest: [6; 32],
            expected_observation_generation: 1,
            expected_council_version: 1,
            expected_council_hash: [7; 32],
            expected_approval_bitset: 0b00111,
            expected_approval_count: 3,
            expected_accepted: true,
        }
    }

    fn unfreeze_guard(count: u8) -> UnfreezeGuardV2 {
        UnfreezeGuardV2 {
            expected_proposal_digest: [1; 32],
            expected_checkpoint_digest: [2; 32],
            expected_checkpoint_generation: 1,
            expected_verification_digest: [3; 32],
            expected_verification_generation: 1,
            expected_original_council_version: 1,
            expected_original_council_hash: [4; 32],
            expected_current_council_version: 2,
            expected_current_council_hash: [5; 32],
            expected_gate_epoch: 3,
            expected_target_nonce: 4,
            expected_current_deployment_digest: [6; 32],
            expected_current_deployment_generation: 1,
            expected_artifact_sha256: [7; 32],
            expected_artifact_merkle_root: [8; 32],
            expected_actual_capacity: 1_048_576,
            expected_approval_bitset: if count == 3 { 0b00111 } else { 0b00011 },
            expected_approval_count: count,
        }
    }

    fn envelope() -> CeremonyEnvelopeV1 {
        CeremonyEnvelopeV1 {
            compute_unit_limit: 1_000_000,
            compute_unit_price_micro_lamports: 1,
            durable_nonce_account: OptionalPubkeyV1::none(),
            durable_nonce_authority: OptionalPubkeyV1::none(),
        }
    }

    macro_rules! assert_codec {
        ($value:expr, $type:ty) => {{
            let value = $value;
            let encoded = value.pack().unwrap();
            assert_eq!(encoded.len(), <$type>::LEN);
            assert_eq!(<$type>::unpack(&encoded).unwrap(), value);
            for length in 0..encoded.len() {
                assert!(<$type>::unpack(&encoded[..length]).is_err());
            }
            let mut trailing = encoded.clone();
            trailing.push(0);
            assert!(<$type>::unpack(&trailing).is_err());
            let mut wrong_tag = encoded;
            wrong_tag[0] = 0;
            assert!(<$type>::unpack(&wrong_tag).is_err());
        }};
    }

    #[test]
    fn tags_are_contiguous_after_ceremony_and_never_overlap_39_through_52() {
        let tags = [
            INITIALIZE_CONTROLLER_V2_TAG,
            CREATE_PROPOSAL_V3_TAG,
            APPROVE_PROPOSAL_V3_TAG,
            FINALIZE_GOVERNANCE_V3_TAG,
            QUEUE_PROPOSAL_V3_TAG,
            FREEZE_PROPOSAL_V3_TAG,
            CANCEL_PROPOSAL_V3_TAG,
            EXPIRE_PROPOSAL_V3_TAG,
            GUARDIAN_FREEZE_V2_TAG,
            CREATE_EMERGENCY_RESOLUTION_V2_TAG,
            APPROVE_EMERGENCY_RESOLUTION_V2_TAG,
            QUEUE_EMERGENCY_RESOLUTION_V2_TAG,
            EXECUTE_EMERGENCY_RESOLUTION_V2_TAG,
            EXPIRE_EMERGENCY_RESOLUTION_V2_TAG,
            CREATE_CHECKPOINT_V2_TAG,
            RECAST_CHECKPOINT_V2_TAG,
            FINALIZE_CHECKPOINT_V2_TAG,
            BIND_PROGRAMDATA_VERIFICATION_V2_TAG,
            FINALIZE_PROGRAMDATA_VERIFICATION_V2_TAG,
            OBSERVE_PROGRAMDATA_FAILURE_V2_TAG,
            APPROVE_UNFREEZE_V2_TAG,
            EXECUTE_UNFREEZE_V2_TAG,
        ];
        assert_eq!(
            tags,
            core::array::from_fn::<_, 22, _>(|index| 53 + index as u8)
        );
        assert!(tags.iter().all(|tag| !(39..=52).contains(tag)));
    }

    #[test]
    fn representative_codecs_are_exact_and_semantically_strict() {
        assert_codec!(
            QueueProposalV3 {
                expected: proposal_guard(ProposalStateV2::GovernanceSatisfied)
            },
            QueueProposalV3
        );
        assert_codec!(
            FreezeProposalV3 {
                expected: proposal_guard(ProposalStateV2::Timelocked),
                expected_next_gate_epoch: 3,
            },
            FreezeProposalV3
        );
        assert_codec!(
            QueueEmergencyResolutionV2 {
                expected: resolution_guard(EmergencyFreezeResolutionStateV1::CouncilApproved)
            },
            QueueEmergencyResolutionV2
        );
        assert_codec!(
            FinalizeCheckpointV2 {
                expected: checkpoint_guard(StateCheckpointPhaseV1::Poststate)
            },
            FinalizeCheckpointV2
        );
        assert_codec!(
            ApproveUnfreezeV2 {
                expected: unfreeze_guard(2)
            },
            ApproveUnfreezeV2
        );
        assert_codec!(
            ExecuteUnfreezeV2 {
                expected: unfreeze_guard(3),
                linked_proposal: key(9),
                envelope: envelope(),
            },
            ExecuteUnfreezeV2
        );

        let mut bad = QueueProposalV3 {
            expected: proposal_guard(ProposalStateV2::GovernanceSatisfied),
        }
        .pack()
        .unwrap();
        bad[1 + 32] = 0xff;
        assert_eq!(
            QueueProposalV3::unpack(&bad),
            Err(ProgramError::InvalidInstructionData)
        );
    }

    #[test]
    fn every_instruction_length_is_fixed_and_under_the_global_cap() {
        let lengths = [
            InitializeControllerV2::LEN,
            CreateProposalV3::LEN,
            ApproveProposalV3::LEN,
            FinalizeGovernanceV3::LEN,
            QueueProposalV3::LEN,
            FreezeProposalV3::LEN,
            CancelProposalV3::LEN,
            ExpireProposalV3::LEN,
            GuardianFreezeV2::LEN,
            CreateEmergencyResolutionV2::LEN,
            ApproveEmergencyResolutionV2::LEN,
            QueueEmergencyResolutionV2::LEN,
            ExecuteEmergencyResolutionV2::LEN,
            ExpireEmergencyResolutionV2::LEN,
            CreateCheckpointV2::LEN,
            RecastCheckpointV2::LEN,
            FinalizeCheckpointV2::LEN,
            BindProgramDataVerificationV2::LEN,
            FinalizeProgramDataVerificationV2::LEN,
            ObserveProgramDataFailureV2::LEN,
            ApproveUnfreezeV2::LEN,
            ExecuteUnfreezeV2::LEN,
        ];
        assert!(lengths
            .iter()
            .all(|length| *length > 1 && *length <= MAX_RELEASE1_V3_INSTRUCTION_DATA_LEN));
        assert_eq!(CreateProposalV3::PAYLOAD_LEN, UpgradeProposalV3::LEN);
        assert_eq!(InitializeControllerV2::PAYLOAD_LEN, 1_424);
        assert_eq!(INITIALIZE_CONTROLLER_V2_ACCOUNT_COUNT, 22);
        assert_eq!(CreateCheckpointV2::PAYLOAD_LEN, StateCheckpointV2::LEN);
        assert_eq!(
            BindProgramDataVerificationV2::PAYLOAD_LEN,
            ProgramDataVerificationV2::LEN
        );
        assert_eq!(UnfreezeGuardV2::LEN, 322);
    }

    #[test]
    fn closed_builders_freeze_order_and_privileges() {
        let queue = queue_proposal_v3_instruction(
            key(1),
            QueueProposalV3Accounts {
                controller_config: key(2),
                policy: key(3),
                protocol_gate: key(4),
                capacity_policy: key(5),
                current_deployment: key(6),
                proposal: key(7),
            },
            QueueProposalV3 {
                expected: proposal_guard(ProposalStateV2::GovernanceSatisfied),
            },
        )
        .unwrap();
        assert_eq!(queue.accounts.len(), 6);
        assert!(queue.accounts[..5]
            .iter()
            .all(|meta| !meta.is_signer && !meta.is_writable));
        assert!(queue.accounts[5].is_writable && !queue.accounts[5].is_signer);

        let finalize = finalize_checkpoint_v2_instruction(
            key(1),
            FinalizeCheckpointV2Accounts {
                controller_config: key(2),
                policy: key(3),
                current_council: key(4),
                protocol_gate: key(5),
                subject: key(6),
                capacity_policy: key(7),
                current_deployment: key(8),
                programdata_observation: key(9),
                target_program: key(10),
                target_programdata: key(11),
                checkpoint: key(12),
            },
            FinalizeCheckpointV2 {
                expected: checkpoint_guard(StateCheckpointPhaseV1::Poststate),
            },
        )
        .unwrap();
        assert_eq!(finalize.accounts.len(), 11);
        assert!(finalize.accounts[4].is_writable);
        assert!(finalize.accounts[10].is_writable);
        assert!(finalize.accounts.iter().all(|meta| !meta.is_signer));
    }

    #[test]
    fn purpose_enum_remains_strict_in_the_underlying_observation_contract() {
        assert_eq!(ProgramDataObservationPurposeV1::ProposalPrestate as u8, 2);
    }
}
