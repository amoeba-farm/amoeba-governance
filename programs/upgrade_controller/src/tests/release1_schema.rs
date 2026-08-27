use std::{fmt::Debug, fs, path::PathBuf};

use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{hash::hashv, pubkey::Pubkey};

use crate::{
    artifact_merkle::{
        artifact_chunk_count, artifact_chunk_empty_hash, artifact_chunk_leaf_hash,
        artifact_chunk_node_hash, artifact_merkle_proof, artifact_merkle_root,
        verify_artifact_chunk_proof, ARTIFACT_CHUNK_SIZE_16_KIB, ARTIFACT_CHUNK_SIZE_4_KIB,
        ARTIFACT_CHUNK_SIZE_8_KIB, ARTIFACT_MERKLE_SCHEME_ID, ARTIFACT_MERKLE_SCHEME_MATERIAL_V1,
        BENCHMARK_ARTIFACT_CHUNK_SIZE_CANDIDATES_V1, MAX_ARTIFACT_BYTES_V1, MAX_ARTIFACT_CHUNKS_V1,
        MAX_ARTIFACT_PROOF_DEPTH_V1, MAX_SELECTED_ARTIFACT_CHUNKS_V1,
        RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    },
    digest::{
        PROPOSAL_DIGEST_DOMAIN_V1, PROPOSAL_DIGEST_MATERIAL_LEN, PROPOSAL_DIGEST_PREIMAGE_LEN,
    },
    pda::{
        derive_checkpoint_pda, derive_council_rotation_pda, derive_emergency_checkpoint_pda,
        derive_emergency_resolution_pda, derive_programdata_check_pda,
    },
    release1_digest::{
        canonical_council_rotation_digest_material_v1,
        canonical_emergency_resolution_digest_material_v1, canonical_proposal_digest_material_v2,
        canonical_state_checkpoint_digest_material_v1, compute_council_rotation_digest_v1,
        compute_emergency_resolution_digest_v1, compute_proposal_digest_v2,
        compute_state_checkpoint_digest_v1, validate_council_rotation_digest_v1,
        validate_emergency_resolution_digest_v1, validate_proposal_digest_v2,
        validate_state_checkpoint_digest_v1, COUNCIL_ROTATION_DIGEST_DOMAIN_V1,
        COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1, COUNCIL_ROTATION_DIGEST_PREIMAGE_LEN_V1,
        EMERGENCY_RESOLUTION_DIGEST_DOMAIN_V1, EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1,
        EMERGENCY_RESOLUTION_DIGEST_PREIMAGE_LEN_V1, PROPOSAL_DIGEST_DOMAIN_V2,
        PROPOSAL_DIGEST_MATERIAL_LEN_V2, PROPOSAL_DIGEST_PREIMAGE_LEN_V2,
        STATE_CHECKPOINT_DIGEST_DOMAIN_V1, STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1,
        STATE_CHECKPOINT_DIGEST_PREIMAGE_LEN_V1,
    },
    release1_state::{
        buffer_verification_v1_offset, council_rotation_v1_offset, emergency_resolution_v1_offset,
        programdata_verification_v1_offset, state_checkpoint_v1_offset, upgrade_proposal_v2_offset,
        BufferVerificationStatusV1, BufferVerificationV1, CouncilRotationProposalV1,
        CouncilRotationStateV1, EmergencyFreezeResolutionKindV1, EmergencyFreezeResolutionStateV1,
        EmergencyFreezeResolutionV1, ProgramDataVerificationStatusV1, ProgramDataVerificationV1,
        ProposalStateV2, StateCheckpointPhaseV1, StateCheckpointV1, UpgradeProposalV2,
        BUFFER_VERIFICATION_V1_DISCRIMINATOR, COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
        EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR, PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
        RELEASE1_ACCOUNT_VERSION_V1, STATE_CHECKPOINT_V1_DISCRIMINATOR,
        UPGRADE_PROPOSAL_V2_DISCRIMINATOR, VERIFICATION_BITMAP_BYTES_V1,
    },
    state::{
        CheckpointPhaseV1, GateStatusV1, OptionalPubkeyV1, ProposalClassV1, VoteRequirementV1,
        CONTROLLER_CONFIG_RESERVED_LEN, GOVERNANCE_COUNCIL_RESERVED_LEN,
        GOVERNANCE_POLICY_RESERVED_LEN, PROTOCOL_GATE_RESERVED_LEN, UPGRADE_PROPOSAL_RESERVED_LEN,
    },
    GovernanceError,
};

const GOLDEN_PROPOSAL_DIGEST_V2: [u8; 32] = [
    36, 174, 135, 178, 15, 166, 172, 180, 134, 138, 58, 44, 240, 56, 207, 195, 51, 250, 220, 174,
    129, 191, 86, 89, 9, 135, 49, 202, 135, 83, 106, 188,
];
const GOLDEN_CHECKPOINT_DIGEST_V1: [u8; 32] = [
    188, 72, 231, 159, 20, 86, 219, 199, 52, 54, 4, 157, 58, 30, 189, 76, 47, 190, 63, 92, 181, 68,
    208, 44, 111, 208, 5, 123, 247, 61, 70, 13,
];
const GOLDEN_ROTATION_DIGEST_V1: [u8; 32] = [
    80, 42, 91, 12, 11, 163, 126, 169, 171, 2, 216, 13, 214, 217, 11, 147, 147, 103, 234, 82, 191,
    181, 84, 50, 178, 227, 141, 231, 164, 45, 65, 107,
];
const GOLDEN_EMERGENCY_DIGEST_V1: [u8; 32] = [
    203, 149, 255, 79, 73, 92, 187, 96, 140, 11, 233, 38, 19, 85, 187, 143, 199, 154, 204, 81, 180,
    211, 95, 154, 205, 147, 139, 122, 112, 90, 64, 222,
];
const GOLDEN_ARTIFACT_MERKLE_ROOT_V1: [u8; 32] = [
    154, 204, 2, 215, 73, 144, 43, 58, 19, 51, 111, 162, 120, 187, 169, 160, 104, 96, 135, 195,
    230, 106, 224, 42, 172, 8, 222, 123, 30, 10, 171, 170,
];

fn key(value: u8) -> Pubkey {
    Pubkey::new_from_array([value; 32])
}

fn bytes(value: u8) -> [u8; 32] {
    [value; 32]
}

fn artifact(length: usize) -> Vec<u8> {
    (0..length).map(|index| (index % 251) as u8).collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn release1_fixture_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("fixtures")
        .join("upgrade_governance_release1.json")
}

fn complete_bitmap(count: u32) -> [u8; VERIFICATION_BITMAP_BYTES_V1] {
    let mut bitmap = [0u8; VERIFICATION_BITMAP_BYTES_V1];
    for index in 0..count {
        bitmap[(index / 8) as usize] |= 1 << (index % 8);
    }
    bitmap
}

fn sample_proposal(chunk_size: u32) -> Box<UpgradeProposalV2> {
    let artifact = artifact(5_000);
    let chunk_count = artifact_chunk_count(artifact.len() as u64, chunk_size).unwrap();
    let mut proposal = Box::new(UpgradeProposalV2 {
        discriminator: UPGRADE_PROPOSAL_V2_DISCRIMINATOR,
        account_version: 2,
        bump: 201,
        initialized: true,
        proposal_class: ProposalClassV1::RoutineUpgrade,
        state: ProposalStateV2::Draft,
        creation_gate_status: GateStatusV1::Active,
        zero_tail_required: true,
        proposal_flags: 0,
        proposal_id: 7,
        target_nonce: 11,
        creation_slot: 10,
        cluster_domain: bytes(1),
        controller_program: key(2),
        controller_config: key(3),
        protocol_gate: key(4),
        policy_version: 1,
        policy_hash: bytes(5),
        creation_council_version: 1,
        creation_council_hash: bytes(6),
        creation_gate_epoch: 9,
        freeze_gate_epoch: 10,
        target_program: key(7),
        target_programdata: key(8),
        upgradeable_loader: key(9),
        authority_pda: key(10),
        canonical_spill_treasury: key(11),
        buffer_pubkey: key(12),
        buffer_loader_owner: key(9),
        buffer_uploader_authority: key(13),
        buffer_final_authority: key(10),
        buffer_verification: key(14),
        programdata_verification: key(15),
        artifact_length: artifact.len() as u64,
        artifact_sha256: hashv(&[&artifact]).to_bytes(),
        artifact_chunk_merkle_root: artifact_merkle_root(&artifact, chunk_size).unwrap(),
        chunk_hash_domain: ARTIFACT_MERKLE_SCHEME_ID,
        chunk_size,
        chunk_count,
        source_commit_hash: bytes(16),
        source_tree_hash: bytes(17),
        build_input_inventory_hash: bytes(18),
        reproducible_build_receipt_hash: bytes(19),
        package_receipt_hash: bytes(20),
        release_intent_hash: bytes(21),
        expected_execution_pre_payload_hash: bytes(22),
        expected_execution_pre_chunk_root: bytes(23),
        current_raw_programdata_hash: bytes(24),
        deployed_slot: 2,
        current_capacity: 4_096,
        extension_delta: 4_096,
        expected_post_capacity: 8_192,
        prestate_checkpoint: key(25),
        required_poststate_checkpoint: key(26),
        checkpoint_schema_id: bytes(27),
        checkpoint_policy_hash: bytes(28),
        primary_proposal: OptionalPubkeyV1::none(),
        rollback_proposal: OptionalPubkeyV1::some(key(29)).unwrap(),
        rollback_buffer: OptionalPubkeyV1::some(key(30)).unwrap(),
        rollback_artifact_sha256: bytes(31),
        rollback_artifact_chunk_root: bytes(32),
        vote_requirement: VoteRequirementV1::None,
        vote_program: Pubkey::default(),
        vote_result_pda: Pubkey::default(),
        review_start_slot: 20,
        review_end_slot: 30,
        not_before_slot: 40,
        expiry_slot: 50,
        first_approval_slot: 0,
        council_approved_slot: 0,
        governance_satisfied_slot: 0,
        queued_slot: 0,
        frozen_slot: 0,
        extension_executed_slot: 0,
        upgrade_executed_slot: 0,
        programdata_verified_slot: 0,
        poststate_accepted_slot: 0,
        unfreeze_approved_slot: 0,
        terminal_slot: 0,
        council_approval_bitset: 0,
        council_approval_count: 0,
        cancellation_council_version: 0,
        cancellation_council_hash: [0; 32],
        cancellation_approval_bitset: 0,
        cancellation_approval_count: 0,
        unfreeze_council_version: 0,
        unfreeze_council_hash: [0; 32],
        unfreeze_approval_bitset: 0,
        unfreeze_approval_count: 0,
        proposal_digest: [0; 32],
        cancellation_reason_code: 0,
        terminal_reason_code: 0,
        reserved: [0; 146],
    });
    proposal.proposal_digest = compute_proposal_digest_v2(&proposal).unwrap();
    proposal
}

fn sample_buffer_verification() -> Box<BufferVerificationV1> {
    let proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    Box::new(BufferVerificationV1 {
        discriminator: BUFFER_VERIFICATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: 202,
        initialized: true,
        status: BufferVerificationStatusV1::Verified,
        controller_config: proposal.controller_config,
        proposal: key(33),
        upgradeable_loader: proposal.upgradeable_loader,
        buffer: proposal.buffer_pubkey,
        expected_uploader_authority: proposal.buffer_uploader_authority,
        controller_authority: proposal.authority_pda,
        artifact_length: proposal.artifact_length,
        artifact_sha256: proposal.artifact_sha256,
        artifact_chunk_merkle_root: proposal.artifact_chunk_merkle_root,
        chunk_hash_domain: proposal.chunk_hash_domain,
        chunk_size: proposal.chunk_size,
        chunk_count: proposal.chunk_count,
        verified_chunk_bitmap: complete_bitmap(proposal.chunk_count),
        verified_chunk_count: proposal.chunk_count,
        adopted_slot: 21,
        finalized_slot: 22,
        sealed_buffer_header_hash: bytes(34),
        terminal_slot: 0,
        reserved: [0; 72],
    })
}

fn sample_programdata_verification() -> Box<ProgramDataVerificationV1> {
    let proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    let tail_length = proposal.expected_post_capacity - proposal.artifact_length;
    let tail_chunk_count = artifact_chunk_count(tail_length, proposal.chunk_size).unwrap();
    Box::new(ProgramDataVerificationV1 {
        discriminator: PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: 203,
        initialized: true,
        status: ProgramDataVerificationStatusV1::Verified,
        controller_config: proposal.controller_config,
        proposal: key(33),
        target_program: proposal.target_program,
        target_programdata: proposal.target_programdata,
        upgradeable_loader: proposal.upgradeable_loader,
        controller_authority: proposal.authority_pda,
        artifact_length: proposal.artifact_length,
        artifact_sha256: proposal.artifact_sha256,
        artifact_chunk_merkle_root: proposal.artifact_chunk_merkle_root,
        chunk_hash_domain: proposal.chunk_hash_domain,
        chunk_size: proposal.chunk_size,
        payload_chunk_count: proposal.chunk_count,
        verified_payload_chunk_bitmap: complete_bitmap(proposal.chunk_count),
        verified_payload_chunk_count: proposal.chunk_count,
        deployed_slot: 88,
        capacity: proposal.expected_post_capacity,
        tail_length,
        tail_chunk_count,
        verified_tail_chunk_bitmap: complete_bitmap(tail_chunk_count),
        verified_tail_chunk_count: tail_chunk_count,
        raw_programdata_hash: bytes(35),
        zero_tail_verified: true,
        finalized_slot: 89,
        reserved: [0; 119],
    })
}

fn sample_checkpoint() -> Box<StateCheckpointV1> {
    let mut checkpoint = Box::new(StateCheckpointV1 {
        discriminator: STATE_CHECKPOINT_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: 204,
        initialized: true,
        phase: StateCheckpointPhaseV1::Prestate,
        controller_config: key(3),
        proposal: key(33),
        emergency_resolution: Pubkey::default(),
        subject_digest: bytes(36),
        target_program: key(7),
        target_programdata: key(8),
        finalized_observation_slot: 90,
        gate_epoch: 10,
        target_programdata_slot: 2,
        target_payload_commitment: bytes(37),
        target_raw_programdata_commitment: bytes(38),
        target_capacity: 4_096,
        program_owned_state_root: bytes(39),
        program_owned_state_count: 17,
        logical_compressed_state_root: bytes(40),
        logical_compressed_state_count: 19,
        semantic_custody_accounting_root: bytes(41),
        hard_combined_root: bytes(42),
        external_metadata_observation_root: bytes(43),
        external_raw_balance_observation_root: bytes(44),
        schema_identifier: bytes(45),
        admitted_positive_donation_root: bytes(46),
        admitted_positive_donation_count: 1,
        forbidden_drift_count: 0,
        approval_council_version: 2,
        approval_council_hash: bytes(47),
        checkpoint_digest: [0; 32],
        approval_bitset: 0b0_0111,
        approval_count: 3,
        accepted: true,
        accepted_slot: 91,
        reserved: [0; 37],
    });
    checkpoint.checkpoint_digest = compute_state_checkpoint_digest_v1(&checkpoint).unwrap();
    checkpoint
}

fn sample_rotation() -> Box<CouncilRotationProposalV1> {
    let mut rotation = Box::new(CouncilRotationProposalV1 {
        discriminator: COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: 205,
        initialized: true,
        state: CouncilRotationStateV1::Timelocked,
        controller_config: key(3),
        target_program: key(7),
        current_council: key(48),
        current_council_version: 2,
        current_council_hash: bytes(49),
        candidate_council: key(50),
        candidate_council_version: 3,
        candidate_council_hash: bytes(51),
        creation_slot: 100,
        not_before_slot: 120,
        expiry_slot: 140,
        target_nonce: 11,
        approval_bitset: 0b0_0111,
        approval_count: 3,
        cancellation_approval_bitset: 0,
        cancellation_approval_count: 0,
        rotation_digest: [0; 32],
        activated_slot: 0,
        cancellation_reason_code: 0,
        terminal_reason_code: 0,
        reserved: [0; 84],
    });
    rotation.rotation_digest = compute_council_rotation_digest_v1(&rotation).unwrap();
    rotation
}

fn sample_emergency_resolution() -> Box<EmergencyFreezeResolutionV1> {
    let mut resolution = Box::new(EmergencyFreezeResolutionV1 {
        discriminator: EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: 206,
        initialized: true,
        state: EmergencyFreezeResolutionStateV1::Timelocked,
        controller_config: key(3),
        protocol_gate: key(4),
        target_program: key(7),
        target_programdata: key(8),
        frozen_epoch: 12,
        freeze_slot: 150,
        freeze_reason_code: 2,
        resolution_kind: EmergencyFreezeResolutionKindV1::ResumeWithoutUpgrade,
        creation_slot: 151,
        not_before_slot: 170,
        expiry_slot: 190,
        target_nonce: 11,
        observed_programdata_slot: 2,
        observed_payload_hash: bytes(52),
        observed_raw_programdata_hash: bytes(53),
        observed_capacity: 4_096,
        observed_authority: key(10),
        emergency_checkpoint: key(54),
        approval_council_version: 2,
        approval_council_hash: bytes(55),
        approval_bitset: 0b0_0111,
        approval_count: 3,
        resolution_digest: [0; 32],
        executed_slot: 0,
        cancellation_reason_code: 0,
        terminal_reason_code: 0,
        reserved: [0; 91],
    });
    resolution.resolution_digest = compute_emergency_resolution_digest_v1(&resolution).unwrap();
    resolution
}

fn assert_exact_roundtrip<T>(value: &T, expected_len: usize)
where
    T: BorshDeserialize + BorshSerialize + Debug + Eq,
{
    let encoded = value.try_to_vec().unwrap();
    assert_eq!(encoded.len(), expected_len);
    assert_eq!(T::try_from_slice(&encoded).unwrap(), *value);

    let mut trailing = encoded.clone();
    trailing.push(0);
    assert!(T::try_from_slice(&trailing).is_err());
    assert!(T::try_from_slice(&encoded[..encoded.len() - 1]).is_err());
}

#[test]
fn release1_layouts_are_exact_fixed_width_and_roundtrip() {
    let proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    let buffer = sample_buffer_verification();
    let programdata = sample_programdata_verification();
    let checkpoint = sample_checkpoint();
    let rotation = sample_rotation();
    let resolution = sample_emergency_resolution();

    assert_exact_roundtrip(&*proposal, UpgradeProposalV2::LEN);
    assert_exact_roundtrip(&*buffer, BufferVerificationV1::LEN);
    assert_exact_roundtrip(&*programdata, ProgramDataVerificationV1::LEN);
    assert_exact_roundtrip(&*checkpoint, StateCheckpointV1::LEN);
    assert_exact_roundtrip(&*rotation, CouncilRotationProposalV1::LEN);
    assert_exact_roundtrip(&*resolution, EmergencyFreezeResolutionV1::LEN);

    assert_eq!(
        proposal.try_to_vec().unwrap()[upgrade_proposal_v2_offset::STATE],
        0
    );
    assert_eq!(
        &proposal.try_to_vec().unwrap()[upgrade_proposal_v2_offset::PROPOSAL_DIGEST..][..32],
        &proposal.proposal_digest
    );
    assert_eq!(
        buffer.try_to_vec().unwrap()[buffer_verification_v1_offset::STATUS],
        BufferVerificationStatusV1::Verified as u8
    );
    assert_eq!(
        programdata.try_to_vec().unwrap()[programdata_verification_v1_offset::ZERO_TAIL_VERIFIED],
        1
    );
    assert_eq!(
        checkpoint.try_to_vec().unwrap()[state_checkpoint_v1_offset::PHASE],
        StateCheckpointPhaseV1::Prestate as u8
    );
    assert_eq!(
        rotation.try_to_vec().unwrap()[council_rotation_v1_offset::STATE],
        CouncilRotationStateV1::Timelocked as u8
    );
    assert_eq!(
        resolution.try_to_vec().unwrap()[emergency_resolution_v1_offset::RESOLUTION_KIND],
        EmergencyFreezeResolutionKindV1::ResumeWithoutUpgrade as u8
    );
}

#[test]
fn release1_enum_discriminants_are_exhaustive_and_unknown_values_fail() {
    let proposal_states = [
        ProposalStateV2::Draft,
        ProposalStateV2::BufferAdopted,
        ProposalStateV2::BufferVerified,
        ProposalStateV2::CouncilApproved,
        ProposalStateV2::TokenReviewOpen,
        ProposalStateV2::GovernanceSatisfied,
        ProposalStateV2::Timelocked,
        ProposalStateV2::Frozen,
        ProposalStateV2::Extended,
        ProposalStateV2::UpgradeExecuted,
        ProposalStateV2::ProgramDataVerified,
        ProposalStateV2::PoststateAccepted,
        ProposalStateV2::UnfreezeApproved,
        ProposalStateV2::Completed,
        ProposalStateV2::Cancelled,
        ProposalStateV2::Expired,
        ProposalStateV2::SupersededByRollback,
        ProposalStateV2::Retired,
    ];
    for (expected, state) in proposal_states.into_iter().enumerate() {
        assert_eq!(state.try_to_vec().unwrap(), [expected as u8]);
        assert_eq!(
            ProposalStateV2::try_from_slice(&[expected as u8]).unwrap(),
            state
        );
    }
    assert!(ProposalStateV2::try_from_slice(&[18]).is_err());

    let buffer_states = [
        BufferVerificationStatusV1::Adopted,
        BufferVerificationStatusV1::Verifying,
        BufferVerificationStatusV1::Verified,
        BufferVerificationStatusV1::ConsumedByUpgrade,
        BufferVerificationStatusV1::ClosedAbandoned,
    ];
    for (expected, state) in buffer_states.into_iter().enumerate() {
        assert_eq!(state.try_to_vec().unwrap(), [expected as u8]);
        assert_eq!(
            BufferVerificationStatusV1::try_from_slice(&[expected as u8]).unwrap(),
            state
        );
    }
    assert!(BufferVerificationStatusV1::try_from_slice(&[5]).is_err());

    for (expected, state) in [
        CouncilRotationStateV1::Draft,
        CouncilRotationStateV1::CouncilApproved,
        CouncilRotationStateV1::Timelocked,
        CouncilRotationStateV1::Activated,
        CouncilRotationStateV1::Cancelled,
        CouncilRotationStateV1::Expired,
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(state.try_to_vec().unwrap(), [expected as u8]);
    }
    assert!(CouncilRotationStateV1::try_from_slice(&[6]).is_err());

    for (expected, state) in [
        EmergencyFreezeResolutionStateV1::Draft,
        EmergencyFreezeResolutionStateV1::CouncilApproved,
        EmergencyFreezeResolutionStateV1::Timelocked,
        EmergencyFreezeResolutionStateV1::Executed,
        EmergencyFreezeResolutionStateV1::Cancelled,
        EmergencyFreezeResolutionStateV1::Expired,
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(state.try_to_vec().unwrap(), [expected as u8]);
    }
    assert!(EmergencyFreezeResolutionStateV1::try_from_slice(&[6]).is_err());
    assert!(StateCheckpointPhaseV1::try_from_slice(&[3]).is_err());
    assert!(ProgramDataVerificationStatusV1::try_from_slice(&[2]).is_err());
    assert!(EmergencyFreezeResolutionKindV1::try_from_slice(&[1]).is_err());
}

#[test]
fn every_release1_account_rejects_bad_header_reserved_and_enum_bytes() {
    let mut proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    proposal.discriminator[0] ^= 1;
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::InvalidDiscriminator)
    );
    proposal.discriminator = UPGRADE_PROPOSAL_V2_DISCRIMINATOR;
    proposal.account_version = 1;
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::UnsupportedVersion)
    );
    proposal.account_version = 2;
    proposal.initialized = false;
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::Uninitialized)
    );
    proposal.initialized = true;
    proposal.reserved[0] = 1;
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::NonzeroReserved)
    );

    let mut buffer = sample_buffer_verification();
    buffer.reserved[0] = 1;
    assert_eq!(
        buffer.validate_schema(),
        Err(GovernanceError::NonzeroReserved)
    );
    let mut programdata = sample_programdata_verification();
    programdata.reserved[0] = 1;
    assert_eq!(
        programdata.validate_schema(),
        Err(GovernanceError::NonzeroReserved)
    );
    let mut checkpoint = sample_checkpoint();
    checkpoint.reserved[0] = 1;
    assert_eq!(
        checkpoint.validate_schema(),
        Err(GovernanceError::NonzeroReserved)
    );
    let mut rotation = sample_rotation();
    rotation.reserved[0] = 1;
    assert_eq!(
        rotation.validate_schema(),
        Err(GovernanceError::NonzeroReserved)
    );
    let mut resolution = sample_emergency_resolution();
    resolution.reserved[0] = 1;
    assert_eq!(
        resolution.validate_schema(),
        Err(GovernanceError::NonzeroReserved)
    );

    let enum_cases = [
        (
            sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1)
                .try_to_vec()
                .unwrap(),
            upgrade_proposal_v2_offset::STATE,
        ),
        (
            sample_buffer_verification().try_to_vec().unwrap(),
            buffer_verification_v1_offset::STATUS,
        ),
        (
            sample_programdata_verification().try_to_vec().unwrap(),
            programdata_verification_v1_offset::STATUS,
        ),
        (
            sample_checkpoint().try_to_vec().unwrap(),
            state_checkpoint_v1_offset::PHASE,
        ),
        (
            sample_rotation().try_to_vec().unwrap(),
            council_rotation_v1_offset::STATE,
        ),
        (
            sample_emergency_resolution().try_to_vec().unwrap(),
            emergency_resolution_v1_offset::STATE,
        ),
    ];
    for (mut encoded, offset) in enum_cases {
        encoded[offset] = u8::MAX;
        assert!(
            UpgradeProposalV2::try_from_slice(&encoded).is_err()
                && BufferVerificationV1::try_from_slice(&encoded).is_err()
                && ProgramDataVerificationV1::try_from_slice(&encoded).is_err()
                && StateCheckpointV1::try_from_slice(&encoded).is_err()
                && CouncilRotationProposalV1::try_from_slice(&encoded).is_err()
                && EmergencyFreezeResolutionV1::try_from_slice(&encoded).is_err()
        );
    }

    let mut invalid_bool = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1)
        .try_to_vec()
        .unwrap();
    invalid_bool[14] = 2;
    assert!(UpgradeProposalV2::try_from_slice(&invalid_bool).is_err());
}

#[test]
fn schema_validators_enforce_commitments_bitmaps_and_independent_zero_tail() {
    assert_eq!(
        sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1).validate_schema(),
        Ok(())
    );
    for rejected_chunk_size in [ARTIFACT_CHUNK_SIZE_4_KIB, ARTIFACT_CHUNK_SIZE_8_KIB] {
        let mut proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
        proposal.chunk_size = rejected_chunk_size;
        assert_eq!(
            proposal.validate_schema(),
            Err(GovernanceError::InvalidProposalCommitment)
        );
    }
    assert_eq!(sample_buffer_verification().validate_schema(), Ok(()));
    assert_eq!(sample_programdata_verification().validate_schema(), Ok(()));
    assert_eq!(sample_checkpoint().validate_schema(), Ok(()));
    assert_eq!(sample_rotation().validate_schema(), Ok(()));
    assert_eq!(sample_emergency_resolution().validate_schema(), Ok(()));

    let mut proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    proposal.chunk_hash_domain[0] ^= 1;
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::InvalidProposalCommitment)
    );
    let mut proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    proposal.state = ProposalStateV2::TokenReviewOpen;
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );
    let mut proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    proposal.proposal_class = ProposalClassV1::TargetImmutability;
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::UnsupportedProposalClass)
    );

    let mut buffer = sample_buffer_verification();
    buffer.verified_chunk_count -= 1;
    assert_eq!(
        buffer.validate_schema(),
        Err(GovernanceError::InvalidRelease1Bitmap)
    );
    let mut buffer = sample_buffer_verification();
    buffer.verified_chunk_bitmap[VERIFICATION_BITMAP_BYTES_V1 - 1] = 0x80;
    buffer.verified_chunk_count += 1;
    assert_eq!(
        buffer.validate_schema(),
        Err(GovernanceError::InvalidRelease1Bitmap)
    );

    let mut programdata = sample_programdata_verification();
    programdata.verified_tail_chunk_bitmap = [0; VERIFICATION_BITMAP_BYTES_V1];
    programdata.verified_tail_chunk_count = 0;
    assert_eq!(
        programdata.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );
    let mut programdata = sample_programdata_verification();
    programdata.verified_payload_chunk_bitmap = [0; VERIFICATION_BITMAP_BYTES_V1];
    programdata.verified_payload_chunk_count = 0;
    assert_eq!(
        programdata.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );

    let mut checkpoint = sample_checkpoint();
    checkpoint.forbidden_drift_count = 1;
    assert_eq!(
        checkpoint.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );
    let mut checkpoint = sample_checkpoint();
    checkpoint.admitted_positive_donation_count = 0;
    assert_eq!(
        checkpoint.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );

    let mut resolution = sample_emergency_resolution();
    resolution.freeze_reason_code = 1;
    assert_eq!(
        resolution.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );
}

#[test]
fn rollback_shape_and_rotation_safe_current_council_accumulators_are_canonical() {
    let mut rollback = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    rollback.proposal_class = ProposalClassV1::EmergencyRollback;
    rollback.primary_proposal = OptionalPubkeyV1::some(key(93)).unwrap();
    rollback.rollback_proposal = OptionalPubkeyV1::none();
    rollback.rollback_buffer = OptionalPubkeyV1::none();
    rollback.rollback_artifact_sha256 = [0; 32];
    rollback.rollback_artifact_chunk_root = [0; 32];
    rollback.deployed_slot = 0;
    rollback.current_raw_programdata_hash = [0; 32];
    rollback.proposal_digest = compute_proposal_digest_v2(&rollback).unwrap();
    assert_eq!(rollback.validate_schema(), Ok(()));
    assert_eq!(validate_proposal_digest_v2(&rollback), Ok(()));

    let mut checkpoint = sample_checkpoint();
    checkpoint.accepted = false;
    checkpoint.accepted_slot = 0;
    checkpoint.approval_bitset = 0;
    checkpoint.approval_count = 0;
    assert_eq!(
        checkpoint.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );
    checkpoint.approval_council_version = 0;
    checkpoint.approval_council_hash = [0; 32];
    assert_eq!(checkpoint.validate_schema(), Ok(()));
    checkpoint.approval_council_version = 3;
    checkpoint.approval_council_hash = bytes(94);
    checkpoint.approval_bitset = 1;
    checkpoint.approval_count = 1;
    assert_eq!(checkpoint.validate_schema(), Ok(()));

    let mut proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    proposal.unfreeze_council_version = 3;
    proposal.unfreeze_council_hash = bytes(95);
    assert_eq!(
        proposal.validate_schema(),
        Err(GovernanceError::InvalidRelease1Account)
    );
    proposal.unfreeze_approval_bitset = 1;
    proposal.unfreeze_approval_count = 1;
    assert_eq!(proposal.validate_schema(), Ok(()));
}

#[test]
fn digest_domains_lengths_and_inclusion_boundaries_are_exact() {
    assert_eq!(PROPOSAL_DIGEST_DOMAIN_V2.len(), 26);
    assert_eq!(PROPOSAL_DIGEST_MATERIAL_LEN_V2, 1_424);
    assert_eq!(PROPOSAL_DIGEST_PREIMAGE_LEN_V2, 1_450);
    assert_eq!(STATE_CHECKPOINT_DIGEST_DOMAIN_V1.len(), 26);
    assert_eq!(STATE_CHECKPOINT_DIGEST_MATERIAL_LEN_V1, 573);
    assert_eq!(STATE_CHECKPOINT_DIGEST_PREIMAGE_LEN_V1, 599);
    assert_eq!(COUNCIL_ROTATION_DIGEST_DOMAIN_V1.len(), 26);
    assert_eq!(COUNCIL_ROTATION_DIGEST_MATERIAL_LEN_V1, 240);
    assert_eq!(COUNCIL_ROTATION_DIGEST_PREIMAGE_LEN_V1, 266);
    assert_eq!(EMERGENCY_RESOLUTION_DIGEST_DOMAIN_V1.len(), 30);
    assert_eq!(EMERGENCY_RESOLUTION_DIGEST_MATERIAL_LEN_V1, 323);
    assert_eq!(EMERGENCY_RESOLUTION_DIGEST_PREIMAGE_LEN_V1, 353);

    let proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    let checkpoint = sample_checkpoint();
    let rotation = sample_rotation();
    let resolution = sample_emergency_resolution();
    assert_eq!(
        canonical_proposal_digest_material_v2(&proposal)
            .unwrap()
            .len(),
        1_424
    );
    assert_eq!(
        canonical_state_checkpoint_digest_material_v1(&checkpoint)
            .unwrap()
            .len(),
        573
    );
    assert_eq!(
        canonical_council_rotation_digest_material_v1(&rotation)
            .unwrap()
            .len(),
        240
    );
    assert_eq!(
        canonical_emergency_resolution_digest_material_v1(&resolution)
            .unwrap()
            .len(),
        323
    );
    assert_eq!(validate_proposal_digest_v2(&proposal), Ok(()));
    assert_eq!(validate_state_checkpoint_digest_v1(&checkpoint), Ok(()));
    assert_eq!(validate_council_rotation_digest_v1(&rotation), Ok(()));
    assert_eq!(validate_emergency_resolution_digest_v1(&resolution), Ok(()));
    assert_eq!(proposal.proposal_digest, GOLDEN_PROPOSAL_DIGEST_V2);
    assert_eq!(checkpoint.checkpoint_digest, GOLDEN_CHECKPOINT_DIGEST_V1);
    assert_eq!(rotation.rotation_digest, GOLDEN_ROTATION_DIGEST_V1);
    assert_eq!(resolution.resolution_digest, GOLDEN_EMERGENCY_DIGEST_V1);

    let baseline = compute_proposal_digest_v2(&proposal).unwrap();
    let mut changed = proposal.clone();
    changed.proposal_class = ProposalClassV1::EconomicChange;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.creation_gate_status = GateStatusV1::EmergencyFrozen;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.proposal_id += 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.cluster_domain[0] ^= 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.policy_hash[0] ^= 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.creation_council_hash[0] ^= 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.target_program = key(90);
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.buffer_pubkey = key(91);
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.artifact_chunk_merkle_root[0] ^= 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.source_commit_hash[0] ^= 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.current_capacity += 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.checkpoint_policy_hash[0] ^= 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.rollback_artifact_sha256[0] ^= 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);
    let mut changed = proposal.clone();
    changed.review_start_slot += 1;
    assert_ne!(compute_proposal_digest_v2(&changed).unwrap(), baseline);

    let mut mutable_only = proposal.clone();
    mutable_only.state = ProposalStateV2::Completed;
    mutable_only.first_approval_slot = 1;
    mutable_only.terminal_slot = 999;
    mutable_only.council_approval_bitset = 7;
    mutable_only.council_approval_count = 3;
    mutable_only.unfreeze_council_version = 7;
    mutable_only.unfreeze_council_hash = bytes(92);
    mutable_only.unfreeze_approval_bitset = 7;
    mutable_only.unfreeze_approval_count = 3;
    mutable_only.cancellation_reason_code = 4;
    mutable_only.terminal_reason_code = 5;
    mutable_only.proposal_digest = bytes(93);
    mutable_only.bump ^= 1;
    assert_eq!(
        canonical_proposal_digest_material_v2(&mutable_only).unwrap(),
        canonical_proposal_digest_material_v2(&proposal).unwrap()
    );

    let checkpoint_baseline = compute_state_checkpoint_digest_v1(&checkpoint).unwrap();
    let mut changed_checkpoint = checkpoint.clone();
    changed_checkpoint.hard_combined_root[0] ^= 1;
    assert_ne!(
        compute_state_checkpoint_digest_v1(&changed_checkpoint).unwrap(),
        checkpoint_baseline
    );
    let mut mutable_checkpoint = checkpoint.clone();
    mutable_checkpoint.approval_council_version += 1;
    mutable_checkpoint.approval_council_hash[0] ^= 1;
    mutable_checkpoint.approval_bitset = 31;
    mutable_checkpoint.approval_count = 5;
    mutable_checkpoint.accepted_slot += 1;
    mutable_checkpoint.checkpoint_digest[0] ^= 1;
    assert_eq!(
        canonical_state_checkpoint_digest_material_v1(&mutable_checkpoint).unwrap(),
        canonical_state_checkpoint_digest_material_v1(&checkpoint).unwrap()
    );

    let rotation_baseline = compute_council_rotation_digest_v1(&rotation).unwrap();
    let mut changed_rotation = rotation.clone();
    changed_rotation.target_nonce += 1;
    assert_ne!(
        compute_council_rotation_digest_v1(&changed_rotation).unwrap(),
        rotation_baseline
    );
    let mut mutable_rotation = rotation.clone();
    mutable_rotation.state = CouncilRotationStateV1::Activated;
    mutable_rotation.approval_bitset = 31;
    mutable_rotation.approval_count = 5;
    mutable_rotation.activated_slot = 121;
    mutable_rotation.rotation_digest[0] ^= 1;
    assert_eq!(
        canonical_council_rotation_digest_material_v1(&mutable_rotation).unwrap(),
        canonical_council_rotation_digest_material_v1(&rotation).unwrap()
    );

    let resolution_baseline = compute_emergency_resolution_digest_v1(&resolution).unwrap();
    let mut changed_resolution = resolution.clone();
    changed_resolution.observed_raw_programdata_hash[0] ^= 1;
    assert_ne!(
        compute_emergency_resolution_digest_v1(&changed_resolution).unwrap(),
        resolution_baseline
    );
    let mut mutable_resolution = resolution.clone();
    mutable_resolution.state = EmergencyFreezeResolutionStateV1::Executed;
    mutable_resolution.approval_bitset = 31;
    mutable_resolution.approval_count = 5;
    mutable_resolution.executed_slot = 171;
    mutable_resolution.resolution_digest[0] ^= 1;
    assert_eq!(
        canonical_emergency_resolution_digest_material_v1(&mutable_resolution).unwrap(),
        canonical_emergency_resolution_digest_material_v1(&resolution).unwrap()
    );
}

#[test]
fn digest_mismatch_is_rejected_for_each_release1_subject() {
    let mut proposal = sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1);
    proposal.proposal_digest[0] ^= 1;
    assert_eq!(
        validate_proposal_digest_v2(&proposal),
        Err(GovernanceError::Release1DigestMismatch)
    );
    let mut checkpoint = sample_checkpoint();
    checkpoint.checkpoint_digest[0] ^= 1;
    assert_eq!(
        validate_state_checkpoint_digest_v1(&checkpoint),
        Err(GovernanceError::Release1DigestMismatch)
    );
    let mut rotation = sample_rotation();
    rotation.rotation_digest[0] ^= 1;
    assert_eq!(
        validate_council_rotation_digest_v1(&rotation),
        Err(GovernanceError::Release1DigestMismatch)
    );
    let mut resolution = sample_emergency_resolution();
    resolution.resolution_digest[0] ^= 1;
    assert_eq!(
        validate_emergency_resolution_digest_v1(&resolution),
        Err(GovernanceError::Release1DigestMismatch)
    );
}

#[test]
fn merkle_scheme_id_selected_size_padding_and_proofs_are_exact() {
    assert_eq!(ARTIFACT_MERKLE_SCHEME_MATERIAL_V1.len(), 149);
    assert_eq!(
        hashv(&[ARTIFACT_MERKLE_SCHEME_MATERIAL_V1]).to_bytes(),
        ARTIFACT_MERKLE_SCHEME_ID
    );
    assert_eq!(
        BENCHMARK_ARTIFACT_CHUNK_SIZE_CANDIDATES_V1,
        [4_096, 8_192, 16_384]
    );
    assert_eq!(RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 16_384);
    assert_eq!(MAX_ARTIFACT_CHUNKS_V1, 512);
    assert_eq!(MAX_SELECTED_ARTIFACT_CHUNKS_V1, 128);
    assert_eq!(MAX_ARTIFACT_PROOF_DEPTH_V1, 7);

    let chunk_size = RELEASE1_ARTIFACT_CHUNK_SIZE_V1;
    let data = artifact(chunk_size as usize * 2 + 17);
    let root = artifact_merkle_root(&data, chunk_size).unwrap();
    assert_eq!(root, GOLDEN_ARTIFACT_MERKLE_ROOT_V1);
    for index in [0u32, 1, 2] {
        let start = index as usize * chunk_size as usize;
        let end = (start + chunk_size as usize).min(data.len());
        let proof = artifact_merkle_proof(&data, chunk_size, index).unwrap();
        assert_eq!(proof.len(), 2);
        assert_eq!(
            verify_artifact_chunk_proof(
                &root,
                data.len() as u64,
                chunk_size,
                index,
                &data[start..end],
                &proof,
            ),
            Ok(())
        );
    }

    let leaf0 = artifact_chunk_leaf_hash(0, &data[..chunk_size as usize]).unwrap();
    let leaf1 =
        artifact_chunk_leaf_hash(1, &data[chunk_size as usize..chunk_size as usize * 2]).unwrap();
    let leaf2 = artifact_chunk_leaf_hash(2, &data[chunk_size as usize * 2..]).unwrap();
    let empty3 = artifact_chunk_empty_hash(3).unwrap();
    let manual = artifact_chunk_node_hash(
        &artifact_chunk_node_hash(&leaf0, &leaf1),
        &artifact_chunk_node_hash(&leaf2, &empty3),
    );
    assert_eq!(root, manual);

    let last = &data[chunk_size as usize * 2..];
    let proof = artifact_merkle_proof(&data, chunk_size, 2).unwrap();
    let mut wrong_root = root;
    wrong_root[0] ^= 1;
    assert_eq!(
        verify_artifact_chunk_proof(&wrong_root, data.len() as u64, chunk_size, 2, last, &proof,),
        Err(GovernanceError::InvalidMerkleProof)
    );
    let mut wrong_proof = proof.clone();
    wrong_proof[0][0] ^= 1;
    assert_eq!(
        verify_artifact_chunk_proof(&root, data.len() as u64, chunk_size, 2, last, &wrong_proof,),
        Err(GovernanceError::InvalidMerkleProof)
    );
    assert_eq!(
        verify_artifact_chunk_proof(&root, data.len() as u64, chunk_size, 3, last, &proof,),
        Err(GovernanceError::InvalidMerkleProof)
    );
    assert_eq!(
        verify_artifact_chunk_proof(
            &root,
            data.len() as u64,
            chunk_size,
            2,
            &last[..last.len() - 1],
            &proof,
        ),
        Err(GovernanceError::InvalidMerkleProof)
    );
    assert_eq!(
        verify_artifact_chunk_proof(
            &root,
            data.len() as u64,
            chunk_size,
            2,
            last,
            &proof[..proof.len() - 1],
        ),
        Err(GovernanceError::InvalidMerkleProof)
    );

    let one_chunk = artifact(17);
    let root = artifact_merkle_root(&one_chunk, RELEASE1_ARTIFACT_CHUNK_SIZE_V1).unwrap();
    let proof = artifact_merkle_proof(&one_chunk, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 0).unwrap();
    assert!(proof.is_empty());
    assert_eq!(
        verify_artifact_chunk_proof(
            &root,
            one_chunk.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            0,
            &one_chunk,
            &proof,
        ),
        Ok(())
    );
}

#[test]
fn merkle_bounds_cover_the_two_mibibyte_worst_case() {
    assert_eq!(
        artifact_chunk_count(0, RELEASE1_ARTIFACT_CHUNK_SIZE_V1),
        Err(GovernanceError::InvalidMerkleParameters)
    );
    assert_eq!(
        artifact_chunk_count(MAX_ARTIFACT_BYTES_V1 + 1, RELEASE1_ARTIFACT_CHUNK_SIZE_V1,),
        Err(GovernanceError::InvalidMerkleParameters)
    );
    assert_eq!(
        artifact_chunk_count(1, 2_048),
        Err(GovernanceError::InvalidMerkleParameters)
    );
    assert_eq!(
        artifact_chunk_count(MAX_ARTIFACT_BYTES_V1, ARTIFACT_CHUNK_SIZE_4_KIB),
        Err(GovernanceError::InvalidMerkleParameters)
    );
    assert_eq!(
        artifact_chunk_count(MAX_ARTIFACT_BYTES_V1, ARTIFACT_CHUNK_SIZE_8_KIB),
        Err(GovernanceError::InvalidMerkleParameters)
    );
    assert_eq!(
        artifact_chunk_count(MAX_ARTIFACT_BYTES_V1, ARTIFACT_CHUNK_SIZE_16_KIB).unwrap(),
        128
    );
    assert_eq!(
        artifact_chunk_leaf_hash(128, &[1]),
        Err(GovernanceError::InvalidMerkleParameters)
    );

    let data = vec![0x5a; MAX_ARTIFACT_BYTES_V1 as usize];
    let root = artifact_merkle_root(&data, RELEASE1_ARTIFACT_CHUNK_SIZE_V1).unwrap();
    let proof = artifact_merkle_proof(&data, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 127).unwrap();
    assert_eq!(proof.len(), MAX_ARTIFACT_PROOF_DEPTH_V1);
    let start = data.len() - RELEASE1_ARTIFACT_CHUNK_SIZE_V1 as usize;
    assert_eq!(
        verify_artifact_chunk_proof(
            &root,
            data.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            127,
            &data[start..],
            &proof,
        ),
        Ok(())
    );
}

#[test]
fn new_pdas_are_deterministic_separated_and_bind_numeric_seeds() {
    let controller = key(70);
    let target = key(71);
    let proposal = key(72);
    let addresses = [
        derive_programdata_check_pda(&controller, &proposal).0,
        derive_checkpoint_pda(&controller, &proposal, CheckpointPhaseV1::Prestate).0,
        derive_checkpoint_pda(&controller, &proposal, CheckpointPhaseV1::Poststate).0,
        derive_emergency_resolution_pda(&controller, &target, 7).0,
        derive_emergency_checkpoint_pda(&controller, &target, 7).0,
        derive_council_rotation_pda(&controller, &target, 8).0,
    ];
    for (index, address) in addresses.iter().enumerate() {
        assert!(addresses[..index].iter().all(|prior| prior != address));
    }
    assert_ne!(
        derive_emergency_resolution_pda(&controller, &target, 7).0,
        derive_emergency_resolution_pda(&controller, &target, 8).0
    );
    assert_ne!(
        derive_council_rotation_pda(&controller, &target, 8).0,
        derive_council_rotation_pda(&controller, &target, 8u64.swap_bytes()).0
    );
}

#[test]
fn v1_abi_and_digest_constants_remain_frozen() {
    assert_eq!(CONTROLLER_CONFIG_RESERVED_LEN, 28);
    assert_eq!(GOVERNANCE_POLICY_RESERVED_LEN, 21);
    assert_eq!(GOVERNANCE_COUNCIL_RESERVED_LEN, 26);
    assert_eq!(PROTOCOL_GATE_RESERVED_LEN, 2);
    assert_eq!(UPGRADE_PROPOSAL_RESERVED_LEN, 142);
    assert_eq!(PROPOSAL_DIGEST_DOMAIN_V1, b"AMOEBA_UPGRADE_PROPOSAL_V1");
    assert_eq!(PROPOSAL_DIGEST_MATERIAL_LEN, 1_084);
    assert_eq!(PROPOSAL_DIGEST_PREIMAGE_LEN, 1_110);
}

#[test]
fn shared_release1_json_fixture_is_consumed_by_rust_and_cannot_drift() {
    let fixture_text = fs::read_to_string(release1_fixture_path()).expect("read Release 1 fixture");
    let fixture: serde_json::Value =
        serde_json::from_str(&fixture_text).expect("parse Release 1 fixture");
    assert_eq!(fixture["fixture_version"].as_u64(), Some(1));
    assert!(fixture["warning"]
        .as_str()
        .expect("fixture warning")
        .contains("SYNTHETIC NON-PRODUCTION"));

    let fixture_sha256 = fixture["fixture_sha256"].as_str().expect("fixture SHA-256");
    let hash_field = format!("\"fixture_sha256\": \"{fixture_sha256}\"");
    let zeroed_hash_field = format!("\"fixture_sha256\": \"{}\"", "0".repeat(64));
    let canonical_zeroed = fixture_text.replacen(&hash_field, &zeroed_hash_field, 1);
    assert_ne!(canonical_zeroed, fixture_text);
    assert_eq!(
        hex(&hashv(&[canonical_zeroed.as_bytes()]).to_bytes()),
        fixture_sha256
    );

    let account_encodings = [
        (
            "upgrade_proposal_v2",
            sample_proposal(RELEASE1_ARTIFACT_CHUNK_SIZE_V1)
                .try_to_vec()
                .unwrap(),
        ),
        (
            "buffer_verification_v1",
            sample_buffer_verification().try_to_vec().unwrap(),
        ),
        (
            "programdata_verification_v1",
            sample_programdata_verification().try_to_vec().unwrap(),
        ),
        (
            "state_checkpoint_v1",
            sample_checkpoint().try_to_vec().unwrap(),
        ),
        (
            "council_rotation_proposal_v1",
            sample_rotation().try_to_vec().unwrap(),
        ),
        (
            "emergency_freeze_resolution_v1",
            sample_emergency_resolution().try_to_vec().unwrap(),
        ),
    ];
    for (name, encoded) in account_encodings {
        let vector = &fixture["accounts"][name];
        assert_eq!(vector["len"].as_u64(), Some(encoded.len() as u64), "{name}");
        assert_eq!(
            vector["encoded_hex"].as_str(),
            Some(hex(&encoded).as_str()),
            "{name}"
        );
    }

    let digest_vectors = [
        ("upgrade_proposal_v2", GOLDEN_PROPOSAL_DIGEST_V2),
        ("state_checkpoint_v1", GOLDEN_CHECKPOINT_DIGEST_V1),
        ("council_rotation_proposal_v1", GOLDEN_ROTATION_DIGEST_V1),
        ("emergency_freeze_resolution_v1", GOLDEN_EMERGENCY_DIGEST_V1),
    ];
    for (name, digest) in digest_vectors {
        assert_eq!(
            fixture["accounts"][name]["digest"]["sha256_hex"].as_str(),
            Some(hex(&digest).as_str()),
            "{name}"
        );
    }
    assert_eq!(
        fixture["merkle"]["root_sha256_hex"].as_str(),
        Some(hex(&GOLDEN_ARTIFACT_MERKLE_ROOT_V1).as_str())
    );

    let v1_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("fixtures")
        .join("upgrade_governance_v1.json");
    let v1_bytes = fs::read(v1_path).expect("read V1 fixture");
    assert_eq!(
        fixture["v1_regression"]["fixture_sha256"].as_str(),
        Some(hex(&hashv(&[&v1_bytes]).to_bytes()).as_str())
    );
}
