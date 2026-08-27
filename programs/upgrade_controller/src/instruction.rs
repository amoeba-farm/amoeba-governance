use solana_program::{
    instruction::{AccountMeta, Instruction},
    program_error::ProgramError,
    pubkey::Pubkey,
};

use crate::{
    release1_state::{
        CouncilRotationStateV1, EmergencyFreezeResolutionKindV1, EmergencyFreezeResolutionStateV1,
        ProposalStateV2, StateCheckpointPhaseV1,
    },
    state::{GateStatusV1, ProposalClassV1},
};

pub const MAX_CONTROLLER_INSTRUCTION_DATA_LEN: usize = 16_384;

pub const RECORD_PROPOSAL_APPROVAL_V1_TAG: u8 = 0;
pub const RECORD_PROPOSAL_APPROVAL_V1_LEN: usize = 1 + 32 + 8;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecordProposalApprovalV1 {
    pub expected_proposal_digest: [u8; 32],
    pub expected_council_version: u64,
}

impl RecordProposalApprovalV1 {
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.len() != RECORD_PROPOSAL_APPROVAL_V1_LEN
            || data[0] != RECORD_PROPOSAL_APPROVAL_V1_TAG
        {
            return Err(ProgramError::InvalidInstructionData);
        }
        let mut expected_proposal_digest = [0u8; 32];
        expected_proposal_digest.copy_from_slice(&data[1..33]);
        let mut version = [0u8; 8];
        version.copy_from_slice(&data[33..41]);
        Ok(Self {
            expected_proposal_digest,
            expected_council_version: u64::from_le_bytes(version),
        })
    }

    pub fn pack(self) -> [u8; RECORD_PROPOSAL_APPROVAL_V1_LEN] {
        let mut data = [0u8; RECORD_PROPOSAL_APPROVAL_V1_LEN];
        data[0] = RECORD_PROPOSAL_APPROVAL_V1_TAG;
        data[1..33].copy_from_slice(&self.expected_proposal_digest);
        data[33..41].copy_from_slice(&self.expected_council_version.to_le_bytes());
        data
    }
}

#[allow(clippy::too_many_arguments)]
pub fn record_proposal_approval_instruction(
    controller_program: Pubkey,
    controller_config: Pubkey,
    policy: Pubkey,
    council: Pubkey,
    proposal: Pubkey,
    seat_authority: Pubkey,
    expected_proposal_digest: [u8; 32],
    expected_council_version: u64,
) -> Instruction {
    Instruction {
        program_id: controller_program,
        accounts: vec![
            AccountMeta::new_readonly(controller_config, false),
            AccountMeta::new_readonly(policy, false),
            AccountMeta::new_readonly(council, false),
            AccountMeta::new(proposal, false),
            AccountMeta::new_readonly(seat_authority, true),
        ],
        data: RecordProposalApprovalV1 {
            expected_proposal_digest,
            expected_council_version,
        }
        .pack()
        .to_vec(),
    }
}

struct FixedReader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> FixedReader<'a> {
    const fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take<const N: usize>(&mut self) -> Result<[u8; N], ProgramError> {
        let end = self
            .offset
            .checked_add(N)
            .ok_or(ProgramError::InvalidInstructionData)?;
        let source = self
            .bytes
            .get(self.offset..end)
            .ok_or(ProgramError::InvalidInstructionData)?;
        let mut out = [0u8; N];
        out.copy_from_slice(source);
        self.offset = end;
        Ok(out)
    }

    fn finish(self) -> Result<(), ProgramError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(ProgramError::InvalidInstructionData)
        }
    }
}

struct FixedWriter<'a> {
    bytes: &'a mut [u8],
    offset: usize,
}

impl<'a> FixedWriter<'a> {
    fn new(bytes: &'a mut [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn put(&mut self, value: &[u8]) {
        let end = self
            .offset
            .checked_add(value.len())
            .expect("fixed instruction length overflow");
        self.bytes[self.offset..end].copy_from_slice(value);
        self.offset = end;
    }

    fn finish(self) {
        assert_eq!(self.offset, self.bytes.len());
    }
}

trait FixedWire: Sized {
    const LEN: usize;

    fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError>;
    fn encode(&self, writer: &mut FixedWriter<'_>);
}

impl FixedWire for u8 {
    const LEN: usize = 1;

    fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError> {
        Ok(reader.take::<1>()?[0])
    }

    fn encode(&self, writer: &mut FixedWriter<'_>) {
        writer.put(&[*self]);
    }
}

macro_rules! fixed_wire_integer {
    ($type:ty, $len:expr) => {
        impl FixedWire for $type {
            const LEN: usize = $len;

            fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError> {
                Ok(<$type>::from_le_bytes(reader.take::<$len>()?))
            }

            fn encode(&self, writer: &mut FixedWriter<'_>) {
                writer.put(&self.to_le_bytes());
            }
        }
    };
}

fixed_wire_integer!(u16, 2);
fixed_wire_integer!(u32, 4);
fixed_wire_integer!(u64, 8);

impl FixedWire for Pubkey {
    const LEN: usize = 32;

    fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError> {
        Ok(Self::new_from_array(reader.take::<32>()?))
    }

    fn encode(&self, writer: &mut FixedWriter<'_>) {
        writer.put(self.as_ref());
    }
}

impl<T: Copy + Default + FixedWire, const N: usize> FixedWire for [T; N] {
    const LEN: usize = T::LEN * N;

    fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError> {
        let mut values = [T::default(); N];
        for value in &mut values {
            *value = T::decode(reader)?;
        }
        Ok(values)
    }

    fn encode(&self, writer: &mut FixedWriter<'_>) {
        for value in self {
            value.encode(writer);
        }
    }
}

macro_rules! fixed_wire_enum {
    ($type:ty { $($value:expr => $variant:path),+ $(,)? }) => {
        impl FixedWire for $type {
            const LEN: usize = 1;

            fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError> {
                match u8::decode(reader)? {
                    $($value => Ok($variant),)+
                    _ => Err(ProgramError::InvalidInstructionData),
                }
            }

            fn encode(&self, writer: &mut FixedWriter<'_>) {
                (*self as u8).encode(writer);
            }
        }
    };
}

fixed_wire_enum!(ProposalClassV1 {
    0 => ProposalClassV1::RoutineUpgrade,
    1 => ProposalClassV1::EmergencyRollback,
    2 => ProposalClassV1::EconomicChange,
    3 => ProposalClassV1::ConstitutionalChange,
});
fixed_wire_enum!(GateStatusV1 {
    0 => GateStatusV1::Active,
    1 => GateStatusV1::FrozenForUpgrade,
    2 => GateStatusV1::EmergencyFrozen,
});
fixed_wire_enum!(ProposalStateV2 {
    0 => ProposalStateV2::Draft,
    1 => ProposalStateV2::BufferAdopted,
    2 => ProposalStateV2::BufferVerified,
    3 => ProposalStateV2::CouncilApproved,
    5 => ProposalStateV2::GovernanceSatisfied,
    6 => ProposalStateV2::Timelocked,
    7 => ProposalStateV2::Frozen,
    8 => ProposalStateV2::Extended,
    9 => ProposalStateV2::UpgradeExecuted,
    10 => ProposalStateV2::ProgramDataVerified,
    11 => ProposalStateV2::PoststateAccepted,
    12 => ProposalStateV2::UnfreezeApproved,
    13 => ProposalStateV2::Completed,
    14 => ProposalStateV2::Cancelled,
    15 => ProposalStateV2::Expired,
    16 => ProposalStateV2::SupersededByRollback,
    17 => ProposalStateV2::Retired,
});
fixed_wire_enum!(StateCheckpointPhaseV1 {
    0 => StateCheckpointPhaseV1::Prestate,
    1 => StateCheckpointPhaseV1::Poststate,
    2 => StateCheckpointPhaseV1::Emergency,
});
fixed_wire_enum!(CouncilRotationStateV1 {
    0 => CouncilRotationStateV1::Draft,
    1 => CouncilRotationStateV1::CouncilApproved,
    2 => CouncilRotationStateV1::Timelocked,
    3 => CouncilRotationStateV1::Activated,
    4 => CouncilRotationStateV1::Cancelled,
    5 => CouncilRotationStateV1::Expired,
});
fixed_wire_enum!(EmergencyFreezeResolutionStateV1 {
    0 => EmergencyFreezeResolutionStateV1::Draft,
    1 => EmergencyFreezeResolutionStateV1::CouncilApproved,
    2 => EmergencyFreezeResolutionStateV1::Timelocked,
    3 => EmergencyFreezeResolutionStateV1::Executed,
    4 => EmergencyFreezeResolutionStateV1::Cancelled,
    5 => EmergencyFreezeResolutionStateV1::Expired,
});
fixed_wire_enum!(EmergencyFreezeResolutionKindV1 {
    0 => EmergencyFreezeResolutionKindV1::ResumeWithoutUpgrade,
});

#[derive(Clone, Copy, Debug, Default, Eq, PartialEq)]
pub struct OptionalInstructionPubkeyV1(Option<Pubkey>);

impl OptionalInstructionPubkeyV1 {
    pub const fn none() -> Self {
        Self(None)
    }

    pub fn some(value: Pubkey) -> Result<Self, ProgramError> {
        if value == Pubkey::default() {
            Err(ProgramError::InvalidInstructionData)
        } else {
            Ok(Self(Some(value)))
        }
    }

    pub const fn value(self) -> Option<Pubkey> {
        self.0
    }
}

impl FixedWire for OptionalInstructionPubkeyV1 {
    const LEN: usize = 33;

    fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError> {
        let present = u8::decode(reader)?;
        let value = Pubkey::decode(reader)?;
        match (present, value == Pubkey::default()) {
            (0, true) => Ok(Self::none()),
            (1, false) => Ok(Self(Some(value))),
            _ => Err(ProgramError::InvalidInstructionData),
        }
    }

    fn encode(&self, writer: &mut FixedWriter<'_>) {
        match self.0 {
            None => {
                0u8.encode(writer);
                Pubkey::default().encode(writer);
            }
            Some(value) => {
                1u8.encode(writer);
                value.encode(writer);
            }
        }
    }
}

macro_rules! fixed_wire_struct {
    ($(#[$meta:meta])* pub struct $name:ident { $($field:ident: $type:ty),* $(,)? }) => {
        $(#[$meta])*
        #[derive(Clone, Copy, Debug, Eq, PartialEq)]
        pub struct $name {
            $(pub $field: $type,)*
        }

        impl FixedWire for $name {
            const LEN: usize = 0 $(+ <$type as FixedWire>::LEN)*;

            fn decode(reader: &mut FixedReader<'_>) -> Result<Self, ProgramError> {
                Ok(Self {
                    $($field: <$type as FixedWire>::decode(reader)?,)*
                })
            }

            fn encode(&self, writer: &mut FixedWriter<'_>) {
                $(self.$field.encode(writer);)*
            }
        }
    };
}

fixed_wire_struct! {
    /// Immutable term commitments for one seat authority supplied as a read-only account.
    #[derive(Default)]
    pub struct CouncilSeatTermV1 {
        term_start_slot: u64,
        term_end_slot: u64,
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum CheckpointSubjectStateV1 {
    ProposalFrozen = 0,
    ProposalProgramDataVerified = 1,
    EmergencyResolutionTimelocked = 2,
}

fixed_wire_enum!(CheckpointSubjectStateV1 {
    0 => CheckpointSubjectStateV1::ProposalFrozen,
    1 => CheckpointSubjectStateV1::ProposalProgramDataVerified,
    2 => CheckpointSubjectStateV1::EmergencyResolutionTimelocked,
});

impl Default for CheckpointSubjectStateV1 {
    fn default() -> Self {
        Self::ProposalFrozen
    }
}

fixed_wire_struct! {
    /// Signed observation guard shared by proposal lifecycle transitions.
    pub struct ProposalExpectationV2 {
        expected_proposal_digest: [u8; 32],
        expected_policy_version: u64,
        expected_policy_hash: [u8; 32],
        expected_council_version: u64,
        expected_council_hash: [u8; 32],
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        expected_target_nonce: u64,
        expected_state: ProposalStateV2,
        expected_review_start_slot: u64,
        expected_review_end_slot: u64,
        expected_not_before_slot: u64,
        expected_expiry_slot: u64,
    }
}

fixed_wire_struct! {
    /// Signed observation guard shared by emergency-resolution transitions.
    pub struct EmergencyResolutionExpectationV1 {
        expected_resolution_digest: [u8; 32],
        expected_policy_version: u64,
        expected_policy_hash: [u8; 32],
        expected_council_version: u64,
        expected_council_hash: [u8; 32],
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        expected_freeze_slot: u64,
        expected_freeze_reason_code: u16,
        expected_target_nonce: u64,
        expected_state: EmergencyFreezeResolutionStateV1,
        expected_not_before_slot: u64,
        expected_expiry_slot: u64,
    }
}

fixed_wire_struct! {
    /// Signed observation guard shared by checkpoint approvals and finalization.
    pub struct CheckpointExpectationV1 {
        phase: StateCheckpointPhaseV1,
        expected_subject_state: CheckpointSubjectStateV1,
        expected_subject_digest: [u8; 32],
        expected_checkpoint_digest: [u8; 32],
        expected_council_version: u64,
        expected_council_hash: [u8; 32],
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
}

fixed_wire_struct! {
    /// Signed observation guard shared by council-rotation transitions.
    pub struct CouncilRotationExpectationV1 {
        expected_rotation_digest: [u8; 32],
        expected_current_council_version: u64,
        expected_current_council_hash: [u8; 32],
        expected_candidate_council_version: u64,
        expected_candidate_council_hash: [u8; 32],
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        expected_target_nonce: u64,
        expected_state: CouncilRotationStateV1,
        expected_not_before_slot: u64,
        expected_expiry_slot: u64,
    }
}

macro_rules! fixed_instruction {
    (
        $name:ident,
        tag $tag_const:ident = $tag:expr,
        len $len_const:ident,
        { $($field:ident: $type:ty),* $(,)? }
    ) => {
        pub const $tag_const: u8 = $tag;
        pub const $len_const: usize = 1 $(+ <$type as FixedWire>::LEN)*;

        #[derive(Clone, Debug, Eq, PartialEq)]
        pub struct $name {
            $(pub $field: $type,)*
        }

        impl $name {
            pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
                if data.len() != $len_const || data.first().copied() != Some($tag_const) {
                    return Err(ProgramError::InvalidInstructionData);
                }
                let mut reader = FixedReader::new(&data[1..]);
                let value = Self {
                    $($field: <$type as FixedWire>::decode(&mut reader)?,)*
                };
                reader.finish()?;
                Ok(value)
            }

            pub fn pack(&self) -> [u8; $len_const] {
                let mut data = [0u8; $len_const];
                data[0] = $tag_const;
                let mut writer = FixedWriter::new(&mut data[1..]);
                $(self.$field.encode(&mut writer);)*
                writer.finish();
                data
            }
        }
    };
}

fixed_instruction!(
    InitializeControllerV1,
    tag INITIALIZE_CONTROLLER_V1_TAG = 1,
    len INITIALIZE_CONTROLLER_V1_LEN,
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
        seat_terms: [CouncilSeatTermV1; 5],
    }
);

fixed_instruction!(
    CreateProposalV2,
    tag CREATE_PROPOSAL_V2_TAG = 2,
    len CREATE_PROPOSAL_V2_LEN,
    {
        proposal_class: ProposalClassV1,
        creation_gate_status: GateStatusV1,
        expected_proposal_id: u64,
        expected_target_nonce: u64,
        creation_slot: u64,
        expected_policy_version: u64,
        expected_policy_hash: [u8; 32],
        expected_creation_council_version: u64,
        expected_creation_council_hash: [u8; 32],
        expected_creation_gate_epoch: u64,
        expected_freeze_gate_epoch: u64,
        artifact_length: u64,
        artifact_sha256: [u8; 32],
        artifact_chunk_merkle_root: [u8; 32],
        source_commit_hash: [u8; 32],
        source_tree_hash: [u8; 32],
        build_input_inventory_hash: [u8; 32],
        reproducible_build_receipt_hash: [u8; 32],
        package_receipt_hash: [u8; 32],
        release_intent_hash: [u8; 32],
        expected_execution_pre_payload_hash: [u8; 32],
        expected_execution_pre_chunk_root: [u8; 32],
        current_raw_programdata_hash: [u8; 32],
        deployed_slot: u64,
        current_capacity: u64,
        extension_delta: u64,
        expected_post_capacity: u64,
        checkpoint_schema_id: [u8; 32],
        checkpoint_policy_hash: [u8; 32],
        primary_proposal: OptionalInstructionPubkeyV1,
        rollback_proposal: OptionalInstructionPubkeyV1,
        rollback_buffer: OptionalInstructionPubkeyV1,
        rollback_artifact_sha256: [u8; 32],
        rollback_artifact_chunk_root: [u8; 32],
        review_start_slot: u64,
        review_end_slot: u64,
        not_before_slot: u64,
        expiry_slot: u64,
        expected_proposal_digest: [u8; 32],
    }
);

fixed_instruction!(
    ApproveProposalV2,
    tag APPROVE_PROPOSAL_V2_TAG = 3,
    len APPROVE_PROPOSAL_V2_LEN,
    {
        expected: ProposalExpectationV2,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
);

fixed_instruction!(
    FinalizeGovernanceV2,
    tag FINALIZE_GOVERNANCE_V2_TAG = 4,
    len FINALIZE_GOVERNANCE_V2_LEN,
    {
        expected: ProposalExpectationV2,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
);

fixed_instruction!(
    QueueProposalV2,
    tag QUEUE_PROPOSAL_V2_TAG = 5,
    len QUEUE_PROPOSAL_V2_LEN,
    {
        expected: ProposalExpectationV2,
    }
);

fixed_instruction!(
    FreezeProposalV2,
    tag FREEZE_PROPOSAL_V2_TAG = 6,
    len FREEZE_PROPOSAL_V2_LEN,
    {
        expected: ProposalExpectationV2,
        expected_next_gate_epoch: u64,
    }
);

fixed_instruction!(
    CancelProposalV2,
    tag CANCEL_PROPOSAL_V2_TAG = 7,
    len CANCEL_PROPOSAL_V2_LEN,
    {
        expected: ProposalExpectationV2,
        expected_cancellation_approval_bitset: u8,
        expected_cancellation_approval_count: u8,
        cancellation_reason_code: u16,
    }
);

fixed_instruction!(
    ExpireProposalV2,
    tag EXPIRE_PROPOSAL_V2_TAG = 8,
    len EXPIRE_PROPOSAL_V2_LEN,
    {
        expected: ProposalExpectationV2,
    }
);

fixed_instruction!(
    GuardianFreezeV1,
    tag GUARDIAN_FREEZE_V1_TAG = 9,
    len GUARDIAN_FREEZE_V1_LEN,
    {
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        expected_target_nonce: u64,
        expected_programdata_slot: u64,
        expected_payload_hash: [u8; 32],
        expected_raw_programdata_hash: [u8; 32],
        expected_capacity: u64,
        freeze_reason_code: u16,
    }
);

fixed_instruction!(
    CreateEmergencyResolutionV1,
    tag CREATE_EMERGENCY_RESOLUTION_V1_TAG = 10,
    len CREATE_EMERGENCY_RESOLUTION_V1_LEN,
    {
        resolution_kind: EmergencyFreezeResolutionKindV1,
        creation_slot: u64,
        not_before_slot: u64,
        expiry_slot: u64,
        expected_policy_version: u64,
        expected_policy_hash: [u8; 32],
        expected_council_version: u64,
        expected_council_hash: [u8; 32],
        expected_gate_epoch: u64,
        expected_freeze_slot: u64,
        expected_freeze_reason_code: u16,
        expected_target_nonce: u64,
        observed_programdata_slot: u64,
        observed_payload_hash: [u8; 32],
        observed_raw_programdata_hash: [u8; 32],
        observed_capacity: u64,
        expected_resolution_digest: [u8; 32],
    }
);

fixed_instruction!(
    ApproveEmergencyResolutionV1,
    tag APPROVE_EMERGENCY_RESOLUTION_V1_TAG = 11,
    len APPROVE_EMERGENCY_RESOLUTION_V1_LEN,
    {
        expected: EmergencyResolutionExpectationV1,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
);

fixed_instruction!(
    QueueEmergencyResolutionV1,
    tag QUEUE_EMERGENCY_RESOLUTION_V1_TAG = 12,
    len QUEUE_EMERGENCY_RESOLUTION_V1_LEN,
    {
        expected: EmergencyResolutionExpectationV1,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
);

fixed_instruction!(
    ExecuteEmergencyResolutionV1,
    tag EXECUTE_EMERGENCY_RESOLUTION_V1_TAG = 13,
    len EXECUTE_EMERGENCY_RESOLUTION_V1_LEN,
    {
        expected: EmergencyResolutionExpectationV1,
        expected_checkpoint_digest: [u8; 32],
        expected_programdata_slot: u64,
        expected_payload_hash: [u8; 32],
        expected_raw_programdata_hash: [u8; 32],
        expected_capacity: u64,
    }
);

fixed_instruction!(
    ConvertEmergencyFreezeV2,
    tag CONVERT_EMERGENCY_FREEZE_V2_TAG = 14,
    len CONVERT_EMERGENCY_FREEZE_V2_LEN,
    {
        expected: ProposalExpectationV2,
        expected_next_gate_epoch: u64,
    }
);

fixed_instruction!(
    BindCheckpointV1,
    tag BIND_CHECKPOINT_V1_TAG = 15,
    len BIND_CHECKPOINT_V1_LEN,
    {
        phase: StateCheckpointPhaseV1,
        expected_subject_state: CheckpointSubjectStateV1,
        expected_subject_digest: [u8; 32],
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        finalized_observation_slot: u64,
        target_programdata_slot: u64,
        target_payload_commitment: [u8; 32],
        target_raw_programdata_commitment: [u8; 32],
        target_capacity: u64,
        program_owned_state_root: [u8; 32],
        program_owned_state_count: u64,
        logical_compressed_state_root: [u8; 32],
        logical_compressed_state_count: u64,
        semantic_custody_accounting_root: [u8; 32],
        hard_combined_root: [u8; 32],
        external_metadata_observation_root: [u8; 32],
        external_raw_balance_observation_root: [u8; 32],
        schema_identifier: [u8; 32],
        admitted_positive_donation_root: [u8; 32],
        admitted_positive_donation_count: u64,
        forbidden_drift_count: u32,
        expected_checkpoint_digest: [u8; 32],
    }
);

fixed_instruction!(
    ApproveCheckpointV1,
    tag APPROVE_CHECKPOINT_V1_TAG = 16,
    len APPROVE_CHECKPOINT_V1_LEN,
    {
        expected: CheckpointExpectationV1,
    }
);

fixed_instruction!(
    FinalizeCheckpointV1,
    tag FINALIZE_CHECKPOINT_V1_TAG = 17,
    len FINALIZE_CHECKPOINT_V1_LEN,
    {
        expected: CheckpointExpectationV1,
    }
);

fixed_instruction!(
    CreateCandidateCouncilSetV1,
    tag CREATE_CANDIDATE_COUNCIL_SET_V1_TAG = 18,
    len CREATE_CANDIDATE_COUNCIL_SET_V1_LEN,
    {
        expected_current_council_version: u64,
        expected_current_council_hash: [u8; 32],
        candidate_council_version: u64,
        activation_slot: u64,
        expected_target_nonce: u64,
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        expected_candidate_council_hash: [u8; 32],
        seat_terms: [CouncilSeatTermV1; 5],
    }
);

fixed_instruction!(
    CreateCouncilRotationV1,
    tag CREATE_COUNCIL_ROTATION_V1_TAG = 19,
    len CREATE_COUNCIL_ROTATION_V1_LEN,
    {
        creation_slot: u64,
        not_before_slot: u64,
        expiry_slot: u64,
        expected_current_council_version: u64,
        expected_current_council_hash: [u8; 32],
        expected_candidate_council_version: u64,
        expected_candidate_council_hash: [u8; 32],
        expected_gate_status: GateStatusV1,
        expected_gate_epoch: u64,
        expected_target_nonce: u64,
        expected_rotation_digest: [u8; 32],
    }
);

fixed_instruction!(
    ApproveCouncilRotationV1,
    tag APPROVE_COUNCIL_ROTATION_V1_TAG = 20,
    len APPROVE_COUNCIL_ROTATION_V1_LEN,
    {
        expected: CouncilRotationExpectationV1,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
);

fixed_instruction!(
    ActivateCouncilRotationV1,
    tag ACTIVATE_COUNCIL_ROTATION_V1_TAG = 21,
    len ACTIVATE_COUNCIL_ROTATION_V1_LEN,
    {
        expected: CouncilRotationExpectationV1,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
);

fixed_instruction!(
    QueueCouncilRotationV1,
    tag QUEUE_COUNCIL_ROTATION_V1_TAG = 22,
    len QUEUE_COUNCIL_ROTATION_V1_LEN,
    {
        expected: CouncilRotationExpectationV1,
        expected_approval_bitset: u8,
        expected_approval_count: u8,
    }
);

fixed_instruction!(
    ExpireEmergencyResolutionV1,
    tag EXPIRE_EMERGENCY_RESOLUTION_V1_TAG = 23,
    len EXPIRE_EMERGENCY_RESOLUTION_V1_LEN,
    {
        expected: EmergencyResolutionExpectationV1,
    }
);

fixed_instruction!(
    CancelCouncilRotationV1,
    tag CANCEL_COUNCIL_ROTATION_V1_TAG = 24,
    len CANCEL_COUNCIL_ROTATION_V1_LEN,
    {
        expected: CouncilRotationExpectationV1,
        expected_cancellation_approval_bitset: u8,
        expected_cancellation_approval_count: u8,
        cancellation_reason_code: u16,
    }
);

fixed_instruction!(
    ExpireCouncilRotationV1,
    tag EXPIRE_COUNCIL_ROTATION_V1_TAG = 25,
    len EXPIRE_COUNCIL_ROTATION_V1_LEN,
    {
        expected: CouncilRotationExpectationV1,
    }
);

// Reserved closed-surface tags.  These constants intentionally have no codecs
// until their typed Loader-v3 and unfreeze processors are implemented.
// Tag 26 is intentionally closed: EmergencyFreezeResolutionV1 has no separate
// cancellation accumulator, so a safe council-cancellation codec requires V2.
pub const CANCEL_EMERGENCY_RESOLUTION_V2_RESERVED_TAG: u8 = 26;
pub const ADOPT_BUFFER_V1_TAG: u8 = 27;
pub const VERIFY_BUFFER_CHUNK_V1_TAG: u8 = 28;
pub const FINALIZE_BUFFER_VERIFICATION_V1_TAG: u8 = 29;
pub const EXTEND_TARGET_V1_TAG: u8 = 30;
pub const EXECUTE_UPGRADE_V1_TAG: u8 = 31;
pub const VERIFY_PROGRAMDATA_CHUNK_V1_TAG: u8 = 32;
pub const FINALIZE_PROGRAMDATA_VERIFICATION_V1_TAG: u8 = 33;
pub const APPROVE_UNFREEZE_V1_TAG: u8 = 34;
pub const EXECUTE_UNFREEZE_V1_TAG: u8 = 35;
pub const CLOSE_ABANDONED_BUFFER_V1_TAG: u8 = 36;
pub const EXECUTE_ROLLBACK_V1_TAG: u8 = 37;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum UpgradeControllerInstruction {
    RecordProposalApprovalV1(RecordProposalApprovalV1),
    InitializeControllerV1(InitializeControllerV1),
    CreateProposalV2(Box<CreateProposalV2>),
    ApproveProposalV2(ApproveProposalV2),
    FinalizeGovernanceV2(FinalizeGovernanceV2),
    QueueProposalV2(QueueProposalV2),
    FreezeProposalV2(FreezeProposalV2),
    CancelProposalV2(CancelProposalV2),
    ExpireProposalV2(ExpireProposalV2),
    GuardianFreezeV1(GuardianFreezeV1),
    CreateEmergencyResolutionV1(CreateEmergencyResolutionV1),
    ApproveEmergencyResolutionV1(ApproveEmergencyResolutionV1),
    QueueEmergencyResolutionV1(QueueEmergencyResolutionV1),
    ExecuteEmergencyResolutionV1(ExecuteEmergencyResolutionV1),
    ConvertEmergencyFreezeV2(ConvertEmergencyFreezeV2),
    BindCheckpointV1(BindCheckpointV1),
    ApproveCheckpointV1(ApproveCheckpointV1),
    FinalizeCheckpointV1(FinalizeCheckpointV1),
    CreateCandidateCouncilSetV1(CreateCandidateCouncilSetV1),
    CreateCouncilRotationV1(CreateCouncilRotationV1),
    ApproveCouncilRotationV1(ApproveCouncilRotationV1),
    ActivateCouncilRotationV1(ActivateCouncilRotationV1),
    QueueCouncilRotationV1(QueueCouncilRotationV1),
    ExpireEmergencyResolutionV1(ExpireEmergencyResolutionV1),
    CancelCouncilRotationV1(CancelCouncilRotationV1),
    ExpireCouncilRotationV1(ExpireCouncilRotationV1),
}

impl UpgradeControllerInstruction {
    pub fn unpack(data: &[u8]) -> Result<Self, ProgramError> {
        if data.is_empty() || data.len() > MAX_CONTROLLER_INSTRUCTION_DATA_LEN {
            return Err(ProgramError::InvalidInstructionData);
        }
        match data[0] {
            RECORD_PROPOSAL_APPROVAL_V1_TAG => {
                RecordProposalApprovalV1::unpack(data).map(Self::RecordProposalApprovalV1)
            }
            INITIALIZE_CONTROLLER_V1_TAG => {
                InitializeControllerV1::unpack(data).map(Self::InitializeControllerV1)
            }
            CREATE_PROPOSAL_V2_TAG => {
                CreateProposalV2::unpack(data).map(|value| Self::CreateProposalV2(Box::new(value)))
            }
            APPROVE_PROPOSAL_V2_TAG => ApproveProposalV2::unpack(data).map(Self::ApproveProposalV2),
            FINALIZE_GOVERNANCE_V2_TAG => {
                FinalizeGovernanceV2::unpack(data).map(Self::FinalizeGovernanceV2)
            }
            QUEUE_PROPOSAL_V2_TAG => QueueProposalV2::unpack(data).map(Self::QueueProposalV2),
            FREEZE_PROPOSAL_V2_TAG => FreezeProposalV2::unpack(data).map(Self::FreezeProposalV2),
            CANCEL_PROPOSAL_V2_TAG => CancelProposalV2::unpack(data).map(Self::CancelProposalV2),
            EXPIRE_PROPOSAL_V2_TAG => ExpireProposalV2::unpack(data).map(Self::ExpireProposalV2),
            GUARDIAN_FREEZE_V1_TAG => GuardianFreezeV1::unpack(data).map(Self::GuardianFreezeV1),
            CREATE_EMERGENCY_RESOLUTION_V1_TAG => {
                CreateEmergencyResolutionV1::unpack(data).map(Self::CreateEmergencyResolutionV1)
            }
            APPROVE_EMERGENCY_RESOLUTION_V1_TAG => {
                ApproveEmergencyResolutionV1::unpack(data).map(Self::ApproveEmergencyResolutionV1)
            }
            QUEUE_EMERGENCY_RESOLUTION_V1_TAG => {
                QueueEmergencyResolutionV1::unpack(data).map(Self::QueueEmergencyResolutionV1)
            }
            EXECUTE_EMERGENCY_RESOLUTION_V1_TAG => {
                ExecuteEmergencyResolutionV1::unpack(data).map(Self::ExecuteEmergencyResolutionV1)
            }
            CONVERT_EMERGENCY_FREEZE_V2_TAG => {
                ConvertEmergencyFreezeV2::unpack(data).map(Self::ConvertEmergencyFreezeV2)
            }
            BIND_CHECKPOINT_V1_TAG => BindCheckpointV1::unpack(data).map(Self::BindCheckpointV1),
            APPROVE_CHECKPOINT_V1_TAG => {
                ApproveCheckpointV1::unpack(data).map(Self::ApproveCheckpointV1)
            }
            FINALIZE_CHECKPOINT_V1_TAG => {
                FinalizeCheckpointV1::unpack(data).map(Self::FinalizeCheckpointV1)
            }
            CREATE_CANDIDATE_COUNCIL_SET_V1_TAG => {
                CreateCandidateCouncilSetV1::unpack(data).map(Self::CreateCandidateCouncilSetV1)
            }
            CREATE_COUNCIL_ROTATION_V1_TAG => {
                CreateCouncilRotationV1::unpack(data).map(Self::CreateCouncilRotationV1)
            }
            APPROVE_COUNCIL_ROTATION_V1_TAG => {
                ApproveCouncilRotationV1::unpack(data).map(Self::ApproveCouncilRotationV1)
            }
            ACTIVATE_COUNCIL_ROTATION_V1_TAG => {
                ActivateCouncilRotationV1::unpack(data).map(Self::ActivateCouncilRotationV1)
            }
            QUEUE_COUNCIL_ROTATION_V1_TAG => {
                QueueCouncilRotationV1::unpack(data).map(Self::QueueCouncilRotationV1)
            }
            EXPIRE_EMERGENCY_RESOLUTION_V1_TAG => {
                ExpireEmergencyResolutionV1::unpack(data).map(Self::ExpireEmergencyResolutionV1)
            }
            CANCEL_COUNCIL_ROTATION_V1_TAG => {
                CancelCouncilRotationV1::unpack(data).map(Self::CancelCouncilRotationV1)
            }
            EXPIRE_COUNCIL_ROTATION_V1_TAG => {
                ExpireCouncilRotationV1::unpack(data).map(Self::ExpireCouncilRotationV1)
            }
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

macro_rules! fixed_builder {
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
        ) -> Instruction {
            Instruction {
                program_id: controller_program,
                accounts: vec![
                    $(account_meta!(accounts.$field, $mode),)*
                ],
                data: instruction.pack().to_vec(),
            }
        }
    };
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct InitializeControllerV1Accounts {
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
    pub canonical_spill_treasury: Pubkey,
    pub guardian: Pubkey,
    pub seat_authorities: [Pubkey; 5],
    pub system_program: Pubkey,
}

/// Accounts, in order: payer (writable signer), initializer (signer), controller
/// Program, controller ProgramData, target Program, target ProgramData, Loader,
/// config (writable), authority PDA, gate/policy/council (writable), spill,
/// guardian, five read-only seat authorities, and System Program.
pub fn initialize_controller_v1_instruction(
    controller_program_id: Pubkey,
    accounts: InitializeControllerV1Accounts,
    instruction: InitializeControllerV1,
) -> Instruction {
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
    Instruction {
        program_id: controller_program_id,
        accounts: metas,
        data: instruction.pack().to_vec(),
    }
}

fixed_builder!(
    CreateProposalV2Accounts {
        payer: signer_writable,
        creator_seat_authority: signer_readonly,
        controller_config: writable,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
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
    create_proposal_v2_instruction,
    CreateProposalV2
);

fixed_builder!(
    ApproveProposalV2Accounts {
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        proposal: writable,
        seat_authority: signer_readonly,
    },
    approve_proposal_v2_instruction,
    ApproveProposalV2
);

fixed_builder!(
    FinalizeGovernanceV2Accounts {
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        proposal: writable,
    },
    finalize_governance_v2_instruction,
    FinalizeGovernanceV2
);

fixed_builder!(
    QueueProposalV2Accounts {
        controller_config: readonly,
        policy: readonly,
        protocol_gate: readonly,
        proposal: writable,
    },
    queue_proposal_v2_instruction,
    QueueProposalV2
);

fixed_builder!(
    FreezeProposalV2Accounts {
        controller_config: writable,
        policy: readonly,
        council: readonly,
        protocol_gate: writable,
        proposal: writable,
    },
    freeze_proposal_v2_instruction,
    FreezeProposalV2
);

fixed_builder!(
    CancelProposalV2Accounts {
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        proposal: writable,
        seat_authority: signer_readonly,
    },
    cancel_proposal_v2_instruction,
    CancelProposalV2
);

fixed_builder!(
    ExpireProposalV2Accounts {
        controller_config: readonly,
        protocol_gate: readonly,
        proposal: writable,
    },
    expire_proposal_v2_instruction,
    ExpireProposalV2
);

fixed_builder!(
    GuardianFreezeV1Accounts {
        controller_config: readonly,
        protocol_gate: writable,
        target_program: readonly,
        target_programdata: readonly,
        upgradeable_loader: readonly,
        authority_pda: readonly,
        guardian: signer_readonly,
    },
    guardian_freeze_v1_instruction,
    GuardianFreezeV1
);

fixed_builder!(
    CreateEmergencyResolutionV1Accounts {
        payer: signer_writable,
        creator_seat_authority: signer_readonly,
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        target_program: readonly,
        target_programdata: readonly,
        upgradeable_loader: readonly,
        authority_pda: readonly,
        emergency_resolution: writable,
        system_program: readonly,
    },
    create_emergency_resolution_v1_instruction,
    CreateEmergencyResolutionV1
);

fixed_builder!(
    ApproveEmergencyResolutionV1Accounts {
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        emergency_resolution: writable,
        seat_authority: signer_readonly,
    },
    approve_emergency_resolution_v1_instruction,
    ApproveEmergencyResolutionV1
);

fixed_builder!(
    QueueEmergencyResolutionV1Accounts {
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        emergency_resolution: writable,
    },
    queue_emergency_resolution_v1_instruction,
    QueueEmergencyResolutionV1
);

fixed_builder!(
    ExecuteEmergencyResolutionV1Accounts {
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: writable,
        emergency_resolution: writable,
        emergency_checkpoint: readonly,
        target_program: readonly,
        target_programdata: readonly,
        upgradeable_loader: readonly,
        authority_pda: readonly,
    },
    execute_emergency_resolution_v1_instruction,
    ExecuteEmergencyResolutionV1
);

fixed_builder!(
    ConvertEmergencyFreezeV2Accounts {
        controller_config: writable,
        policy: readonly,
        council: readonly,
        protocol_gate: writable,
        proposal: writable,
    },
    convert_emergency_freeze_v2_instruction,
    ConvertEmergencyFreezeV2
);

fixed_builder!(
    BindCheckpointV1Accounts {
        payer: signer_writable,
        controller_config: readonly,
        protocol_gate: readonly,
        subject: readonly,
        target_program: readonly,
        target_programdata: readonly,
        phase_evidence: readonly,
        checkpoint: writable,
        system_program: readonly,
    },
    bind_checkpoint_v1_instruction,
    BindCheckpointV1
);

fixed_builder!(
    ApproveCheckpointV1Accounts {
        controller_config: readonly,
        policy: readonly,
        council: readonly,
        protocol_gate: readonly,
        subject: readonly,
        checkpoint: writable,
        seat_authority: signer_readonly,
    },
    approve_checkpoint_v1_instruction,
    ApproveCheckpointV1
);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FinalizeCheckpointV1Accounts {
    pub controller_config: Pubkey,
    pub policy: Pubkey,
    pub council: Pubkey,
    pub protocol_gate: Pubkey,
    pub subject: Pubkey,
    pub checkpoint: Pubkey,
}

/// The proposal subject is writable only for a Poststate checkpoint, whose
/// finalization performs the separate `ProgramDataVerified -> PoststateAccepted`
/// transition. Prestate and emergency subjects remain read-only.
pub fn finalize_checkpoint_v1_instruction(
    controller_program: Pubkey,
    accounts: FinalizeCheckpointV1Accounts,
    instruction: FinalizeCheckpointV1,
) -> Instruction {
    let subject = if instruction.expected.phase == StateCheckpointPhaseV1::Poststate {
        account_meta!(accounts.subject, writable)
    } else {
        account_meta!(accounts.subject, readonly)
    };
    Instruction {
        program_id: controller_program,
        accounts: vec![
            account_meta!(accounts.controller_config, readonly),
            account_meta!(accounts.policy, readonly),
            account_meta!(accounts.council, readonly),
            account_meta!(accounts.protocol_gate, readonly),
            subject,
            account_meta!(accounts.checkpoint, writable),
        ],
        data: instruction.pack().to_vec(),
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct CreateCandidateCouncilSetV1Accounts {
    pub payer: Pubkey,
    pub creator_seat_authority: Pubkey,
    pub controller_config: Pubkey,
    pub policy: Pubkey,
    pub current_council: Pubkey,
    pub protocol_gate: Pubkey,
    pub candidate_council: Pubkey,
    pub candidate_seat_authorities: [Pubkey; 5],
    pub system_program: Pubkey,
}

/// The payer and active creator seat are intentionally distinct roles. Candidate
/// seat authorities are read-only and need not sign, preserving PDA/multisig seats.
pub fn create_candidate_council_set_v1_instruction(
    controller_program: Pubkey,
    accounts: CreateCandidateCouncilSetV1Accounts,
    instruction: CreateCandidateCouncilSetV1,
) -> Instruction {
    let mut metas = vec![
        account_meta!(accounts.payer, signer_writable),
        account_meta!(accounts.creator_seat_authority, signer_readonly),
        account_meta!(accounts.controller_config, readonly),
        account_meta!(accounts.policy, readonly),
        account_meta!(accounts.current_council, readonly),
        account_meta!(accounts.protocol_gate, readonly),
        account_meta!(accounts.candidate_council, writable),
    ];
    metas.extend(
        accounts
            .candidate_seat_authorities
            .into_iter()
            .map(|authority| account_meta!(authority, readonly)),
    );
    metas.push(account_meta!(accounts.system_program, readonly));
    Instruction {
        program_id: controller_program,
        accounts: metas,
        data: instruction.pack().to_vec(),
    }
}

fixed_builder!(
    CreateCouncilRotationV1Accounts {
        payer: signer_writable,
        creator_seat_authority: signer_readonly,
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        candidate_council: readonly,
        protocol_gate: readonly,
        rotation: writable,
        system_program: readonly,
    },
    create_council_rotation_v1_instruction,
    CreateCouncilRotationV1
);

fixed_builder!(
    ApproveCouncilRotationV1Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        candidate_council: readonly,
        protocol_gate: readonly,
        rotation: writable,
        seat_authority: signer_readonly,
    },
    approve_council_rotation_v1_instruction,
    ApproveCouncilRotationV1
);

fixed_builder!(
    ActivateCouncilRotationV1Accounts {
        controller_config: writable,
        policy: readonly,
        current_council: readonly,
        candidate_council: readonly,
        protocol_gate: readonly,
        rotation: writable,
    },
    activate_council_rotation_v1_instruction,
    ActivateCouncilRotationV1
);

fixed_builder!(
    QueueCouncilRotationV1Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        candidate_council: readonly,
        protocol_gate: readonly,
        rotation: writable,
    },
    queue_council_rotation_v1_instruction,
    QueueCouncilRotationV1
);

fixed_builder!(
    ExpireEmergencyResolutionV1Accounts {
        controller_config: readonly,
        protocol_gate: readonly,
        emergency_resolution: writable,
    },
    expire_emergency_resolution_v1_instruction,
    ExpireEmergencyResolutionV1
);

fixed_builder!(
    CancelCouncilRotationV1Accounts {
        controller_config: readonly,
        policy: readonly,
        current_council: readonly,
        candidate_council: readonly,
        protocol_gate: readonly,
        rotation: writable,
        seat_authority: signer_readonly,
    },
    cancel_council_rotation_v1_instruction,
    CancelCouncilRotationV1
);

fixed_builder!(
    ExpireCouncilRotationV1Accounts {
        controller_config: readonly,
        protocol_gate: readonly,
        rotation: writable,
    },
    expire_council_rotation_v1_instruction,
    ExpireCouncilRotationV1
);

#[cfg(test)]
mod tests {
    use super::*;
    use solana_program::hash::hash;

    fn key(value: u8) -> Pubkey {
        Pubkey::new_from_array([value; 32])
    }

    const fn bytes(value: u8) -> [u8; 32] {
        [value; 32]
    }

    fn seat_terms() -> [CouncilSeatTermV1; 5] {
        [
            CouncilSeatTermV1 {
                term_start_slot: 10,
                term_end_slot: 110,
            },
            CouncilSeatTermV1 {
                term_start_slot: 11,
                term_end_slot: 111,
            },
            CouncilSeatTermV1 {
                term_start_slot: 12,
                term_end_slot: 112,
            },
            CouncilSeatTermV1 {
                term_start_slot: 13,
                term_end_slot: 113,
            },
            CouncilSeatTermV1 {
                term_start_slot: 14,
                term_end_slot: 114,
            },
        ]
    }

    fn initialize() -> InitializeControllerV1 {
        InitializeControllerV1 {
            cluster_domain: bytes(1),
            initial_policy_version: 2,
            initial_council_version: 3,
            next_proposal_id: 4,
            target_nonce: 5,
            initial_gate_epoch: 6,
            policy_activation_slot: 7,
            routine_delay_slots: 8,
            major_delay_slots: 9,
            rollback_delay_slots: 10,
            terminal_delay_slots: 11,
            vote_review_slots: 12,
            proposal_expiry_slots: 13,
            expected_policy_hash: bytes(2),
            expected_council_hash: bytes(3),
            seat_terms: seat_terms(),
        }
    }

    fn create_proposal() -> CreateProposalV2 {
        CreateProposalV2 {
            proposal_class: ProposalClassV1::RoutineUpgrade,
            creation_gate_status: GateStatusV1::Active,
            expected_proposal_id: 1,
            expected_target_nonce: 2,
            creation_slot: 3,
            expected_policy_version: 4,
            expected_policy_hash: bytes(4),
            expected_creation_council_version: 5,
            expected_creation_council_hash: bytes(5),
            expected_creation_gate_epoch: 6,
            expected_freeze_gate_epoch: 7,
            artifact_length: 8,
            artifact_sha256: bytes(8),
            artifact_chunk_merkle_root: bytes(9),
            source_commit_hash: bytes(10),
            source_tree_hash: bytes(11),
            build_input_inventory_hash: bytes(12),
            reproducible_build_receipt_hash: bytes(13),
            package_receipt_hash: bytes(14),
            release_intent_hash: bytes(15),
            expected_execution_pre_payload_hash: bytes(16),
            expected_execution_pre_chunk_root: bytes(17),
            current_raw_programdata_hash: bytes(18),
            deployed_slot: 19,
            current_capacity: 20,
            extension_delta: 21,
            expected_post_capacity: 41,
            checkpoint_schema_id: bytes(22),
            checkpoint_policy_hash: bytes(23),
            primary_proposal: OptionalInstructionPubkeyV1::none(),
            rollback_proposal: OptionalInstructionPubkeyV1::some(key(24)).unwrap(),
            rollback_buffer: OptionalInstructionPubkeyV1::some(key(25)).unwrap(),
            rollback_artifact_sha256: bytes(26),
            rollback_artifact_chunk_root: bytes(27),
            review_start_slot: 28,
            review_end_slot: 29,
            not_before_slot: 30,
            expiry_slot: 31,
            expected_proposal_digest: bytes(32),
        }
    }

    fn proposal_expectation() -> ProposalExpectationV2 {
        ProposalExpectationV2 {
            expected_proposal_digest: bytes(33),
            expected_policy_version: 34,
            expected_policy_hash: bytes(35),
            expected_council_version: 36,
            expected_council_hash: bytes(37),
            expected_gate_status: GateStatusV1::FrozenForUpgrade,
            expected_gate_epoch: 38,
            expected_target_nonce: 39,
            expected_state: ProposalStateV2::Timelocked,
            expected_review_start_slot: 40,
            expected_review_end_slot: 41,
            expected_not_before_slot: 42,
            expected_expiry_slot: 43,
        }
    }

    fn guardian_freeze() -> GuardianFreezeV1 {
        GuardianFreezeV1 {
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 44,
            expected_target_nonce: 45,
            expected_programdata_slot: 46,
            expected_payload_hash: bytes(47),
            expected_raw_programdata_hash: bytes(48),
            expected_capacity: 49,
            freeze_reason_code: 50,
        }
    }

    fn create_emergency_resolution() -> CreateEmergencyResolutionV1 {
        CreateEmergencyResolutionV1 {
            resolution_kind: EmergencyFreezeResolutionKindV1::ResumeWithoutUpgrade,
            creation_slot: 51,
            not_before_slot: 52,
            expiry_slot: 53,
            expected_policy_version: 54,
            expected_policy_hash: bytes(55),
            expected_council_version: 56,
            expected_council_hash: bytes(57),
            expected_gate_epoch: 58,
            expected_freeze_slot: 59,
            expected_freeze_reason_code: 60,
            expected_target_nonce: 61,
            observed_programdata_slot: 62,
            observed_payload_hash: bytes(63),
            observed_raw_programdata_hash: bytes(64),
            observed_capacity: 65,
            expected_resolution_digest: bytes(66),
        }
    }

    fn emergency_expectation() -> EmergencyResolutionExpectationV1 {
        EmergencyResolutionExpectationV1 {
            expected_resolution_digest: bytes(67),
            expected_policy_version: 68,
            expected_policy_hash: bytes(69),
            expected_council_version: 70,
            expected_council_hash: bytes(71),
            expected_gate_status: GateStatusV1::EmergencyFrozen,
            expected_gate_epoch: 72,
            expected_freeze_slot: 73,
            expected_freeze_reason_code: 74,
            expected_target_nonce: 75,
            expected_state: EmergencyFreezeResolutionStateV1::Timelocked,
            expected_not_before_slot: 76,
            expected_expiry_slot: 77,
        }
    }

    fn bind_checkpoint() -> BindCheckpointV1 {
        BindCheckpointV1 {
            phase: StateCheckpointPhaseV1::Poststate,
            expected_subject_state: CheckpointSubjectStateV1::ProposalProgramDataVerified,
            expected_subject_digest: bytes(78),
            expected_gate_status: GateStatusV1::FrozenForUpgrade,
            expected_gate_epoch: 79,
            finalized_observation_slot: 80,
            target_programdata_slot: 81,
            target_payload_commitment: bytes(82),
            target_raw_programdata_commitment: bytes(83),
            target_capacity: 84,
            program_owned_state_root: bytes(85),
            program_owned_state_count: 86,
            logical_compressed_state_root: bytes(87),
            logical_compressed_state_count: 88,
            semantic_custody_accounting_root: bytes(89),
            hard_combined_root: bytes(90),
            external_metadata_observation_root: bytes(91),
            external_raw_balance_observation_root: bytes(92),
            schema_identifier: bytes(93),
            admitted_positive_donation_root: bytes(94),
            admitted_positive_donation_count: 95,
            forbidden_drift_count: 0,
            expected_checkpoint_digest: bytes(96),
        }
    }

    fn checkpoint_expectation(phase: StateCheckpointPhaseV1) -> CheckpointExpectationV1 {
        CheckpointExpectationV1 {
            phase,
            expected_subject_state: match phase {
                StateCheckpointPhaseV1::Prestate => CheckpointSubjectStateV1::ProposalFrozen,
                StateCheckpointPhaseV1::Poststate => {
                    CheckpointSubjectStateV1::ProposalProgramDataVerified
                }
                StateCheckpointPhaseV1::Emergency => {
                    CheckpointSubjectStateV1::EmergencyResolutionTimelocked
                }
            },
            expected_subject_digest: bytes(97),
            expected_checkpoint_digest: bytes(98),
            expected_council_version: 99,
            expected_council_hash: bytes(100),
            expected_gate_status: if phase == StateCheckpointPhaseV1::Emergency {
                GateStatusV1::EmergencyFrozen
            } else {
                GateStatusV1::FrozenForUpgrade
            },
            expected_gate_epoch: 101,
            expected_approval_bitset: 0b00111,
            expected_approval_count: 3,
        }
    }

    fn create_candidate_council() -> CreateCandidateCouncilSetV1 {
        CreateCandidateCouncilSetV1 {
            expected_current_council_version: 102,
            expected_current_council_hash: bytes(103),
            candidate_council_version: 103,
            activation_slot: 104,
            expected_target_nonce: 105,
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 106,
            expected_candidate_council_hash: bytes(107),
            seat_terms: seat_terms(),
        }
    }

    fn create_council_rotation() -> CreateCouncilRotationV1 {
        CreateCouncilRotationV1 {
            creation_slot: 108,
            not_before_slot: 109,
            expiry_slot: 110,
            expected_current_council_version: 111,
            expected_current_council_hash: bytes(112),
            expected_candidate_council_version: 112,
            expected_candidate_council_hash: bytes(113),
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 114,
            expected_target_nonce: 115,
            expected_rotation_digest: bytes(116),
        }
    }

    fn rotation_expectation() -> CouncilRotationExpectationV1 {
        CouncilRotationExpectationV1 {
            expected_rotation_digest: bytes(117),
            expected_current_council_version: 118,
            expected_current_council_hash: bytes(119),
            expected_candidate_council_version: 119,
            expected_candidate_council_hash: bytes(120),
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 121,
            expected_target_nonce: 122,
            expected_state: CouncilRotationStateV1::Timelocked,
            expected_not_before_slot: 123,
            expected_expiry_slot: 124,
        }
    }

    fn instruction_cases() -> Vec<(u8, usize, Vec<u8>)> {
        vec![
            (
                RECORD_PROPOSAL_APPROVAL_V1_TAG,
                RECORD_PROPOSAL_APPROVAL_V1_LEN,
                RecordProposalApprovalV1 {
                    expected_proposal_digest: bytes(7),
                    expected_council_version: 0x0102_0304_0506_0708,
                }
                .pack()
                .to_vec(),
            ),
            (
                INITIALIZE_CONTROLLER_V1_TAG,
                INITIALIZE_CONTROLLER_V1_LEN,
                initialize().pack().to_vec(),
            ),
            (
                CREATE_PROPOSAL_V2_TAG,
                CREATE_PROPOSAL_V2_LEN,
                create_proposal().pack().to_vec(),
            ),
            (
                APPROVE_PROPOSAL_V2_TAG,
                APPROVE_PROPOSAL_V2_LEN,
                ApproveProposalV2 {
                    expected: proposal_expectation(),
                    expected_approval_bitset: 1,
                    expected_approval_count: 1,
                }
                .pack()
                .to_vec(),
            ),
            (
                FINALIZE_GOVERNANCE_V2_TAG,
                FINALIZE_GOVERNANCE_V2_LEN,
                FinalizeGovernanceV2 {
                    expected: proposal_expectation(),
                    expected_approval_bitset: 7,
                    expected_approval_count: 3,
                }
                .pack()
                .to_vec(),
            ),
            (
                QUEUE_PROPOSAL_V2_TAG,
                QUEUE_PROPOSAL_V2_LEN,
                QueueProposalV2 {
                    expected: proposal_expectation(),
                }
                .pack()
                .to_vec(),
            ),
            (
                FREEZE_PROPOSAL_V2_TAG,
                FREEZE_PROPOSAL_V2_LEN,
                FreezeProposalV2 {
                    expected: proposal_expectation(),
                    expected_next_gate_epoch: 125,
                }
                .pack()
                .to_vec(),
            ),
            (
                CANCEL_PROPOSAL_V2_TAG,
                CANCEL_PROPOSAL_V2_LEN,
                CancelProposalV2 {
                    expected: proposal_expectation(),
                    expected_cancellation_approval_bitset: 3,
                    expected_cancellation_approval_count: 2,
                    cancellation_reason_code: 126,
                }
                .pack()
                .to_vec(),
            ),
            (
                EXPIRE_PROPOSAL_V2_TAG,
                EXPIRE_PROPOSAL_V2_LEN,
                ExpireProposalV2 {
                    expected: proposal_expectation(),
                }
                .pack()
                .to_vec(),
            ),
            (
                GUARDIAN_FREEZE_V1_TAG,
                GUARDIAN_FREEZE_V1_LEN,
                guardian_freeze().pack().to_vec(),
            ),
            (
                CREATE_EMERGENCY_RESOLUTION_V1_TAG,
                CREATE_EMERGENCY_RESOLUTION_V1_LEN,
                create_emergency_resolution().pack().to_vec(),
            ),
            (
                APPROVE_EMERGENCY_RESOLUTION_V1_TAG,
                APPROVE_EMERGENCY_RESOLUTION_V1_LEN,
                ApproveEmergencyResolutionV1 {
                    expected: emergency_expectation(),
                    expected_approval_bitset: 1,
                    expected_approval_count: 1,
                }
                .pack()
                .to_vec(),
            ),
            (
                QUEUE_EMERGENCY_RESOLUTION_V1_TAG,
                QUEUE_EMERGENCY_RESOLUTION_V1_LEN,
                QueueEmergencyResolutionV1 {
                    expected: emergency_expectation(),
                    expected_approval_bitset: 7,
                    expected_approval_count: 3,
                }
                .pack()
                .to_vec(),
            ),
            (
                EXECUTE_EMERGENCY_RESOLUTION_V1_TAG,
                EXECUTE_EMERGENCY_RESOLUTION_V1_LEN,
                ExecuteEmergencyResolutionV1 {
                    expected: emergency_expectation(),
                    expected_checkpoint_digest: bytes(127),
                    expected_programdata_slot: 128,
                    expected_payload_hash: bytes(129),
                    expected_raw_programdata_hash: bytes(130),
                    expected_capacity: 131,
                }
                .pack()
                .to_vec(),
            ),
            (
                CONVERT_EMERGENCY_FREEZE_V2_TAG,
                CONVERT_EMERGENCY_FREEZE_V2_LEN,
                ConvertEmergencyFreezeV2 {
                    expected: proposal_expectation(),
                    expected_next_gate_epoch: 132,
                }
                .pack()
                .to_vec(),
            ),
            (
                BIND_CHECKPOINT_V1_TAG,
                BIND_CHECKPOINT_V1_LEN,
                bind_checkpoint().pack().to_vec(),
            ),
            (
                APPROVE_CHECKPOINT_V1_TAG,
                APPROVE_CHECKPOINT_V1_LEN,
                ApproveCheckpointV1 {
                    expected: checkpoint_expectation(StateCheckpointPhaseV1::Prestate),
                }
                .pack()
                .to_vec(),
            ),
            (
                FINALIZE_CHECKPOINT_V1_TAG,
                FINALIZE_CHECKPOINT_V1_LEN,
                FinalizeCheckpointV1 {
                    expected: checkpoint_expectation(StateCheckpointPhaseV1::Poststate),
                }
                .pack()
                .to_vec(),
            ),
            (
                CREATE_CANDIDATE_COUNCIL_SET_V1_TAG,
                CREATE_CANDIDATE_COUNCIL_SET_V1_LEN,
                create_candidate_council().pack().to_vec(),
            ),
            (
                CREATE_COUNCIL_ROTATION_V1_TAG,
                CREATE_COUNCIL_ROTATION_V1_LEN,
                create_council_rotation().pack().to_vec(),
            ),
            (
                APPROVE_COUNCIL_ROTATION_V1_TAG,
                APPROVE_COUNCIL_ROTATION_V1_LEN,
                ApproveCouncilRotationV1 {
                    expected: rotation_expectation(),
                    expected_approval_bitset: 1,
                    expected_approval_count: 1,
                }
                .pack()
                .to_vec(),
            ),
            (
                ACTIVATE_COUNCIL_ROTATION_V1_TAG,
                ACTIVATE_COUNCIL_ROTATION_V1_LEN,
                ActivateCouncilRotationV1 {
                    expected: rotation_expectation(),
                    expected_approval_bitset: 7,
                    expected_approval_count: 3,
                }
                .pack()
                .to_vec(),
            ),
            (
                QUEUE_COUNCIL_ROTATION_V1_TAG,
                QUEUE_COUNCIL_ROTATION_V1_LEN,
                QueueCouncilRotationV1 {
                    expected: rotation_expectation(),
                    expected_approval_bitset: 7,
                    expected_approval_count: 3,
                }
                .pack()
                .to_vec(),
            ),
            (
                EXPIRE_EMERGENCY_RESOLUTION_V1_TAG,
                EXPIRE_EMERGENCY_RESOLUTION_V1_LEN,
                ExpireEmergencyResolutionV1 {
                    expected: emergency_expectation(),
                }
                .pack()
                .to_vec(),
            ),
            (
                CANCEL_COUNCIL_ROTATION_V1_TAG,
                CANCEL_COUNCIL_ROTATION_V1_LEN,
                CancelCouncilRotationV1 {
                    expected: rotation_expectation(),
                    expected_cancellation_approval_bitset: 3,
                    expected_cancellation_approval_count: 2,
                    cancellation_reason_code: 125,
                }
                .pack()
                .to_vec(),
            ),
            (
                EXPIRE_COUNCIL_ROTATION_V1_TAG,
                EXPIRE_COUNCIL_ROTATION_V1_LEN,
                ExpireCouncilRotationV1 {
                    expected: rotation_expectation(),
                }
                .pack()
                .to_vec(),
            ),
        ]
    }

    #[test]
    fn tag_zero_remains_byte_for_byte_frozen() {
        let value = RecordProposalApprovalV1 {
            expected_proposal_digest: [7; 32],
            expected_council_version: 0x0102_0304_0506_0708,
        };
        let bytes = value.pack();
        assert_eq!(bytes.len(), RECORD_PROPOSAL_APPROVAL_V1_LEN);
        assert_eq!(RecordProposalApprovalV1::unpack(&bytes), Ok(value));
        assert_eq!(
            bytes,
            [
                0, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
                7, 7, 7, 7, 7, 8, 7, 6, 5, 4, 3, 2, 1,
            ]
        );
        assert_eq!(&bytes[33..], &value.expected_council_version.to_le_bytes());
    }

    #[test]
    fn all_instruction_codecs_are_exact_bounded_and_reject_drift() {
        let cases = instruction_cases();
        assert_eq!(cases.len(), 26);
        for (expected_tag, expected_len, packed) in cases {
            assert_eq!(packed[0], expected_tag);
            assert_eq!(packed.len(), expected_len);
            assert!(packed.len() <= MAX_CONTROLLER_INSTRUCTION_DATA_LEN);
            assert!(UpgradeControllerInstruction::unpack(&packed).is_ok());

            let truncated = &packed[..packed.len() - 1];
            assert_eq!(
                UpgradeControllerInstruction::unpack(truncated),
                Err(ProgramError::InvalidInstructionData),
                "tag {expected_tag} accepted truncation"
            );
            let mut trailing = packed.clone();
            trailing.push(0);
            assert_eq!(
                UpgradeControllerInstruction::unpack(&trailing),
                Err(ProgramError::InvalidInstructionData),
                "tag {expected_tag} accepted trailing data"
            );
            let mut unknown = packed;
            unknown[0] = u8::MAX;
            assert_eq!(
                UpgradeControllerInstruction::unpack(&unknown),
                Err(ProgramError::InvalidInstructionData)
            );
        }
        assert_eq!(
            UpgradeControllerInstruction::unpack(&[]),
            Err(ProgramError::InvalidInstructionData)
        );
        assert_eq!(
            UpgradeControllerInstruction::unpack(&vec![0; MAX_CONTROLLER_INSTRUCTION_DATA_LEN + 1]),
            Err(ProgramError::InvalidInstructionData)
        );
        for reserved in CANCEL_EMERGENCY_RESOLUTION_V2_RESERVED_TAG..=EXECUTE_ROLLBACK_V1_TAG {
            assert_eq!(
                UpgradeControllerInstruction::unpack(&[reserved]),
                Err(ProgramError::InvalidInstructionData)
            );
        }
    }

    #[test]
    fn every_instruction_enum_is_decoded_explicitly() {
        let mut proposal = create_proposal().pack();
        proposal[1] = u8::MAX;
        assert_eq!(
            CreateProposalV2::unpack(&proposal),
            Err(ProgramError::InvalidInstructionData)
        );
        for unsupported_class in [
            ProposalClassV1::CouncilSetRotation as u8,
            ProposalClassV1::TargetImmutability as u8,
        ] {
            let mut proposal = create_proposal().pack();
            proposal[1] = unsupported_class;
            assert_eq!(
                CreateProposalV2::unpack(&proposal),
                Err(ProgramError::InvalidInstructionData)
            );
        }
        let mut proposal = create_proposal().pack();
        proposal[2] = u8::MAX;
        assert_eq!(
            CreateProposalV2::unpack(&proposal),
            Err(ProgramError::InvalidInstructionData)
        );

        let mut approval = ApproveProposalV2 {
            expected: proposal_expectation(),
            expected_approval_bitset: 1,
            expected_approval_count: 1,
        }
        .pack();
        approval[130] = u8::MAX;
        assert_eq!(
            ApproveProposalV2::unpack(&approval),
            Err(ProgramError::InvalidInstructionData)
        );
        let mut approval = ApproveProposalV2 {
            expected: proposal_expectation(),
            expected_approval_bitset: 1,
            expected_approval_count: 1,
        }
        .pack();
        approval[130] = ProposalStateV2::TokenReviewOpen as u8;
        assert_eq!(
            ApproveProposalV2::unpack(&approval),
            Err(ProgramError::InvalidInstructionData)
        );

        let mut emergency = create_emergency_resolution().pack();
        emergency[1] = u8::MAX;
        assert_eq!(
            CreateEmergencyResolutionV1::unpack(&emergency),
            Err(ProgramError::InvalidInstructionData)
        );
        let mut emergency = ApproveEmergencyResolutionV1 {
            expected: emergency_expectation(),
            expected_approval_bitset: 1,
            expected_approval_count: 1,
        }
        .pack();
        emergency[140] = u8::MAX;
        assert_eq!(
            ApproveEmergencyResolutionV1::unpack(&emergency),
            Err(ProgramError::InvalidInstructionData)
        );

        let mut checkpoint = bind_checkpoint().pack();
        checkpoint[1] = u8::MAX;
        assert_eq!(
            BindCheckpointV1::unpack(&checkpoint),
            Err(ProgramError::InvalidInstructionData)
        );
        let mut checkpoint = bind_checkpoint().pack();
        checkpoint[2] = u8::MAX;
        assert_eq!(
            BindCheckpointV1::unpack(&checkpoint),
            Err(ProgramError::InvalidInstructionData)
        );

        let mut rotation = ApproveCouncilRotationV1 {
            expected: rotation_expectation(),
            expected_approval_bitset: 1,
            expected_approval_count: 1,
        }
        .pack();
        rotation[130] = u8::MAX;
        assert_eq!(
            ApproveCouncilRotationV1::unpack(&rotation),
            Err(ProgramError::InvalidInstructionData)
        );
    }

    #[test]
    fn optional_pubkeys_are_fixed_width_and_canonical() {
        let mut absent_nonzero = [0u8; 33];
        absent_nonzero[1] = 1;
        assert_eq!(
            OptionalInstructionPubkeyV1::decode(&mut FixedReader::new(&absent_nonzero)),
            Err(ProgramError::InvalidInstructionData)
        );
        let present_default = {
            let mut value = [0u8; 33];
            value[0] = 1;
            value
        };
        assert_eq!(
            OptionalInstructionPubkeyV1::decode(&mut FixedReader::new(&present_default)),
            Err(ProgramError::InvalidInstructionData)
        );
        let mut unknown_presence = [0u8; 33];
        unknown_presence[0] = 2;
        assert_eq!(
            OptionalInstructionPubkeyV1::decode(&mut FixedReader::new(&unknown_presence)),
            Err(ProgramError::InvalidInstructionData)
        );
    }

    fn assert_account_contract(
        instruction: Instruction,
        expected_data: Vec<u8>,
        expected_accounts: &[(u8, bool, bool)],
    ) {
        assert_eq!(instruction.program_id, key(250));
        assert_eq!(instruction.data, expected_data);
        assert_eq!(instruction.accounts.len(), expected_accounts.len());
        for (index, (actual, (key_byte, is_signer, is_writable))) in instruction
            .accounts
            .iter()
            .zip(expected_accounts.iter().copied())
            .enumerate()
        {
            assert_eq!(actual.pubkey, key(key_byte), "account {index} key");
            assert_eq!(actual.is_signer, is_signer, "account {index} signer");
            assert_eq!(actual.is_writable, is_writable, "account {index} writable");
        }
    }

    macro_rules! assert_fixed_builder_contract {
        (
            $builder:ident,
            $accounts_type:ident {
                $($field:ident: $key_byte:expr => ($is_signer:expr, $is_writable:expr)),+ $(,)?
            },
            $instruction:expr $(,)?
        ) => {{
            let instruction = $instruction;
            let expected_data = instruction.pack().to_vec();
            let built = $builder(
                key(250),
                $accounts_type {
                    $($field: key($key_byte),)+
                },
                instruction,
            );
            assert_account_contract(
                built,
                expected_data,
                &[$(($key_byte, $is_signer, $is_writable)),+],
            );
        }};
    }

    #[test]
    fn legacy_and_initialization_builders_freeze_account_order_and_privileges() {
        let legacy = RecordProposalApprovalV1 {
            expected_proposal_digest: bytes(1),
            expected_council_version: 2,
        };
        assert_account_contract(
            record_proposal_approval_instruction(
                key(250),
                key(1),
                key(2),
                key(3),
                key(4),
                key(5),
                legacy.expected_proposal_digest,
                legacy.expected_council_version,
            ),
            legacy.pack().to_vec(),
            &[
                (1, false, false),
                (2, false, false),
                (3, false, false),
                (4, false, true),
                (5, true, false),
            ],
        );

        let initialization = initialize();
        assert_account_contract(
            initialize_controller_v1_instruction(
                key(250),
                InitializeControllerV1Accounts {
                    payer: key(1),
                    initializer: key(2),
                    controller_program: key(3),
                    controller_programdata: key(4),
                    target_program: key(5),
                    target_programdata: key(6),
                    upgradeable_loader: key(7),
                    controller_config: key(8),
                    authority_pda: key(9),
                    protocol_gate: key(10),
                    policy: key(11),
                    council: key(12),
                    canonical_spill_treasury: key(13),
                    guardian: key(14),
                    seat_authorities: [key(15), key(16), key(17), key(18), key(19)],
                    system_program: key(20),
                },
                initialization.clone(),
            ),
            initialization.pack().to_vec(),
            &[
                (1, true, true),
                (2, true, false),
                (3, false, false),
                (4, false, false),
                (5, false, false),
                (6, false, false),
                (7, false, false),
                (8, false, true),
                (9, false, false),
                (10, false, true),
                (11, false, true),
                (12, false, true),
                (13, false, false),
                (14, false, false),
                (15, false, false),
                (16, false, false),
                (17, false, false),
                (18, false, false),
                (19, false, false),
                (20, false, false),
            ],
        );
    }

    #[test]
    fn proposal_builders_freeze_account_order_and_privileges() {
        assert_fixed_builder_contract!(
            create_proposal_v2_instruction,
            CreateProposalV2Accounts {
                payer: 1 => (true, true),
                creator_seat_authority: 2 => (true, false),
                controller_config: 3 => (false, true),
                policy: 4 => (false, false),
                council: 5 => (false, false),
                protocol_gate: 6 => (false, false),
                target_program: 7 => (false, false),
                target_programdata: 8 => (false, false),
                upgradeable_loader: 9 => (false, false),
                authority_pda: 10 => (false, false),
                canonical_spill_treasury: 11 => (false, false),
                buffer: 12 => (false, false),
                buffer_uploader_authority: 13 => (false, false),
                proposal: 14 => (false, true),
                system_program: 15 => (false, false),
            },
            create_proposal(),
        );
        assert_fixed_builder_contract!(
            approve_proposal_v2_instruction,
            ApproveProposalV2Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, false),
                proposal: 5 => (false, true),
                seat_authority: 6 => (true, false),
            },
            ApproveProposalV2 {
                expected: proposal_expectation(),
                expected_approval_bitset: 1,
                expected_approval_count: 1,
            },
        );
        assert_fixed_builder_contract!(
            finalize_governance_v2_instruction,
            FinalizeGovernanceV2Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, false),
                proposal: 5 => (false, true),
            },
            FinalizeGovernanceV2 {
                expected: proposal_expectation(),
                expected_approval_bitset: 7,
                expected_approval_count: 3,
            },
        );
        assert_fixed_builder_contract!(
            queue_proposal_v2_instruction,
            QueueProposalV2Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                protocol_gate: 3 => (false, false),
                proposal: 4 => (false, true),
            },
            QueueProposalV2 {
                expected: proposal_expectation(),
            },
        );
        assert_fixed_builder_contract!(
            freeze_proposal_v2_instruction,
            FreezeProposalV2Accounts {
                controller_config: 1 => (false, true),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, true),
                proposal: 5 => (false, true),
            },
            FreezeProposalV2 {
                expected: proposal_expectation(),
                expected_next_gate_epoch: 125,
            },
        );
        assert_fixed_builder_contract!(
            cancel_proposal_v2_instruction,
            CancelProposalV2Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, false),
                proposal: 5 => (false, true),
                seat_authority: 6 => (true, false),
            },
            CancelProposalV2 {
                expected: proposal_expectation(),
                expected_cancellation_approval_bitset: 3,
                expected_cancellation_approval_count: 2,
                cancellation_reason_code: 126,
            },
        );
        assert_fixed_builder_contract!(
            expire_proposal_v2_instruction,
            ExpireProposalV2Accounts {
                controller_config: 1 => (false, false),
                protocol_gate: 2 => (false, false),
                proposal: 3 => (false, true),
            },
            ExpireProposalV2 {
                expected: proposal_expectation(),
            },
        );
        assert_fixed_builder_contract!(
            convert_emergency_freeze_v2_instruction,
            ConvertEmergencyFreezeV2Accounts {
                controller_config: 1 => (false, true),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, true),
                proposal: 5 => (false, true),
            },
            ConvertEmergencyFreezeV2 {
                expected: proposal_expectation(),
                expected_next_gate_epoch: 132,
            },
        );
    }

    #[test]
    fn guardian_and_emergency_builders_freeze_account_order_and_privileges() {
        assert_fixed_builder_contract!(
            guardian_freeze_v1_instruction,
            GuardianFreezeV1Accounts {
                controller_config: 1 => (false, false),
                protocol_gate: 2 => (false, true),
                target_program: 3 => (false, false),
                target_programdata: 4 => (false, false),
                upgradeable_loader: 5 => (false, false),
                authority_pda: 6 => (false, false),
                guardian: 7 => (true, false),
            },
            guardian_freeze(),
        );
        assert_fixed_builder_contract!(
            create_emergency_resolution_v1_instruction,
            CreateEmergencyResolutionV1Accounts {
                payer: 1 => (true, true),
                creator_seat_authority: 2 => (true, false),
                controller_config: 3 => (false, false),
                policy: 4 => (false, false),
                council: 5 => (false, false),
                protocol_gate: 6 => (false, false),
                target_program: 7 => (false, false),
                target_programdata: 8 => (false, false),
                upgradeable_loader: 9 => (false, false),
                authority_pda: 10 => (false, false),
                emergency_resolution: 11 => (false, true),
                system_program: 12 => (false, false),
            },
            create_emergency_resolution(),
        );
        assert_fixed_builder_contract!(
            approve_emergency_resolution_v1_instruction,
            ApproveEmergencyResolutionV1Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, false),
                emergency_resolution: 5 => (false, true),
                seat_authority: 6 => (true, false),
            },
            ApproveEmergencyResolutionV1 {
                expected: emergency_expectation(),
                expected_approval_bitset: 1,
                expected_approval_count: 1,
            },
        );
        assert_fixed_builder_contract!(
            queue_emergency_resolution_v1_instruction,
            QueueEmergencyResolutionV1Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, false),
                emergency_resolution: 5 => (false, true),
            },
            QueueEmergencyResolutionV1 {
                expected: emergency_expectation(),
                expected_approval_bitset: 7,
                expected_approval_count: 3,
            },
        );
        assert_fixed_builder_contract!(
            execute_emergency_resolution_v1_instruction,
            ExecuteEmergencyResolutionV1Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, true),
                emergency_resolution: 5 => (false, true),
                emergency_checkpoint: 6 => (false, false),
                target_program: 7 => (false, false),
                target_programdata: 8 => (false, false),
                upgradeable_loader: 9 => (false, false),
                authority_pda: 10 => (false, false),
            },
            ExecuteEmergencyResolutionV1 {
                expected: emergency_expectation(),
                expected_checkpoint_digest: bytes(127),
                expected_programdata_slot: 128,
                expected_payload_hash: bytes(129),
                expected_raw_programdata_hash: bytes(130),
                expected_capacity: 131,
            },
        );
        assert_fixed_builder_contract!(
            expire_emergency_resolution_v1_instruction,
            ExpireEmergencyResolutionV1Accounts {
                controller_config: 1 => (false, false),
                protocol_gate: 2 => (false, false),
                emergency_resolution: 3 => (false, true),
            },
            ExpireEmergencyResolutionV1 {
                expected: emergency_expectation(),
            },
        );
    }

    #[test]
    fn checkpoint_builders_freeze_account_order_and_phase_privileges() {
        assert_fixed_builder_contract!(
            bind_checkpoint_v1_instruction,
            BindCheckpointV1Accounts {
                payer: 1 => (true, true),
                controller_config: 2 => (false, false),
                protocol_gate: 3 => (false, false),
                subject: 4 => (false, false),
                target_program: 5 => (false, false),
                target_programdata: 6 => (false, false),
                phase_evidence: 7 => (false, false),
                checkpoint: 8 => (false, true),
                system_program: 9 => (false, false),
            },
            bind_checkpoint(),
        );
        assert_fixed_builder_contract!(
            approve_checkpoint_v1_instruction,
            ApproveCheckpointV1Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                council: 3 => (false, false),
                protocol_gate: 4 => (false, false),
                subject: 5 => (false, false),
                checkpoint: 6 => (false, true),
                seat_authority: 7 => (true, false),
            },
            ApproveCheckpointV1 {
                expected: checkpoint_expectation(StateCheckpointPhaseV1::Prestate),
            },
        );

        for (phase, subject_writable) in [
            (StateCheckpointPhaseV1::Prestate, false),
            (StateCheckpointPhaseV1::Poststate, true),
            (StateCheckpointPhaseV1::Emergency, false),
        ] {
            let instruction = FinalizeCheckpointV1 {
                expected: checkpoint_expectation(phase),
            };
            assert_account_contract(
                finalize_checkpoint_v1_instruction(
                    key(250),
                    FinalizeCheckpointV1Accounts {
                        controller_config: key(1),
                        policy: key(2),
                        council: key(3),
                        protocol_gate: key(4),
                        subject: key(5),
                        checkpoint: key(6),
                    },
                    instruction.clone(),
                ),
                instruction.pack().to_vec(),
                &[
                    (1, false, false),
                    (2, false, false),
                    (3, false, false),
                    (4, false, false),
                    (5, false, subject_writable),
                    (6, false, true),
                ],
            );
        }
    }

    #[test]
    fn council_rotation_builders_freeze_account_order_and_privileges() {
        let candidate = create_candidate_council();
        assert_account_contract(
            create_candidate_council_set_v1_instruction(
                key(250),
                CreateCandidateCouncilSetV1Accounts {
                    payer: key(1),
                    creator_seat_authority: key(2),
                    controller_config: key(3),
                    policy: key(4),
                    current_council: key(5),
                    protocol_gate: key(6),
                    candidate_council: key(7),
                    candidate_seat_authorities: [key(8), key(9), key(10), key(11), key(12)],
                    system_program: key(13),
                },
                candidate.clone(),
            ),
            candidate.pack().to_vec(),
            &[
                (1, true, true),
                (2, true, false),
                (3, false, false),
                (4, false, false),
                (5, false, false),
                (6, false, false),
                (7, false, true),
                (8, false, false),
                (9, false, false),
                (10, false, false),
                (11, false, false),
                (12, false, false),
                (13, false, false),
            ],
        );
        assert_fixed_builder_contract!(
            create_council_rotation_v1_instruction,
            CreateCouncilRotationV1Accounts {
                payer: 1 => (true, true),
                creator_seat_authority: 2 => (true, false),
                controller_config: 3 => (false, false),
                policy: 4 => (false, false),
                current_council: 5 => (false, false),
                candidate_council: 6 => (false, false),
                protocol_gate: 7 => (false, false),
                rotation: 8 => (false, true),
                system_program: 9 => (false, false),
            },
            create_council_rotation(),
        );
        assert_fixed_builder_contract!(
            approve_council_rotation_v1_instruction,
            ApproveCouncilRotationV1Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                current_council: 3 => (false, false),
                candidate_council: 4 => (false, false),
                protocol_gate: 5 => (false, false),
                rotation: 6 => (false, true),
                seat_authority: 7 => (true, false),
            },
            ApproveCouncilRotationV1 {
                expected: rotation_expectation(),
                expected_approval_bitset: 1,
                expected_approval_count: 1,
            },
        );
        assert_fixed_builder_contract!(
            queue_council_rotation_v1_instruction,
            QueueCouncilRotationV1Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                current_council: 3 => (false, false),
                candidate_council: 4 => (false, false),
                protocol_gate: 5 => (false, false),
                rotation: 6 => (false, true),
            },
            QueueCouncilRotationV1 {
                expected: rotation_expectation(),
                expected_approval_bitset: 7,
                expected_approval_count: 3,
            },
        );
        assert_fixed_builder_contract!(
            activate_council_rotation_v1_instruction,
            ActivateCouncilRotationV1Accounts {
                controller_config: 1 => (false, true),
                policy: 2 => (false, false),
                current_council: 3 => (false, false),
                candidate_council: 4 => (false, false),
                protocol_gate: 5 => (false, false),
                rotation: 6 => (false, true),
            },
            ActivateCouncilRotationV1 {
                expected: rotation_expectation(),
                expected_approval_bitset: 7,
                expected_approval_count: 3,
            },
        );
        assert_fixed_builder_contract!(
            cancel_council_rotation_v1_instruction,
            CancelCouncilRotationV1Accounts {
                controller_config: 1 => (false, false),
                policy: 2 => (false, false),
                current_council: 3 => (false, false),
                candidate_council: 4 => (false, false),
                protocol_gate: 5 => (false, false),
                rotation: 6 => (false, true),
                seat_authority: 7 => (true, false),
            },
            CancelCouncilRotationV1 {
                expected: rotation_expectation(),
                expected_cancellation_approval_bitset: 3,
                expected_cancellation_approval_count: 2,
                cancellation_reason_code: 125,
            },
        );
        assert_fixed_builder_contract!(
            expire_council_rotation_v1_instruction,
            ExpireCouncilRotationV1Accounts {
                controller_config: 1 => (false, false),
                protocol_gate: 2 => (false, false),
                rotation: 3 => (false, true),
            },
            ExpireCouncilRotationV1 {
                expected: rotation_expectation(),
            },
        );
    }

    const INSTRUCTION_VECTOR_LENGTHS: [usize; 26] = [
        41, 273, 806, 165, 165, 163, 171, 167, 163, 100, 244, 159, 159, 269, 171, 448, 118, 118,
        186, 154, 149, 149, 149, 157, 151, 147,
    ];

    const INSTRUCTION_VECTOR_SHA256: [[u8; 32]; 26] = [
        [
            67, 229, 137, 7, 234, 18, 208, 235, 249, 34, 186, 123, 252, 252, 248, 128, 37, 11, 148,
            213, 209, 252, 248, 179, 110, 22, 193, 10, 118, 234, 77, 95,
        ],
        [
            253, 21, 119, 192, 9, 208, 145, 200, 225, 102, 57, 149, 217, 210, 242, 217, 21, 34, 2,
            207, 228, 120, 227, 40, 67, 178, 80, 56, 13, 10, 243, 51,
        ],
        [
            141, 55, 179, 228, 116, 252, 4, 237, 45, 207, 240, 179, 178, 182, 44, 6, 207, 2, 219,
            3, 20, 195, 242, 99, 119, 39, 23, 64, 167, 42, 170, 169,
        ],
        [
            98, 4, 155, 139, 104, 243, 148, 42, 139, 199, 201, 92, 206, 177, 40, 145, 164, 20, 103,
            253, 243, 58, 249, 189, 106, 35, 11, 241, 127, 91, 68, 19,
        ],
        [
            148, 87, 0, 14, 80, 9, 250, 160, 25, 76, 65, 76, 23, 30, 142, 4, 222, 36, 226, 26, 204,
            93, 196, 253, 26, 74, 114, 86, 145, 4, 227, 107,
        ],
        [
            33, 152, 141, 118, 92, 75, 156, 233, 145, 78, 206, 180, 87, 162, 194, 25, 89, 65, 163,
            144, 58, 240, 254, 250, 173, 3, 230, 29, 12, 3, 201, 34,
        ],
        [
            59, 98, 10, 124, 67, 41, 247, 113, 112, 143, 4, 233, 197, 166, 118, 73, 54, 22, 121,
            253, 147, 140, 6, 120, 98, 24, 158, 21, 195, 254, 30, 86,
        ],
        [
            158, 128, 52, 131, 198, 209, 132, 30, 35, 18, 2, 179, 138, 147, 64, 180, 218, 129, 88,
            244, 26, 119, 251, 240, 50, 180, 40, 145, 207, 217, 206, 250,
        ],
        [
            31, 86, 222, 247, 52, 201, 10, 110, 200, 215, 197, 118, 86, 160, 175, 219, 237, 234,
            159, 15, 2, 211, 13, 191, 86, 242, 200, 237, 124, 250, 204, 142,
        ],
        [
            94, 176, 134, 119, 101, 33, 107, 196, 166, 73, 172, 8, 190, 17, 109, 59, 21, 52, 53,
            75, 194, 67, 63, 147, 144, 53, 190, 4, 203, 226, 36, 59,
        ],
        [
            106, 11, 117, 132, 135, 236, 61, 153, 156, 12, 58, 57, 122, 187, 207, 220, 76, 110, 17,
            64, 75, 85, 236, 30, 60, 15, 128, 37, 187, 66, 15, 173,
        ],
        [
            208, 117, 139, 23, 163, 71, 97, 201, 1, 162, 23, 156, 62, 252, 166, 65, 236, 144, 213,
            235, 153, 173, 246, 18, 125, 183, 110, 94, 56, 184, 143, 63,
        ],
        [
            178, 168, 135, 211, 78, 197, 38, 194, 26, 204, 103, 209, 191, 245, 10, 138, 70, 220,
            117, 18, 19, 77, 162, 37, 203, 164, 115, 188, 115, 245, 43, 221,
        ],
        [
            162, 106, 180, 155, 211, 100, 251, 8, 51, 251, 141, 138, 243, 36, 253, 11, 135, 155,
            174, 157, 64, 131, 105, 49, 114, 134, 142, 66, 27, 34, 16, 248,
        ],
        [
            161, 233, 136, 72, 30, 105, 248, 84, 171, 79, 56, 143, 47, 189, 201, 185, 75, 3, 215,
            71, 4, 127, 208, 254, 157, 246, 10, 228, 164, 39, 123, 76,
        ],
        [
            120, 149, 15, 153, 247, 65, 32, 88, 193, 127, 81, 63, 199, 125, 120, 134, 167, 255,
            195, 175, 155, 142, 220, 202, 51, 111, 12, 205, 76, 3, 53, 27,
        ],
        [
            228, 183, 133, 25, 74, 188, 92, 32, 76, 230, 250, 207, 66, 0, 222, 128, 15, 71, 154,
            191, 33, 166, 23, 142, 105, 19, 213, 15, 62, 153, 92, 154,
        ],
        [
            171, 245, 184, 121, 102, 249, 23, 33, 210, 20, 7, 24, 48, 232, 180, 94, 216, 45, 88,
            211, 242, 98, 139, 144, 223, 245, 142, 25, 231, 121, 158, 232,
        ],
        [
            93, 239, 109, 241, 57, 13, 41, 207, 195, 7, 6, 11, 199, 31, 195, 131, 45, 73, 68, 171,
            214, 195, 219, 174, 14, 210, 25, 90, 36, 68, 149, 216,
        ],
        [
            120, 233, 225, 182, 244, 135, 44, 235, 45, 170, 226, 51, 66, 231, 188, 103, 219, 234,
            217, 156, 215, 117, 160, 65, 191, 190, 56, 84, 228, 59, 246, 65,
        ],
        [
            97, 173, 43, 66, 102, 232, 103, 134, 206, 117, 155, 81, 133, 254, 133, 73, 143, 83, 11,
            42, 206, 52, 136, 227, 38, 187, 220, 189, 47, 191, 8, 185,
        ],
        [
            122, 188, 17, 156, 146, 177, 35, 166, 80, 149, 134, 34, 220, 98, 174, 14, 165, 5, 214,
            24, 29, 89, 193, 112, 146, 160, 98, 3, 130, 55, 161, 229,
        ],
        [
            153, 15, 37, 31, 127, 158, 3, 233, 162, 186, 116, 190, 228, 102, 221, 48, 205, 251,
            121, 139, 121, 231, 53, 26, 16, 223, 14, 154, 103, 32, 233, 150,
        ],
        [
            215, 20, 150, 72, 194, 146, 200, 195, 23, 208, 98, 84, 238, 221, 93, 212, 85, 91, 104,
            205, 114, 93, 212, 141, 245, 130, 236, 77, 18, 215, 232, 137,
        ],
        [
            181, 252, 157, 154, 85, 224, 64, 70, 129, 28, 2, 31, 106, 180, 87, 187, 71, 44, 47,
            253, 233, 229, 112, 41, 246, 170, 23, 211, 204, 196, 254, 180,
        ],
        [
            106, 61, 56, 70, 8, 5, 191, 11, 208, 154, 223, 235, 70, 145, 92, 252, 226, 219, 119,
            153, 242, 24, 191, 249, 211, 187, 215, 63, 55, 140, 201, 217,
        ],
    ];

    #[test]
    fn instruction_wire_vectors_are_frozen() {
        let cases = instruction_cases();
        assert_eq!(cases.len(), INSTRUCTION_VECTOR_LENGTHS.len());
        for (index, (tag, len, packed)) in cases.into_iter().enumerate() {
            assert_eq!(usize::from(tag), index);
            assert_eq!(len, INSTRUCTION_VECTOR_LENGTHS[index]);
            assert_eq!(packed.len(), INSTRUCTION_VECTOR_LENGTHS[index]);
            assert_eq!(hash(&packed).to_bytes(), INSTRUCTION_VECTOR_SHA256[index]);
        }
    }
}
