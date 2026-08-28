//! Release 1 rollback activation, abandoned-buffer close, and governed unfreeze.
//!
//! This module is deliberately a closed verification kernel. It never accepts
//! caller-selected CPI bytes or accounts, derives every Loader-v3 instruction
//! from the pinned interface, and prepares every controller-owned account byte
//! before the first mutation.

use solana_loader_v3_interface::instruction::close;
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    hash::hashv,
    instruction::Instruction,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::{instructions, Sysvar},
};
use solana_sdk_ids::{compute_budget, system_program, sysvar as sysvar_ids};
use solana_system_interface::instruction as system_instruction;

use crate::{
    artifact_merkle::{
        artifact_chunk_count, artifact_chunk_empty_hash, artifact_chunk_leaf_hash,
        artifact_chunk_node_hash, MAX_ARTIFACT_PROOF_DEPTH_V1, MAX_PADDED_ARTIFACT_CHUNKS_V1,
    },
    authorization::validate_seat_authority,
    council::{
        record_seat_approval, validate_council_guardian_separation, validate_council_set,
        VALID_APPROVAL_MASK,
    },
    instruction::{
        ActivateRollbackV1, ApproveUnfreezeV1, CloseAbandonedBufferV1, EnvelopeExpectationV1,
        ExecuteUnfreezeV1, FixedMerkleProofV1, ObserveProgramDataFailureV1, ProposalExpectationV2,
        UnfreezeExpectationV1, MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1,
        MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
    },
    pda::{
        derive_authority_pda, derive_buffer_check_pda, derive_checkpoint_pda,
        derive_controller_config_pda, derive_council_pda, derive_gate_pda, derive_policy_pda,
        derive_programdata_check_pda, derive_programdata_failure_observation_pda,
        derive_proposal_pda, derive_upgradeable_programdata_address, AUTHORITY_SEED,
        PROGRAMDATA_FAILURE_OBSERVATION_SEED, UPGRADEABLE_LOADER_ID, UPGRADE_SEED_DOMAIN_V1,
    },
    policy::validate_policy_against_config,
    release1_account_io::{
        create_fixed_pda_account, encode_fixed_account, load_fixed_controller_account,
        require_distinct_accounts, store_fixed_controller_account, validate_exact_privileges,
    },
    release1_digest::{
        compute_programdata_failure_observation_digest_v1,
        validate_programdata_failure_observation_digest_v1, validate_proposal_digest_v2,
        validate_state_checkpoint_digest_v1,
    },
    release1_loader_accounts::{
        loader_account_data_hash, parse_upgradeable_program, parse_upgradeable_programdata,
        validate_buffer_account, validate_program_programdata_linkage, LOADER_BUFFER_METADATA_LEN,
        LOADER_PROGRAMDATA_METADATA_LEN, LOADER_PROGRAM_ACCOUNT_LEN,
    },
    release1_state::{
        BufferVerificationStatusV1, BufferVerificationV1, ProgramDataFailureObservationV1,
        ProgramDataMismatchClassV1, ProgramDataVerificationStatusV1, ProgramDataVerificationV1,
        ProposalStateV2, StateCheckpointPhaseV1, StateCheckpointV1, UpgradeProposalV2,
        MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1,
        PROGRAMDATA_FAILURE_OBSERVATION_V1_DISCRIMINATOR,
        PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN, PROPOSAL_COMPLETED_TERMINAL_REASON_V1,
        PROPOSAL_RETIRED_ROLLBACK_TERMINAL_REASON_V1,
        PROPOSAL_SUPERSEDED_BY_ROLLBACK_TERMINAL_REASON_V1, RELEASE1_ACCOUNT_VERSION_V1,
        RELEASE1_APPROVAL_THRESHOLD, VERIFICATION_BITMAP_BYTES_V1,
    },
    state::{
        CheckpointPhaseV1, ControllerConfigV1, GateStatusV1, GovernanceCouncilSetV1,
        GovernancePolicyV1, OptionalPubkeyV1, ProposalClassV1, ProtocolGateV1,
    },
    GovernanceError, GovernanceResult,
};

/// A distinct nonzero reason for the continuously frozen handoff from a failed
/// primary proposal to its precommitted rollback.
pub const ROLLBACK_ACTIVATION_FREEZE_REASON_V1: u16 = 3;

/// Zero-tail chunks are deliberately outside the artifact Merkle tree. Their
/// relative index and exact final-partial length are committed under this
/// separate domain.
const PROGRAMDATA_ZERO_TAIL_CHUNK_DOMAIN_V1: &[u8] = b"AMOEBA_PROGRAMDATA_ZERO_TAIL_CHUNK_V1";
const MAX_PROGRAMDATA_ZERO_TAIL_CHUNK_BYTES_V1: usize = 16 * 1024;
const PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1: usize = 1024;
const MAX_PROGRAMDATA_ZERO_HASH_BLOCKS_V1: usize =
    MAX_PROGRAMDATA_ZERO_TAIL_CHUNK_BYTES_V1 / PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1;
static PROGRAMDATA_ZERO_HASH_BLOCK_V1: [u8; PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1] =
    [0; PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1];

#[derive(Clone, Debug, Eq, PartialEq)]
struct RuntimeProgramDataObservationV1 {
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

/// Records one current-council approval in the proposal's dedicated unfreeze
/// accumulator. A council rotation invalidates the old accumulator and starts
/// a fresh one; proposal and checkpoint approvals are never reused.
pub fn process_approve_unfreeze_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveUnfreezeV1,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, proposal_info, poststate_info, verification_info, target_program, target_programdata, authority_info, loader_info, seat] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        poststate_info,
        verification_info,
        target_programdata,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_seat_authority(seat)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        proposal_info,
        poststate_info,
        verification_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        seat,
    ])?;
    if *loader_info.key != UPGRADEABLE_LOADER_ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_and_council_active(&policy, &council, slot)?;
    validate_unfreeze_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &policy,
        &council,
        &gate,
        proposal_info.key,
    )?;
    if !matches!(
        proposal.state,
        ProposalStateV2::PoststateAccepted | ProposalStateV2::UnfreezeApproved
    ) || *seat.key == config.guardian
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }

    let verification = load_verified_programdata(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
    )?;
    let poststate = load_accepted_poststate(
        program_id,
        poststate_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
        &gate,
        &verification,
    )?;
    validate_unfreeze_evidence_expectation(
        &instruction.expected,
        &poststate,
        &verification,
        &config,
    )?;
    validate_live_verified_programdata(
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        &config,
        &proposal,
        &verification,
    )?;

    prepare_unfreeze_accumulator(&mut proposal, &council)?;
    if proposal.unfreeze_approval_count == 0 {
        proposal.unfreeze_council_version = council.version;
        proposal.unfreeze_council_hash = council.set_hash;
    }
    let (bitset, count) = record_seat_approval(
        &council,
        proposal.unfreeze_approval_bitset,
        proposal.unfreeze_approval_count,
        seat.key,
        slot,
    )?;
    proposal.unfreeze_approval_bitset = bitset;
    proposal.unfreeze_approval_count = count;
    if count == RELEASE1_APPROVAL_THRESHOLD {
        proposal.state = ProposalStateV2::UnfreezeApproved;
        proposal.unfreeze_approved_slot = slot;
    }
    validate_proposal_digest_v2(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV2::LEN,
    )
}

/// Executes only the separate, exact unfreeze transaction. It performs no CPI,
/// increments the epoch, clears every freeze field, completes the active
/// proposal, and terminalizes exactly the reciprocal linked proposal.
pub fn process_execute_unfreeze_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExecuteUnfreezeV1,
) -> ProgramResult {
    let [config_info, policy_info, council_info, gate_info, proposal_info, linked_info, poststate_info, verification_info, target_program, target_programdata, authority_info, loader_info, instructions_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [
        config_info,
        policy_info,
        council_info,
        poststate_info,
        verification_info,
        target_programdata,
        authority_info,
        instructions_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(linked_info, true, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        council_info,
        gate_info,
        proposal_info,
        linked_info,
        poststate_info,
        verification_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        instructions_info,
    ])?;
    if *loader_info.key != UPGRADEABLE_LOADER_ID
        || *instructions_info.key != sysvar_ids::instructions::ID
        || instruction.linked_proposal != *linked_info.key
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let council = load_current_council(program_id, council_info, config_info, &config, &policy)?;
    let mut gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    let mut linked = load_proposal(program_id, linked_info, config_info, &config)?;
    let slot = Clock::get()?.slot;
    require_policy_and_council_active(&policy, &council, slot)?;
    validate_unfreeze_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &policy,
        &council,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::UnfreezeApproved {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_current_quorum(
        &council,
        proposal.unfreeze_council_version,
        &proposal.unfreeze_council_hash,
        proposal.unfreeze_approval_bitset,
        proposal.unfreeze_approval_count,
        slot,
    )?;

    let verification = load_verified_programdata(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
    )?;
    let poststate = load_accepted_poststate(
        program_id,
        poststate_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
        &gate,
        &verification,
    )?;
    validate_unfreeze_evidence_expectation(
        &instruction.expected,
        &poststate,
        &verification,
        &config,
    )?;
    validate_live_verified_programdata(
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        &config,
        &proposal,
        &verification,
    )?;
    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &instruction.pack(),
        &instruction.envelope,
    )?;

    let next_epoch = gate
        .epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    terminalize_unfreeze_pair(
        &proposal,
        proposal_info.key,
        &mut linked,
        linked_info.key,
        slot,
    )?;
    proposal.state = ProposalStateV2::Completed;
    proposal.terminal_slot = slot;
    proposal.terminal_reason_code = PROPOSAL_COMPLETED_TERMINAL_REASON_V1;
    validate_proposal_digest_v2(&proposal)?;
    validate_proposal_digest_v2(&linked)?;

    gate.epoch = next_epoch;
    gate.status = GateStatusV1::Active;
    gate.active_proposal = Pubkey::default();
    gate.freeze_slot = 0;
    gate.freeze_reason_code = 0;
    gate.last_completed_proposal = *proposal_info.key;
    gate.validate_static()?;
    let gate_bytes = encode_fixed_account(&*gate, ProtocolGateV1::LEN)?;
    let proposal_bytes = encode_fixed_account(&*proposal, UpgradeProposalV2::LEN)?;
    let linked_bytes = encode_fixed_account(&*linked, UpgradeProposalV2::LEN)?;
    commit_three_fixed_accounts(
        program_id,
        gate_info,
        &gate_bytes,
        ProtocolGateV1::LEN,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV2::LEN,
        linked_info,
        &linked_bytes,
        UpgradeProposalV2::LEN,
    )
}

/// Closes only a canonical controller-owned Loader-v3 Buffer belonging to a
/// Cancelled, Expired, or explicitly Retired rollback proposal, and transfers
/// every lamport only to the pinned treasury.
pub fn process_close_abandoned_buffer_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CloseAbandonedBufferV1,
) -> ProgramResult {
    let [config_info, gate_info, proposal_info, verification_info, buffer_info, treasury_info, authority_info, loader_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [config_info, gate_info, proposal_info, authority_info] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(verification_info, true, false, false)?;
    validate_exact_privileges(buffer_info, true, false, false)?;
    validate_exact_privileges(treasury_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        gate_info,
        proposal_info,
        verification_info,
        buffer_info,
        treasury_info,
        authority_info,
        loader_info,
    ])?;
    if *loader_info.key != UPGRADEABLE_LOADER_ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    check_proposal_expectation_without_live_council(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
    )?;
    validate_abandoned_buffer_close_state(&proposal, proposal_info.key, &config, &gate)?;
    validate_close_identities(
        &config,
        &proposal,
        verification_info.key,
        buffer_info.key,
        treasury_info.key,
        authority_info.key,
    )?;

    let mut verification = load_buffer_verification(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        buffer_info,
        &config,
        &proposal,
    )?;
    if verification.status != instruction.expected_verification_status
        || verification.verified_chunk_bitmap != instruction.expected_verified_chunk_bitmap
        || verification.verified_chunk_count != instruction.expected_verified_chunk_count
        || verification.finalized_slot != instruction.expected_buffer_verification_finalized_slot
        || matches!(
            verification.status,
            BufferVerificationStatusV1::ConsumedByUpgrade
                | BufferVerificationStatusV1::ClosedAbandoned
        )
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let buffer_header = validate_buffer_account(buffer_info, &config.upgradeable_loader)?;
    let buffer_data = buffer_info.try_borrow_data()?;
    let header_hash = hashv(&[&buffer_data[..LOADER_BUFFER_METADATA_LEN]]).to_bytes();
    if buffer_header.authority != Some(config.authority_pda)
        || buffer_header.payload_length as u64 != proposal.artifact_length
        || header_hash != verification.sealed_buffer_header_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    drop(buffer_data);

    let slot = Clock::get()?.slot;
    if slot == 0 {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    verification.status = BufferVerificationStatusV1::ClosedAbandoned;
    verification.terminal_slot = slot;
    verification.validate_schema()?;
    let verification_bytes = encode_fixed_account(&*verification, BufferVerificationV1::LEN)?;

    let close_instruction = close(buffer_info.key, treasury_info.key, authority_info.key);
    validate_close_cpi_shape(
        &close_instruction,
        buffer_info.key,
        treasury_info.key,
        authority_info.key,
    )?;
    let authority_bump = derive_authority_pda(program_id, &config.target_program).1;
    let bump_seed = [authority_bump];
    let signer_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        AUTHORITY_SEED,
        config.target_program.as_ref(),
        &bump_seed,
    ];
    invoke_signed(
        &close_instruction,
        &[
            buffer_info.clone(),
            treasury_info.clone(),
            authority_info.clone(),
            loader_info.clone(),
        ],
        &[signer_seeds],
    )?;
    if buffer_info.lamports() != 0 {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    commit_one_fixed_account(
        program_id,
        verification_info,
        &verification_bytes,
        BufferVerificationV1::LEN,
    )
}

/// Keeps the target continuously frozen while switching the active proposal to
/// the exact, precommitted rollback. The already-consumed target nonce is not
/// incremented again.
pub fn process_activate_rollback_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ActivateRollbackV1,
) -> ProgramResult {
    let [config_info, policy_info, gate_info, primary_info, rollback_info, rollback_buffer_verification_info, primary_programdata_verification_info, failure_info, target_program, target_programdata, authority_info, loader_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [
        config_info,
        policy_info,
        primary_info,
        rollback_buffer_verification_info,
        primary_programdata_verification_info,
        failure_info,
        target_programdata,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(rollback_info, true, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        gate_info,
        primary_info,
        rollback_info,
        rollback_buffer_verification_info,
        primary_programdata_verification_info,
        failure_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
    ])?;
    if *loader_info.key != UPGRADEABLE_LOADER_ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let mut gate = load_gate(program_id, gate_info, config_info, &config)?;
    let primary = load_proposal(program_id, primary_info, config_info, &config)?;
    let rollback = load_proposal(program_id, rollback_info, config_info, &config)?;
    check_proposal_expectation_with_policy(
        &instruction.expected_primary,
        &primary,
        &config,
        &policy,
        &gate,
    )?;
    check_proposal_expectation_with_policy(
        &instruction.expected_rollback,
        &rollback,
        &config,
        &policy,
        &gate,
    )?;
    validate_active_primary_binding(&primary, primary_info.key, &config, &gate)?;
    validate_reciprocal_rollback(
        &primary,
        primary_info.key,
        &rollback,
        rollback_info.key,
        &config,
    )?;
    if !matches!(
        primary.state,
        ProposalStateV2::UpgradeExecuted | ProposalStateV2::ProgramDataVerified
    ) || rollback.state != ProposalStateV2::Timelocked
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }

    let slot = Clock::get()?.slot;
    require_policy_active(&policy, slot)?;
    validate_rollback_activation_timing(&primary, &rollback, &config, slot)?;

    let primary_verification = load_programdata_verification_for_failure(
        program_id,
        primary_programdata_verification_info,
        primary_info,
        config_info,
        &config,
        &primary,
    )?;
    if primary_verification.status != instruction.expected_primary_programdata_verification_status
        || primary_verification.finalized_slot
            != instruction.expected_primary_programdata_verification_finalized_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if *authority_info.key != config.authority_pda
        || *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_rollback_failure_evidence(
        program_id,
        failure_info,
        primary_info,
        config_info,
        gate_info,
        &config,
        &gate,
        &primary,
        &primary_verification,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        &instruction.expected_failure_evidence_digest,
        slot,
    )?;

    let rollback_verification = load_buffer_verification_without_live_buffer(
        program_id,
        rollback_buffer_verification_info,
        rollback_info,
        config_info,
        &config,
        &rollback,
    )?;
    if rollback_verification.status != instruction.expected_rollback_buffer_verification_status
        || rollback_verification.verified_chunk_bitmap
            != instruction.expected_rollback_verified_chunk_bitmap
        || rollback_verification.verified_chunk_count
            != instruction.expected_rollback_verified_chunk_count
        || rollback_verification.status != BufferVerificationStatusV1::Verified
        || rollback_verification.verified_chunk_count != rollback.chunk_count
        || rollback_verification.finalized_slot == 0
        || rollback_verification.finalized_slot > primary.upgrade_executed_slot
        || rollback_verification.finalized_slot > slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let next_epoch = gate
        .epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let mut next_rollback = (*rollback).clone();
    next_rollback.state = ProposalStateV2::Frozen;
    next_rollback.freeze_gate_epoch = next_epoch;
    next_rollback.frozen_slot = slot;
    validate_proposal_digest_v2(&next_rollback)?;
    gate.epoch = next_epoch;
    gate.status = GateStatusV1::FrozenForUpgrade;
    gate.active_proposal = *rollback_info.key;
    gate.freeze_slot = slot;
    gate.freeze_reason_code = ROLLBACK_ACTIVATION_FREEZE_REASON_V1;
    gate.validate_static()?;
    let gate_bytes = encode_fixed_account(&*gate, ProtocolGateV1::LEN)?;
    let rollback_bytes = encode_fixed_account(&next_rollback, UpgradeProposalV2::LEN)?;
    commit_two_fixed_accounts(
        program_id,
        gate_info,
        &gate_bytes,
        ProtocolGateV1::LEN,
        rollback_info,
        &rollback_bytes,
        UpgradeProposalV2::LEN,
    )
}

/// Creates an immutable, exact failure observation from live Program and
/// ProgramData bytes. The caller supplies only stale-plan guards and a Merkle
/// proof for the already-committed expected payload leaf.
pub fn process_observe_programdata_failure_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ObserveProgramDataFailureV1,
) -> ProgramResult {
    let [payer, config_info, gate_info, primary_info, verification_info, target_program, target_programdata, authority_info, loader_info, failure_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(payer, true, true, false)?;
    for account in [
        config_info,
        gate_info,
        primary_info,
        verification_info,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
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
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(failure_info, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        gate_info,
        primary_info,
        verification_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        failure_info,
        system_program_info,
    ])?;
    if *loader_info.key != UPGRADEABLE_LOADER_ID || *system_program_info.key != system_program::ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    instruction.validate_failure_shape()?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let primary = load_proposal(program_id, primary_info, config_info, &config)?;
    check_proposal_expectation_without_live_council(
        &instruction.expected,
        &primary,
        &config,
        &gate,
    )?;
    validate_active_primary_binding(&primary, primary_info.key, &config, &gate)?;
    if primary.proposal_class == ProposalClassV1::EmergencyRollback
        || primary.state != ProposalStateV2::UpgradeExecuted
        || *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *authority_info.key != config.authority_pda
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let verification = load_programdata_verification_for_failure(
        program_id,
        verification_info,
        primary_info,
        config_info,
        &config,
        &primary,
    )?;
    if verification.status == ProgramDataVerificationStatusV1::Verified
        || verification.finalized_slot != 0
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let slot = Clock::get()?.slot;
    if slot == 0 || slot < primary.upgrade_executed_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let runtime = capture_runtime_observation(target_program, target_programdata)?;
    compare_failure_instruction_observation(&instruction, &runtime)?;
    let (expected_leaf_hash, actual_leaf_hash) = validate_mechanical_mismatch(
        &instruction,
        &runtime,
        target_programdata,
        &config,
        &primary,
        &verification,
    )?;

    let (expected_failure, failure_bump) =
        derive_programdata_failure_observation_pda(program_id, primary_info.key, gate.epoch);
    if *failure_info.key != expected_failure {
        return Err(GovernanceError::InvalidPda.into());
    }
    if failure_info.owner != &system_program::ID || failure_info.data_len() != 0 {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let mut failure = ProgramDataFailureObservationV1 {
        discriminator: PROGRAMDATA_FAILURE_OBSERVATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: failure_bump,
        initialized: true,
        finalized: true,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        primary_proposal: *primary_info.key,
        target_program: *target_program.key,
        target_programdata: *target_programdata.key,
        frozen_epoch: gate.epoch,
        actual_program_owner: runtime.program_owner,
        actual_program_executable: runtime.program_executable,
        actual_program_data_length: runtime.program_data_length,
        program_header_present: runtime.program_header_present,
        actual_linked_programdata: runtime.linked_programdata,
        raw_hash_complete: runtime.raw_hash_complete,
        actual_raw_programdata_sha256: runtime.raw_programdata_hash,
        actual_owner: runtime.programdata_owner,
        actual_executable: runtime.programdata_executable,
        actual_data_length: runtime.programdata_data_length,
        programdata_header_present: runtime.programdata_header_present,
        actual_programdata_slot: runtime.programdata_slot,
        actual_capacity: runtime.capacity,
        actual_authority: runtime.authority,
        mismatch_class: instruction.mismatch_class,
        failing_chunk_index: instruction.failing_chunk_index,
        expected_leaf_hash,
        actual_leaf_hash,
        finalized_slot: slot,
        observation_digest: [0; 32],
        reserved: [0; PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN],
    };
    failure.observation_digest = compute_programdata_failure_observation_digest_v1(&failure)?;
    validate_programdata_failure_observation_digest_v1(&failure)?;
    let failure_bytes = encode_fixed_account(&failure, ProgramDataFailureObservationV1::LEN)?;
    let epoch_seed = gate.epoch.to_le_bytes();
    let bump_seed = [failure_bump];
    let signer_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        PROGRAMDATA_FAILURE_OBSERVATION_SEED,
        primary_info.key.as_ref(),
        &epoch_seed,
        &bump_seed,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        failure_info,
        system_program_info,
        &Rent::get()?,
        ProgramDataFailureObservationV1::LEN,
        signer_seeds,
    )?;
    commit_one_fixed_account(
        program_id,
        failure_info,
        &failure_bytes,
        ProgramDataFailureObservationV1::LEN,
    )
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
    if derive_controller_config_pda(program_id, &config.target_program)
        != (*config_info.key, config.bump)
        || derive_authority_pda(program_id, &config.target_program).0 != config.authority_pda
        || derive_gate_pda(program_id, &config.target_program).0 != config.gate_pda
        || derive_upgradeable_programdata_address(&config.target_program).0
            != config.target_programdata
        || config.upgradeable_loader != UPGRADEABLE_LOADER_ID
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
    if derive_policy_pda(program_id, &config.target_program, policy.version)
        != (*policy_info.key, policy.bump)
        || policy.controller_config != *config_info.key
        || policy.target_program != config.target_program
        || policy.version != config.current_policy_version
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
    let council = load_fixed_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        council_info,
        GovernanceCouncilSetV1::LEN,
    )?;
    validate_council_set(&council, policy)?;
    validate_council_guardian_separation(&council, &config.guardian)?;
    if derive_council_pda(program_id, &config.target_program, council.version)
        != (*council_info.key, council.bump)
        || council.controller_config != *config_info.key
        || council.target_program != config.target_program
        || council.version != config.current_council_version
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
    if derive_gate_pda(program_id, &config.target_program) != (*gate_info.key, gate.bump)
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
    if derive_proposal_pda(program_id, &config.target_program, proposal.proposal_id)
        != (*proposal_info.key, proposal.bump)
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

fn require_policy_and_council_active(
    policy: &GovernancePolicyV1,
    council: &GovernanceCouncilSetV1,
    slot: u64,
) -> ProgramResult {
    if slot == 0 || slot < policy.activation_slot || !council.active_at(slot) {
        return Err(GovernanceError::InactivePolicy.into());
    }
    Ok(())
}

fn validate_active_primary_binding(
    primary: &UpgradeProposalV2,
    primary_key: &Pubkey,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    let consumed_nonce = primary
        .target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if gate.status != GateStatusV1::FrozenForUpgrade
        || gate.active_proposal != *primary_key
        || gate.epoch != primary.freeze_gate_epoch
        || gate.freeze_slot != primary.frozen_slot
        || gate.freeze_reason_code == 0
        || config.target_nonce != consumed_nonce
    {
        return Err(GovernanceError::InvalidProposalEpoch.into());
    }
    Ok(())
}

fn validate_frozen_proposal_binding(
    proposal: &UpgradeProposalV2,
    proposal_key: &Pubkey,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    validate_active_primary_binding(proposal, proposal_key, config, gate)
}

fn check_proposal_expectation_with_policy(
    expected: &ProposalExpectationV2,
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    if expected.expected_policy_version != policy.version
        || expected.expected_policy_hash != policy.policy_hash
    {
        return Err(GovernanceError::PolicyHashMismatch.into());
    }
    check_proposal_expectation_without_live_council(expected, proposal, config, gate)
}

fn check_proposal_expectation_without_live_council(
    expected: &ProposalExpectationV2,
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    if expected.expected_proposal_digest != proposal.proposal_digest
        || expected.expected_policy_version != proposal.policy_version
        || expected.expected_policy_hash != proposal.policy_hash
        || expected.expected_council_version != proposal.creation_council_version
        || expected.expected_council_hash != proposal.creation_council_hash
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

#[allow(clippy::too_many_arguments)]
fn validate_unfreeze_expectation(
    expected: &UnfreezeExpectationV1,
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    council: &GovernanceCouncilSetV1,
    gate: &ProtocolGateV1,
    proposal_key: &Pubkey,
) -> ProgramResult {
    if expected.expected_proposal_digest != proposal.proposal_digest
        || expected.expected_policy_version != policy.version
        || expected.expected_policy_hash != policy.policy_hash
        || expected.expected_policy_version != proposal.policy_version
        || expected.expected_policy_hash != proposal.policy_hash
        || expected.expected_current_council_version != council.version
        || expected.expected_current_council_hash != council.set_hash
        || expected.expected_frozen_gate_epoch != gate.epoch
        || expected.expected_target_nonce != config.target_nonce
        || expected.expected_proposal_state != proposal.state
        || expected.expected_unfreeze_approval_bitset != proposal.unfreeze_approval_bitset
        || expected.expected_unfreeze_approval_count != proposal.unfreeze_approval_count
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_frozen_proposal_binding(proposal, proposal_key, config, gate)
}

fn validate_unfreeze_evidence_expectation(
    expected: &UnfreezeExpectationV1,
    poststate: &StateCheckpointV1,
    verification: &ProgramDataVerificationV1,
    config: &ControllerConfigV1,
) -> ProgramResult {
    if expected.expected_poststate_checkpoint_digest != poststate.checkpoint_digest
        || expected.expected_programdata_authority != config.authority_pda
        || expected.expected_programdata_deployed_slot != verification.deployed_slot
        || expected.expected_programdata_capacity != verification.capacity
        || expected.expected_raw_programdata_hash != verification.raw_programdata_hash
        || expected.expected_programdata_verification_finalized_slot != verification.finalized_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_exact_current_quorum(
    council: &GovernanceCouncilSetV1,
    approval_council_version: u64,
    approval_council_hash: &[u8; 32],
    bitset: u8,
    count: u8,
    slot: u64,
) -> ProgramResult {
    if approval_council_version != council.version
        || approval_council_hash != &council.set_hash
        || bitset & !VALID_APPROVAL_MASK != 0
        || bitset.count_ones() as u8 != count
        || count != RELEASE1_APPROVAL_THRESHOLD
        || !council.active_at(slot)
    {
        return Err(GovernanceError::QuorumNotSatisfied.into());
    }
    for (index, seat) in council.seats.iter().enumerate() {
        if bitset & (1u8 << index) != 0 && !seat.term_covers(slot) {
            return Err(GovernanceError::InactiveCouncilSeat.into());
        }
    }
    Ok(())
}

fn prepare_unfreeze_accumulator(
    proposal: &mut UpgradeProposalV2,
    council: &GovernanceCouncilSetV1,
) -> ProgramResult {
    let stale_accumulator = proposal.unfreeze_approval_count != 0
        && (proposal.unfreeze_council_version != council.version
            || proposal.unfreeze_council_hash != council.set_hash);
    if stale_accumulator {
        proposal.unfreeze_council_version = 0;
        proposal.unfreeze_council_hash = [0; 32];
        proposal.unfreeze_approval_bitset = 0;
        proposal.unfreeze_approval_count = 0;
        proposal.unfreeze_approved_slot = 0;
        proposal.state = ProposalStateV2::PoststateAccepted;
    } else if proposal.state == ProposalStateV2::UnfreezeApproved {
        return Err(GovernanceError::DuplicateApproval.into());
    }
    Ok(())
}

fn validate_close_identities(
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    verification: &Pubkey,
    buffer: &Pubkey,
    treasury: &Pubkey,
    authority: &Pubkey,
) -> ProgramResult {
    if *buffer != proposal.buffer_pubkey
        || *verification != proposal.buffer_verification
        || *treasury != config.canonical_spill_treasury
        || *treasury != proposal.canonical_spill_treasury
        || *authority != config.authority_pda
        || *authority != proposal.authority_pda
    {
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

fn validate_rollback_activation_timing(
    primary: &UpgradeProposalV2,
    rollback: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    slot: u64,
) -> ProgramResult {
    let rollback_ready_slot = primary
        .upgrade_executed_slot
        .checked_add(config.rollback_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    // Activation is permissionless once the failure evidence and delay are
    // satisfied. Preserve one full checkpoint review window plus the later
    // no-extension rollback execution slot, otherwise a caller could activate
    // at the tail of expiry and strand the target in the new frozen epoch.
    let execution_horizon = slot
        .checked_add(config.council_review_slots())
        .and_then(|value| value.checked_add(1))
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if slot == 0
        || primary.upgrade_executed_slot == 0
        || slot < rollback.not_before_slot
        || slot < rollback_ready_slot
        || slot >= rollback.expiry_slot
        || execution_horizon >= rollback.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn load_verified_programdata(
    program_id: &Pubkey,
    verification_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
) -> Result<Box<ProgramDataVerificationV1>, ProgramError> {
    let verification = load_programdata_verification_for_failure(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        config,
        proposal,
    )?;
    if verification.status != ProgramDataVerificationStatusV1::Verified
        || !verification.zero_tail_verified
        || verification.raw_programdata_hash == [0; 32]
        || verification.finalized_slot == 0
        || proposal.programdata_verified_slot != verification.finalized_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    Ok(verification)
}

fn load_programdata_verification_for_failure(
    program_id: &Pubkey,
    verification_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
) -> Result<Box<ProgramDataVerificationV1>, ProgramError> {
    let verification = load_fixed_controller_account::<ProgramDataVerificationV1>(
        program_id,
        verification_info,
        ProgramDataVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    if derive_programdata_check_pda(program_id, proposal_info.key)
        != (*verification_info.key, verification.bump)
        || *verification_info.key != proposal.programdata_verification
        || verification.controller_config != *config_info.key
        || verification.proposal != *proposal_info.key
        || verification.target_program != config.target_program
        || verification.target_programdata != config.target_programdata
        || verification.upgradeable_loader != config.upgradeable_loader
        || verification.controller_authority != config.authority_pda
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_chunk_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.chunk_hash_domain != proposal.chunk_hash_domain
        || verification.chunk_size != proposal.chunk_size
        || verification.payload_chunk_count != proposal.chunk_count
        || verification.deployed_slot != proposal.upgrade_executed_slot
        || verification.capacity != proposal.expected_post_capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

#[allow(clippy::too_many_arguments)]
fn load_accepted_poststate(
    program_id: &Pubkey,
    checkpoint_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    gate: &ProtocolGateV1,
    verification: &ProgramDataVerificationV1,
) -> Result<Box<StateCheckpointV1>, ProgramError> {
    let checkpoint = load_fixed_controller_account::<StateCheckpointV1>(
        program_id,
        checkpoint_info,
        StateCheckpointV1::LEN,
    )?;
    validate_state_checkpoint_digest_v1(&checkpoint)?;
    if derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Poststate)
        != (*checkpoint_info.key, checkpoint.bump)
        || *checkpoint_info.key != proposal.required_poststate_checkpoint
        || checkpoint.phase != StateCheckpointPhaseV1::Poststate
        || checkpoint.controller_config != *config_info.key
        || checkpoint.proposal != *proposal_info.key
        || checkpoint.emergency_resolution != Pubkey::default()
        || checkpoint.subject_digest != proposal.proposal_digest
        || checkpoint.target_program != config.target_program
        || checkpoint.target_programdata != config.target_programdata
        || checkpoint.gate_epoch != gate.epoch
        || checkpoint.target_programdata_slot != verification.deployed_slot
        || checkpoint.target_raw_programdata_commitment != verification.raw_programdata_hash
        || checkpoint.target_capacity != verification.capacity
        || !checkpoint.accepted
        || checkpoint.forbidden_drift_count != 0
        || checkpoint.finalized_slot == 0
        || checkpoint.finalized_slot != proposal.poststate_accepted_slot
        || checkpoint.finalized_slot < verification.finalized_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(checkpoint)
}

#[allow(clippy::too_many_arguments)]
fn validate_live_verified_programdata(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    authority_info: &AccountInfo<'_>,
    loader_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    verification: &ProgramDataVerificationV1,
) -> ProgramResult {
    if *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *authority_info.key != config.authority_pda
        || *loader_info.key != config.upgradeable_loader
        || *loader_info.key != UPGRADEABLE_LOADER_ID
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let header = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    let data = target_programdata.try_borrow_data()?;
    if u64::try_from(data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?
        > MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1
        || header.upgrade_authority != Some(config.authority_pda)
        || header.deployed_slot != verification.deployed_slot
        || header.capacity as u64 != verification.capacity
        || verification.capacity != proposal.expected_post_capacity
        || loader_account_data_hash(&data) != verification.raw_programdata_hash
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    Ok(())
}

fn terminalize_unfreeze_pair(
    proposal: &UpgradeProposalV2,
    proposal_key: &Pubkey,
    linked: &mut UpgradeProposalV2,
    linked_key: &Pubkey,
    slot: u64,
) -> ProgramResult {
    match proposal.proposal_class {
        ProposalClassV1::EmergencyRollback => {
            if !proposal.primary_proposal.present
                || proposal.primary_proposal.value != *linked_key
                || linked.proposal_class == ProposalClassV1::EmergencyRollback
                || !linked.rollback_proposal.present
                || linked.rollback_proposal.value != *proposal_key
                || !linked.rollback_buffer.present
                || linked.rollback_buffer.value != proposal.buffer_pubkey
                || linked.rollback_artifact_sha256 != proposal.artifact_sha256
                || linked.rollback_artifact_chunk_root != proposal.artifact_chunk_merkle_root
                || linked.target_nonce != proposal.target_nonce
                || linked.checkpoint_schema_id != proposal.checkpoint_schema_id
                || linked.checkpoint_policy_hash != proposal.checkpoint_policy_hash
                || !matches!(
                    linked.state,
                    ProposalStateV2::UpgradeExecuted | ProposalStateV2::ProgramDataVerified
                )
            {
                return Err(GovernanceError::InvalidProposalCommitment.into());
            }
            linked.state = ProposalStateV2::SupersededByRollback;
            linked.terminal_slot = slot;
            linked.terminal_reason_code = PROPOSAL_SUPERSEDED_BY_ROLLBACK_TERMINAL_REASON_V1;
        }
        ProposalClassV1::RoutineUpgrade
        | ProposalClassV1::EconomicChange
        | ProposalClassV1::ConstitutionalChange => {
            if !proposal.rollback_proposal.present
                || proposal.rollback_proposal.value != *linked_key
                || !proposal.rollback_buffer.present
                || proposal.rollback_buffer.value != linked.buffer_pubkey
                || proposal.rollback_artifact_sha256 != linked.artifact_sha256
                || proposal.rollback_artifact_chunk_root != linked.artifact_chunk_merkle_root
                || linked.proposal_class != ProposalClassV1::EmergencyRollback
                || !linked.primary_proposal.present
                || linked.primary_proposal.value != *proposal_key
                || linked.rollback_proposal.present
                || linked.rollback_buffer.present
                || linked.target_nonce != proposal.target_nonce
                || linked.checkpoint_schema_id != proposal.checkpoint_schema_id
                || linked.checkpoint_policy_hash != proposal.checkpoint_policy_hash
                || linked.state != ProposalStateV2::Timelocked
            {
                return Err(GovernanceError::InvalidProposalCommitment.into());
            }
            linked.state = ProposalStateV2::Retired;
            linked.terminal_slot = slot;
            linked.terminal_reason_code = PROPOSAL_RETIRED_ROLLBACK_TERMINAL_REASON_V1;
        }
        ProposalClassV1::CouncilSetRotation | ProposalClassV1::TargetImmutability => {
            return Err(GovernanceError::UnsupportedProposalClass.into());
        }
    }
    Ok(())
}

fn validate_reciprocal_rollback(
    primary: &UpgradeProposalV2,
    primary_key: &Pubkey,
    rollback: &UpgradeProposalV2,
    rollback_key: &Pubkey,
    config: &ControllerConfigV1,
) -> ProgramResult {
    verify_exact_proposal_timing(rollback, config)?;
    let consumed_nonce = primary
        .target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if primary.proposal_class == ProposalClassV1::EmergencyRollback
        || !primary.rollback_proposal.present
        || primary.rollback_proposal.value != *rollback_key
        || !primary.rollback_buffer.present
        || primary.rollback_buffer.value != rollback.buffer_pubkey
        || primary.rollback_artifact_sha256 != rollback.artifact_sha256
        || primary.rollback_artifact_chunk_root != rollback.artifact_chunk_merkle_root
        || rollback.proposal_class != ProposalClassV1::EmergencyRollback
        || !rollback.primary_proposal.present
        || rollback.primary_proposal.value != *primary_key
        || rollback.rollback_proposal.present
        || rollback.rollback_buffer.present
        || rollback.target_nonce != primary.target_nonce
        || rollback.checkpoint_schema_id != primary.checkpoint_schema_id
        || rollback.checkpoint_policy_hash != primary.checkpoint_policy_hash
        || config.target_nonce != consumed_nonce
        || rollback.controller_config != primary.controller_config
        || rollback.protocol_gate != primary.protocol_gate
        || rollback.target_program != primary.target_program
        || rollback.target_programdata != primary.target_programdata
        || rollback.upgradeable_loader != primary.upgradeable_loader
        || rollback.authority_pda != primary.authority_pda
        || rollback.canonical_spill_treasury != primary.canonical_spill_treasury
        || rollback.buffer_loader_owner != config.upgradeable_loader
        || rollback.buffer_final_authority != config.authority_pda
        || rollback.expected_execution_pre_chunk_root != primary.artifact_chunk_merkle_root
        || rollback.current_capacity != primary.expected_post_capacity
        || rollback.expected_post_capacity != primary.expected_post_capacity
        || rollback.extension_delta != 0
        || rollback.council_approval_bitset & !VALID_APPROVAL_MASK != 0
        || rollback.council_approval_bitset.count_ones() as u8 != rollback.council_approval_count
        || rollback.council_approval_count != RELEASE1_APPROVAL_THRESHOLD
        || rollback.governance_satisfied_slot == 0
        || rollback.queued_slot == 0
    {
        return Err(GovernanceError::InvalidProposalCommitment.into());
    }
    Ok(())
}

fn validate_abandoned_buffer_close_state(
    proposal: &UpgradeProposalV2,
    proposal_key: &Pubkey,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    let closable = matches!(
        proposal.state,
        ProposalStateV2::Cancelled | ProposalStateV2::Expired
    ) || proposal.state == ProposalStateV2::Retired
        && proposal.proposal_class == ProposalClassV1::EmergencyRollback;
    if !closable || gate.active_proposal == *proposal_key {
        return Err(GovernanceError::InvalidStateTransition.into());
    }

    // Cancelled/Expired is only a legitimate rollback terminal while its
    // linked primary has not crossed the freeze boundary. Once that exact
    // primary is the active frozen proposal and has consumed the nonce, its
    // sealed rollback buffer is mandatory recovery custody. The ordinary
    // successful unfreeze path retires the rollback atomically, after which
    // the buffer may be closed through the explicit Retired lane.
    if proposal.proposal_class == ProposalClassV1::EmergencyRollback
        && matches!(
            proposal.state,
            ProposalStateV2::Cancelled | ProposalStateV2::Expired
        )
    {
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
    }
    Ok(())
}

fn load_buffer_verification(
    program_id: &Pubkey,
    verification_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    buffer_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
) -> Result<Box<BufferVerificationV1>, ProgramError> {
    let verification = load_buffer_verification_without_live_buffer(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        config,
        proposal,
    )?;
    if verification.buffer != *buffer_info.key {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

fn load_buffer_verification_without_live_buffer(
    program_id: &Pubkey,
    verification_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
) -> Result<Box<BufferVerificationV1>, ProgramError> {
    let verification = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        verification_info,
        BufferVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    if derive_buffer_check_pda(program_id, proposal_info.key)
        != (*verification_info.key, verification.bump)
        || *verification_info.key != proposal.buffer_verification
        || verification.controller_config != *config_info.key
        || verification.proposal != *proposal_info.key
        || verification.upgradeable_loader != config.upgradeable_loader
        || verification.buffer != proposal.buffer_pubkey
        || verification.expected_uploader_authority != proposal.buffer_uploader_authority
        || verification.controller_authority != config.authority_pda
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_chunk_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.chunk_hash_domain != proposal.chunk_hash_domain
        || verification.chunk_size != proposal.chunk_size
        || verification.chunk_count != proposal.chunk_count
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

#[allow(clippy::too_many_arguments)]
fn validate_rollback_failure_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    primary_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    primary: &UpgradeProposalV2,
    verification: &ProgramDataVerificationV1,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    authority_info: &AccountInfo<'_>,
    loader_info: &AccountInfo<'_>,
    expected_digest: &[u8; 32],
    slot: u64,
) -> ProgramResult {
    match evidence_info.data_len() {
        ProgramDataFailureObservationV1::LEN => {
            if primary.state != ProposalStateV2::UpgradeExecuted
                || verification.status == ProgramDataVerificationStatusV1::Verified
                || verification.finalized_slot != 0
            {
                return Err(GovernanceError::InvalidStateTransition.into());
            }
            let failure = load_failure_observation(
                program_id,
                evidence_info,
                primary_info,
                config_info,
                gate_info,
                config,
                gate,
                primary,
            )?;
            if failure.observation_digest != *expected_digest
                || failure.finalized_slot < primary.upgrade_executed_slot
                || failure.finalized_slot > slot
            {
                return Err(GovernanceError::CrossAccountMismatch.into());
            }
            require_recoverable_rollback_failure_observation(&failure, config, verification)?;
            let runtime = capture_runtime_observation(target_program, target_programdata)?;
            require_observation_unchanged(&runtime, &failure)
        }
        StateCheckpointV1::LEN => {
            if primary.state != ProposalStateV2::ProgramDataVerified
                || verification.status != ProgramDataVerificationStatusV1::Verified
                || verification.finalized_slot == 0
                || verification.finalized_slot != primary.programdata_verified_slot
            {
                return Err(GovernanceError::InvalidStateTransition.into());
            }
            let checkpoint = load_rejected_poststate_failure(
                program_id,
                evidence_info,
                primary_info,
                config_info,
                config,
                gate,
                primary,
                verification,
                slot,
            )?;
            if checkpoint.checkpoint_digest != *expected_digest {
                return Err(GovernanceError::Release1DigestMismatch.into());
            }
            validate_live_verified_programdata(
                target_program,
                target_programdata,
                authority_info,
                loader_info,
                config,
                primary,
                verification,
            )
        }
        _ => Err(GovernanceError::InvalidAccountSize.into()),
    }
}

/// Only byte failures leave the canonical Loader-v3 graph usable by the typed
/// rollback CPI. Header, authority, and capacity failures are immutable audit
/// evidence, but activating a rollback for them would consume the one-way gate
/// transition into a lifecycle that cannot bind an executable Prestate.
fn require_recoverable_rollback_failure_observation(
    failure: &ProgramDataFailureObservationV1,
    config: &ControllerConfigV1,
    verification: &ProgramDataVerificationV1,
) -> ProgramResult {
    if !matches!(
        failure.mismatch_class,
        ProgramDataMismatchClassV1::PayloadLeaf | ProgramDataMismatchClassV1::ZeroTail
    ) {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let expected_data_length = failure
        .actual_capacity
        .checked_add(LOADER_PROGRAMDATA_METADATA_LEN as u64)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if failure.actual_program_owner != config.upgradeable_loader
        || !failure.actual_program_executable
        || failure.actual_program_data_length != LOADER_PROGRAM_ACCOUNT_LEN as u64
        || !failure.program_header_present
        || linked_value(&failure.actual_linked_programdata) != Some(config.target_programdata)
        || !failure.raw_hash_complete
        || failure.actual_raw_programdata_sha256 == [0; 32]
        || failure.actual_owner != config.upgradeable_loader
        || failure.actual_executable
        || failure.actual_data_length != expected_data_length
        || !failure.programdata_header_present
        || failure.actual_programdata_slot != verification.deployed_slot
        || failure.actual_capacity != verification.capacity
        || linked_value(&failure.actual_authority) != Some(config.authority_pda)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_rejected_poststate_failure(
    program_id: &Pubkey,
    checkpoint_info: &AccountInfo<'_>,
    primary_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    primary: &UpgradeProposalV2,
    verification: &ProgramDataVerificationV1,
    slot: u64,
) -> Result<Box<StateCheckpointV1>, ProgramError> {
    let checkpoint = load_fixed_controller_account::<StateCheckpointV1>(
        program_id,
        checkpoint_info,
        StateCheckpointV1::LEN,
    )?;
    validate_state_checkpoint_digest_v1(&checkpoint)?;
    if derive_checkpoint_pda(program_id, primary_info.key, CheckpointPhaseV1::Poststate)
        != (*checkpoint_info.key, checkpoint.bump)
        || *checkpoint_info.key != primary.required_poststate_checkpoint
        || checkpoint.phase != StateCheckpointPhaseV1::Poststate
        || checkpoint.controller_config != *config_info.key
        || checkpoint.proposal != *primary_info.key
        || checkpoint.emergency_resolution != Pubkey::default()
        || checkpoint.subject_digest != primary.proposal_digest
        || checkpoint.target_program != config.target_program
        || checkpoint.target_programdata != config.target_programdata
        || checkpoint.gate_epoch != gate.epoch
        || checkpoint.gate_epoch != primary.freeze_gate_epoch
        || checkpoint.target_programdata_slot != verification.deployed_slot
        || checkpoint.target_raw_programdata_commitment != verification.raw_programdata_hash
        || checkpoint.target_capacity != verification.capacity
        || checkpoint.schema_identifier != primary.checkpoint_schema_id
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_rejected_checkpoint_finalization(&checkpoint, verification.finalized_slot, slot)?;
    Ok(checkpoint)
}

fn validate_rejected_checkpoint_finalization(
    checkpoint: &StateCheckpointV1,
    verification_finalized_slot: u64,
    current_slot: u64,
) -> ProgramResult {
    let approval_mask_is_exact = checkpoint.approval_bitset & !VALID_APPROVAL_MASK == 0
        && checkpoint.approval_bitset.count_ones() as u8 == checkpoint.approval_count
        && checkpoint.approval_count == RELEASE1_APPROVAL_THRESHOLD;
    if checkpoint.accepted
        || checkpoint.forbidden_drift_count == 0
        || checkpoint.approval_council_version == 0
        || checkpoint.approval_council_hash == [0; 32]
        || !approval_mask_is_exact
        || checkpoint.finalized_slot < verification_finalized_slot
        || checkpoint.finalized_slot > current_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_failure_observation(
    program_id: &Pubkey,
    failure_info: &AccountInfo<'_>,
    primary_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    primary: &UpgradeProposalV2,
) -> Result<Box<ProgramDataFailureObservationV1>, ProgramError> {
    let failure = load_fixed_controller_account::<ProgramDataFailureObservationV1>(
        program_id,
        failure_info,
        ProgramDataFailureObservationV1::LEN,
    )?;
    validate_programdata_failure_observation_digest_v1(&failure)?;
    if derive_programdata_failure_observation_pda(program_id, primary_info.key, gate.epoch)
        != (*failure_info.key, failure.bump)
        || failure.controller_config != *config_info.key
        || failure.protocol_gate != *gate_info.key
        || failure.primary_proposal != *primary_info.key
        || failure.target_program != config.target_program
        || failure.target_programdata != config.target_programdata
        || failure.frozen_epoch != gate.epoch
        || failure.frozen_epoch != primary.freeze_gate_epoch
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(failure)
}

fn capture_runtime_observation(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
) -> Result<RuntimeProgramDataObservationV1, ProgramError> {
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
    Ok(RuntimeProgramDataObservationV1 {
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

fn optional_pubkey(value: Option<Pubkey>) -> GovernanceResult<OptionalPubkeyV1> {
    match value {
        Some(value) => OptionalPubkeyV1::some(value),
        None => Ok(OptionalPubkeyV1::none()),
    }
}

fn linked_value(value: &OptionalPubkeyV1) -> Option<Pubkey> {
    value.present.then_some(value.value)
}

fn compare_failure_instruction_observation(
    instruction: &ObserveProgramDataFailureV1,
    actual: &RuntimeProgramDataObservationV1,
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

fn require_observation_unchanged(
    actual: &RuntimeProgramDataObservationV1,
    observation: &ProgramDataFailureObservationV1,
) -> ProgramResult {
    if actual.program_owner != observation.actual_program_owner
        || actual.program_executable != observation.actual_program_executable
        || actual.program_data_length != observation.actual_program_data_length
        || actual.program_header_present != observation.program_header_present
        || actual.linked_programdata != observation.actual_linked_programdata
        || actual.programdata_owner != observation.actual_owner
        || actual.programdata_executable != observation.actual_executable
        || actual.programdata_data_length != observation.actual_data_length
        || actual.programdata_header_present != observation.programdata_header_present
        || actual.programdata_slot != observation.actual_programdata_slot
        || actual.raw_hash_complete != observation.raw_hash_complete
        || actual.raw_programdata_hash != observation.actual_raw_programdata_sha256
        || actual.capacity != observation.actual_capacity
        || actual.authority != observation.actual_authority
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn validate_mechanical_mismatch(
    instruction: &ObserveProgramDataFailureV1,
    actual: &RuntimeProgramDataObservationV1,
    target_programdata: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    verification: &ProgramDataVerificationV1,
) -> Result<([u8; 32], [u8; 32]), ProgramError> {
    let structural_match = actual.program_owner == config.upgradeable_loader
        && actual.program_executable
        && actual.program_data_length == LOADER_PROGRAM_ACCOUNT_LEN as u64
        && actual.program_header_present
        && linked_value(&actual.linked_programdata) == Some(config.target_programdata)
        && actual.programdata_owner == config.upgradeable_loader
        && !actual.programdata_executable
        && actual.programdata_header_present
        && actual.programdata_slot == verification.deployed_slot;
    let authority_match = linked_value(&actual.authority) == Some(config.authority_pda);
    let capacity_match = actual.capacity == verification.capacity;

    match instruction.mismatch_class {
        ProgramDataMismatchClassV1::Header => {
            if structural_match {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV1::Authority => {
            if !structural_match || authority_match {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV1::Capacity => {
            if !structural_match || !authority_match || capacity_match {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV1::PayloadLeaf => {
            if !structural_match || !authority_match || !capacity_match || !actual.raw_hash_complete
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            let data = target_programdata.try_borrow_data()?;
            let payload = data
                .get(LOADER_PROGRAMDATA_METADATA_LEN..)
                .ok_or(GovernanceError::InvalidRelease1Account)?;
            let exact = exact_region_chunk(
                payload,
                0,
                proposal.artifact_length,
                proposal.chunk_size,
                instruction.failing_chunk_index,
            )?;
            require_verified_prefix(
                &verification.verified_payload_chunk_bitmap,
                instruction.failing_chunk_index,
            )?;
            let actual_leaf = artifact_chunk_leaf_hash(instruction.failing_chunk_index, exact)?;
            validate_expected_leaf_proof(
                &proposal.artifact_chunk_merkle_root,
                proposal.artifact_length,
                proposal.chunk_size,
                instruction.failing_chunk_index,
                &instruction.expected_leaf_hash,
                &instruction.proof,
            )?;
            if actual_leaf == instruction.expected_leaf_hash {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok((instruction.expected_leaf_hash, actual_leaf))
        }
        ProgramDataMismatchClassV1::ZeroTail => {
            if !structural_match
                || !authority_match
                || !capacity_match
                || !actual.raw_hash_complete
                || !proposal.zero_tail_required
                || verification.verified_payload_chunk_count != verification.payload_chunk_count
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            let tail_length = verification
                .capacity
                .checked_sub(verification.artifact_length)
                .ok_or(GovernanceError::InvalidCapacityPlan)?;
            let data = target_programdata.try_borrow_data()?;
            let payload = data
                .get(LOADER_PROGRAMDATA_METADATA_LEN..)
                .ok_or(GovernanceError::InvalidRelease1Account)?;
            let exact = exact_region_chunk(
                payload,
                verification.artifact_length,
                tail_length,
                verification.chunk_size,
                instruction.failing_chunk_index,
            )?;
            require_verified_prefix(
                &verification.verified_tail_chunk_bitmap,
                instruction.failing_chunk_index,
            )?;
            let expected_leaf =
                programdata_zero_tail_zero_hash(instruction.failing_chunk_index, exact.len())?;
            let actual_leaf =
                programdata_zero_tail_chunk_hash(instruction.failing_chunk_index, exact)?;
            if instruction.expected_leaf_hash != expected_leaf
                || actual_leaf == expected_leaf
                || exact.iter().all(|byte| *byte == 0)
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok((expected_leaf, actual_leaf))
        }
    }
}

fn require_verified_prefix(
    bitmap: &[u8; VERIFICATION_BITMAP_BYTES_V1],
    failing_index: u32,
) -> ProgramResult {
    let bitmap_capacity = u32::try_from(VERIFICATION_BITMAP_BYTES_V1)
        .map_err(|_| GovernanceError::ArithmeticOverflow)?
        .checked_mul(8)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if failing_index >= bitmap_capacity {
        return Err(GovernanceError::InvalidRelease1Bitmap.into());
    }
    for index in 0..failing_index {
        let byte_index =
            usize::try_from(index / 8).map_err(|_| GovernanceError::ArithmeticOverflow)?;
        let bit = 1u8 << (index % 8);
        if bitmap[byte_index] & bit == 0 {
            return Err(GovernanceError::InvalidRelease1Bitmap.into());
        }
    }
    Ok(())
}

fn programdata_zero_tail_chunk_hash(
    chunk_index: u32,
    exact_chunk: &[u8],
) -> Result<[u8; 32], ProgramError> {
    if exact_chunk.is_empty() || exact_chunk.len() > MAX_PROGRAMDATA_ZERO_TAIL_CHUNK_BYTES_V1 {
        return Err(GovernanceError::InvalidMerkleParameters.into());
    }
    let actual_length =
        u32::try_from(exact_chunk.len()).map_err(|_| GovernanceError::InvalidMerkleParameters)?;
    Ok(hashv(&[
        PROGRAMDATA_ZERO_TAIL_CHUNK_DOMAIN_V1,
        &chunk_index.to_le_bytes(),
        &actual_length.to_le_bytes(),
        exact_chunk,
    ])
    .to_bytes())
}

fn programdata_zero_tail_zero_hash(
    chunk_index: u32,
    actual_length: usize,
) -> Result<[u8; 32], ProgramError> {
    if actual_length == 0 || actual_length > MAX_PROGRAMDATA_ZERO_TAIL_CHUNK_BYTES_V1 {
        return Err(GovernanceError::InvalidMerkleParameters.into());
    }
    let length_bytes = u32::try_from(actual_length)
        .map_err(|_| GovernanceError::InvalidMerkleParameters)?
        .to_le_bytes();
    let index_bytes = chunk_index.to_le_bytes();
    let mut slices: [&[u8]; MAX_PROGRAMDATA_ZERO_HASH_BLOCKS_V1 + 4] =
        [&[]; MAX_PROGRAMDATA_ZERO_HASH_BLOCKS_V1 + 4];
    slices[0] = PROGRAMDATA_ZERO_TAIL_CHUNK_DOMAIN_V1;
    slices[1] = &index_bytes;
    slices[2] = &length_bytes;
    let full_blocks = actual_length / PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1;
    let remainder = actual_length % PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1;
    for slice in &mut slices[3..3 + full_blocks] {
        *slice = &PROGRAMDATA_ZERO_HASH_BLOCK_V1;
    }
    let slice_count = if remainder == 0 {
        3 + full_blocks
    } else {
        slices[3 + full_blocks] = &PROGRAMDATA_ZERO_HASH_BLOCK_V1[..remainder];
        4 + full_blocks
    };
    Ok(hashv(&slices[..slice_count]).to_bytes())
}

fn validate_expected_leaf_proof(
    expected_root: &[u8; 32],
    artifact_length: u64,
    chunk_size: u32,
    chunk_index: u32,
    expected_leaf: &[u8; 32],
    proof: &FixedMerkleProofV1,
) -> ProgramResult {
    proof.validate()?;
    let chunk_count = artifact_chunk_count(artifact_length, chunk_size)?;
    if chunk_index >= chunk_count || *expected_leaf == [0; 32] {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    let padded_count = (chunk_count as usize).next_power_of_two();
    let expected_depth = padded_count.trailing_zeros() as usize;
    let proof_len = usize::from(proof.proof_len);
    if proof_len != expected_depth || proof_len > MAX_ARTIFACT_PROOF_DEPTH_V1 {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    let mut current = *expected_leaf;
    let mut index = chunk_index;
    for (level, sibling) in proof.nodes[..proof_len].iter().enumerate() {
        validate_padding_sibling(sibling, index, level, chunk_count as usize, padded_count)?;
        current = if index & 1 == 0 {
            artifact_chunk_node_hash(&current, sibling)
        } else {
            artifact_chunk_node_hash(sibling, &current)
        };
        index >>= 1;
    }
    if &current != expected_root {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    Ok(())
}

fn validate_padding_sibling(
    sibling: &[u8; 32],
    node_index: u32,
    proof_level: usize,
    chunk_count: usize,
    padded_count: usize,
) -> ProgramResult {
    if proof_level >= MAX_ARTIFACT_PROOF_DEPTH_V1 {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    let sibling_leaf_count = 1usize
        .checked_shl(proof_level as u32)
        .ok_or(GovernanceError::InvalidMerkleProof)?;
    let sibling_node_index = (node_index as usize) ^ 1;
    let sibling_start = sibling_node_index
        .checked_mul(sibling_leaf_count)
        .ok_or(GovernanceError::InvalidMerkleProof)?;
    let sibling_end = sibling_start
        .checked_add(sibling_leaf_count)
        .ok_or(GovernanceError::InvalidMerkleProof)?;
    if sibling_end > padded_count {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    if sibling_start >= chunk_count
        && sibling != &padding_subtree_hash(sibling_start, sibling_leaf_count)?
    {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    Ok(())
}

fn padding_subtree_hash(
    padded_start: usize,
    padded_leaf_count: usize,
) -> Result<[u8; 32], ProgramError> {
    let padded_end = padded_start
        .checked_add(padded_leaf_count)
        .ok_or(GovernanceError::InvalidMerkleProof)?;
    if padded_leaf_count == 0
        || !padded_leaf_count.is_power_of_two()
        || padded_start % padded_leaf_count != 0
        || padded_end > MAX_PADDED_ARTIFACT_CHUNKS_V1
    {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    let mut level = Vec::with_capacity(padded_leaf_count);
    for index in padded_start..padded_end {
        let index = u32::try_from(index).map_err(|_| GovernanceError::InvalidMerkleProof)?;
        level.push(artifact_chunk_empty_hash(index)?);
    }
    while level.len() > 1 {
        let mut next = Vec::with_capacity(level.len() / 2);
        for pair in level.chunks_exact(2) {
            next.push(artifact_chunk_node_hash(&pair[0], &pair[1]));
        }
        level = next;
    }
    level
        .pop()
        .ok_or_else(|| GovernanceError::InvalidMerkleProof.into())
}

fn exact_region_chunk(
    payload: &[u8],
    region_start: u64,
    region_length: u64,
    chunk_size: u32,
    chunk_index: u32,
) -> Result<&[u8], ProgramError> {
    let relative_start = u64::from(chunk_index)
        .checked_mul(u64::from(chunk_size))
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let remaining = region_length
        .checked_sub(relative_start)
        .ok_or(GovernanceError::InvalidMerkleProof)?;
    let length = remaining.min(u64::from(chunk_size));
    if length == 0 {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    let start = region_start
        .checked_add(relative_start)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let end = start
        .checked_add(length)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let start = usize::try_from(start).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let end = usize::try_from(end).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    payload
        .get(start..end)
        .ok_or_else(|| GovernanceError::InvalidMerkleProof.into())
}

fn derive_exact_timing(
    config: &ControllerConfigV1,
    class: ProposalClassV1,
    creation_slot: u64,
) -> Result<(u64, u64, u64, u64), ProgramError> {
    let delay = match class {
        ProposalClassV1::EmergencyRollback => config.rollback_delay_slots,
        ProposalClassV1::RoutineUpgrade => config.routine_delay_slots,
        ProposalClassV1::EconomicChange | ProposalClassV1::ConstitutionalChange => {
            config.major_delay_slots
        }
        ProposalClassV1::CouncilSetRotation | ProposalClassV1::TargetImmutability => {
            return Err(GovernanceError::UnsupportedProposalClass.into());
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
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok((review_start, review_end, not_before, expiry))
}

fn verify_exact_proposal_timing(
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
) -> ProgramResult {
    if derive_exact_timing(config, proposal.proposal_class, proposal.creation_slot)?
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

fn validate_canonical_envelope(
    program_id: &Pubkey,
    current_accounts: &[AccountInfo<'_>],
    instructions_info: &AccountInfo<'_>,
    expected_current_data: &[u8],
    envelope: &EnvelopeExpectationV1,
) -> ProgramResult {
    envelope.validate()?;
    if envelope.compute_unit_limit == 0
        || envelope.compute_unit_limit > MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1
        || envelope.compute_unit_price_micro_lamports
            > MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    let nonce = envelope.durable_nonce_account.value();
    let nonce_authority = envelope.durable_nonce_authority.value();
    if nonce.is_some() != nonce_authority.is_some() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let current_index = if nonce.is_some() { 3usize } else { 2usize };
    if usize::from(instructions::load_current_index_checked(instructions_info)?) != current_index {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let mut index = 0usize;
    if let (Some(nonce), Some(authority)) = (nonce, nonce_authority) {
        let actual = instructions::load_instruction_at_checked(index, instructions_info)?;
        if actual != system_instruction::advance_nonce_account(&nonce, &authority) {
            return Err(GovernanceError::CrossAccountMismatch.into());
        }
        index += 1;
    }
    let limit = instructions::load_instruction_at_checked(index, instructions_info)?;
    let mut limit_data = [0u8; 5];
    limit_data[0] = 2;
    limit_data[1..].copy_from_slice(&envelope.compute_unit_limit.to_le_bytes());
    if limit.program_id != compute_budget::ID
        || !limit.accounts.is_empty()
        || limit.data != limit_data
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    index += 1;
    let price = instructions::load_instruction_at_checked(index, instructions_info)?;
    let mut price_data = [0u8; 9];
    price_data[0] = 3;
    price_data[1..].copy_from_slice(&envelope.compute_unit_price_micro_lamports.to_le_bytes());
    if price.program_id != compute_budget::ID
        || !price.accounts.is_empty()
        || price.data != price_data
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    index += 1;
    let current = instructions::load_instruction_at_checked(index, instructions_info)?;
    if current.program_id != *program_id
        || current.data != expected_current_data
        || current.accounts.len() != current_accounts.len()
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    for (meta, info) in current.accounts.iter().zip(current_accounts) {
        if meta.pubkey != *info.key
            || meta.is_signer != info.is_signer
            || meta.is_writable != info.is_writable
        {
            return Err(GovernanceError::InvalidAccountPrivileges.into());
        }
    }
    if instructions::load_instruction_at_checked(index + 1, instructions_info).is_ok() {
        return Err(GovernanceError::InvalidAccountCount.into());
    }
    Ok(())
}

fn validate_close_cpi_shape(
    instruction: &Instruction,
    buffer: &Pubkey,
    treasury: &Pubkey,
    authority: &Pubkey,
) -> ProgramResult {
    let expected = [
        (*buffer, false, true),
        (*treasury, false, true),
        (*authority, true, false),
    ];
    if instruction.program_id != UPGRADEABLE_LOADER_ID
        || instruction.accounts.len() != expected.len()
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    for (meta, (key, signer, writable)) in instruction.accounts.iter().zip(expected) {
        if meta.pubkey != key || meta.is_signer != signer || meta.is_writable != writable {
            return Err(GovernanceError::CrossAccountMismatch.into());
        }
    }
    Ok(())
}

fn commit_one_fixed_account(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    bytes: &[u8],
    expected_len: usize,
) -> ProgramResult {
    if account.owner != program_id {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let mut data = account.try_borrow_mut_data()?;
    if data.len() != expected_len || bytes.len() != expected_len {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    data.copy_from_slice(bytes);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn commit_two_fixed_accounts(
    program_id: &Pubkey,
    first: &AccountInfo<'_>,
    first_bytes: &[u8],
    first_len: usize,
    second: &AccountInfo<'_>,
    second_bytes: &[u8],
    second_len: usize,
) -> ProgramResult {
    if first.owner != program_id || second.owner != program_id {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let mut first_data = first.try_borrow_mut_data()?;
    let mut second_data = second.try_borrow_mut_data()?;
    if first_data.len() != first_len
        || second_data.len() != second_len
        || first_bytes.len() != first_len
        || second_bytes.len() != second_len
    {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    first_data.copy_from_slice(first_bytes);
    second_data.copy_from_slice(second_bytes);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn commit_three_fixed_accounts(
    program_id: &Pubkey,
    first: &AccountInfo<'_>,
    first_bytes: &[u8],
    first_len: usize,
    second: &AccountInfo<'_>,
    second_bytes: &[u8],
    second_len: usize,
    third: &AccountInfo<'_>,
    third_bytes: &[u8],
    third_len: usize,
) -> ProgramResult {
    if first.owner != program_id || second.owner != program_id || third.owner != program_id {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let mut first_data = first.try_borrow_mut_data()?;
    let mut second_data = second.try_borrow_mut_data()?;
    let mut third_data = third.try_borrow_mut_data()?;
    if first_data.len() != first_len
        || second_data.len() != second_len
        || third_data.len() != third_len
        || first_bytes.len() != first_len
        || second_bytes.len() != second_len
        || third_bytes.len() != third_len
    {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    first_data.copy_from_slice(first_bytes);
    second_data.copy_from_slice(second_bytes);
    third_data.copy_from_slice(third_bytes);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use borsh::BorshDeserialize;
    use solana_program::instruction::AccountMeta;

    use crate::{
        artifact_merkle::{
            artifact_merkle_proof, artifact_merkle_root, RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
        },
        instruction::{OptionalInstructionPubkeyV1, MAX_FIXED_MERKLE_PROOF_NODES_V1},
        release1_digest::{
            compute_state_checkpoint_digest_v1, compute_state_checkpoint_hard_combined_root_v1,
        },
        state::{
            CouncilSeatV1, GovernanceModeV1, OptionalPubkeyV1, CONTROLLER_CONFIG_RESERVED_LEN,
            GOVERNANCE_COUNCIL_RESERVED_LEN, GOVERNANCE_POLICY_RESERVED_LEN,
        },
    };

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn bytes(byte: u8) -> [u8; 32] {
        [byte; 32]
    }

    fn decode_hex(value: &str) -> Vec<u8> {
        assert_eq!(value.len() % 2, 0);
        value
            .as_bytes()
            .chunks_exact(2)
            .map(|pair| {
                let pair = core::str::from_utf8(pair).unwrap();
                u8::from_str_radix(pair, 16).unwrap()
            })
            .collect()
    }

    fn fixture_account<T: BorshDeserialize>(name: &str) -> T {
        let fixture: serde_json::Value = serde_json::from_str(include_str!(
            "../../../fixtures/upgrade_governance_release1.json"
        ))
        .unwrap();
        let encoded = fixture["accounts"][name]["encoded_hex"].as_str().unwrap();
        T::try_from_slice(&decode_hex(encoded)).unwrap()
    }

    fn proposal_expectation() -> ProposalExpectationV2 {
        ProposalExpectationV2 {
            expected_proposal_digest: bytes(1),
            expected_policy_version: 1,
            expected_policy_hash: bytes(2),
            expected_council_version: 1,
            expected_council_hash: bytes(3),
            expected_gate_status: GateStatusV1::FrozenForUpgrade,
            expected_gate_epoch: 4,
            expected_target_nonce: 5,
            expected_state: ProposalStateV2::Timelocked,
            expected_review_start_slot: 6,
            expected_review_end_slot: 7,
            expected_not_before_slot: 8,
            expected_expiry_slot: 9,
        }
    }

    fn unfreeze_expectation() -> UnfreezeExpectationV1 {
        UnfreezeExpectationV1 {
            expected_proposal_digest: bytes(10),
            expected_policy_version: 1,
            expected_policy_hash: bytes(11),
            expected_current_council_version: 2,
            expected_current_council_hash: bytes(12),
            expected_frozen_gate_epoch: 13,
            expected_target_nonce: 14,
            expected_proposal_state: ProposalStateV2::PoststateAccepted,
            expected_poststate_checkpoint_digest: bytes(15),
            expected_programdata_authority: key(16),
            expected_programdata_deployed_slot: 17,
            expected_programdata_capacity: 18,
            expected_raw_programdata_hash: bytes(19),
            expected_unfreeze_approval_bitset: 0,
            expected_unfreeze_approval_count: 0,
            expected_programdata_verification_finalized_slot: 20,
        }
    }

    fn envelope() -> EnvelopeExpectationV1 {
        EnvelopeExpectationV1 {
            compute_unit_limit: 1_200_000,
            compute_unit_price_micro_lamports: 17,
            durable_nonce_account: OptionalInstructionPubkeyV1::none(),
            durable_nonce_authority: OptionalInstructionPubkeyV1::none(),
        }
    }

    fn empty_observation_instruction() -> ObserveProgramDataFailureV1 {
        ObserveProgramDataFailureV1 {
            expected: proposal_expectation(),
            expected_program_owner: key(21),
            expected_program_executable: false,
            expected_program_data_length: 0,
            expected_program_header_present: false,
            expected_linked_programdata: OptionalInstructionPubkeyV1::none(),
            expected_programdata_owner: key(22),
            expected_programdata_executable: false,
            expected_programdata_data_length: 0,
            expected_programdata_header_present: false,
            expected_programdata_slot: 0,
            expected_raw_hash_complete: true,
            expected_raw_programdata_hash: bytes(23),
            expected_capacity: 0,
            expected_programdata_authority: OptionalInstructionPubkeyV1::none(),
            mismatch_class: ProgramDataMismatchClassV1::Header,
            failing_chunk_index: u32::MAX,
            expected_leaf_hash: [0; 32],
            proof: FixedMerkleProofV1::empty(),
        }
    }

    fn sample_config(proposal: &UpgradeProposalV2) -> ControllerConfigV1 {
        ControllerConfigV1 {
            discriminator: [0; 8],
            version: 1,
            bump: 1,
            initialized: true,
            cluster_domain: proposal.cluster_domain,
            target_program: proposal.target_program,
            target_programdata: proposal.target_programdata,
            upgradeable_loader: proposal.upgradeable_loader,
            authority_pda: proposal.authority_pda,
            gate_pda: proposal.protocol_gate,
            canonical_spill_treasury: proposal.canonical_spill_treasury,
            current_council_version: 2,
            current_policy_version: proposal.policy_version,
            next_proposal_id: proposal.proposal_id + 2,
            target_nonce: proposal.target_nonce + 1,
            guardian: key(24),
            vote_program: Pubkey::default(),
            vote_programdata: Pubkey::default(),
            vote_config: Pubkey::default(),
            vote_mint: Pubkey::default(),
            token_governance_enabled: false,
            routine_delay_slots: 20,
            major_delay_slots: 30,
            rollback_delay_slots: 10,
            terminal_delay_slots: 40,
            vote_review_slots: 10,
            proposal_expiry_slots: 190,
            policy_flags: 0,
            reserved: [0; CONTROLLER_CONFIG_RESERVED_LEN],
        }
    }

    fn sample_policy(activation_slot: u64) -> GovernancePolicyV1 {
        GovernancePolicyV1 {
            discriminator: [0; 8],
            account_version: 1,
            bump: 1,
            initialized: true,
            controller_config: key(25),
            version: 1,
            target_program: key(26),
            activation_slot,
            council_size: 5,
            routine_threshold: 3,
            terminal_threshold: 4,
            governance_mode: GovernanceModeV1::BootstrapCouncilOnly,
            policy_flags: 0,
            veto_quorum_bps: 0,
            affirmative_quorum_bps: 0,
            affirmative_approval_bps: 0,
            routine_requires_vote: false,
            economic_requires_vote: false,
            constitutional_requires_vote: false,
            rotation_requires_vote: false,
            immutability_requires_vote: false,
            policy_hash: bytes(27),
            reserved: [0; GOVERNANCE_POLICY_RESERVED_LEN],
        }
    }

    fn sample_council(version: u64, set_hash: [u8; 32]) -> GovernanceCouncilSetV1 {
        GovernanceCouncilSetV1 {
            discriminator: [0; 8],
            account_version: 1,
            bump: 1,
            initialized: true,
            controller_config: key(28),
            version,
            target_program: key(29),
            activation_slot: 1,
            deactivation_slot: 0,
            seats: [CouncilSeatV1::default(); 5],
            routine_threshold: 3,
            terminal_threshold: 4,
            policy_flags: 0,
            set_hash,
            reserved: [0; GOVERNANCE_COUNCIL_RESERVED_LEN],
        }
    }

    fn reciprocal_pair() -> (UpgradeProposalV2, Pubkey, UpgradeProposalV2, Pubkey) {
        let mut primary: UpgradeProposalV2 = fixture_account("upgrade_proposal_v2");
        let primary_key = key(30);
        let rollback_key = key(31);
        let mut rollback = primary.clone();
        rollback.proposal_class = ProposalClassV1::EmergencyRollback;
        rollback.state = ProposalStateV2::Timelocked;
        rollback.buffer_pubkey = key(32);
        rollback.artifact_sha256 = bytes(33);
        rollback.artifact_chunk_merkle_root = bytes(34);
        rollback.primary_proposal = OptionalPubkeyV1::some(primary_key).unwrap();
        rollback.rollback_proposal = OptionalPubkeyV1::none();
        rollback.rollback_buffer = OptionalPubkeyV1::none();
        rollback.rollback_artifact_sha256 = [0; 32];
        rollback.rollback_artifact_chunk_root = [0; 32];
        rollback.target_nonce = primary.target_nonce;
        rollback.expected_execution_pre_payload_hash = bytes(35);
        rollback.expected_execution_pre_chunk_root = primary.artifact_chunk_merkle_root;
        rollback.current_capacity = primary.expected_post_capacity;
        rollback.expected_post_capacity = primary.expected_post_capacity;
        rollback.extension_delta = 0;
        rollback.creation_slot = 10;
        rollback.review_start_slot = 11;
        rollback.review_end_slot = 21;
        rollback.not_before_slot = 31;
        rollback.expiry_slot = 200;
        rollback.council_approval_bitset = 0b0_0111;
        rollback.council_approval_count = 3;
        rollback.governance_satisfied_slot = 22;
        rollback.queued_slot = 23;
        rollback.deployed_slot = 0;
        rollback.current_raw_programdata_hash = [0; 32];

        primary.rollback_proposal = OptionalPubkeyV1::some(rollback_key).unwrap();
        primary.rollback_buffer = OptionalPubkeyV1::some(rollback.buffer_pubkey).unwrap();
        primary.rollback_artifact_sha256 = rollback.artifact_sha256;
        primary.rollback_artifact_chunk_root = rollback.artifact_chunk_merkle_root;
        (primary, primary_key, rollback, rollback_key)
    }

    fn frozen_gate(active_proposal: Pubkey, proposal: &UpgradeProposalV2) -> ProtocolGateV1 {
        ProtocolGateV1 {
            discriminator: [0; 8],
            version: 1,
            bump: 1,
            initialized: true,
            status: GateStatusV1::FrozenForUpgrade,
            controller_config: proposal.controller_config,
            target_program: proposal.target_program,
            target_programdata: proposal.target_programdata,
            epoch: 2,
            active_proposal,
            freeze_slot: 100,
            freeze_reason_code: 2,
            last_completed_proposal: Pubkey::default(),
            reserved: [0; crate::state::PROTOCOL_GATE_RESERVED_LEN],
        }
    }

    fn leaked_account(
        account_key: Pubkey,
        owner: Pubkey,
        writable: bool,
        signer: bool,
        executable: bool,
        data: Vec<u8>,
    ) -> AccountInfo<'static> {
        let key_ref = Box::leak(Box::new(account_key));
        let owner_ref = Box::leak(Box::new(owner));
        let lamports = Box::leak(Box::new(1u64));
        let data = Box::leak(data.into_boxed_slice());
        AccountInfo::new(
            key_ref, signer, writable, lamports, data, owner_ref, executable, 0,
        )
    }

    fn account(
        account_key: Pubkey,
        writable: bool,
        signer: bool,
        executable: bool,
    ) -> AccountInfo<'static> {
        let key_ref = Box::leak(Box::new(account_key));
        let owner_ref = Box::leak(Box::new(key(250)));
        let lamports = Box::leak(Box::new(1u64));
        let data = Box::leak(vec![account_key.to_bytes()[0]; 4].into_boxed_slice());
        AccountInfo::new(
            key_ref, signer, writable, lamports, data, owner_ref, executable, 0,
        )
    }

    fn snapshot(accounts: &[AccountInfo<'_>]) -> Vec<Vec<u8>> {
        accounts
            .iter()
            .map(|account| account.try_borrow_data().unwrap().to_vec())
            .collect()
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

    fn instructions_sysvar(
        transaction: &[Instruction],
        current_index: u16,
    ) -> AccountInfo<'static> {
        let borrowed: Vec<_> = transaction.iter().map(borrowed_instruction).collect();
        let mut data = instructions::construct_instructions_data(&borrowed);
        let offset = data.len() - 2;
        data[offset..].copy_from_slice(&current_index.to_le_bytes());
        account_with_data(sysvar_ids::instructions::ID, false, false, false, data)
    }

    fn account_with_data(
        account_key: Pubkey,
        writable: bool,
        signer: bool,
        executable: bool,
        data: Vec<u8>,
    ) -> AccountInfo<'static> {
        let key_ref = Box::leak(Box::new(account_key));
        let owner_ref = Box::leak(Box::new(key(251)));
        let lamports = Box::leak(Box::new(1u64));
        let data = Box::leak(data.into_boxed_slice());
        AccountInfo::new(
            key_ref, signer, writable, lamports, data, owner_ref, executable, 0,
        )
    }

    fn compute_limit_instruction(expectation: &EnvelopeExpectationV1) -> Instruction {
        let mut data = [0u8; 5];
        data[0] = 2;
        data[1..].copy_from_slice(&expectation.compute_unit_limit.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }

    fn compute_price_instruction(expectation: &EnvelopeExpectationV1) -> Instruction {
        let mut data = [0u8; 9];
        data[0] = 3;
        data[1..].copy_from_slice(&expectation.compute_unit_price_micro_lamports.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }

    fn fixed_proof(nodes: &[[u8; 32]]) -> FixedMerkleProofV1 {
        let mut fixed = [[0; 32]; MAX_FIXED_MERKLE_PROOF_NODES_V1];
        fixed[..nodes.len()].copy_from_slice(nodes);
        FixedMerkleProofV1 {
            proof_len: nodes.len() as u8,
            nodes: fixed,
        }
    }

    #[test]
    fn all_exports_reject_wrong_account_count_before_state_access() {
        let program_id = key(99);
        let expected = Err(GovernanceError::InvalidAccountCount.into());
        assert_eq!(
            process_approve_unfreeze_v1(
                &program_id,
                &[],
                ApproveUnfreezeV1 {
                    expected: unfreeze_expectation(),
                },
            ),
            expected
        );
        assert_eq!(
            process_execute_unfreeze_v1(
                &program_id,
                &[],
                ExecuteUnfreezeV1 {
                    expected: unfreeze_expectation(),
                    linked_proposal: key(1),
                    envelope: envelope(),
                },
            ),
            expected
        );
        assert_eq!(
            process_close_abandoned_buffer_v1(
                &program_id,
                &[],
                CloseAbandonedBufferV1 {
                    expected: proposal_expectation(),
                    expected_verification_status: BufferVerificationStatusV1::Verified,
                    expected_verified_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
                    expected_verified_chunk_count: 0,
                    expected_buffer_verification_finalized_slot: 0,
                },
            ),
            expected
        );
        assert_eq!(
            process_activate_rollback_v1(
                &program_id,
                &[],
                ActivateRollbackV1 {
                    expected_primary: proposal_expectation(),
                    expected_rollback: proposal_expectation(),
                    expected_failure_evidence_digest: bytes(2),
                    expected_primary_programdata_verification_status:
                        ProgramDataVerificationStatusV1::Verifying,
                    expected_primary_programdata_verification_finalized_slot: 0,
                    expected_rollback_buffer_verification_status:
                        BufferVerificationStatusV1::Verified,
                    expected_rollback_verified_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
                    expected_rollback_verified_chunk_count: 0,
                },
            ),
            expected
        );
        assert_eq!(
            process_observe_programdata_failure_v1(
                &program_id,
                &[],
                empty_observation_instruction(),
            ),
            expected
        );
    }

    #[test]
    fn every_export_rejects_privilege_drift_and_aliases_without_mutation() {
        let program_id = key(99);
        let approve = || {
            vec![
                account(key(1), false, false, false),
                account(key(2), false, false, false),
                account(key(3), false, false, false),
                account(key(4), false, false, false),
                account(key(5), true, false, false),
                account(key(6), false, false, false),
                account(key(7), false, false, false),
                account(key(8), false, false, true),
                account(key(9), false, false, false),
                account(key(10), false, false, false),
                account(key(11), false, false, true),
                account(key(12), false, true, false),
            ]
        };
        let mut privilege = approve();
        privilege[0].is_writable = true;
        let before = snapshot(&privilege);
        assert_eq!(
            process_approve_unfreeze_v1(
                &program_id,
                &privilege,
                ApproveUnfreezeV1 {
                    expected: unfreeze_expectation(),
                },
            ),
            Err(GovernanceError::InvalidAccountPrivileges.into())
        );
        assert_eq!(snapshot(&privilege), before);

        let mut alias = approve();
        alias[1] = alias[0].clone();
        let before = snapshot(&alias);
        assert_eq!(
            process_approve_unfreeze_v1(
                &program_id,
                &alias,
                ApproveUnfreezeV1 {
                    expected: unfreeze_expectation(),
                },
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
        assert_eq!(snapshot(&alias), before);

        let mut observe = vec![
            account(key(20), true, false, false),
            account(key(21), false, false, false),
            account(key(22), false, false, false),
            account(key(23), false, false, false),
            account(key(24), false, false, false),
            account(key(25), false, false, false),
            account(key(26), false, false, false),
            account(key(27), false, false, false),
            account(key(28), false, false, true),
            account(key(29), true, false, false),
            account(key(30), false, false, true),
        ];
        observe[0].is_signer = false;
        let before = snapshot(&observe);
        assert_eq!(
            process_observe_programdata_failure_v1(
                &program_id,
                &observe,
                empty_observation_instruction(),
            ),
            Err(GovernanceError::InvalidAccountPrivileges.into())
        );
        assert_eq!(snapshot(&observe), before);
    }

    #[test]
    fn unfreeze_accumulator_resets_on_rotation_and_never_reuses_proposal_votes() {
        let mut proposal: UpgradeProposalV2 = fixture_account("upgrade_proposal_v2");
        proposal.state = ProposalStateV2::PoststateAccepted;
        proposal.council_approval_bitset = 0b0_0111;
        proposal.council_approval_count = 3;
        proposal.unfreeze_council_version = 1;
        proposal.unfreeze_council_hash = bytes(40);
        proposal.unfreeze_approval_bitset = 0b0_0011;
        proposal.unfreeze_approval_count = 2;
        proposal.unfreeze_approved_slot = 0;
        let council = sample_council(2, bytes(41));
        prepare_unfreeze_accumulator(&mut proposal, &council).unwrap();
        assert_eq!(proposal.state, ProposalStateV2::PoststateAccepted);
        assert_eq!(proposal.unfreeze_council_version, 0);
        assert_eq!(proposal.unfreeze_council_hash, [0; 32]);
        assert_eq!(proposal.unfreeze_approval_bitset, 0);
        assert_eq!(proposal.unfreeze_approval_count, 0);
        assert_eq!(proposal.council_approval_bitset, 0b0_0111);
        assert_eq!(proposal.council_approval_count, 3);

        proposal.state = ProposalStateV2::UnfreezeApproved;
        proposal.unfreeze_council_version = council.version;
        proposal.unfreeze_council_hash = council.set_hash;
        proposal.unfreeze_approval_bitset = 0b0_0111;
        proposal.unfreeze_approval_count = 3;
        assert_eq!(
            prepare_unfreeze_accumulator(&mut proposal, &council),
            Err(GovernanceError::DuplicateApproval.into())
        );
    }

    #[test]
    fn structural_programdata_failures_are_rejected_before_rollback_activation_commit() {
        let proposal: UpgradeProposalV2 = fixture_account("upgrade_proposal_v2");
        let config = sample_config(&proposal);
        let mut verification: ProgramDataVerificationV1 =
            fixture_account("programdata_verification_v1");
        verification.deployed_slot = 77;
        verification.capacity = 128;

        let mut failure: ProgramDataFailureObservationV1 =
            fixture_account("programdata_failure_observation_v1");
        failure.actual_program_owner = config.upgradeable_loader;
        failure.actual_program_executable = true;
        failure.actual_program_data_length = LOADER_PROGRAM_ACCOUNT_LEN as u64;
        failure.program_header_present = true;
        failure.actual_linked_programdata =
            OptionalPubkeyV1::some(config.target_programdata).unwrap();
        failure.raw_hash_complete = true;
        failure.actual_raw_programdata_sha256 = bytes(70);
        failure.actual_owner = config.upgradeable_loader;
        failure.actual_executable = false;
        failure.actual_data_length = verification.capacity + LOADER_PROGRAMDATA_METADATA_LEN as u64;
        failure.programdata_header_present = true;
        failure.actual_programdata_slot = verification.deployed_slot;
        failure.actual_capacity = verification.capacity;
        failure.actual_authority = OptionalPubkeyV1::some(config.authority_pda).unwrap();

        for mismatch_class in [
            ProgramDataMismatchClassV1::PayloadLeaf,
            ProgramDataMismatchClassV1::ZeroTail,
        ] {
            failure.mismatch_class = mismatch_class;
            assert_eq!(
                require_recoverable_rollback_failure_observation(&failure, &config, &verification,),
                Ok(())
            );
        }

        for mismatch_class in [
            ProgramDataMismatchClassV1::Header,
            ProgramDataMismatchClassV1::Authority,
            ProgramDataMismatchClassV1::Capacity,
        ] {
            failure.mismatch_class = mismatch_class;
            let before = failure.clone();
            assert_eq!(
                require_recoverable_rollback_failure_observation(&failure, &config, &verification,),
                Err(GovernanceError::InvalidStateTransition.into())
            );
            assert_eq!(failure, before);
        }

        failure.mismatch_class = ProgramDataMismatchClassV1::PayloadLeaf;
        failure.actual_authority = OptionalPubkeyV1::none();
        assert_eq!(
            require_recoverable_rollback_failure_observation(&failure, &config, &verification),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn rollback_policy_timing_nonce_and_full_payload_commitment_fail_closed() {
        let (mut primary, primary_key, rollback, rollback_key) = reciprocal_pair();
        let mut config = sample_config(&primary);
        let policy = sample_policy(100);
        assert_eq!(
            require_policy_active(&policy, 99),
            Err(GovernanceError::InactivePolicy.into())
        );
        require_policy_active(&policy, 100).unwrap();

        primary.upgrade_executed_slot = 100;
        assert_eq!(
            validate_rollback_activation_timing(&primary, &rollback, &config, 109),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        validate_rollback_activation_timing(&primary, &rollback, &config, 110).unwrap();
        validate_rollback_activation_timing(&primary, &rollback, &config, 188).unwrap();
        assert_eq!(
            validate_rollback_activation_timing(&primary, &rollback, &config, 189),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        assert_eq!(
            validate_rollback_activation_timing(&primary, &rollback, &config, 200),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        assert_eq!(
            validate_rollback_activation_timing(&primary, &rollback, &config, u64::MAX - 5),
            Err(GovernanceError::ArithmeticOverflow.into())
        );

        assert_ne!(
            rollback.expected_execution_pre_payload_hash,
            primary.artifact_sha256
        );
        validate_reciprocal_rollback(&primary, &primary_key, &rollback, &rollback_key, &config)
            .unwrap();
        config.target_nonce = primary.target_nonce;
        assert_eq!(
            validate_reciprocal_rollback(&primary, &primary_key, &rollback, &rollback_key, &config,),
            Err(GovernanceError::InvalidProposalCommitment.into())
        );
    }

    #[test]
    fn reciprocal_rollback_requires_identical_checkpoint_schema_and_policy() {
        let (primary, primary_key, rollback, rollback_key) = reciprocal_pair();
        let config = sample_config(&primary);
        validate_reciprocal_rollback(&primary, &primary_key, &rollback, &rollback_key, &config)
            .unwrap();

        let primary_before = primary.clone();
        let rollback_before = rollback.clone();
        let mut wrong_schema = rollback.clone();
        wrong_schema.checkpoint_schema_id[0] ^= 1;
        assert_eq!(
            validate_reciprocal_rollback(
                &primary,
                &primary_key,
                &wrong_schema,
                &rollback_key,
                &config,
            ),
            Err(GovernanceError::InvalidProposalCommitment.into())
        );

        let mut wrong_policy = rollback.clone();
        wrong_policy.checkpoint_policy_hash[0] ^= 1;
        assert_eq!(
            validate_reciprocal_rollback(
                &primary,
                &primary_key,
                &wrong_policy,
                &rollback_key,
                &config,
            ),
            Err(GovernanceError::InvalidProposalCommitment.into())
        );
        assert_eq!(primary, primary_before);
        assert_eq!(rollback, rollback_before);
    }

    #[test]
    fn primary_freeze_locks_cancelled_or_expired_rollback_buffer_until_retirement() {
        let (primary, primary_key, mut rollback, rollback_key) = reciprocal_pair();
        let config = sample_config(&primary);
        let gate = frozen_gate(primary_key, &primary);

        for terminal_state in [ProposalStateV2::Cancelled, ProposalStateV2::Expired] {
            rollback.state = terminal_state;
            let before = rollback.clone();
            assert_eq!(
                validate_abandoned_buffer_close_state(&rollback, &rollback_key, &config, &gate,),
                Err(GovernanceError::InvalidStateTransition.into())
            );
            assert_eq!(rollback, before);
        }

        rollback.state = ProposalStateV2::Retired;
        assert_eq!(
            validate_abandoned_buffer_close_state(&rollback, &rollback_key, &config, &gate),
            Ok(())
        );
    }

    #[test]
    fn reciprocal_unfreeze_terminalization_is_class_specific() {
        let (mut primary, primary_key, mut rollback, rollback_key) = reciprocal_pair();
        primary.state = ProposalStateV2::UnfreezeApproved;
        terminalize_unfreeze_pair(&primary, &primary_key, &mut rollback, &rollback_key, 120)
            .unwrap();
        assert_eq!(rollback.state, ProposalStateV2::Retired);
        assert_eq!(rollback.terminal_slot, 120);
        assert_eq!(
            rollback.terminal_reason_code,
            PROPOSAL_RETIRED_ROLLBACK_TERMINAL_REASON_V1
        );

        primary.state = ProposalStateV2::ProgramDataVerified;
        rollback.state = ProposalStateV2::UnfreezeApproved;
        terminalize_unfreeze_pair(&rollback, &rollback_key, &mut primary, &primary_key, 121)
            .unwrap();
        assert_eq!(primary.state, ProposalStateV2::SupersededByRollback);
        assert_eq!(
            primary.terminal_reason_code,
            PROPOSAL_SUPERSEDED_BY_ROLLBACK_TERMINAL_REASON_V1
        );

        let mut wrong = rollback;
        wrong.primary_proposal = OptionalPubkeyV1::some(key(99)).unwrap();
        assert_eq!(
            terminalize_unfreeze_pair(&primary, &primary_key, &mut wrong, &rollback_key, 122,),
            Err(GovernanceError::InvalidProposalCommitment.into())
        );
    }

    #[test]
    fn rejected_poststate_evidence_survives_rotation_but_false_rejection_fails() {
        let mut checkpoint: StateCheckpointV1 = fixture_account("state_checkpoint_v1");
        checkpoint.approval_council_version = 2;
        checkpoint.approval_council_hash = bytes(42);
        checkpoint.approval_bitset = 0b0_0111;
        checkpoint.approval_count = 3;
        checkpoint.accepted = false;
        checkpoint.forbidden_drift_count = 1;
        checkpoint.hard_combined_root =
            compute_state_checkpoint_hard_combined_root_v1(&checkpoint).unwrap();
        checkpoint.checkpoint_digest = compute_state_checkpoint_digest_v1(&checkpoint).unwrap();
        checkpoint.validate_schema().unwrap();
        let rotated_current_council_version = 3;
        assert_ne!(
            checkpoint.approval_council_version,
            rotated_current_council_version
        );
        validate_rejected_checkpoint_finalization(
            &checkpoint,
            checkpoint.finalized_slot - 1,
            checkpoint.finalized_slot,
        )
        .unwrap();

        let mut falsely_accepted = checkpoint.clone();
        falsely_accepted.accepted = true;
        assert_eq!(
            validate_rejected_checkpoint_finalization(
                &falsely_accepted,
                checkpoint.finalized_slot - 1,
                checkpoint.finalized_slot,
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
        let mut no_forbidden_drift = checkpoint;
        no_forbidden_drift.forbidden_drift_count = 0;
        assert_eq!(
            validate_rejected_checkpoint_finalization(
                &no_forbidden_drift,
                no_forbidden_drift.finalized_slot - 1,
                no_forbidden_drift.finalized_slot,
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn failure_chunk_order_and_zero_tail_domain_are_canonical() {
        let mut bitmap = [0u8; VERIFICATION_BITMAP_BYTES_V1];
        bitmap[0] = 0b0000_0011;
        require_verified_prefix(&bitmap, 2).unwrap();
        bitmap[0] = 0b0000_0001;
        assert_eq!(
            require_verified_prefix(&bitmap, 2),
            Err(GovernanceError::InvalidRelease1Bitmap.into())
        );

        for length in [1usize, 1_023, 1_024, 1_025, 16 * 1024] {
            let index = 7u32;
            let length_bytes = (length as u32).to_le_bytes();
            let index_bytes = index.to_le_bytes();
            let zeroes = vec![0u8; length];
            let direct = hashv(&[
                PROGRAMDATA_ZERO_TAIL_CHUNK_DOMAIN_V1,
                &index_bytes,
                &length_bytes,
                &zeroes,
            ])
            .to_bytes();
            assert_eq!(
                programdata_zero_tail_zero_hash(index, length).unwrap(),
                direct
            );
            assert_eq!(
                programdata_zero_tail_chunk_hash(index, &zeroes).unwrap(),
                direct
            );
        }
        let nonzero = vec![1u8; 17];
        assert_ne!(
            programdata_zero_tail_chunk_hash(0, &nonzero).unwrap(),
            programdata_zero_tail_zero_hash(0, nonzero.len()).unwrap()
        );
    }

    #[test]
    fn committed_leaf_proofs_reject_wrong_leaf_index_and_padding() {
        let chunk_size = RELEASE1_ARTIFACT_CHUNK_SIZE_V1 as usize;
        let artifact: Vec<u8> = (0..chunk_size * 2 + 17)
            .map(|index| (index.wrapping_mul(31) & 0xff) as u8)
            .collect();
        let root = artifact_merkle_root(&artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1).unwrap();
        let nodes = artifact_merkle_proof(&artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 2).unwrap();
        let proof = fixed_proof(&nodes);
        let leaf = artifact_chunk_leaf_hash(2, &artifact[chunk_size * 2..]).unwrap();
        validate_expected_leaf_proof(
            &root,
            artifact.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            2,
            &leaf,
            &proof,
        )
        .unwrap();

        let mut wrong_leaf = leaf;
        wrong_leaf[0] ^= 1;
        assert!(validate_expected_leaf_proof(
            &root,
            artifact.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            2,
            &wrong_leaf,
            &proof,
        )
        .is_err());
        assert!(validate_expected_leaf_proof(
            &root,
            artifact.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            3,
            &leaf,
            &proof,
        )
        .is_err());
        let mut wrong_padding = proof;
        wrong_padding.nodes[0][0] ^= 1;
        assert!(validate_expected_leaf_proof(
            &root,
            artifact.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            2,
            &leaf,
            &wrong_padding,
        )
        .is_err());
    }

    #[test]
    fn unfreeze_envelope_rejects_every_sibling_instruction() {
        let program_id = key(50);
        let expectation = envelope();
        let current_data = vec![35, 1, 2, 3];
        let current = Instruction {
            program_id,
            accounts: vec![],
            data: current_data.clone(),
        };
        let valid = vec![
            compute_limit_instruction(&expectation),
            compute_price_instruction(&expectation),
            current,
        ];
        let valid_sysvar = instructions_sysvar(&valid, 2);
        validate_canonical_envelope(&program_id, &[], &valid_sysvar, &current_data, &expectation)
            .unwrap();

        let mut sibling = valid;
        sibling.push(Instruction {
            program_id: key(51),
            accounts: vec![AccountMeta::new(key(52), false)],
            data: vec![1],
        });
        let sibling_sysvar = instructions_sysvar(&sibling, 2);
        assert_eq!(
            validate_canonical_envelope(
                &program_id,
                &[],
                &sibling_sysvar,
                &current_data,
                &expectation,
            ),
            Err(GovernanceError::InvalidAccountCount.into())
        );
    }

    #[test]
    fn close_treasury_authority_and_loader_shape_are_exact_and_failure_atomic() {
        let proposal: UpgradeProposalV2 = fixture_account("upgrade_proposal_v2");
        let config = sample_config(&proposal);
        validate_close_identities(
            &config,
            &proposal,
            &proposal.buffer_verification,
            &proposal.buffer_pubkey,
            &proposal.canonical_spill_treasury,
            &proposal.authority_pda,
        )
        .unwrap();
        let proposal_before = proposal.clone();
        assert_eq!(
            validate_close_identities(
                &config,
                &proposal,
                &proposal.buffer_verification,
                &proposal.buffer_pubkey,
                &key(60),
                &proposal.authority_pda,
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
        assert_eq!(proposal, proposal_before);
        assert_eq!(
            validate_close_identities(
                &config,
                &proposal,
                &proposal.buffer_verification,
                &proposal.buffer_pubkey,
                &proposal.canonical_spill_treasury,
                &key(61),
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
        assert_eq!(proposal, proposal_before);

        let close_instruction = close(
            &proposal.buffer_pubkey,
            &proposal.canonical_spill_treasury,
            &proposal.authority_pda,
        );
        validate_close_cpi_shape(
            &close_instruction,
            &proposal.buffer_pubkey,
            &proposal.canonical_spill_treasury,
            &proposal.authority_pda,
        )
        .unwrap();
        assert!(validate_close_cpi_shape(
            &close_instruction,
            &proposal.buffer_pubkey,
            &key(62),
            &proposal.authority_pda,
        )
        .is_err());
        assert!(validate_close_cpi_shape(
            &close_instruction,
            &proposal.buffer_pubkey,
            &proposal.canonical_spill_treasury,
            &key(63),
        )
        .is_err());
    }

    #[test]
    fn multi_account_commits_validate_every_target_before_first_write() {
        let program_id = key(70);
        let first = leaked_account(key(71), program_id, true, false, false, vec![1; 4]);
        let second = leaked_account(key(72), program_id, true, false, false, vec![2; 3]);
        let first_before = first.try_borrow_data().unwrap().to_vec();
        assert_eq!(
            commit_two_fixed_accounts(&program_id, &first, &[9; 4], 4, &second, &[8; 4], 4,),
            Err(GovernanceError::InvalidAccountSize.into())
        );
        assert_eq!(first.try_borrow_data().unwrap().to_vec(), first_before);

        let second = leaked_account(key(73), program_id, true, false, false, vec![2; 4]);
        let third = leaked_account(key(74), program_id, true, false, false, vec![3; 3]);
        let first_before = first.try_borrow_data().unwrap().to_vec();
        let second_before = second.try_borrow_data().unwrap().to_vec();
        assert_eq!(
            commit_three_fixed_accounts(
                &program_id,
                &first,
                &[9; 4],
                4,
                &second,
                &[8; 4],
                4,
                &third,
                &[7; 4],
                4,
            ),
            Err(GovernanceError::InvalidAccountSize.into())
        );
        assert_eq!(first.try_borrow_data().unwrap().to_vec(), first_before);
        assert_eq!(second.try_borrow_data().unwrap().to_vec(), second_before);
    }
}
