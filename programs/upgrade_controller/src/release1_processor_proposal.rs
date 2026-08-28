//! Release 1 proposal, freeze, and emergency-resolution processors.
//!
//! This module deliberately contains no loader mutation.  It validates the
//! current loader graph read-only, prepares exact fixed-width account bytes off
//! account borrows, and commits only after every fallible validation succeeds.

use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    hash::hashv,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::{instructions, Sysvar},
};
use solana_sdk_ids::{compute_budget, system_program, sysvar as sysvar_ids};

use crate::{
    artifact_merkle::{
        artifact_chunk_count, ARTIFACT_MERKLE_SCHEME_ID, RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    },
    authorization::validate_seat_authority,
    council::{
        record_seat_approval, validate_council_guardian_separation, validate_council_set,
        VALID_APPROVAL_MASK,
    },
    instruction::{
        ApproveEmergencyResolutionV1, ApproveProposalV2, CancelProposalV2,
        ConvertEmergencyFreezeV2, CreateEmergencyResolutionV1, CreateProposalV2,
        EmergencyResolutionExpectationV1, ExecuteEmergencyResolutionV1, ExpireProposalV2,
        FinalizeGovernanceV2, FreezeProposalV2, GuardianFreezeV1, ProposalExpectationV2,
        QueueEmergencyResolutionV1, QueueProposalV2, MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
        MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
    },
    pda::{
        derive_authority_pda, derive_buffer_check_pda, derive_checkpoint_pda,
        derive_controller_config_pda, derive_council_pda, derive_emergency_checkpoint_pda,
        derive_emergency_freeze_observation_pda, derive_emergency_resolution_pda, derive_gate_pda,
        derive_policy_pda, derive_programdata_check_pda, derive_proposal_pda,
        derive_upgradeable_programdata_address, EMERGENCY_FREEZE_OBSERVATION_SEED,
        EMERGENCY_RESOLUTION_SEED, PROPOSAL_SEED, UPGRADEABLE_LOADER_ID, UPGRADE_SEED_DOMAIN_V1,
    },
    policy::validate_policy_against_config,
    release1_account_io::{
        create_fixed_pda_account, encode_fixed_account, load_fixed_controller_account,
        require_distinct_accounts, store_fixed_controller_account, validate_exact_privileges,
    },
    release1_digest::{
        compute_emergency_freeze_observation_digest_v1, compute_emergency_resolution_digest_v1,
        compute_proposal_digest_v2, validate_emergency_freeze_observation_digest_v1,
        validate_emergency_resolution_digest_v1, validate_proposal_digest_v2,
        validate_state_checkpoint_digest_v1,
    },
    release1_loader_accounts::{
        loader_account_data_hash, parse_upgradeable_program, parse_upgradeable_programdata,
        validate_buffer_account, validate_program_programdata_linkage, LOADER_BUFFER_METADATA_LEN,
    },
    release1_state::{
        BufferVerificationStatusV1, BufferVerificationV1, EmergencyFreezeObservationV1,
        EmergencyFreezeResolutionKindV1, EmergencyFreezeResolutionStateV1,
        EmergencyFreezeResolutionV1, ProposalStateV2, StateCheckpointPhaseV1, StateCheckpointV1,
        UpgradeProposalV2, ACCOUNT_VERSION_V2, BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
        EMERGENCY_FREEZE_OBSERVATION_V1_DISCRIMINATOR,
        EMERGENCY_FREEZE_OBSERVATION_V1_RESERVED_LEN, EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
        EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN,
        EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V1,
        MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1, PROPOSAL_EXPIRED_TERMINAL_REASON_V1,
        RELEASE1_ACCOUNT_VERSION_V1, RELEASE1_APPROVAL_THRESHOLD,
        UPGRADE_PROPOSAL_V2_DISCRIMINATOR, UPGRADE_PROPOSAL_V2_RESERVED_LEN,
    },
    state::{
        CheckpointPhaseV1, ControllerConfigV1, GateStatusV1, GovernanceCouncilSetV1,
        GovernancePolicyV1, OptionalPubkeyV1, ProposalClassV1, ProtocolGateV1, VoteRequirementV1,
    },
    GovernanceError, GovernanceResult,
};

/// Canonical reason used only for a council-approved proposal freeze.  The
/// bootstrap reason remains 1 and guardian reasons are carried verbatim.
pub const GOVERNED_UPGRADE_FREEZE_REASON_V1: u16 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProgramDataSnapshotV1 {
    deployed_slot: u64,
    capacity: u64,
    raw_hash: [u8; 32],
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RuntimeObservationV1 {
    program_owner: Pubkey,
    program_executable: bool,
    program_data_length: u64,
    program_header_present: bool,
    linked_programdata: OptionalPubkeyV1,
    programdata_owner: Pubkey,
    programdata_executable: bool,
    programdata_data_length: u64,
    programdata_header_present: bool,
    programdata_slot: u64,
    raw_hash_complete: bool,
    raw_programdata_hash: [u8; 32],
    capacity: u64,
    authority: OptionalPubkeyV1,
}

pub fn process_create_proposal_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateProposalV2,
) -> ProgramResult {
    let [payer, creator, config_info, policy_info, council_info, gate_info, target_program, target_programdata, loader, authority, spill, buffer, uploader, proposal_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };

    validate_exact_privileges(payer, true, true, false)?;
    validate_seat_authority(creator)?;
    // Proposal creation atomically consumes `next_proposal_id`; the config is
    // therefore writable in both the frozen instruction ABI and the processor
    // contract. Requiring it read-only would make the typed builder
    // unexecutable and was caught by the real ProgramTest lifecycle.
    validate_exact_privileges(config_info, true, false, false)?;
    for account in [
        policy_info,
        council_info,
        gate_info,
        authority,
        spill,
        buffer,
        uploader,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(target_programdata, false, false, false)?;
    validate_exact_privileges(loader, false, false, true)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        creator,
        config_info,
        policy_info,
        council_info,
        gate_info,
        target_program,
        target_programdata,
        loader,
        authority,
        spill,
        buffer,
        uploader,
        proposal_info,
        system_program_info,
    ])?;

    let mut config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    reject_guardian_authority(&config, creator.key)?;
    require_active_seat(&council, creator.key, slot)?;
    if instruction.creation_slot != slot
        || instruction.expected_proposal_id != config.next_proposal_id
        || instruction.expected_target_nonce != config.target_nonce
        || instruction.expected_policy_version != policy.version
        || instruction.expected_policy_hash != policy.policy_hash
        || instruction.expected_creation_council_version != council.version
        || instruction.expected_creation_council_hash != council.set_hash
        || instruction.creation_gate_status != gate.status
        || instruction.expected_creation_gate_epoch != gate.epoch
        || instruction.expected_freeze_gate_epoch != 0
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if gate.status == GateStatusV1::FrozenForUpgrade
        || gate.status == GateStatusV1::EmergencyFrozen
            && gate.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
    {
        return Err(GovernanceError::InvalidGateState.into());
    }

    validate_loader_identity(loader, &config)?;
    if *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *authority.key != config.authority_pda
        || *spill.key != config.canonical_spill_treasury
        || *system_program_info.key != system_program::ID
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let live = read_canonical_programdata_snapshot(
        target_program,
        target_programdata,
        &config,
        Some(config.authority_pda),
    )?;
    let buffer_header = validate_buffer_account(buffer, &config.upgradeable_loader)?;
    if buffer_header.authority != Some(*uploader.key)
        || *uploader.key == Pubkey::default()
        || u64::try_from(buffer_header.payload_length)
            .map_err(|_| GovernanceError::ArithmeticOverflow)?
            != instruction.artifact_length
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let (expected_proposal, proposal_bump) =
        derive_proposal_pda(program_id, &config.target_program, config.next_proposal_id);
    if *proposal_info.key != expected_proposal {
        return Err(GovernanceError::InvalidPda.into());
    }
    let (review_start_slot, review_end_slot, not_before_slot, expiry_slot) =
        derive_proposal_timing(&config, instruction.proposal_class, slot)?;
    if instruction.review_start_slot != review_start_slot
        || instruction.review_end_slot != review_end_slot
        || instruction.not_before_slot != not_before_slot
        || instruction.expiry_slot != expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }

    let primary_proposal = optional_pubkey(instruction.primary_proposal.value())?;
    let rollback_proposal = optional_pubkey(instruction.rollback_proposal.value())?;
    let rollback_buffer = optional_pubkey(instruction.rollback_buffer.value())?;
    let chunk_count =
        artifact_chunk_count(instruction.artifact_length, RELEASE1_ARTIFACT_CHUNK_SIZE_V1)?;
    let (prestate_checkpoint, _) =
        derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Prestate);
    let (poststate_checkpoint, _) =
        derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Poststate);
    let rollback_class = instruction.proposal_class == ProposalClassV1::EmergencyRollback;
    if (!rollback_class
        && (instruction.deployed_slot != live.deployed_slot
            || instruction.current_raw_programdata_hash != live.raw_hash
            || instruction.current_capacity != live.capacity))
        || (rollback_class
            && (instruction.deployed_slot != 0
                || instruction.current_raw_programdata_hash != [0; 32]))
    {
        return Err(GovernanceError::InvalidProposalCommitment.into());
    }

    let proposal = UpgradeProposalV2 {
        discriminator: UPGRADE_PROPOSAL_V2_DISCRIMINATOR,
        account_version: ACCOUNT_VERSION_V2,
        bump: proposal_bump,
        initialized: true,
        proposal_class: instruction.proposal_class,
        state: ProposalStateV2::Draft,
        creation_gate_status: instruction.creation_gate_status,
        zero_tail_required: true,
        proposal_flags: 0,
        proposal_id: instruction.expected_proposal_id,
        target_nonce: instruction.expected_target_nonce,
        creation_slot: slot,
        cluster_domain: config.cluster_domain,
        controller_program: *program_id,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        policy_version: policy.version,
        policy_hash: policy.policy_hash,
        creation_council_version: council.version,
        creation_council_hash: council.set_hash,
        creation_gate_epoch: gate.epoch,
        freeze_gate_epoch: 0,
        target_program: config.target_program,
        target_programdata: config.target_programdata,
        upgradeable_loader: config.upgradeable_loader,
        authority_pda: config.authority_pda,
        canonical_spill_treasury: config.canonical_spill_treasury,
        buffer_pubkey: *buffer.key,
        buffer_loader_owner: config.upgradeable_loader,
        buffer_uploader_authority: *uploader.key,
        buffer_final_authority: config.authority_pda,
        buffer_verification: derive_buffer_check_pda(program_id, proposal_info.key).0,
        programdata_verification: derive_programdata_check_pda(program_id, proposal_info.key).0,
        artifact_length: instruction.artifact_length,
        artifact_sha256: instruction.artifact_sha256,
        artifact_chunk_merkle_root: instruction.artifact_chunk_merkle_root,
        chunk_hash_domain: ARTIFACT_MERKLE_SCHEME_ID,
        chunk_size: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
        chunk_count,
        source_commit_hash: instruction.source_commit_hash,
        source_tree_hash: instruction.source_tree_hash,
        build_input_inventory_hash: instruction.build_input_inventory_hash,
        reproducible_build_receipt_hash: instruction.reproducible_build_receipt_hash,
        package_receipt_hash: instruction.package_receipt_hash,
        release_intent_hash: instruction.release_intent_hash,
        expected_execution_pre_payload_hash: instruction.expected_execution_pre_payload_hash,
        expected_execution_pre_chunk_root: instruction.expected_execution_pre_chunk_root,
        current_raw_programdata_hash: instruction.current_raw_programdata_hash,
        deployed_slot: instruction.deployed_slot,
        current_capacity: instruction.current_capacity,
        extension_delta: instruction.extension_delta,
        expected_post_capacity: instruction.expected_post_capacity,
        prestate_checkpoint,
        required_poststate_checkpoint: poststate_checkpoint,
        checkpoint_schema_id: instruction.checkpoint_schema_id,
        checkpoint_policy_hash: instruction.checkpoint_policy_hash,
        primary_proposal,
        rollback_proposal,
        rollback_buffer,
        rollback_artifact_sha256: instruction.rollback_artifact_sha256,
        rollback_artifact_chunk_root: instruction.rollback_artifact_chunk_root,
        vote_requirement: VoteRequirementV1::None,
        vote_program: Pubkey::default(),
        vote_result_pda: Pubkey::default(),
        review_start_slot,
        review_end_slot,
        not_before_slot,
        expiry_slot,
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
        proposal_digest: instruction.expected_proposal_digest,
        cancellation_reason_code: 0,
        terminal_reason_code: 0,
        reserved: [0; UPGRADE_PROPOSAL_V2_RESERVED_LEN],
    };
    validate_proposal_digest_v2(&proposal)?;
    if compute_proposal_digest_v2(&proposal)? != instruction.expected_proposal_digest {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    config.next_proposal_id = config
        .next_proposal_id
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    config.validate_static()?;
    let _proposal_bytes = encode_fixed_account(&proposal, UpgradeProposalV2::LEN)?;
    let _config_bytes = encode_fixed_account(&*config, ControllerConfigV1::LEN)?;

    let proposal_id_bytes = instruction.expected_proposal_id.to_le_bytes();
    let bump_seed = [proposal_bump];
    let signer_seeds: [&[u8]; 5] = [
        UPGRADE_SEED_DOMAIN_V1,
        PROPOSAL_SEED,
        config.target_program.as_ref(),
        &proposal_id_bytes,
        &bump_seed,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        proposal_info,
        system_program_info,
        &Rent::get()?,
        UpgradeProposalV2::LEN,
        &signer_seeds,
    )?;
    store_fixed_controller_account(program_id, proposal_info, &proposal, UpgradeProposalV2::LEN)?;
    store_fixed_controller_account(program_id, config_info, &*config, ControllerConfigV1::LEN)
}

pub fn process_approve_proposal_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveProposalV2,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, proposal_info, seat] = accounts else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, policy_info, council_info, gate_info])?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_seat_authority(seat)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        proposal_info,
        seat,
    ])?;

    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_proposal_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &policy,
        &gate,
        council.version,
        &council.set_hash,
    )?;
    require_creation_gate(&proposal, &config, &gate)?;
    require_approval_window(
        proposal.review_start_slot,
        proposal.review_end_slot,
        proposal.expiry_slot,
        slot,
    )?;
    if proposal.state != ProposalStateV2::BufferVerified
        || proposal.creation_council_version != config.current_council_version
        || proposal.creation_council_version != council.version
        || proposal.creation_council_hash != council.set_hash
        || instruction.expected_approval_bitset != proposal.council_approval_bitset
        || instruction.expected_approval_count != proposal.council_approval_count
        || proposal.council_approval_count >= RELEASE1_APPROVAL_THRESHOLD
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let (next_bitset, next_count) = record_seat_approval(
        &council,
        proposal.council_approval_bitset,
        proposal.council_approval_count,
        seat.key,
        slot,
    )?;
    proposal.council_approval_bitset = next_bitset;
    proposal.council_approval_count = next_count;
    if proposal.first_approval_slot == 0 {
        proposal.first_approval_slot = slot;
    }
    if next_count == RELEASE1_APPROVAL_THRESHOLD {
        proposal.state = ProposalStateV2::CouncilApproved;
        proposal.council_approved_slot = slot;
    }
    validate_proposal_digest_v2(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV2::LEN,
    )
}

pub fn process_finalize_governance_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FinalizeGovernanceV2,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, proposal_info] = accounts else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, policy_info, council_info, gate_info])?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        proposal_info,
    ])?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    let council = load_pinned_council(
        program_id,
        council_info,
        config_info,
        &config,
        &policy,
        proposal.creation_council_version,
        &proposal.creation_council_hash,
    )?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_proposal_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &policy,
        &gate,
        council.version,
        &council.set_hash,
    )?;
    require_creation_gate(&proposal, &config, &gate)?;
    if proposal.state != ProposalStateV2::CouncilApproved
        || slot >= proposal.expiry_slot
        || instruction.expected_approval_bitset != proposal.council_approval_bitset
        || instruction.expected_approval_count != proposal.council_approval_count
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_recorded_quorum(
        &council,
        proposal.council_approval_bitset,
        proposal.council_approval_count,
        proposal.council_approved_slot,
    )?;
    proposal.state = ProposalStateV2::GovernanceSatisfied;
    proposal.governance_satisfied_slot = slot;
    validate_proposal_digest_v2(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV2::LEN,
    )
}

pub fn process_queue_proposal_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: QueueProposalV2,
) -> ProgramResult {
    let [config_info, policy_info, gate_info, proposal_info] = accounts else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, policy_info, gate_info])?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    require_distinct_accounts(&[config_info, policy_info, gate_info, proposal_info])?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_proposal_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &policy,
        &gate,
        proposal.creation_council_version,
        &proposal.creation_council_hash,
    )?;
    require_creation_gate(&proposal, &config, &gate)?;
    if proposal.state != ProposalStateV2::GovernanceSatisfied
        || proposal.council_approval_count != RELEASE1_APPROVAL_THRESHOLD
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    verify_exact_proposal_timing(&proposal, &config)?;
    proposal.state = ProposalStateV2::Timelocked;
    proposal.queued_slot = slot;
    validate_proposal_digest_v2(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV2::LEN,
    )
}

pub fn process_freeze_proposal_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FreezeProposalV2,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, proposal_info, target_program, target_programdata, loader, authority, rollback_info, rollback_verification_info, rollback_buffer] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(config_info, true, false, false)?;
    validate_readonly_state_accounts(&[policy_info, council_info])?;
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    for account in [
        target_programdata,
        authority,
        rollback_info,
        rollback_verification_info,
        rollback_buffer,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(loader, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        proposal_info,
        target_program,
        target_programdata,
        loader,
        authority,
        rollback_info,
        rollback_verification_info,
        rollback_buffer,
    ])?;
    freeze_or_convert(
        program_id,
        FreezeInputs {
            config_info,
            policy_info,
            council_info,
            gate_info,
            proposal_info,
            target_program,
            target_programdata,
            loader,
            authority,
            rollback_info,
            rollback_verification_info,
            rollback_buffer,
            emergency_observation: None,
        },
        &instruction.expected,
        instruction.expected_next_gate_epoch,
        None,
    )
}

pub fn process_cancel_proposal_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CancelProposalV2,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, proposal_info, seat] = accounts else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, policy_info, council_info, gate_info])?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_seat_authority(seat)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        proposal_info,
        seat,
    ])?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_proposal_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &policy,
        &gate,
        council.version,
        &council.set_hash,
    )?;
    reject_locked_reciprocal_rollback(&proposal, &config, &gate)?;
    if !is_pre_freeze_state(proposal.state)
        || slot >= proposal.expiry_slot
        || instruction.cancellation_reason_code == 0
        || instruction.expected_cancellation_approval_bitset
            != proposal.cancellation_approval_bitset
        || instruction.expected_cancellation_approval_count != proposal.cancellation_approval_count
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    reject_guardian_authority(&config, seat.key)?;
    let stale_accumulator = proposal.cancellation_approval_count != 0
        && (proposal.cancellation_council_version != council.version
            || proposal.cancellation_council_hash != council.set_hash);
    if stale_accumulator {
        proposal.cancellation_council_version = 0;
        proposal.cancellation_council_hash = [0; 32];
        proposal.cancellation_approval_bitset = 0;
        proposal.cancellation_approval_count = 0;
        proposal.cancellation_reason_code = 0;
    }
    if proposal.cancellation_reason_code != 0
        && proposal.cancellation_reason_code != instruction.cancellation_reason_code
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    if proposal.cancellation_approval_count == 0 {
        proposal.cancellation_council_version = council.version;
        proposal.cancellation_council_hash = council.set_hash;
        proposal.cancellation_reason_code = instruction.cancellation_reason_code;
    }
    let (bitset, count) = record_seat_approval(
        &council,
        proposal.cancellation_approval_bitset,
        proposal.cancellation_approval_count,
        seat.key,
        slot,
    )?;
    proposal.cancellation_approval_bitset = bitset;
    proposal.cancellation_approval_count = count;
    if count == RELEASE1_APPROVAL_THRESHOLD {
        proposal.state = ProposalStateV2::Cancelled;
        proposal.terminal_slot = slot;
        proposal.terminal_reason_code = proposal.cancellation_reason_code;
    }
    validate_proposal_digest_v2(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV2::LEN,
    )
}

pub fn process_expire_proposal_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExpireProposalV2,
) -> ProgramResult {
    let [config_info, gate_info, proposal_info] = accounts else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, gate_info])?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    require_distinct_accounts(&[config_info, gate_info, proposal_info])?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    check_proposal_expectation_without_policy(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal.creation_council_version,
        &proposal.creation_council_hash,
    )?;
    reject_locked_reciprocal_rollback(&proposal, &config, &gate)?;
    let slot = Clock::get()?.slot;
    if !is_pre_freeze_state(proposal.state) || slot < proposal.expiry_slot {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    proposal.state = ProposalStateV2::Expired;
    proposal.terminal_slot = slot;
    proposal.terminal_reason_code = PROPOSAL_EXPIRED_TERMINAL_REASON_V1;
    validate_proposal_digest_v2(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV2::LEN,
    )
}

pub fn process_guardian_freeze_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: GuardianFreezeV1,
) -> ProgramResult {
    let [payer, config_info, gate_info, target_program, target_programdata, loader, authority, guardian, observation_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(payer, true, true, false)?;
    validate_exact_privileges(config_info, false, false, false)?;
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(
        target_program,
        false,
        false,
        instruction.expected_program_executable,
    )?;
    validate_exact_privileges(
        target_programdata,
        false,
        false,
        instruction.expected_programdata_executable,
    )?;
    validate_exact_privileges(loader, false, false, true)?;
    validate_exact_privileges(authority, false, false, false)?;
    validate_exact_privileges(guardian, false, true, false)?;
    validate_exact_privileges(observation_info, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        gate_info,
        target_program,
        target_programdata,
        loader,
        authority,
        guardian,
        observation_info,
        system_program_info,
    ])?;
    let config = load_config(program_id, config_info)?;
    let mut gate = load_gate(program_id, gate_info, config_info, &config)?;
    let slot = Clock::get()?.slot;
    let next_epoch = gate
        .epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if gate.status != GateStatusV1::Active
        || instruction.expected_gate_status != gate.status
        || instruction.expected_gate_epoch != gate.epoch
        || instruction.expected_next_gate_epoch != next_epoch
        || instruction.expected_target_nonce != config.target_nonce
        || instruction.freeze_reason_code == 0
        || instruction.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
        || *guardian.key != config.guardian
        || *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *loader.key != config.upgradeable_loader
        || *authority.key != config.authority_pda
        || *system_program_info.key != system_program::ID
        || slot == 0
    {
        return Err(GovernanceError::InvalidGateState.into());
    }
    validate_loader_identity(loader, &config)?;
    let runtime = capture_runtime_observation(target_program, target_programdata)?;
    compare_guardian_instruction_observation(&instruction, &runtime)?;

    let (expected_observation, observation_bump) =
        derive_emergency_freeze_observation_pda(program_id, &config.target_program, next_epoch);
    if *observation_info.key != expected_observation {
        return Err(GovernanceError::InvalidPda.into());
    }
    let mut observation = EmergencyFreezeObservationV1 {
        discriminator: EMERGENCY_FREEZE_OBSERVATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: observation_bump,
        initialized: true,
        finalized: true,
        controller_program: *program_id,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        target_program: config.target_program,
        target_programdata: config.target_programdata,
        upgradeable_loader: config.upgradeable_loader,
        controller_authority: config.authority_pda,
        frozen_epoch: next_epoch,
        freeze_slot: slot,
        freeze_reason_code: instruction.freeze_reason_code,
        actual_program_owner: runtime.program_owner,
        actual_program_executable: runtime.program_executable,
        actual_program_data_length: runtime.program_data_length,
        program_header_present: runtime.program_header_present,
        actual_linked_programdata: runtime.linked_programdata,
        actual_programdata_owner: runtime.programdata_owner,
        actual_programdata_executable: runtime.programdata_executable,
        actual_programdata_data_length: runtime.programdata_data_length,
        programdata_header_present: runtime.programdata_header_present,
        deployed_programdata_slot: runtime.programdata_slot,
        raw_hash_complete: runtime.raw_hash_complete,
        raw_programdata_sha256: runtime.raw_programdata_hash,
        capacity: runtime.capacity,
        observed_authority: runtime.authority,
        observation_digest: [0; 32],
        finalized_slot: slot,
        reserved: [0; EMERGENCY_FREEZE_OBSERVATION_V1_RESERVED_LEN],
    };
    observation.observation_digest = compute_emergency_freeze_observation_digest_v1(&observation)?;
    if instruction.expected_observation_digest != observation.observation_digest {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_emergency_freeze_observation_digest_v1(&observation)?;
    gate.status = GateStatusV1::EmergencyFrozen;
    gate.epoch = next_epoch;
    gate.active_proposal = Pubkey::default();
    gate.freeze_slot = slot;
    gate.freeze_reason_code = instruction.freeze_reason_code;
    gate.validate_static()?;
    let _observation_bytes = encode_fixed_account(&observation, EmergencyFreezeObservationV1::LEN)?;
    let _gate_bytes = encode_fixed_account(&*gate, ProtocolGateV1::LEN)?;

    let epoch_bytes = next_epoch.to_le_bytes();
    let bump_seed = [observation_bump];
    let signer_seeds: [&[u8]; 5] = [
        UPGRADE_SEED_DOMAIN_V1,
        EMERGENCY_FREEZE_OBSERVATION_SEED,
        config.target_program.as_ref(),
        &epoch_bytes,
        &bump_seed,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        observation_info,
        system_program_info,
        &Rent::get()?,
        EmergencyFreezeObservationV1::LEN,
        &signer_seeds,
    )?;
    store_fixed_controller_account(
        program_id,
        observation_info,
        &observation,
        EmergencyFreezeObservationV1::LEN,
    )?;
    store_fixed_controller_account(program_id, gate_info, &*gate, ProtocolGateV1::LEN)
}

pub fn process_create_emergency_resolution_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateEmergencyResolutionV1,
) -> ProgramResult {
    let [payer, config_info, policy_info, council_info, gate_info, observation_info, resolution_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(payer, true, true, false)?;
    validate_readonly_state_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        observation_info,
    ])?;
    validate_exact_privileges(resolution_info, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        policy_info,
        council_info,
        gate_info,
        observation_info,
        resolution_info,
        system_program_info,
    ])?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let observation = load_emergency_observation(
        program_id,
        observation_info,
        config_info,
        gate_info,
        &config,
        &gate,
    )?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    let not_before_slot = gate
        .freeze_slot
        .checked_add(config.routine_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let expiry_slot = gate
        .freeze_slot
        .checked_add(config.proposal_expiry_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if gate.status != GateStatusV1::EmergencyFrozen
        || gate.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
        || instruction.resolution_kind != EmergencyFreezeResolutionKindV1::ResumeWithoutUpgrade
        || instruction.creation_slot != slot
        || instruction.not_before_slot != not_before_slot
        || instruction.expiry_slot != expiry_slot
        || slot < gate.freeze_slot
        || slot >= expiry_slot
        || instruction.expected_policy_version != policy.version
        || instruction.expected_policy_hash != policy.policy_hash
        || instruction.expected_council_version != council.version
        || instruction.expected_council_hash != council.set_hash
        || instruction.expected_gate_epoch != gate.epoch
        || instruction.expected_freeze_slot != gate.freeze_slot
        || instruction.expected_freeze_reason_code != gate.freeze_reason_code
        || instruction.expected_target_nonce != config.target_nonce
        || instruction.expected_freeze_observation_digest != observation.observation_digest
        || *system_program_info.key != system_program::ID
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    compare_resolution_instruction_observation(&instruction, &observation)?;
    let (expected_resolution, resolution_bump) =
        derive_emergency_resolution_pda(program_id, &config.target_program, gate.epoch);
    if *resolution_info.key != expected_resolution {
        return Err(GovernanceError::InvalidPda.into());
    }
    let mut resolution = EmergencyFreezeResolutionV1 {
        discriminator: EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: resolution_bump,
        initialized: true,
        state: EmergencyFreezeResolutionStateV1::Draft,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        target_program: config.target_program,
        target_programdata: config.target_programdata,
        emergency_freeze_observation: *observation_info.key,
        frozen_epoch: gate.epoch,
        freeze_slot: gate.freeze_slot,
        freeze_reason_code: gate.freeze_reason_code,
        resolution_kind: instruction.resolution_kind,
        creation_slot: slot,
        not_before_slot,
        expiry_slot,
        target_nonce: config.target_nonce,
        observed_program_owner: observation.actual_program_owner,
        observed_program_executable: observation.actual_program_executable,
        observed_program_data_length: observation.actual_program_data_length,
        observed_program_header_present: observation.program_header_present,
        observed_linked_programdata: observation.actual_linked_programdata,
        observed_programdata_owner: observation.actual_programdata_owner,
        observed_programdata_executable: observation.actual_programdata_executable,
        observed_programdata_data_length: observation.actual_programdata_data_length,
        observed_programdata_header_present: observation.programdata_header_present,
        observed_programdata_slot: observation.deployed_programdata_slot,
        observed_raw_hash_complete: observation.raw_hash_complete,
        observed_raw_programdata_hash: observation.raw_programdata_sha256,
        observed_capacity: observation.capacity,
        observed_authority: observation.observed_authority,
        emergency_checkpoint: derive_emergency_checkpoint_pda(
            program_id,
            &config.target_program,
            gate.epoch,
        )
        .0,
        approval_council_version: 0,
        approval_council_hash: [0; 32],
        approval_bitset: 0,
        approval_count: 0,
        resolution_digest: [0; 32],
        executed_slot: 0,
        cancellation_reason_code: 0,
        terminal_reason_code: 0,
        reserved: [0; EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN],
    };
    resolution.resolution_digest = compute_emergency_resolution_digest_v1(&resolution)?;
    if resolution.resolution_digest != instruction.expected_resolution_digest {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_emergency_resolution_digest_v1(&resolution)?;
    let _resolution_bytes = encode_fixed_account(&resolution, EmergencyFreezeResolutionV1::LEN)?;
    let epoch_bytes = gate.epoch.to_le_bytes();
    let bump_seed = [resolution_bump];
    let signer_seeds: [&[u8]; 5] = [
        UPGRADE_SEED_DOMAIN_V1,
        EMERGENCY_RESOLUTION_SEED,
        config.target_program.as_ref(),
        &epoch_bytes,
        &bump_seed,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        resolution_info,
        system_program_info,
        &Rent::get()?,
        EmergencyFreezeResolutionV1::LEN,
        &signer_seeds,
    )?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &resolution,
        EmergencyFreezeResolutionV1::LEN,
    )
}

pub fn process_approve_emergency_resolution_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveEmergencyResolutionV1,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, resolution_info, seat] = accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, policy_info, council_info, gate_info])?;
    validate_exact_privileges(resolution_info, true, false, false)?;
    validate_seat_authority(seat)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        resolution_info,
        seat,
    ])?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut resolution =
        load_resolution(program_id, resolution_info, config_info, gate_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_emergency_expectation(
        &instruction.expected,
        &resolution,
        &config,
        &policy,
        &council,
        &gate,
    )?;
    require_emergency_binding(&resolution, &config, &gate, slot, false)?;
    if slot < resolution.not_before_slot
        || instruction.expected_approval_bitset != resolution.approval_bitset
        || instruction.expected_approval_count != resolution.approval_count
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    reject_guardian_authority(&config, seat.key)?;
    let stale = resolution.approval_count != 0
        && (resolution.approval_council_version != council.version
            || resolution.approval_council_hash != council.set_hash);
    if resolution.state != EmergencyFreezeResolutionStateV1::Draft
        && !(stale
            && matches!(
                resolution.state,
                EmergencyFreezeResolutionStateV1::CouncilApproved
                    | EmergencyFreezeResolutionStateV1::Timelocked
            ))
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    if stale {
        resolution.state = EmergencyFreezeResolutionStateV1::Draft;
        resolution.approval_council_version = 0;
        resolution.approval_council_hash = [0; 32];
        resolution.approval_bitset = 0;
        resolution.approval_count = 0;
    }
    if resolution.approval_count == 0 {
        resolution.approval_council_version = council.version;
        resolution.approval_council_hash = council.set_hash;
    }
    let (bitset, count) = record_seat_approval(
        &council,
        resolution.approval_bitset,
        resolution.approval_count,
        seat.key,
        slot,
    )?;
    resolution.approval_bitset = bitset;
    resolution.approval_count = count;
    if count == RELEASE1_APPROVAL_THRESHOLD {
        resolution.state = EmergencyFreezeResolutionStateV1::CouncilApproved;
    }
    validate_emergency_resolution_digest_v1(&resolution)?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &*resolution,
        EmergencyFreezeResolutionV1::LEN,
    )
}

pub fn process_queue_emergency_resolution_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: QueueEmergencyResolutionV1,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, resolution_info] = accounts else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, policy_info, council_info, gate_info])?;
    validate_exact_privileges(resolution_info, true, false, false)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        resolution_info,
    ])?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut resolution =
        load_resolution(program_id, resolution_info, config_info, gate_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_emergency_expectation(
        &instruction.expected,
        &resolution,
        &config,
        &policy,
        &council,
        &gate,
    )?;
    require_emergency_binding(&resolution, &config, &gate, slot, false)?;
    if resolution.state != EmergencyFreezeResolutionStateV1::CouncilApproved
        || slot < resolution.not_before_slot
        || instruction.expected_approval_bitset != resolution.approval_bitset
        || instruction.expected_approval_count != resolution.approval_count
        || resolution.approval_council_version != council.version
        || resolution.approval_council_hash != council.set_hash
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_recorded_quorum(
        &council,
        resolution.approval_bitset,
        resolution.approval_count,
        slot,
    )?;
    resolution.state = EmergencyFreezeResolutionStateV1::Timelocked;
    validate_emergency_resolution_digest_v1(&resolution)?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &*resolution,
        EmergencyFreezeResolutionV1::LEN,
    )
}

pub fn process_execute_emergency_resolution_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExecuteEmergencyResolutionV1,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, resolution_info, observation_info, checkpoint_info, target_program, target_programdata, loader, authority, instructions_sysvar] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_readonly_state_accounts(&[config_info, policy_info, council_info])?;
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(resolution_info, true, false, false)?;
    for account in [
        observation_info,
        checkpoint_info,
        target_programdata,
        authority,
        instructions_sysvar,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        resolution_info,
        observation_info,
        checkpoint_info,
        target_program,
        target_programdata,
        loader,
        authority,
        instructions_sysvar,
    ])?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let mut gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut resolution =
        load_resolution(program_id, resolution_info, config_info, gate_info, &config)?;
    let observation = load_emergency_observation(
        program_id,
        observation_info,
        config_info,
        gate_info,
        &config,
        &gate,
    )?;
    let checkpoint = load_fixed_controller_account::<StateCheckpointV1>(
        program_id,
        checkpoint_info,
        StateCheckpointV1::LEN,
    )?;
    validate_state_checkpoint_digest_v1(&checkpoint)?;
    let checkpoint_pda =
        derive_emergency_checkpoint_pda(program_id, &config.target_program, gate.epoch);
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_emergency_expectation(
        &instruction.expected,
        &resolution,
        &config,
        &policy,
        &council,
        &gate,
    )?;
    require_emergency_binding(&resolution, &config, &gate, slot, false)?;
    if resolution.state != EmergencyFreezeResolutionStateV1::Timelocked
        || slot < resolution.not_before_slot
        || resolution.approval_council_version != council.version
        || resolution.approval_council_hash != council.set_hash
        || instruction.expected_freeze_observation_digest != observation.observation_digest
        || instruction.expected_checkpoint_digest != checkpoint.checkpoint_digest
        || *checkpoint_info.key != resolution.emergency_checkpoint
        || *checkpoint_info.key != checkpoint_pda.0
        || checkpoint.bump != checkpoint_pda.1
        || checkpoint.phase != StateCheckpointPhaseV1::Emergency
        || checkpoint.proposal != Pubkey::default()
        || checkpoint.emergency_resolution != *resolution_info.key
        || checkpoint.subject_digest != resolution.resolution_digest
        || checkpoint.controller_config != *config_info.key
        || checkpoint.target_program != config.target_program
        || checkpoint.target_programdata != config.target_programdata
        || checkpoint.gate_epoch != gate.epoch
        || !checkpoint.accepted
        || checkpoint.forbidden_drift_count != 0
        || checkpoint.approval_count != RELEASE1_APPROVAL_THRESHOLD
        || checkpoint.finalized_slot > slot
        || checkpoint.finalized_observation_slot < gate.freeze_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_recorded_quorum(
        &council,
        resolution.approval_bitset,
        resolution.approval_count,
        slot,
    )?;
    let runtime = capture_runtime_observation(target_program, target_programdata)?;
    compare_execute_instruction_observation(&instruction, &runtime)?;
    require_resolution_observation_match(&resolution, &observation)?;
    require_canonical_unchanged_runtime(&runtime, &observation, &config)?;
    if checkpoint.target_programdata_slot != runtime.programdata_slot
        // The accepted emergency checkpoint is the council-attested payload
        // audit anchor.  Re-hashing the payload here would make this path take
        // a second full pass over ProgramData.  The mechanical raw-account
        // hash already covers the exact Loader header, payload, and zero tail,
        // so equality with the frozen observation proves that the checkpoint's
        // subject bytes have not changed since the guardian freeze.
        || checkpoint.target_payload_commitment == [0; 32]
        || checkpoint.target_raw_programdata_commitment != runtime.raw_programdata_hash
        || checkpoint.target_capacity != runtime.capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if *loader.key != config.upgradeable_loader
        || *authority.key != config.authority_pda
        || *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_loader_identity(loader, &config)?;
    validate_bounded_emergency_resolution_envelope(
        program_id,
        accounts,
        instructions_sysvar,
        &instruction.pack(),
    )?;
    gate.epoch = gate
        .epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    gate.status = GateStatusV1::Active;
    gate.active_proposal = Pubkey::default();
    gate.freeze_slot = 0;
    gate.freeze_reason_code = 0;
    resolution.state = EmergencyFreezeResolutionStateV1::Executed;
    resolution.executed_slot = slot;
    resolution.terminal_reason_code = EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V1;
    gate.validate_static()?;
    validate_emergency_resolution_digest_v1(&resolution)?;
    let _gate_bytes = encode_fixed_account(&*gate, ProtocolGateV1::LEN)?;
    let _resolution_bytes = encode_fixed_account(&*resolution, EmergencyFreezeResolutionV1::LEN)?;
    store_fixed_controller_account(program_id, gate_info, &*gate, ProtocolGateV1::LEN)?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &*resolution,
        EmergencyFreezeResolutionV1::LEN,
    )
}

pub fn process_convert_emergency_freeze_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ConvertEmergencyFreezeV2,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, proposal_info, observation_info, target_program, target_programdata, loader, authority, rollback_info, rollback_verification_info, rollback_buffer] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(config_info, true, false, false)?;
    validate_readonly_state_accounts(&[policy_info, council_info])?;
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    for account in [
        observation_info,
        target_programdata,
        authority,
        rollback_info,
        rollback_verification_info,
        rollback_buffer,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        proposal_info,
        observation_info,
        target_program,
        target_programdata,
        loader,
        authority,
        rollback_info,
        rollback_verification_info,
        rollback_buffer,
    ])?;
    freeze_or_convert(
        program_id,
        FreezeInputs {
            config_info,
            policy_info,
            council_info,
            gate_info,
            proposal_info,
            target_program,
            target_programdata,
            loader,
            authority,
            rollback_info,
            rollback_verification_info,
            rollback_buffer,
            emergency_observation: Some(observation_info),
        },
        &instruction.expected,
        instruction.expected_next_gate_epoch,
        Some(&instruction.expected_freeze_observation_digest),
    )
}

struct FreezeInputs<'a, 'info> {
    config_info: &'a AccountInfo<'info>,
    policy_info: &'a AccountInfo<'info>,
    council_info: &'a AccountInfo<'info>,
    gate_info: &'a AccountInfo<'info>,
    proposal_info: &'a AccountInfo<'info>,
    target_program: &'a AccountInfo<'info>,
    target_programdata: &'a AccountInfo<'info>,
    loader: &'a AccountInfo<'info>,
    authority: &'a AccountInfo<'info>,
    rollback_info: &'a AccountInfo<'info>,
    rollback_verification_info: &'a AccountInfo<'info>,
    rollback_buffer: &'a AccountInfo<'info>,
    emergency_observation: Option<&'a AccountInfo<'info>>,
}

fn freeze_or_convert(
    program_id: &Pubkey,
    inputs: FreezeInputs<'_, '_>,
    expectation: &ProposalExpectationV2,
    expected_next_epoch: u64,
    expected_observation_digest: Option<&[u8; 32]>,
) -> ProgramResult {
    let mut config = load_config(program_id, inputs.config_info)?;
    let policy = load_policy(program_id, inputs.policy_info, inputs.config_info, &config)?;
    let mut gate = load_gate(program_id, inputs.gate_info, inputs.config_info, &config)?;
    let mut proposal = load_proposal(
        program_id,
        inputs.proposal_info,
        inputs.config_info,
        &config,
    )?;
    let council = load_pinned_council(
        program_id,
        inputs.council_info,
        inputs.config_info,
        &config,
        &policy,
        proposal.creation_council_version,
        &proposal.creation_council_hash,
    )?;
    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    check_proposal_expectation(
        expectation,
        &proposal,
        &config,
        &policy,
        &gate,
        council.version,
        &council.set_hash,
    )?;
    require_creation_gate(&proposal, &config, &gate)?;
    verify_exact_proposal_timing(&proposal, &config)?;
    let (next_target_nonce, next_epoch) = checked_freeze_counters(config.target_nonce, gate.epoch)?;
    if proposal.state != ProposalStateV2::Timelocked
        || proposal.proposal_class == ProposalClassV1::EmergencyRollback
        || slot < proposal.not_before_slot
        || slot >= proposal.expiry_slot
        || expected_next_epoch != next_epoch
        || proposal.council_approval_count != RELEASE1_APPROVAL_THRESHOLD
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_freeze_execution_runway(
        proposal.extension_delta,
        proposal.expiry_slot,
        config.council_review_slots(),
        slot,
    )?;
    require_exact_recorded_quorum(
        &council,
        proposal.council_approval_bitset,
        proposal.council_approval_count,
        proposal.council_approved_slot,
    )?;
    let converting = inputs.emergency_observation.is_some();
    if converting {
        let observation = load_emergency_observation(
            program_id,
            inputs.emergency_observation.expect("checked"),
            inputs.config_info,
            inputs.gate_info,
            &config,
            &gate,
        )?;
        if proposal.creation_gate_status != GateStatusV1::EmergencyFrozen
            || gate.status != GateStatusV1::EmergencyFrozen
            || gate.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
            || expected_observation_digest != Some(&observation.observation_digest)
        {
            return Err(GovernanceError::InvalidGateState.into());
        }
    } else if proposal.creation_gate_status != GateStatusV1::Active
        || gate.status != GateStatusV1::Active
    {
        return Err(GovernanceError::InvalidGateState.into());
    }

    validate_loader_identity(inputs.loader, &config)?;
    if *inputs.target_program.key != config.target_program
        || *inputs.target_programdata.key != config.target_programdata
        || *inputs.authority.key != config.authority_pda
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let live = read_canonical_programdata_snapshot(
        inputs.target_program,
        inputs.target_programdata,
        &config,
        Some(config.authority_pda),
    )?;
    if live.deployed_slot != proposal.deployed_slot
        || live.capacity != proposal.current_capacity
        || live.raw_hash != proposal.current_raw_programdata_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_prepared_rollback(
        program_id,
        &config,
        inputs.proposal_info,
        &proposal,
        inputs.rollback_info,
        inputs.rollback_verification_info,
        inputs.rollback_buffer,
        slot,
    )?;

    config.target_nonce = next_target_nonce;
    gate.epoch = next_epoch;
    gate.status = GateStatusV1::FrozenForUpgrade;
    gate.active_proposal = *inputs.proposal_info.key;
    gate.freeze_slot = slot;
    gate.freeze_reason_code = GOVERNED_UPGRADE_FREEZE_REASON_V1;
    proposal.state = ProposalStateV2::Frozen;
    proposal.freeze_gate_epoch = next_epoch;
    proposal.frozen_slot = slot;
    config.validate_static()?;
    gate.validate_static()?;
    validate_proposal_digest_v2(&proposal)?;
    let _config_bytes = encode_fixed_account(&*config, ControllerConfigV1::LEN)?;
    let _gate_bytes = encode_fixed_account(&*gate, ProtocolGateV1::LEN)?;
    let _proposal_bytes = encode_fixed_account(&*proposal, UpgradeProposalV2::LEN)?;
    store_fixed_controller_account(
        program_id,
        inputs.config_info,
        &*config,
        ControllerConfigV1::LEN,
    )?;
    store_fixed_controller_account(program_id, inputs.gate_info, &*gate, ProtocolGateV1::LEN)?;
    store_fixed_controller_account(
        program_id,
        inputs.proposal_info,
        &*proposal,
        UpgradeProposalV2::LEN,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_prepared_rollback(
    program_id: &Pubkey,
    config: &ControllerConfigV1,
    primary_info: &AccountInfo<'_>,
    primary: &UpgradeProposalV2,
    rollback_info: &AccountInfo<'_>,
    verification_info: &AccountInfo<'_>,
    buffer_info: &AccountInfo<'_>,
    slot: u64,
) -> ProgramResult {
    let rollback = load_fixed_controller_account::<UpgradeProposalV2>(
        program_id,
        rollback_info,
        UpgradeProposalV2::LEN,
    )?;
    validate_proposal_digest_v2(&rollback)?;
    let verification = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        verification_info,
        BufferVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    verify_exact_proposal_timing(&rollback, config)?;
    let rollback_pda =
        derive_proposal_pda(program_id, &config.target_program, rollback.proposal_id);
    let verification_pda = derive_buffer_check_pda(program_id, rollback_info.key);
    if primary.rollback_proposal.value != *rollback_info.key
        || primary.rollback_buffer.value != *buffer_info.key
        || !primary.rollback_proposal.present
        || !primary.rollback_buffer.present
        || rollback_pda.0 != *rollback_info.key
        || rollback.bump != rollback_pda.1
        || rollback.controller_program != *program_id
        || rollback.cluster_domain != config.cluster_domain
        || rollback.policy_version != config.current_policy_version
        || verification_pda.0 != *verification_info.key
        || verification.bump != verification_pda.1
        || rollback.proposal_class != ProposalClassV1::EmergencyRollback
        || rollback.primary_proposal.value != *primary_info.key
        || !rollback.primary_proposal.present
        || rollback.rollback_proposal.present
        || rollback.rollback_buffer.present
        || rollback.state != ProposalStateV2::Timelocked
        || rollback.target_nonce != primary.target_nonce
        || rollback.checkpoint_schema_id != primary.checkpoint_schema_id
        || rollback.checkpoint_policy_hash != primary.checkpoint_policy_hash
        || rollback.controller_config != primary.controller_config
        || rollback.protocol_gate != primary.protocol_gate
        || rollback.target_program != primary.target_program
        || rollback.target_programdata != primary.target_programdata
        || rollback.upgradeable_loader != primary.upgradeable_loader
        || rollback.authority_pda != primary.authority_pda
        || rollback.canonical_spill_treasury != primary.canonical_spill_treasury
        || rollback.buffer_loader_owner != config.upgradeable_loader
        || rollback.buffer_final_authority != config.authority_pda
        || rollback.buffer_pubkey != *buffer_info.key
        || rollback.buffer_verification != *verification_info.key
        || rollback.programdata_verification
            != derive_programdata_check_pda(program_id, rollback_info.key).0
        || rollback.prestate_checkpoint
            != derive_checkpoint_pda(program_id, rollback_info.key, CheckpointPhaseV1::Prestate).0
        || rollback.required_poststate_checkpoint
            != derive_checkpoint_pda(program_id, rollback_info.key, CheckpointPhaseV1::Poststate).0
        || primary.rollback_artifact_sha256 != rollback.artifact_sha256
        || primary.rollback_artifact_chunk_root != rollback.artifact_chunk_merkle_root
        || rollback.expected_execution_pre_chunk_root != primary.artifact_chunk_merkle_root
        || rollback.current_capacity != primary.expected_post_capacity
        || rollback.expected_post_capacity != primary.expected_post_capacity
        || rollback.extension_delta != 0
        || rollback.council_approval_count != RELEASE1_APPROVAL_THRESHOLD
        || rollback.governance_satisfied_slot == 0
        || rollback.queued_slot == 0
        || slot >= rollback.expiry_slot
        || verification.status != BufferVerificationStatusV1::Verified
        || verification.controller_config != primary.controller_config
        || verification.proposal != *rollback_info.key
        || verification.upgradeable_loader != config.upgradeable_loader
        || verification.buffer != *buffer_info.key
        || verification.expected_uploader_authority != rollback.buffer_uploader_authority
        || verification.controller_authority != config.authority_pda
        || verification.artifact_length != rollback.artifact_length
        || verification.artifact_sha256 != rollback.artifact_sha256
        || verification.artifact_chunk_merkle_root != rollback.artifact_chunk_merkle_root
        || verification.chunk_hash_domain != rollback.chunk_hash_domain
        || verification.chunk_size != rollback.chunk_size
        || verification.chunk_count != rollback.chunk_count
        || verification.finalized_slot > slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let rollback_ready = slot
        .checked_add(config.rollback_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let primary_runway = primary
        .expiry_slot
        .checked_add(config.rollback_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if rollback_ready >= rollback.expiry_slot || rollback.expiry_slot <= primary_runway {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let header = validate_buffer_account(buffer_info, &config.upgradeable_loader)?;
    let data = buffer_info.try_borrow_data()?;
    let header_hash = hashv(&[&data[..LOADER_BUFFER_METADATA_LEN]]).to_bytes();
    if header.authority != Some(config.authority_pda)
        || u64::try_from(header.payload_length).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != rollback.artifact_length
        || header_hash != verification.sealed_buffer_header_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

/// A permissionless caller may submit a fully approved freeze, so the
/// controller must not let that caller wait until the last admissible slot and
/// strand the target.  Preserve one complete council-review window for the
/// protected-state checkpoint, one later execution slot, and one additional
/// slot when checked extension is required because extension and upgrade must
/// be strictly separated.
fn require_freeze_execution_runway(
    extension_delta: u64,
    expiry_slot: u64,
    council_review_slots: u64,
    slot: u64,
) -> ProgramResult {
    let execution_slots = if extension_delta == 0 { 1 } else { 2 };
    let last_admissible_freeze_horizon = slot
        .checked_add(council_review_slots)
        .and_then(|value| value.checked_add(execution_slots))
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if last_admissible_freeze_horizon >= expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn load_config(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
) -> Result<Box<ControllerConfigV1>, ProgramError> {
    let config = load_fixed_controller_account::<ControllerConfigV1>(
        program_id,
        config_info,
        ControllerConfigV1::LEN,
    )?;
    config.validate_static()?;
    let expected = derive_controller_config_pda(program_id, &config.target_program);
    if expected.0 != *config_info.key
        || expected.1 != config.bump
        || config.upgradeable_loader != UPGRADEABLE_LOADER_ID
        || derive_upgradeable_programdata_address(&config.target_program).0
            != config.target_programdata
        || derive_authority_pda(program_id, &config.target_program).0 != config.authority_pda
        || derive_gate_pda(program_id, &config.target_program).0 != config.gate_pda
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    Ok(config)
}

fn load_policy(
    program_id: &Pubkey,
    policy_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<GovernancePolicyV1>, ProgramError> {
    let policy = load_fixed_controller_account::<GovernancePolicyV1>(
        program_id,
        policy_info,
        GovernancePolicyV1::LEN,
    )?;
    validate_policy_against_config(&policy, config)?;
    let expected = derive_policy_pda(program_id, &config.target_program, policy.version);
    if expected.0 != *policy_info.key
        || expected.1 != policy.bump
        || policy.controller_config != *config_info.key
        || policy.version != config.current_policy_version
        || policy.target_program != config.target_program
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(policy)
}

fn load_current_council(
    program_id: &Pubkey,
    council_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
) -> Result<Box<GovernanceCouncilSetV1>, ProgramError> {
    load_pinned_council(
        program_id,
        council_info,
        config_info,
        config,
        policy,
        config.current_council_version,
        &[0; 32],
    )
}

fn load_pinned_council(
    program_id: &Pubkey,
    council_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    expected_version: u64,
    expected_hash: &[u8; 32],
) -> Result<Box<GovernanceCouncilSetV1>, ProgramError> {
    let council = load_fixed_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        council_info,
        GovernanceCouncilSetV1::LEN,
    )?;
    validate_council_set(&council, policy)?;
    validate_council_guardian_separation(&council, &config.guardian)?;
    let expected = derive_council_pda(program_id, &config.target_program, council.version);
    if expected.0 != *council_info.key
        || expected.1 != council.bump
        || council.controller_config != *config_info.key
        || council.target_program != config.target_program
        || council.version != expected_version
        || (*expected_hash != [0; 32] && council.set_hash != *expected_hash)
    {
        return Err(GovernanceError::StaleCouncilVersion.into());
    }
    Ok(council)
}

fn load_gate(
    program_id: &Pubkey,
    gate_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<ProtocolGateV1>, ProgramError> {
    let gate = load_fixed_controller_account::<ProtocolGateV1>(
        program_id,
        gate_info,
        ProtocolGateV1::LEN,
    )?;
    gate.validate_static()?;
    let expected = derive_gate_pda(program_id, &config.target_program);
    if expected.0 != *gate_info.key
        || expected.1 != gate.bump
        || *gate_info.key != config.gate_pda
        || gate.controller_config != *config_info.key
        || gate.target_program != config.target_program
        || gate.target_programdata != config.target_programdata
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(gate)
}

fn load_proposal(
    program_id: &Pubkey,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<UpgradeProposalV2>, ProgramError> {
    let proposal = load_fixed_controller_account::<UpgradeProposalV2>(
        program_id,
        proposal_info,
        UpgradeProposalV2::LEN,
    )?;
    validate_proposal_digest_v2(&proposal)?;
    let expected = derive_proposal_pda(program_id, &config.target_program, proposal.proposal_id);
    if expected.0 != *proposal_info.key
        || expected.1 != proposal.bump
        || proposal.controller_program != *program_id
        || proposal.controller_config != *config_info.key
        || proposal.protocol_gate != config.gate_pda
        || proposal.cluster_domain != config.cluster_domain
        || proposal.target_program != config.target_program
        || proposal.target_programdata != config.target_programdata
        || proposal.upgradeable_loader != config.upgradeable_loader
        || proposal.authority_pda != config.authority_pda
        || proposal.canonical_spill_treasury != config.canonical_spill_treasury
        || proposal.policy_version != config.current_policy_version
        || proposal.proposal_id >= config.next_proposal_id
        || proposal.buffer_verification != derive_buffer_check_pda(program_id, proposal_info.key).0
        || proposal.programdata_verification
            != derive_programdata_check_pda(program_id, proposal_info.key).0
        || proposal.prestate_checkpoint
            != derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Prestate).0
        || proposal.required_poststate_checkpoint
            != derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Poststate).0
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    verify_exact_proposal_timing(&proposal, config)?;
    Ok(proposal)
}

fn load_resolution(
    program_id: &Pubkey,
    resolution_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<EmergencyFreezeResolutionV1>, ProgramError> {
    let resolution = load_fixed_controller_account::<EmergencyFreezeResolutionV1>(
        program_id,
        resolution_info,
        EmergencyFreezeResolutionV1::LEN,
    )?;
    validate_emergency_resolution_digest_v1(&resolution)?;
    let expected = derive_emergency_resolution_pda(
        program_id,
        &config.target_program,
        resolution.frozen_epoch,
    );
    if expected.0 != *resolution_info.key
        || expected.1 != resolution.bump
        || resolution.controller_config != *config_info.key
        || resolution.protocol_gate != *gate_info.key
        || resolution.target_program != config.target_program
        || resolution.target_programdata != config.target_programdata
        || resolution.emergency_checkpoint
            != derive_emergency_checkpoint_pda(
                program_id,
                &config.target_program,
                resolution.frozen_epoch,
            )
            .0
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(resolution)
}

fn load_emergency_observation(
    program_id: &Pubkey,
    observation_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> Result<Box<EmergencyFreezeObservationV1>, ProgramError> {
    let observation = load_fixed_controller_account::<EmergencyFreezeObservationV1>(
        program_id,
        observation_info,
        EmergencyFreezeObservationV1::LEN,
    )?;
    validate_emergency_freeze_observation_digest_v1(&observation)?;
    let expected =
        derive_emergency_freeze_observation_pda(program_id, &config.target_program, gate.epoch);
    if expected.0 != *observation_info.key
        || expected.1 != observation.bump
        || observation.controller_program != *program_id
        || observation.controller_config != *config_info.key
        || observation.protocol_gate != *gate_info.key
        || observation.target_program != config.target_program
        || observation.target_programdata != config.target_programdata
        || observation.upgradeable_loader != config.upgradeable_loader
        || observation.controller_authority != config.authority_pda
        || observation.frozen_epoch != gate.epoch
        || observation.freeze_slot != gate.freeze_slot
        || observation.freeze_reason_code != gate.freeze_reason_code
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(observation)
}

fn validate_readonly_state_accounts(accounts: &[&AccountInfo<'_>]) -> ProgramResult {
    for account in accounts {
        validate_exact_privileges(account, false, false, false)?;
    }
    Ok(())
}

fn validate_loader_identity(
    loader: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> ProgramResult {
    if *loader.key != UPGRADEABLE_LOADER_ID || config.upgradeable_loader != UPGRADEABLE_LOADER_ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_policy_active(policy: &GovernancePolicyV1, slot: u64) -> ProgramResult {
    if slot == 0 || slot < policy.activation_slot {
        return Err(GovernanceError::InactivePolicy.into());
    }
    Ok(())
}

fn require_active_seat(
    council: &GovernanceCouncilSetV1,
    authority: &Pubkey,
    slot: u64,
) -> ProgramResult {
    let seat = council
        .seats
        .iter()
        .find(|seat| seat.seat_authority == *authority)
        .ok_or(GovernanceError::UnknownSeatAuthority)?;
    if !council.active_at(slot) || !seat.term_covers(slot) {
        return Err(GovernanceError::InactiveCouncilSeat.into());
    }
    Ok(())
}

fn reject_guardian_authority(config: &ControllerConfigV1, authority: &Pubkey) -> ProgramResult {
    if *authority == config.guardian {
        return Err(GovernanceError::UnknownSeatAuthority.into());
    }
    Ok(())
}

fn require_approval_window(
    review_start_slot: u64,
    review_end_slot: u64,
    expiry_slot: u64,
    slot: u64,
) -> ProgramResult {
    if slot < review_start_slot || slot > review_end_slot || slot >= expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn checked_freeze_counters(target_nonce: u64, gate_epoch: u64) -> GovernanceResult<(u64, u64)> {
    let next_target_nonce = target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let next_gate_epoch = gate_epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    Ok((next_target_nonce, next_gate_epoch))
}

fn require_exact_recorded_quorum(
    council: &GovernanceCouncilSetV1,
    bitset: u8,
    count: u8,
    slot: u64,
) -> ProgramResult {
    if bitset & !VALID_APPROVAL_MASK != 0
        || bitset.count_ones() as u8 != count
        || count != RELEASE1_APPROVAL_THRESHOLD
        || !council.active_at(slot)
    {
        return Err(GovernanceError::QuorumNotSatisfied.into());
    }
    for (index, seat) in council.seats.iter().enumerate() {
        if bitset & (1 << index) != 0 && !seat.term_covers(slot) {
            return Err(GovernanceError::InactiveCouncilSeat.into());
        }
    }
    Ok(())
}

fn derive_proposal_timing(
    config: &ControllerConfigV1,
    class: ProposalClassV1,
    creation_slot: u64,
) -> GovernanceResult<(u64, u64, u64, u64)> {
    let delay = match class {
        ProposalClassV1::EmergencyRollback => config.rollback_delay_slots,
        ProposalClassV1::RoutineUpgrade => config.routine_delay_slots,
        ProposalClassV1::EconomicChange | ProposalClassV1::ConstitutionalChange => {
            config.major_delay_slots
        }
        ProposalClassV1::CouncilSetRotation | ProposalClassV1::TargetImmutability => {
            return Err(GovernanceError::UnsupportedProposalClass)
        }
    };
    let review_start = creation_slot
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let review_end = review_start
        .checked_add(config.council_review_slots())
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let not_before = review_end
        .checked_add(delay)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let expiry = creation_slot
        .checked_add(config.proposal_expiry_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if not_before >= expiry {
        return Err(GovernanceError::InvalidProposalTiming);
    }
    Ok((review_start, review_end, not_before, expiry))
}

fn verify_exact_proposal_timing(
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
) -> ProgramResult {
    let exact = derive_proposal_timing(config, proposal.proposal_class, proposal.creation_slot)?;
    if exact
        != (
            proposal.review_start_slot,
            proposal.review_end_slot,
            proposal.not_before_slot,
            proposal.expiry_slot,
        )
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn check_proposal_expectation(
    expected: &ProposalExpectationV2,
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    gate: &ProtocolGateV1,
    council_version: u64,
    council_hash: &[u8; 32],
) -> ProgramResult {
    if expected.expected_policy_version != policy.version
        || expected.expected_policy_hash != policy.policy_hash
    {
        return Err(GovernanceError::PolicyHashMismatch.into());
    }
    check_proposal_expectation_without_policy(
        expected,
        proposal,
        config,
        gate,
        council_version,
        council_hash,
    )
}

fn check_proposal_expectation_without_policy(
    expected: &ProposalExpectationV2,
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    council_version: u64,
    council_hash: &[u8; 32],
) -> ProgramResult {
    if expected.expected_proposal_digest != proposal.proposal_digest
        || expected.expected_policy_version != proposal.policy_version
        || expected.expected_policy_hash != proposal.policy_hash
        || expected.expected_council_version != council_version
        || expected.expected_council_hash != *council_hash
        || expected.expected_gate_status != gate.status
        || expected.expected_gate_epoch != gate.epoch
        || expected.expected_target_nonce != config.target_nonce
        || expected.expected_state != proposal.state
        || expected.expected_review_start_slot != proposal.review_start_slot
        || expected.expected_review_end_slot != proposal.review_end_slot
        || expected.expected_not_before_slot != proposal.not_before_slot
        || expected.expected_expiry_slot != proposal.expiry_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_creation_gate(
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    require_creation_gate_values(
        proposal.target_nonce,
        proposal.creation_gate_status,
        proposal.creation_gate_epoch,
        config.target_nonce,
        gate.status,
        gate.epoch,
        gate.freeze_reason_code,
    )
}

fn require_creation_gate_values(
    proposal_target_nonce: u64,
    creation_gate_status: GateStatusV1,
    creation_gate_epoch: u64,
    current_target_nonce: u64,
    current_gate_status: GateStatusV1,
    current_gate_epoch: u64,
    current_freeze_reason_code: u16,
) -> ProgramResult {
    if proposal_target_nonce != current_target_nonce
        || creation_gate_status != current_gate_status
        || creation_gate_epoch != current_gate_epoch
        || current_gate_status == GateStatusV1::FrozenForUpgrade
        || current_gate_status == GateStatusV1::EmergencyFrozen
            && current_freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
    {
        return Err(GovernanceError::InvalidProposalEpoch.into());
    }
    Ok(())
}

fn is_pre_freeze_state(state: ProposalStateV2) -> bool {
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

/// A rollback proposal is ordinary pre-freeze state only until its exact
/// linked primary consumes the target nonce and becomes the active frozen
/// proposal. From that point the rollback buffer is a mandatory recovery
/// capability and cannot be cancelled or expired independently.
fn reject_locked_reciprocal_rollback(
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    if proposal.proposal_class != ProposalClassV1::EmergencyRollback {
        return Ok(());
    }
    let consumed_nonce = proposal
        .target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if proposal.primary_proposal.present
        && config.target_nonce == consumed_nonce
        && gate.status == GateStatusV1::FrozenForUpgrade
        && gate.active_proposal == proposal.primary_proposal.value
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    Ok(())
}

fn read_canonical_programdata_snapshot(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    expected_authority: Option<Pubkey>,
) -> Result<ProgramDataSnapshotV1, ProgramError> {
    let header = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    let capacity =
        u64::try_from(header.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    if header.upgrade_authority != expected_authority {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let data = target_programdata.try_borrow_data()?;
    if u64::try_from(data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?
        > MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1
    {
        return Err(GovernanceError::InvalidCapacityPlan.into());
    }
    Ok(ProgramDataSnapshotV1 {
        deployed_slot: header.deployed_slot,
        capacity,
        raw_hash: loader_account_data_hash(&data),
    })
}

fn optional_pubkey(value: Option<Pubkey>) -> GovernanceResult<OptionalPubkeyV1> {
    match value {
        Some(value) => OptionalPubkeyV1::some(value),
        None => Ok(OptionalPubkeyV1::none()),
    }
}

fn capture_runtime_observation(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
) -> Result<RuntimeObservationV1, ProgramError> {
    let program_data = target_program.try_borrow_data()?;
    let program_data_length =
        u64::try_from(program_data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let parsed_program = parse_upgradeable_program(&program_data)
        .ok()
        .and_then(|header| OptionalPubkeyV1::some(header.programdata_address).ok());
    let (program_header_present, linked_programdata) = match parsed_program {
        Some(linked) => (true, linked),
        None => (false, OptionalPubkeyV1::none()),
    };
    drop(program_data);

    let programdata_data = target_programdata.try_borrow_data()?;
    let programdata_data_length =
        u64::try_from(programdata_data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let raw_hash_complete = programdata_data_length <= MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1;
    let raw_programdata_hash = if raw_hash_complete {
        loader_account_data_hash(&programdata_data)
    } else {
        [0; 32]
    };
    let parsed_programdata = parse_upgradeable_programdata(&programdata_data).ok();
    let (programdata_header_present, programdata_slot, capacity, authority) =
        match parsed_programdata {
            Some(header) => (
                true,
                header.deployed_slot,
                u64::try_from(header.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?,
                optional_pubkey(header.upgrade_authority)?,
            ),
            None => (false, 0, 0, OptionalPubkeyV1::none()),
        };
    Ok(RuntimeObservationV1 {
        program_owner: *target_program.owner,
        program_executable: target_program.executable,
        program_data_length,
        program_header_present,
        linked_programdata,
        programdata_owner: *target_programdata.owner,
        programdata_executable: target_programdata.executable,
        programdata_data_length,
        programdata_header_present,
        programdata_slot,
        raw_hash_complete,
        raw_programdata_hash,
        capacity,
        authority,
    })
}

fn compare_guardian_instruction_observation(
    instruction: &GuardianFreezeV1,
    actual: &RuntimeObservationV1,
) -> ProgramResult {
    if instruction.expected_program_owner != actual.program_owner
        || instruction.expected_program_executable != actual.program_executable
        || instruction.expected_program_data_length != actual.program_data_length
        || instruction.expected_program_header_present != actual.program_header_present
        || instruction.expected_linked_programdata.value()
            != linked_value(&actual.linked_programdata)
        || instruction.expected_programdata_owner != actual.programdata_owner
        || instruction.expected_programdata_executable != actual.programdata_executable
        || instruction.expected_programdata_data_length != actual.programdata_data_length
        || instruction.expected_programdata_header_present != actual.programdata_header_present
        || instruction.expected_programdata_slot != actual.programdata_slot
        || instruction.expected_raw_hash_complete != actual.raw_hash_complete
        || instruction.expected_raw_programdata_hash != actual.raw_programdata_hash
        || instruction.expected_capacity != actual.capacity
        || instruction.expected_programdata_authority.value() != linked_value(&actual.authority)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn compare_resolution_instruction_observation(
    instruction: &CreateEmergencyResolutionV1,
    actual: &EmergencyFreezeObservationV1,
) -> ProgramResult {
    if instruction.observed_program_owner != actual.actual_program_owner
        || instruction.observed_program_executable != actual.actual_program_executable
        || instruction.observed_program_data_length != actual.actual_program_data_length
        || instruction.observed_program_header_present != actual.program_header_present
        || instruction.observed_linked_programdata.value()
            != linked_value(&actual.actual_linked_programdata)
        || instruction.observed_programdata_owner != actual.actual_programdata_owner
        || instruction.observed_programdata_executable != actual.actual_programdata_executable
        || instruction.observed_programdata_data_length != actual.actual_programdata_data_length
        || instruction.observed_programdata_header_present != actual.programdata_header_present
        || instruction.observed_programdata_slot != actual.deployed_programdata_slot
        || instruction.observed_raw_hash_complete != actual.raw_hash_complete
        || instruction.observed_raw_programdata_hash != actual.raw_programdata_sha256
        || instruction.observed_capacity != actual.capacity
        || instruction.observed_programdata_authority.value()
            != linked_value(&actual.observed_authority)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn compare_execute_instruction_observation(
    instruction: &ExecuteEmergencyResolutionV1,
    actual: &RuntimeObservationV1,
) -> ProgramResult {
    if instruction.expected_program_owner != actual.program_owner
        || instruction.expected_program_executable != actual.program_executable
        || instruction.expected_program_data_length != actual.program_data_length
        || instruction.expected_program_header_present != actual.program_header_present
        || instruction.expected_linked_programdata.value()
            != linked_value(&actual.linked_programdata)
        || instruction.expected_programdata_owner != actual.programdata_owner
        || instruction.expected_programdata_executable != actual.programdata_executable
        || instruction.expected_programdata_data_length != actual.programdata_data_length
        || instruction.expected_programdata_header_present != actual.programdata_header_present
        || instruction.expected_programdata_slot != actual.programdata_slot
        || instruction.expected_raw_hash_complete != actual.raw_hash_complete
        || instruction.expected_raw_programdata_hash != actual.raw_programdata_hash
        || instruction.expected_capacity != actual.capacity
        || instruction.expected_programdata_authority.value() != linked_value(&actual.authority)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn linked_value(optional: &OptionalPubkeyV1) -> Option<Pubkey> {
    optional.present.then_some(optional.value)
}

fn require_resolution_observation_match(
    resolution: &EmergencyFreezeResolutionV1,
    observation: &EmergencyFreezeObservationV1,
) -> ProgramResult {
    if resolution.emergency_freeze_observation == Pubkey::default()
        || resolution.frozen_epoch != observation.frozen_epoch
        || resolution.freeze_slot != observation.freeze_slot
        || resolution.freeze_reason_code != observation.freeze_reason_code
        || resolution.observed_program_owner != observation.actual_program_owner
        || resolution.observed_program_executable != observation.actual_program_executable
        || resolution.observed_program_data_length != observation.actual_program_data_length
        || resolution.observed_program_header_present != observation.program_header_present
        || resolution.observed_linked_programdata != observation.actual_linked_programdata
        || resolution.observed_programdata_owner != observation.actual_programdata_owner
        || resolution.observed_programdata_executable != observation.actual_programdata_executable
        || resolution.observed_programdata_data_length != observation.actual_programdata_data_length
        || resolution.observed_programdata_header_present != observation.programdata_header_present
        || resolution.observed_programdata_slot != observation.deployed_programdata_slot
        || resolution.observed_raw_hash_complete != observation.raw_hash_complete
        || resolution.observed_raw_programdata_hash != observation.raw_programdata_sha256
        || resolution.observed_capacity != observation.capacity
        || resolution.observed_authority != observation.observed_authority
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_canonical_unchanged_runtime(
    actual: &RuntimeObservationV1,
    frozen: &EmergencyFreezeObservationV1,
    config: &ControllerConfigV1,
) -> ProgramResult {
    if !actual.raw_hash_complete
        || actual.program_owner != UPGRADEABLE_LOADER_ID
        || !actual.program_executable
        || !actual.program_header_present
        || linked_value(&actual.linked_programdata) != Some(config.target_programdata)
        || actual.programdata_owner != UPGRADEABLE_LOADER_ID
        || actual.programdata_executable
        || !actual.programdata_header_present
        || actual.programdata_slot == 0
        || actual.capacity == 0
        || linked_value(&actual.authority) != Some(config.authority_pda)
        || actual.program_owner != frozen.actual_program_owner
        || actual.program_executable != frozen.actual_program_executable
        || actual.program_data_length != frozen.actual_program_data_length
        || actual.program_header_present != frozen.program_header_present
        || linked_value(&actual.linked_programdata)
            != linked_value(&frozen.actual_linked_programdata)
        || actual.programdata_owner != frozen.actual_programdata_owner
        || actual.programdata_executable != frozen.actual_programdata_executable
        || actual.programdata_data_length != frozen.actual_programdata_data_length
        || actual.programdata_header_present != frozen.programdata_header_present
        || actual.programdata_slot != frozen.deployed_programdata_slot
        || actual.raw_hash_complete != frozen.raw_hash_complete
        || actual.raw_programdata_hash != frozen.raw_programdata_sha256
        || actual.capacity != frozen.capacity
        || linked_value(&actual.authority) != linked_value(&frozen.observed_authority)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn check_emergency_expectation(
    expected: &EmergencyResolutionExpectationV1,
    resolution: &EmergencyFreezeResolutionV1,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    council: &GovernanceCouncilSetV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    if expected.expected_policy_version != policy.version
        || expected.expected_policy_hash != policy.policy_hash
        || expected.expected_council_version != council.version
        || expected.expected_council_hash != council.set_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    check_emergency_expectation_without_policy(expected, resolution, config, gate)
}

fn check_emergency_expectation_without_policy(
    expected: &EmergencyResolutionExpectationV1,
    resolution: &EmergencyFreezeResolutionV1,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    if expected.expected_resolution_digest != resolution.resolution_digest
        || expected.expected_gate_status != gate.status
        || expected.expected_gate_epoch != gate.epoch
        || expected.expected_freeze_slot != gate.freeze_slot
        || expected.expected_freeze_reason_code != gate.freeze_reason_code
        || expected.expected_target_nonce != config.target_nonce
        || expected.expected_state != resolution.state
        || expected.expected_not_before_slot != resolution.not_before_slot
        || expected.expected_expiry_slot != resolution.expiry_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_emergency_binding(
    resolution: &EmergencyFreezeResolutionV1,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    slot: u64,
    allow_expired_slot: bool,
) -> ProgramResult {
    if gate.status != GateStatusV1::EmergencyFrozen
        || gate.active_proposal != Pubkey::default()
        || gate.epoch != resolution.frozen_epoch
        || gate.freeze_slot != resolution.freeze_slot
        || gate.freeze_reason_code != resolution.freeze_reason_code
        || gate.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
        || config.target_nonce != resolution.target_nonce
        || (!allow_expired_slot && slot >= resolution.expiry_slot)
    {
        return Err(GovernanceError::InvalidProposalEpoch.into());
    }
    Ok(())
}

/// Admits only the two canonical bounded ComputeBudget instructions followed
/// by the exact emergency-resolution call.  The raw ProgramData hash can use a
/// substantial fraction of the default transaction budget at the Release 1
/// maximum account size, so rejecting ComputeBudget here would make the
/// otherwise valid recovery capability non-executable.
fn validate_bounded_emergency_resolution_envelope(
    program_id: &Pubkey,
    account_infos: &[AccountInfo<'_>],
    instructions_sysvar: &AccountInfo<'_>,
    expected_data: &[u8],
) -> ProgramResult {
    if *instructions_sysvar.key != sysvar_ids::instructions::ID
        || instructions::load_current_index_checked(instructions_sysvar)? != 2
    {
        return Err(GovernanceError::InvalidAccountPrivileges.into());
    }

    let limit = instructions::load_instruction_at_checked(0, instructions_sysvar)?;
    let mut expected_limit_prefix = [0u8; 1];
    expected_limit_prefix[0] = 2;
    if limit.program_id != compute_budget::ID
        || !limit.accounts.is_empty()
        || limit.data.len() != 5
        || limit.data[..1] != expected_limit_prefix
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let mut limit_bytes = [0u8; 4];
    limit_bytes.copy_from_slice(&limit.data[1..]);
    let compute_unit_limit = u32::from_le_bytes(limit_bytes);
    if compute_unit_limit == 0 || compute_unit_limit > MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1 {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let price = instructions::load_instruction_at_checked(1, instructions_sysvar)?;
    let mut expected_price_prefix = [0u8; 1];
    expected_price_prefix[0] = 3;
    if price.program_id != compute_budget::ID
        || !price.accounts.is_empty()
        || price.data.len() != 9
        || price.data[..1] != expected_price_prefix
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let mut price_bytes = [0u8; 8];
    price_bytes.copy_from_slice(&price.data[1..]);
    if u64::from_le_bytes(price_bytes) > MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1 {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let current = instructions::load_instruction_at_checked(2, instructions_sysvar)?;
    if current.program_id != *program_id
        || current.data != expected_data
        || current.accounts.len() != account_infos.len()
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    for (meta, info) in current.accounts.iter().zip(account_infos) {
        if meta.pubkey != *info.key
            || meta.is_signer != info.is_signer
            || meta.is_writable != info.is_writable
        {
            return Err(GovernanceError::InvalidAccountPrivileges.into());
        }
    }
    if instructions::load_instruction_at_checked(3, instructions_sysvar).is_ok() {
        return Err(GovernanceError::InvalidAccountCount.into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::state::{
        CouncilSeatV1, COUNCIL_SEAT_RESERVED_LEN, GOVERNANCE_COUNCIL_DISCRIMINATOR,
        GOVERNANCE_COUNCIL_RESERVED_LEN,
    };
    use solana_program::instruction::{AccountMeta, Instruction};

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn bytes(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn leaked_account(
        account_key: Pubkey,
        writable: bool,
        signer: bool,
        data: Vec<u8>,
    ) -> AccountInfo<'static> {
        let key_ref = Box::leak(Box::new(account_key));
        let owner_ref = Box::leak(Box::new(key(250)));
        let lamports = Box::leak(Box::new(1u64));
        let data = Box::leak(data.into_boxed_slice());
        AccountInfo::new(
            key_ref, signer, writable, lamports, data, owner_ref, false, 0,
        )
    }

    fn borrowed_instruction(instruction: &Instruction) -> instructions::BorrowedInstruction<'_> {
        instructions::BorrowedInstruction {
            program_id: &instruction.program_id,
            accounts: instruction
                .accounts
                .iter()
                .map(|meta| instructions::BorrowedAccountMeta {
                    pubkey: &meta.pubkey,
                    is_signer: meta.is_signer,
                    is_writable: meta.is_writable,
                })
                .collect(),
            data: &instruction.data,
        }
    }

    fn instruction_sysvar_data(transaction: &[Instruction], current_index: u16) -> Vec<u8> {
        let borrowed: Vec<_> = transaction.iter().map(borrowed_instruction).collect();
        let mut data = instructions::construct_instructions_data(&borrowed);
        let offset = data.len() - 2;
        data[offset..].copy_from_slice(&current_index.to_le_bytes());
        data
    }

    fn compute_limit(units: u32) -> Instruction {
        let mut data = [0u8; 5];
        data[0] = 2;
        data[1..].copy_from_slice(&units.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }

    fn compute_price(micro_lamports: u64) -> Instruction {
        let mut data = [0u8; 9];
        data[0] = 3;
        data[1..].copy_from_slice(&micro_lamports.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }

    fn timing_config() -> ControllerConfigV1 {
        ControllerConfigV1 {
            discriminator: crate::state::CONTROLLER_CONFIG_DISCRIMINATOR,
            version: crate::state::ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            cluster_domain: [1; 32],
            target_program: key(1),
            target_programdata: key(2),
            upgradeable_loader: UPGRADEABLE_LOADER_ID,
            authority_pda: key(3),
            gate_pda: key(4),
            canonical_spill_treasury: key(5),
            current_council_version: 1,
            current_policy_version: 1,
            next_proposal_id: 1,
            target_nonce: 1,
            guardian: key(6),
            vote_program: Pubkey::default(),
            vote_programdata: Pubkey::default(),
            vote_config: Pubkey::default(),
            vote_mint: Pubkey::default(),
            token_governance_enabled: false,
            routine_delay_slots: 10,
            major_delay_slots: 20,
            rollback_delay_slots: 5,
            terminal_delay_slots: 30,
            vote_review_slots: 4,
            proposal_expiry_slots: 100,
            policy_flags: 0,
            reserved: [0; crate::state::CONTROLLER_CONFIG_RESERVED_LEN],
        }
    }

    fn active_council() -> GovernanceCouncilSetV1 {
        let seats = std::array::from_fn(|index| CouncilSeatV1 {
            seat_authority: key(40 + index as u8),
            term_start_slot: 1,
            term_end_slot: 100,
            active: true,
            reserved: [0; COUNCIL_SEAT_RESERVED_LEN],
        });
        GovernanceCouncilSetV1 {
            discriminator: GOVERNANCE_COUNCIL_DISCRIMINATOR,
            account_version: crate::state::ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            controller_config: key(30),
            version: 1,
            target_program: key(31),
            activation_slot: 1,
            deactivation_slot: 0,
            seats,
            routine_threshold: RELEASE1_APPROVAL_THRESHOLD,
            terminal_threshold: 4,
            policy_flags: 0,
            set_hash: [1; 32],
            reserved: [0; GOVERNANCE_COUNCIL_RESERVED_LEN],
        }
    }

    fn proposal_expectation() -> ProposalExpectationV2 {
        ProposalExpectationV2 {
            expected_proposal_digest: [1; 32],
            expected_policy_version: 1,
            expected_policy_hash: [2; 32],
            expected_council_version: 1,
            expected_council_hash: [3; 32],
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 1,
            expected_target_nonce: 1,
            expected_state: ProposalStateV2::Draft,
            expected_review_start_slot: 2,
            expected_review_end_slot: 3,
            expected_not_before_slot: 4,
            expected_expiry_slot: 5,
        }
    }

    fn create_proposal_instruction() -> CreateProposalV2 {
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
            expected_freeze_gate_epoch: 0,
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
            primary_proposal: crate::instruction::OptionalInstructionPubkeyV1::none(),
            rollback_proposal: crate::instruction::OptionalInstructionPubkeyV1::some(key(24))
                .unwrap(),
            rollback_buffer: crate::instruction::OptionalInstructionPubkeyV1::some(key(25))
                .unwrap(),
            rollback_artifact_sha256: bytes(26),
            rollback_artifact_chunk_root: bytes(27),
            review_start_slot: 28,
            review_end_slot: 29,
            not_before_slot: 30,
            expiry_slot: 31,
            expected_proposal_digest: bytes(32),
        }
    }

    fn guardian_freeze_instruction() -> GuardianFreezeV1 {
        GuardianFreezeV1 {
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 44,
            expected_next_gate_epoch: 45,
            expected_target_nonce: 46,
            expected_program_owner: key(43),
            expected_program_executable: true,
            expected_program_data_length: 36,
            expected_program_header_present: true,
            expected_linked_programdata: crate::instruction::OptionalInstructionPubkeyV1::some(
                key(44),
            )
            .unwrap(),
            expected_programdata_owner: key(47),
            expected_programdata_executable: false,
            expected_programdata_data_length: 4_141,
            expected_programdata_header_present: true,
            expected_programdata_slot: 47,
            expected_raw_hash_complete: true,
            expected_raw_programdata_hash: bytes(48),
            expected_capacity: 4_096,
            expected_programdata_authority: crate::instruction::OptionalInstructionPubkeyV1::some(
                key(50),
            )
            .unwrap(),
            freeze_reason_code: 51,
            expected_observation_digest: bytes(52),
        }
    }

    fn create_emergency_resolution_instruction() -> CreateEmergencyResolutionV1 {
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
            expected_freeze_observation_digest: bytes(62),
            observed_program_owner: key(58),
            observed_program_executable: true,
            observed_program_data_length: 36,
            observed_program_header_present: true,
            observed_linked_programdata: crate::instruction::OptionalInstructionPubkeyV1::some(
                key(59),
            )
            .unwrap(),
            observed_programdata_owner: key(63),
            observed_programdata_executable: false,
            observed_programdata_data_length: 4_141,
            observed_programdata_header_present: true,
            observed_programdata_slot: 63,
            observed_raw_hash_complete: true,
            observed_raw_programdata_hash: bytes(64),
            observed_capacity: 4_096,
            observed_programdata_authority: crate::instruction::OptionalInstructionPubkeyV1::some(
                key(66),
            )
            .unwrap(),
            expected_resolution_digest: bytes(67),
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

    fn execute_emergency_resolution_instruction() -> ExecuteEmergencyResolutionV1 {
        ExecuteEmergencyResolutionV1 {
            expected: emergency_expectation(),
            expected_freeze_observation_digest: bytes(127),
            expected_checkpoint_digest: bytes(128),
            expected_program_owner: UPGRADEABLE_LOADER_ID,
            expected_program_executable: true,
            expected_program_data_length: 36,
            expected_program_header_present: true,
            expected_linked_programdata: crate::instruction::OptionalInstructionPubkeyV1::some(
                key(126),
            )
            .unwrap(),
            expected_programdata_owner: UPGRADEABLE_LOADER_ID,
            expected_programdata_executable: false,
            expected_programdata_data_length: 4_141,
            expected_programdata_header_present: true,
            expected_programdata_slot: 129,
            expected_raw_hash_complete: true,
            expected_raw_programdata_hash: bytes(130),
            expected_capacity: 4_096,
            expected_programdata_authority: crate::instruction::OptionalInstructionPubkeyV1::some(
                key(132),
            )
            .unwrap(),
        }
    }

    fn invalid_account_count() -> ProgramResult {
        Err(ProgramError::Custom(
            GovernanceError::InvalidAccountCount as u32,
        ))
    }

    #[test]
    fn every_export_rejects_wrong_account_count_before_clock_or_account_data() {
        let program_id = key(200);
        let proposal_expected = proposal_expectation();
        let emergency_expected = emergency_expectation();
        let results = [
            process_create_proposal_v2(&program_id, &[], create_proposal_instruction()),
            process_approve_proposal_v2(
                &program_id,
                &[],
                ApproveProposalV2 {
                    expected: proposal_expected,
                    expected_approval_bitset: 0,
                    expected_approval_count: 0,
                },
            ),
            process_finalize_governance_v2(
                &program_id,
                &[],
                FinalizeGovernanceV2 {
                    expected: proposal_expected,
                    expected_approval_bitset: 0,
                    expected_approval_count: 0,
                },
            ),
            process_queue_proposal_v2(
                &program_id,
                &[],
                QueueProposalV2 {
                    expected: proposal_expected,
                },
            ),
            process_freeze_proposal_v2(
                &program_id,
                &[],
                FreezeProposalV2 {
                    expected: proposal_expected,
                    expected_next_gate_epoch: 2,
                },
            ),
            process_cancel_proposal_v2(
                &program_id,
                &[],
                CancelProposalV2 {
                    expected: proposal_expected,
                    expected_cancellation_approval_bitset: 0,
                    expected_cancellation_approval_count: 0,
                    cancellation_reason_code: 1,
                },
            ),
            process_expire_proposal_v2(
                &program_id,
                &[],
                ExpireProposalV2 {
                    expected: proposal_expected,
                },
            ),
            process_guardian_freeze_v1(&program_id, &[], guardian_freeze_instruction()),
            process_create_emergency_resolution_v1(
                &program_id,
                &[],
                create_emergency_resolution_instruction(),
            ),
            process_approve_emergency_resolution_v1(
                &program_id,
                &[],
                ApproveEmergencyResolutionV1 {
                    expected: emergency_expected,
                    expected_approval_bitset: 0,
                    expected_approval_count: 0,
                },
            ),
            process_queue_emergency_resolution_v1(
                &program_id,
                &[],
                QueueEmergencyResolutionV1 {
                    expected: emergency_expected,
                    expected_approval_bitset: 0b00111,
                    expected_approval_count: RELEASE1_APPROVAL_THRESHOLD,
                },
            ),
            process_execute_emergency_resolution_v1(
                &program_id,
                &[],
                execute_emergency_resolution_instruction(),
            ),
            process_convert_emergency_freeze_v2(
                &program_id,
                &[],
                ConvertEmergencyFreezeV2 {
                    expected: proposal_expected,
                    expected_next_gate_epoch: 2,
                    expected_freeze_observation_digest: bytes(201),
                },
            ),
        ];
        for result in results {
            assert_eq!(result, invalid_account_count());
        }
    }

    #[test]
    fn proposal_timing_is_class_selected_and_checked() {
        let config = timing_config();
        assert_eq!(
            derive_proposal_timing(&config, ProposalClassV1::EmergencyRollback, 100).unwrap(),
            (101, 105, 110, 200)
        );
        assert_eq!(
            derive_proposal_timing(&config, ProposalClassV1::RoutineUpgrade, 100).unwrap(),
            (101, 105, 115, 200)
        );
        assert_eq!(
            derive_proposal_timing(&config, ProposalClassV1::EconomicChange, 100).unwrap(),
            (101, 105, 125, 200)
        );
        assert_eq!(
            derive_proposal_timing(&config, ProposalClassV1::TargetImmutability, 100),
            Err(GovernanceError::UnsupportedProposalClass)
        );
    }

    #[test]
    fn timing_overflow_and_equality_fail_closed() {
        let mut config = timing_config();
        assert_eq!(
            derive_proposal_timing(&config, ProposalClassV1::RoutineUpgrade, u64::MAX),
            Err(GovernanceError::ArithmeticOverflow)
        );
        config.proposal_expiry_slots = 15;
        assert_eq!(
            derive_proposal_timing(&config, ProposalClassV1::RoutineUpgrade, 100),
            Err(GovernanceError::InvalidProposalTiming)
        );
        assert_eq!(
            checked_freeze_counters(u64::MAX, 1),
            Err(GovernanceError::ArithmeticOverflow)
        );
        assert_eq!(
            checked_freeze_counters(1, u64::MAX),
            Err(GovernanceError::ArithmeticOverflow)
        );
        assert_eq!(checked_freeze_counters(8, 9), Ok((9, 10)));
    }

    #[test]
    fn freeze_runway_reserves_checkpoint_and_extension_slots() {
        // With a four-slot checkpoint window, a no-extension proposal needs
        // one additional execution slot and an extension proposal needs two.
        assert_eq!(require_freeze_execution_runway(0, 100, 4, 94), Ok(()));
        assert_eq!(
            require_freeze_execution_runway(0, 100, 4, 95),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        assert_eq!(require_freeze_execution_runway(1, 100, 4, 93), Ok(()));
        assert_eq!(
            require_freeze_execution_runway(1, 100, 4, 94),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        assert_eq!(
            require_freeze_execution_runway(0, u64::MAX, 4, u64::MAX - 2),
            Err(GovernanceError::ArithmeticOverflow.into())
        );
    }

    #[test]
    fn emergency_resume_envelope_is_compute_bounded_and_has_no_sibling() {
        let program_id = key(200);
        let account_key = key(201);
        let expected_data = vec![13, 7, 8];
        let current = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new_readonly(account_key, false),
                AccountMeta::new_readonly(sysvar_ids::instructions::ID, false),
            ],
            data: expected_data.clone(),
        };
        let canonical = vec![
            compute_limit(MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1),
            compute_price(MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1),
            current.clone(),
        ];
        let state_info = leaked_account(account_key, false, false, vec![]);
        let sysvar_info = leaked_account(
            sysvar_ids::instructions::ID,
            false,
            false,
            instruction_sysvar_data(&canonical, 2),
        );
        assert_eq!(
            validate_bounded_emergency_resolution_envelope(
                &program_id,
                &[state_info.clone(), sysvar_info],
                &leaked_account(
                    sysvar_ids::instructions::ID,
                    false,
                    false,
                    instruction_sysvar_data(&canonical, 2),
                ),
                &expected_data,
            ),
            Ok(())
        );

        let mut with_sibling = canonical.clone();
        with_sibling.push(Instruction {
            program_id: key(202),
            accounts: vec![],
            data: vec![],
        });
        let sibling_sysvar = leaked_account(
            sysvar_ids::instructions::ID,
            false,
            false,
            instruction_sysvar_data(&with_sibling, 2),
        );
        assert_eq!(
            validate_bounded_emergency_resolution_envelope(
                &program_id,
                &[state_info.clone(), sibling_sysvar.clone()],
                &sibling_sysvar,
                &expected_data,
            ),
            Err(GovernanceError::InvalidAccountCount.into())
        );

        let underflow_limit = vec![compute_limit(0), compute_price(0), current];
        let underflow_sysvar = leaked_account(
            sysvar_ids::instructions::ID,
            false,
            false,
            instruction_sysvar_data(&underflow_limit, 2),
        );
        assert_eq!(
            validate_bounded_emergency_resolution_envelope(
                &program_id,
                &[state_info, underflow_sysvar.clone()],
                &underflow_sysvar,
                &expected_data,
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn proposal_approval_window_boundaries_fail_closed() {
        assert_eq!(require_approval_window(10, 20, 30, 10), Ok(()));
        assert_eq!(require_approval_window(10, 20, 30, 20), Ok(()));
        for slot in [9, 21, 30, 31] {
            assert_eq!(
                require_approval_window(10, 20, 30, slot),
                Err(ProgramError::Custom(
                    GovernanceError::InvalidProposalTiming as u32
                )),
                "slot {slot} must be outside the immutable approval window"
            );
        }
    }

    #[test]
    fn stale_nonce_gate_status_epoch_and_bootstrap_freeze_fail_closed() {
        assert_eq!(
            require_creation_gate_values(
                7,
                GateStatusV1::Active,
                11,
                7,
                GateStatusV1::Active,
                11,
                0
            ),
            Ok(())
        );
        for result in [
            require_creation_gate_values(
                6,
                GateStatusV1::Active,
                11,
                7,
                GateStatusV1::Active,
                11,
                0,
            ),
            require_creation_gate_values(
                7,
                GateStatusV1::EmergencyFrozen,
                11,
                7,
                GateStatusV1::Active,
                11,
                0,
            ),
            require_creation_gate_values(
                7,
                GateStatusV1::Active,
                10,
                7,
                GateStatusV1::Active,
                11,
                0,
            ),
            require_creation_gate_values(
                7,
                GateStatusV1::FrozenForUpgrade,
                11,
                7,
                GateStatusV1::FrozenForUpgrade,
                11,
                GOVERNED_UPGRADE_FREEZE_REASON_V1,
            ),
            require_creation_gate_values(
                7,
                GateStatusV1::EmergencyFrozen,
                11,
                7,
                GateStatusV1::EmergencyFrozen,
                11,
                BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
            ),
        ] {
            assert_eq!(
                result,
                Err(ProgramError::Custom(
                    GovernanceError::InvalidProposalEpoch as u32
                ))
            );
        }
        assert_eq!(
            require_creation_gate_values(
                7,
                GateStatusV1::EmergencyFrozen,
                11,
                7,
                GateStatusV1::EmergencyFrozen,
                11,
                99,
            ),
            Ok(())
        );
    }

    #[test]
    fn prepared_rollback_cannot_be_cancelled_or_expired_after_primary_freeze() {
        let primary_key = key(170);
        let rollback = UpgradeProposalV2 {
            proposal_class: ProposalClassV1::EmergencyRollback,
            target_nonce: 7,
            primary_proposal: OptionalPubkeyV1::some(primary_key).unwrap(),
            ..UpgradeProposalV2::default()
        };
        let mut config = timing_config();
        config.target_nonce = 8;
        let mut gate = ProtocolGateV1 {
            discriminator: [0; 8],
            version: 1,
            bump: 1,
            initialized: true,
            status: GateStatusV1::FrozenForUpgrade,
            controller_config: key(171),
            target_program: config.target_program,
            target_programdata: config.target_programdata,
            epoch: 2,
            active_proposal: primary_key,
            freeze_slot: 10,
            freeze_reason_code: GOVERNED_UPGRADE_FREEZE_REASON_V1,
            last_completed_proposal: Pubkey::default(),
            reserved: [0; crate::state::PROTOCOL_GATE_RESERVED_LEN],
        };
        let before = rollback.clone();

        // Both CancelProposalV2 and ExpireProposalV2 call this guard before
        // modifying their detached proposal value or committing account bytes.
        for operation in ["cancel", "expire"] {
            assert_eq!(
                reject_locked_reciprocal_rollback(&rollback, &config, &gate),
                Err(GovernanceError::InvalidStateTransition.into()),
                "{operation} must preserve the sealed recovery capability"
            );
            assert_eq!(rollback, before, "{operation} changed proposal state");
        }

        gate.active_proposal = key(172);
        assert_eq!(
            reject_locked_reciprocal_rollback(&rollback, &config, &gate),
            Ok(())
        );
        gate.active_proposal = primary_key;
        config.target_nonce = rollback.target_nonce;
        assert_eq!(
            reject_locked_reciprocal_rollback(&rollback, &config, &gate),
            Ok(())
        );
    }

    #[test]
    fn guardian_cannot_authorize_any_nonfreeze_seat_path() {
        let config = timing_config();
        let council = active_council();
        for path in [
            "proposal creation",
            "proposal approval",
            "proposal cancellation",
            "emergency resolution approval",
        ] {
            assert_eq!(
                reject_guardian_authority(&config, &config.guardian),
                Err(ProgramError::Custom(
                    GovernanceError::UnknownSeatAuthority as u32
                )),
                "guardian unexpectedly admitted for {path}"
            );
        }
        assert_eq!(
            require_active_seat(&council, &config.guardian, 10),
            Err(ProgramError::Custom(
                GovernanceError::UnknownSeatAuthority as u32
            ))
        );
        for seat in &council.seats {
            assert_eq!(
                reject_guardian_authority(&config, &seat.seat_authority),
                Ok(())
            );
            assert_eq!(
                require_active_seat(&council, &seat.seat_authority, 10),
                Ok(())
            );
        }
    }

    #[test]
    fn runtime_capture_preserves_malformed_programdata_and_hashes_when_bounded() {
        let program_key = key(10);
        let programdata_key = key(11);
        let owner = key(12);
        let mut program_lamports = 1;
        let mut programdata_lamports = 1;
        let mut malformed_program = vec![9; 17];
        let mut malformed_programdata = vec![7; 19];
        let program = AccountInfo::new(
            &program_key,
            false,
            false,
            &mut program_lamports,
            &mut malformed_program,
            &owner,
            false,
            0,
        );
        let programdata = AccountInfo::new(
            &programdata_key,
            false,
            false,
            &mut programdata_lamports,
            &mut malformed_programdata,
            &owner,
            true,
            0,
        );
        let observed = capture_runtime_observation(&program, &programdata).unwrap();
        assert!(!observed.program_header_present);
        assert!(!observed.programdata_header_present);
        assert!(observed.raw_hash_complete);
        assert_eq!(observed.raw_programdata_hash, hashv(&[&[7; 19]]).to_bytes());
        assert_eq!(observed.authority, OptionalPubkeyV1::none());
    }

    #[test]
    fn oversized_runtime_capture_is_persistable_without_one_shot_hashing() {
        let program_key = key(13);
        let programdata_key = key(14);
        let owner = key(15);
        let mut program_lamports = 1;
        let mut programdata_lamports = 1;
        let mut malformed_program = vec![9; 17];
        let mut oversized = vec![0; MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 as usize + 1];
        let program = AccountInfo::new(
            &program_key,
            false,
            false,
            &mut program_lamports,
            &mut malformed_program,
            &owner,
            false,
            0,
        );
        let programdata = AccountInfo::new(
            &programdata_key,
            false,
            false,
            &mut programdata_lamports,
            &mut oversized,
            &owner,
            false,
            0,
        );
        let observed = capture_runtime_observation(&program, &programdata).unwrap();
        assert!(!observed.raw_hash_complete);
        assert_eq!(observed.raw_programdata_hash, [0; 32]);
    }

    #[test]
    fn all_five_seat_masks_enforce_exact_three_of_five_and_duplicates_fail() {
        let council = active_council();
        for mask in 0u8..=VALID_APPROVAL_MASK {
            let count = mask.count_ones() as u8;
            assert_eq!(
                require_exact_recorded_quorum(&council, mask, count, 10).is_ok(),
                count == RELEASE1_APPROVAL_THRESHOLD,
                "mask {mask:05b}"
            );
        }
        assert_eq!(
            record_seat_approval(&council, 0b00001, 1, &council.seats[0].seat_authority, 10,),
            Err(GovernanceError::DuplicateApproval)
        );
        assert_eq!(
            require_exact_recorded_quorum(&council, 0b100000, 1, 10),
            Err(ProgramError::Custom(
                GovernanceError::QuorumNotSatisfied as u32
            ))
        );
    }

    #[test]
    fn account_count_privilege_and_alias_failures_leave_writable_bytes_unchanged() {
        let instruction = QueueProposalV2 {
            expected: proposal_expectation(),
        };
        assert_eq!(
            process_queue_proposal_v2(&key(60), &[], instruction.clone()),
            Err(ProgramError::Custom(
                GovernanceError::InvalidAccountCount as u32
            ))
        );

        let owner = key(61);
        let config_key = key(62);
        let policy_key = key(63);
        let shared_key = key(64);
        let mut config_lamports = 1;
        let mut policy_lamports = 1;
        let mut gate_lamports = 1;
        let mut proposal_lamports = 1;
        let mut config_data = [1u8; 8];
        let mut policy_data = [2u8; 8];
        let mut gate_data = [3u8; 8];
        let mut proposal_data = [4u8; 8];
        let before = proposal_data;
        let config = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut config_lamports,
            &mut config_data,
            &owner,
            false,
            0,
        );
        let policy = AccountInfo::new(
            &policy_key,
            false,
            false,
            &mut policy_lamports,
            &mut policy_data,
            &owner,
            false,
            0,
        );
        let gate = AccountInfo::new(
            &shared_key,
            false,
            false,
            &mut gate_lamports,
            &mut gate_data,
            &owner,
            false,
            0,
        );
        let proposal = AccountInfo::new(
            &shared_key,
            false,
            true,
            &mut proposal_lamports,
            &mut proposal_data,
            &owner,
            false,
            0,
        );
        assert_eq!(
            process_queue_proposal_v2(&key(60), &[config, policy, gate, proposal], instruction,),
            Err(ProgramError::Custom(
                GovernanceError::CrossAccountMismatch as u32
            ))
        );
        assert_eq!(proposal_data, before);

        let config_key = key(65);
        let policy_key = key(66);
        let gate_key = key(67);
        let proposal_key = key(68);
        let mut config_lamports = 1;
        let mut policy_lamports = 1;
        let mut gate_lamports = 1;
        let mut proposal_lamports = 1;
        let mut config_data = [5u8; 8];
        let mut policy_data = [6u8; 8];
        let mut gate_data = [7u8; 8];
        let mut proposal_data = [8u8; 8];
        let before = proposal_data;
        let config = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut config_lamports,
            &mut config_data,
            &owner,
            false,
            0,
        );
        let policy = AccountInfo::new(
            &policy_key,
            false,
            false,
            &mut policy_lamports,
            &mut policy_data,
            &owner,
            false,
            0,
        );
        let gate = AccountInfo::new(
            &gate_key,
            false,
            false,
            &mut gate_lamports,
            &mut gate_data,
            &owner,
            false,
            0,
        );
        let proposal = AccountInfo::new(
            &proposal_key,
            false,
            false,
            &mut proposal_lamports,
            &mut proposal_data,
            &owner,
            false,
            0,
        );
        assert_eq!(
            process_queue_proposal_v2(
                &key(60),
                &[config, policy, gate, proposal],
                QueueProposalV2 {
                    expected: proposal_expectation(),
                },
            ),
            Err(ProgramError::Custom(
                GovernanceError::InvalidAccountPrivileges as u32
            ))
        );
        assert_eq!(proposal_data, before);
    }

    #[test]
    fn canonical_runtime_must_match_every_freeze_observation_field() {
        let config = timing_config();
        let runtime = RuntimeObservationV1 {
            program_owner: UPGRADEABLE_LOADER_ID,
            program_executable: true,
            program_data_length: 36,
            program_header_present: true,
            linked_programdata: OptionalPubkeyV1::some(config.target_programdata).unwrap(),
            programdata_owner: UPGRADEABLE_LOADER_ID,
            programdata_executable: false,
            programdata_data_length: 55,
            programdata_header_present: true,
            programdata_slot: 9,
            raw_hash_complete: true,
            raw_programdata_hash: [8; 32],
            capacity: 10,
            authority: OptionalPubkeyV1::some(config.authority_pda).unwrap(),
        };
        let frozen = EmergencyFreezeObservationV1 {
            discriminator: EMERGENCY_FREEZE_OBSERVATION_V1_DISCRIMINATOR,
            account_version: RELEASE1_ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            finalized: true,
            controller_program: key(20),
            controller_config: key(21),
            protocol_gate: key(22),
            target_program: config.target_program,
            target_programdata: config.target_programdata,
            upgradeable_loader: UPGRADEABLE_LOADER_ID,
            controller_authority: config.authority_pda,
            frozen_epoch: 2,
            freeze_slot: 3,
            freeze_reason_code: 9,
            actual_program_owner: runtime.program_owner,
            actual_program_executable: runtime.program_executable,
            actual_program_data_length: runtime.program_data_length,
            program_header_present: runtime.program_header_present,
            actual_linked_programdata: runtime.linked_programdata,
            actual_programdata_owner: runtime.programdata_owner,
            actual_programdata_executable: runtime.programdata_executable,
            actual_programdata_data_length: runtime.programdata_data_length,
            programdata_header_present: runtime.programdata_header_present,
            deployed_programdata_slot: runtime.programdata_slot,
            raw_hash_complete: runtime.raw_hash_complete,
            raw_programdata_sha256: runtime.raw_programdata_hash,
            capacity: runtime.capacity,
            observed_authority: runtime.authority,
            observation_digest: [7; 32],
            finalized_slot: 3,
            reserved: [0; EMERGENCY_FREEZE_OBSERVATION_V1_RESERVED_LEN],
        };
        assert_eq!(
            require_canonical_unchanged_runtime(&runtime, &frozen, &config),
            Ok(())
        );
        let mut drifted = runtime.clone();
        drifted.raw_programdata_hash[0] ^= 1;
        assert_eq!(
            require_canonical_unchanged_runtime(&drifted, &frozen, &config),
            Err(ProgramError::Custom(
                GovernanceError::CrossAccountMismatch as u32
            ))
        );
    }

    #[test]
    fn prefreeze_set_is_closed_and_excludes_every_postfreeze_terminal() {
        for state in [
            ProposalStateV2::Draft,
            ProposalStateV2::BufferAdopted,
            ProposalStateV2::BufferVerified,
            ProposalStateV2::CouncilApproved,
            ProposalStateV2::GovernanceSatisfied,
            ProposalStateV2::Timelocked,
        ] {
            assert!(is_pre_freeze_state(state));
        }
        for state in [
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
            ProposalStateV2::TokenReviewOpen,
        ] {
            assert!(!is_pre_freeze_state(state));
        }
    }
}
