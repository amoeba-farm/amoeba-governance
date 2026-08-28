//! Closed Release 1 Loader-v3 extension, upgrade, and deployed-byte verification.
//!
//! Every CPI in this module is constructed by the pinned Loader-v3 interface.
//! There is no caller-selected program, instruction data, or account vector.

use solana_loader_v3_interface::instruction::{extend_program_checked, upgrade};
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
    artifact_merkle::verify_artifact_chunk_proof,
    instruction::{
        EnvelopeExpectationV1, ExecuteUpgradeV1, ExtendTargetV1, FinalizeProgramDataVerificationV1,
        ProgramDataChunkPhaseV1, ProposalExpectationV2, VerifyProgramDataChunkV1,
        MAX_ENVELOPE_COMPUTE_UNIT_LIMIT_V1, MAX_ENVELOPE_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
    },
    pda::{
        derive_authority_pda, derive_buffer_check_pda, derive_checkpoint_pda,
        derive_controller_config_pda, derive_gate_pda, derive_programdata_check_pda,
        derive_proposal_pda, derive_upgradeable_programdata_address, AUTHORITY_SEED,
        PROGRAMDATA_CHECK_SEED, UPGRADEABLE_LOADER_ID, UPGRADE_SEED_DOMAIN_V1,
    },
    policy::validate_policy_against_config,
    release1_account_io::{
        create_fixed_pda_account, encode_fixed_account, load_fixed_controller_account,
        require_distinct_accounts, validate_exact_privileges,
    },
    release1_digest::{validate_proposal_digest_v2, validate_state_checkpoint_digest_v1},
    release1_loader_accounts::{
        loader_account_data_hash, parse_upgradeable_buffer, validate_program_programdata_linkage,
        LOADER_BUFFER_METADATA_LEN,
    },
    release1_state::{
        BufferVerificationStatusV1, BufferVerificationV1, ProgramDataVerificationStatusV1,
        ProgramDataVerificationV1, ProposalStateV2, StateCheckpointPhaseV1, StateCheckpointV1,
        UpgradeProposalV2, MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1,
        PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR, PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN,
        RELEASE1_ACCOUNT_VERSION_V1, VERIFICATION_BITMAP_BYTES_V1,
    },
    state::{
        CheckpointPhaseV1, ControllerConfigV1, GateStatusV1, GovernancePolicyV1, ProposalClassV1,
        ProtocolGateV1,
    },
    GovernanceError,
};

/// Extends the canonical target through one checked Loader-v3 CPI. The
/// transaction envelope is closed and the resulting Loader-written slot and
/// capacity are re-read before the proposal is advanced to `Extended`.
pub fn process_extend_target_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExtendTargetV1,
) -> ProgramResult {
    let [payer, config_info, gate_info, proposal_info, prestate_info, target_programdata, target_program, authority_info, loader_info, system_program_info, rent_info, instructions_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };

    validate_exact_privileges(payer, true, true, false)?;
    validate_exact_privileges(config_info, false, false, false)?;
    validate_exact_privileges(gate_info, false, false, false)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(prestate_info, false, false, false)?;
    validate_exact_privileges(target_programdata, true, false, false)?;
    validate_exact_privileges(target_program, true, false, true)?;
    // Loader-v3 interface 5.0.0 marks the checked authority writable.
    validate_exact_privileges(authority_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    validate_exact_privileges(rent_info, false, false, false)?;
    validate_exact_privileges(instructions_info, false, false, false)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        gate_info,
        proposal_info,
        prestate_info,
        target_programdata,
        target_program,
        authority_info,
        loader_info,
        system_program_info,
        rent_info,
        instructions_info,
    ])?;
    validate_program_and_sysvar_ids(
        loader_info,
        system_program_info,
        Some(rent_info),
        None,
        instructions_info,
    )?;
    let rent = Rent::from_account_info(rent_info)?;

    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_frozen_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::Frozen
        || proposal.extension_delta == 0
        || proposal.proposal_class == ProposalClassV1::EmergencyRollback
        || instruction.expected_current_capacity != proposal.current_capacity
        || instruction.expected_extension_delta != proposal.extension_delta
        || instruction.expected_post_capacity != proposal.expected_post_capacity
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_target_account_keys(&config, target_program, target_programdata, authority_info)?;

    let slot = current_frozen_slot(&proposal)?;
    require_extension_execution_runway(&proposal, slot)?;
    let prestate = load_accepted_prestate(
        program_id,
        prestate_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
        &gate,
        &instruction.expected_prestate_checkpoint_digest,
        slot,
    )?;
    let expected_raw = expected_unextended_raw_programdata_hash(&proposal, &prestate)?;
    let before = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    if before.deployed_slot != prestate.target_programdata_slot
        || before.upgrade_authority != Some(config.authority_pda)
        || u64::try_from(before.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != proposal.current_capacity
        || slot <= before.deployed_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    require_raw_programdata_hash(target_programdata, &expected_raw)?;

    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &instruction.pack(),
        &instruction.envelope,
    )?;
    let delta = u32::try_from(proposal.extension_delta)
        .map_err(|_| GovernanceError::InvalidCapacityPlan)?;
    let extend = extend_program_checked(
        target_program.key,
        authority_info.key,
        Some(payer.key),
        delta,
    );
    validate_extend_cpi_shape(
        &extend,
        target_programdata.key,
        target_program.key,
        authority_info.key,
        system_program_info.key,
        payer.key,
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
        &extend,
        &[
            target_programdata.clone(),
            target_program.clone(),
            authority_info.clone(),
            system_program_info.clone(),
            payer.clone(),
            loader_info.clone(),
        ],
        &[signer_seeds],
    )?;

    let after = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    if after.deployed_slot != slot
        || after.upgrade_authority != Some(config.authority_pda)
        || u64::try_from(after.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != proposal.expected_post_capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_zero_appended_extension(
        target_programdata,
        after.payload_offset,
        proposal.current_capacity,
        proposal.extension_delta,
    )?;
    // The checked extension must preserve the exact prefix and append only a
    // zero-filled delta; rent is supplied and decoded before CPI so malformed
    // rent state cannot influence payment behavior.
    let _ = rent;

    proposal.state = ProposalStateV2::Extended;
    proposal.extension_executed_slot = slot;
    validate_proposal_digest_v2(&proposal)?;
    let bytes = encode_fixed_account(&*proposal, UpgradeProposalV2::LEN)?;
    commit_one_fixed_account(program_id, proposal_info, &bytes, UpgradeProposalV2::LEN)
}

/// Performs exactly one canonical Loader-v3 Upgrade CPI and creates the
/// separate deployed-byte verification account. Success never unfreezes.
pub fn process_execute_upgrade_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExecuteUpgradeV1,
) -> ProgramResult {
    let [payer, config_info, policy_info, gate_info, proposal_info, counterpart_info, counterpart_verification_info, prestate_info, buffer_verification_info, programdata_verification_info, target_programdata, target_program, buffer_info, spill_info, rent_info, clock_info, authority_info, loader_info, system_program_info, instructions_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };

    validate_exact_privileges(payer, true, true, false)?;
    for account in [
        config_info,
        policy_info,
        gate_info,
        counterpart_info,
        counterpart_verification_info,
        prestate_info,
        rent_info,
        clock_info,
        authority_info,
        instructions_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(buffer_verification_info, true, false, false)?;
    validate_exact_privileges(programdata_verification_info, true, false, false)?;
    validate_exact_privileges(target_programdata, true, false, false)?;
    validate_exact_privileges(target_program, true, false, true)?;
    validate_exact_privileges(buffer_info, true, false, false)?;
    validate_exact_privileges(spill_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        policy_info,
        gate_info,
        proposal_info,
        counterpart_info,
        counterpart_verification_info,
        prestate_info,
        buffer_verification_info,
        programdata_verification_info,
        target_programdata,
        target_program,
        buffer_info,
        spill_info,
        rent_info,
        clock_info,
        authority_info,
        loader_info,
        system_program_info,
        instructions_info,
    ])?;
    validate_program_and_sysvar_ids(
        loader_info,
        system_program_info,
        Some(rent_info),
        Some(clock_info),
        instructions_info,
    )?;
    let rent = Rent::from_account_info(rent_info)?;
    let clock = Clock::from_account_info(clock_info)?;

    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_frozen_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if instruction.expected.expected_policy_version != policy.version
        || instruction.expected.expected_policy_hash != policy.policy_hash
        || clock.slot == 0
        || clock.slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let expected_state = if proposal.extension_delta == 0 {
        ProposalStateV2::Frozen
    } else {
        ProposalStateV2::Extended
    };
    if proposal.state != expected_state
        || (proposal.extension_delta != 0
            && (proposal.extension_executed_slot == 0
                || proposal.extension_executed_slot >= clock.slot))
        || instruction.expected_capacity != proposal.expected_post_capacity
        || instruction.expected_verified_chunk_count != proposal.chunk_count
        || instruction.expected_buffer_verification_status != BufferVerificationStatusV1::Verified
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_target_account_keys(&config, target_program, target_programdata, authority_info)?;
    if *spill_info.key != config.canonical_spill_treasury
        || *spill_info.key != proposal.canonical_spill_treasury
        || *buffer_info.key != proposal.buffer_pubkey
        || *buffer_verification_info.key != proposal.buffer_verification
        || *programdata_verification_info.key != proposal.programdata_verification
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if programdata_verification_info.owner != &system_program::ID
        || programdata_verification_info.data_len() != 0
    {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }

    let prestate = load_accepted_prestate(
        program_id,
        prestate_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
        &gate,
        &instruction.expected_prestate_checkpoint_digest,
        clock.slot,
    )?;
    if proposal.extension_delta != 0 && prestate.finalized_slot > proposal.extension_executed_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let before = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    let expected_current_slot = if proposal.extension_delta == 0 {
        prestate.target_programdata_slot
    } else {
        proposal.extension_executed_slot
    };
    if before.deployed_slot != expected_current_slot
        || before.deployed_slot != instruction.expected_programdata_slot
        || before.upgrade_authority != Some(config.authority_pda)
        || u64::try_from(before.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != proposal.expected_post_capacity
        || clock.slot <= before.deployed_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let expected_raw = if proposal.extension_delta == 0 {
        let committed = expected_unextended_raw_programdata_hash(&proposal, &prestate)?;
        if instruction.expected_current_raw_programdata_hash != committed {
            return Err(GovernanceError::Release1DigestMismatch.into());
        }
        committed
    } else {
        // Checked extension is the only controller capability that can have
        // changed ProgramData since the accepted prestate. Its exact earlier
        // slot, resulting capacity, and authority were validated above. The
        // plan binds the resulting raw account bytes immediately before this
        // separate-slot upgrade transaction.
        if proposal.proposal_class == ProposalClassV1::EmergencyRollback
            || instruction.expected_current_raw_programdata_hash == [0; 32]
        {
            return Err(GovernanceError::InvalidCapacityPlan.into());
        }
        instruction.expected_current_raw_programdata_hash
    };
    require_raw_programdata_hash(target_programdata, &expected_raw)?;

    let mut buffer_verification = load_buffer_verification(
        program_id,
        buffer_verification_info,
        proposal_info,
        config_info,
        buffer_info,
        &config,
        &proposal,
    )?;
    if buffer_verification.status != instruction.expected_buffer_verification_status
        || buffer_verification.verified_chunk_count != instruction.expected_verified_chunk_count
        || buffer_verification.sealed_buffer_header_hash
            != instruction.expected_sealed_buffer_header_hash
        || buffer_verification.finalized_slot == 0
        || buffer_verification.finalized_slot > clock.slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_live_sealed_buffer(buffer_info, &config, &proposal, &buffer_verification)?;
    validate_reciprocal_counterpart(
        program_id,
        counterpart_info,
        counterpart_verification_info,
        config_info,
        &config,
        &proposal,
        proposal_info.key,
        &instruction,
        clock.slot,
    )?;

    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &instruction.pack(),
        &instruction.envelope,
    )?;

    let tail_length = proposal
        .expected_post_capacity
        .checked_sub(proposal.artifact_length)
        .ok_or(GovernanceError::InvalidCapacityPlan)?;
    let tail_chunk_count = chunk_count_allow_empty(tail_length, proposal.chunk_size)?;
    let (_, verification_bump) = derive_programdata_check_pda(program_id, proposal_info.key);
    let verification = ProgramDataVerificationV1 {
        discriminator: PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: verification_bump,
        initialized: true,
        status: ProgramDataVerificationStatusV1::Verifying,
        controller_config: *config_info.key,
        proposal: *proposal_info.key,
        target_program: *target_program.key,
        target_programdata: *target_programdata.key,
        upgradeable_loader: *loader_info.key,
        controller_authority: *authority_info.key,
        artifact_length: proposal.artifact_length,
        artifact_sha256: proposal.artifact_sha256,
        artifact_chunk_merkle_root: proposal.artifact_chunk_merkle_root,
        chunk_hash_domain: proposal.chunk_hash_domain,
        chunk_size: proposal.chunk_size,
        payload_chunk_count: proposal.chunk_count,
        verified_payload_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
        verified_payload_chunk_count: 0,
        deployed_slot: clock.slot,
        capacity: proposal.expected_post_capacity,
        tail_length,
        tail_chunk_count,
        verified_tail_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
        verified_tail_chunk_count: 0,
        raw_programdata_hash: [0; 32],
        zero_tail_verified: false,
        finalized_slot: 0,
        reserved: [0; PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN],
    };
    verification.validate_schema()?;
    // Both decoded accounts are detached heap allocations. Update those only
    // after every pre-CPI check and encode all final bytes before invoking the
    // loader. This preserves transaction atomicity without retaining duplicate
    // 1,792-byte proposal / verification values on the SBPF stack.
    proposal.state = ProposalStateV2::UpgradeExecuted;
    proposal.upgrade_executed_slot = clock.slot;
    validate_proposal_digest_v2(&proposal)?;
    buffer_verification.status = BufferVerificationStatusV1::ConsumedByUpgrade;
    buffer_verification.terminal_slot = clock.slot;
    buffer_verification.validate_schema()?;
    let proposal_bytes = encode_fixed_account(&*proposal, UpgradeProposalV2::LEN)?;
    let buffer_verification_bytes =
        encode_fixed_account(&*buffer_verification, BufferVerificationV1::LEN)?;
    let programdata_verification_bytes =
        encode_fixed_account(&verification, ProgramDataVerificationV1::LEN)?;

    let upgrade_instruction = upgrade(
        target_program.key,
        buffer_info.key,
        authority_info.key,
        spill_info.key,
    );
    validate_upgrade_cpi_shape(
        &upgrade_instruction,
        target_programdata.key,
        target_program.key,
        buffer_info.key,
        spill_info.key,
        rent_info.key,
        clock_info.key,
        authority_info.key,
    )?;
    let authority_bump = derive_authority_pda(program_id, &config.target_program).1;
    let authority_bump_seed = [authority_bump];
    let authority_signer_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        AUTHORITY_SEED,
        config.target_program.as_ref(),
        &authority_bump_seed,
    ];
    invoke_signed(
        &upgrade_instruction,
        &[
            target_programdata.clone(),
            target_program.clone(),
            buffer_info.clone(),
            spill_info.clone(),
            rent_info.clone(),
            clock_info.clone(),
            authority_info.clone(),
            loader_info.clone(),
        ],
        &[authority_signer_seeds],
    )?;

    let after = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    if after.deployed_slot != clock.slot
        || after.upgrade_authority != Some(config.authority_pda)
        || u64::try_from(after.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != proposal.expected_post_capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let consumed_buffer_data = buffer_info.try_borrow_data()?;
    if buffer_info.lamports() != 0
        || consumed_buffer_data.len() != LOADER_BUFFER_METADATA_LEN
        || parse_upgradeable_buffer(&consumed_buffer_data)?.authority != Some(config.authority_pda)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    drop(consumed_buffer_data);

    let verification_bump_seed = [verification_bump];
    let verification_signer_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        PROGRAMDATA_CHECK_SEED,
        proposal_info.key.as_ref(),
        &verification_bump_seed,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        programdata_verification_info,
        system_program_info,
        &rent,
        ProgramDataVerificationV1::LEN,
        verification_signer_seeds,
    )?;
    commit_three_fixed_accounts(
        program_id,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV2::LEN,
        buffer_verification_info,
        &buffer_verification_bytes,
        BufferVerificationV1::LEN,
        programdata_verification_info,
        &programdata_verification_bytes,
        ProgramDataVerificationV1::LEN,
    )
}

/// Verifies one deployed artifact or zero-tail chunk directly from canonical
/// ProgramData bytes and records the corresponding non-replayable bitmap bit.
pub fn process_verify_programdata_chunk_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: VerifyProgramDataChunkV1,
) -> ProgramResult {
    let [config_info, gate_info, proposal_info, target_program, target_programdata, authority_info, loader_info, verification_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    instruction.validate_phase_proof()?;
    for account in [
        config_info,
        gate_info,
        proposal_info,
        target_program,
        target_programdata,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, account.key == target_program.key)?;
    }
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(verification_info, true, false, false)?;
    require_distinct_accounts(&[
        config_info,
        gate_info,
        proposal_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        verification_info,
    ])?;
    if *loader_info.key != UPGRADEABLE_LOADER_ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_frozen_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::UpgradeExecuted {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_target_account_keys(&config, target_program, target_programdata, authority_info)?;
    let mut verification = load_programdata_verification(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
    )?;
    require_programdata_verification_expectation(
        &verification,
        instruction.expected_verification_status,
        &instruction.expected_verified_payload_chunk_bitmap,
        instruction.expected_verified_payload_chunk_count,
        &instruction.expected_verified_tail_chunk_bitmap,
        instruction.expected_verified_tail_chunk_count,
    )?;
    if verification.status != ProgramDataVerificationStatusV1::Verifying {
        return Err(GovernanceError::InvalidStateTransition.into());
    }

    let header =
        validate_current_programdata(target_program, target_programdata, &config, &verification)?;
    let data = target_programdata.try_borrow_data()?;
    let payload = data
        .get(header.payload_offset..)
        .ok_or(GovernanceError::InvalidRelease1Account)?;
    match instruction.phase {
        ProgramDataChunkPhaseV1::Payload => {
            let exact = exact_region_chunk(
                payload,
                0,
                verification.artifact_length,
                verification.chunk_size,
                instruction.chunk_index,
            )?;
            let proof_len = usize::from(instruction.proof.proof_len);
            verify_artifact_chunk_proof(
                &verification.artifact_chunk_merkle_root,
                verification.artifact_length,
                verification.chunk_size,
                instruction.chunk_index,
                exact,
                &instruction.proof.nodes[..proof_len],
            )?;
            mark_bitmap_bit(
                &mut verification.verified_payload_chunk_bitmap,
                &mut verification.verified_payload_chunk_count,
                verification.payload_chunk_count,
                instruction.chunk_index,
            )?;
        }
        ProgramDataChunkPhaseV1::ZeroTail => {
            if !proposal.zero_tail_required {
                return Err(GovernanceError::InvalidProposalCommitment.into());
            }
            let exact = exact_region_chunk(
                payload,
                verification.artifact_length,
                verification.tail_length,
                verification.chunk_size,
                instruction.chunk_index,
            )?;
            if exact.iter().any(|byte| *byte != 0) {
                return Err(GovernanceError::Release1DigestMismatch.into());
            }
            mark_bitmap_bit(
                &mut verification.verified_tail_chunk_bitmap,
                &mut verification.verified_tail_chunk_count,
                verification.tail_chunk_count,
                instruction.chunk_index,
            )?;
        }
    }
    let complete = verification.verified_payload_chunk_count == verification.payload_chunk_count
        && verification.verified_tail_chunk_count == verification.tail_chunk_count;
    verification.status = if complete {
        ProgramDataVerificationStatusV1::ReadyToFinalize
    } else {
        ProgramDataVerificationStatusV1::Verifying
    };
    verification.validate_schema()?;
    let bytes = encode_fixed_account(&*verification, ProgramDataVerificationV1::LEN)?;
    drop(data);
    commit_one_fixed_account(
        program_id,
        verification_info,
        &bytes,
        ProgramDataVerificationV1::LEN,
    )
}

/// Records one raw ProgramData hash after every artifact and zero-tail chunk
/// has been independently verified, then advances only to
/// `ProgramDataVerified`.
pub fn process_finalize_programdata_verification_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FinalizeProgramDataVerificationV1,
) -> ProgramResult {
    let [config_info, gate_info, proposal_info, target_program, target_programdata, authority_info, loader_info, verification_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(config_info, false, false, false)?;
    validate_exact_privileges(gate_info, false, false, false)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(target_programdata, false, false, false)?;
    validate_exact_privileges(authority_info, false, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(verification_info, true, false, false)?;
    require_distinct_accounts(&[
        config_info,
        gate_info,
        proposal_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        verification_info,
    ])?;
    if *loader_info.key != UPGRADEABLE_LOADER_ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let mut proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_frozen_expectation(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::UpgradeExecuted {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let slot = current_post_execution_frozen_slot(&proposal)?;
    validate_target_account_keys(&config, target_program, target_programdata, authority_info)?;
    let mut verification = load_programdata_verification(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        &config,
        &proposal,
    )?;
    require_programdata_verification_expectation(
        &verification,
        instruction.expected_verification_status,
        &instruction.expected_verified_payload_chunk_bitmap,
        instruction.expected_verified_payload_chunk_count,
        &instruction.expected_verified_tail_chunk_bitmap,
        instruction.expected_verified_tail_chunk_count,
    )?;
    if verification.status != ProgramDataVerificationStatusV1::ReadyToFinalize
        || instruction.expected_deployed_slot != verification.deployed_slot
        || instruction.expected_capacity != verification.capacity
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let header =
        validate_current_programdata(target_program, target_programdata, &config, &verification)?;
    let data = target_programdata.try_borrow_data()?;
    if u64::try_from(data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?
        > MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1
    {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    if header.payload_offset != data.len().saturating_sub(header.capacity)
        || verification.verified_payload_chunk_count != verification.payload_chunk_count
        || verification.verified_tail_chunk_count != verification.tail_chunk_count
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    let raw_hash = loader_account_data_hash(&data);
    drop(data);

    verification.status = ProgramDataVerificationStatusV1::Verified;
    verification.zero_tail_verified = true;
    verification.raw_programdata_hash = raw_hash;
    verification.finalized_slot = slot;
    verification.validate_schema()?;
    proposal.state = ProposalStateV2::ProgramDataVerified;
    proposal.programdata_verified_slot = slot;
    validate_proposal_digest_v2(&proposal)?;
    let verification_bytes = encode_fixed_account(&*verification, ProgramDataVerificationV1::LEN)?;
    let proposal_bytes = encode_fixed_account(&*proposal, UpgradeProposalV2::LEN)?;
    commit_two_fixed_accounts(
        program_id,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV2::LEN,
        verification_info,
        &verification_bytes,
        ProgramDataVerificationV1::LEN,
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
    let expected =
        crate::pda::derive_policy_pda(program_id, &config.target_program, policy.version);
    if expected != (*policy_info.key, policy.bump)
        || policy.controller_config != *config_info.key
        || policy.target_program != config.target_program
        || policy.version != config.current_policy_version
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(policy)
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

fn validate_frozen_expectation(
    expected: &ProposalExpectationV2,
    proposal: &UpgradeProposalV2,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    proposal_key: &Pubkey,
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
    let consumed_nonce = proposal
        .target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if gate.status != GateStatusV1::FrozenForUpgrade
        || gate.active_proposal != *proposal_key
        || gate.epoch != proposal.freeze_gate_epoch
        || config.target_nonce != consumed_nonce
        || gate.freeze_slot != proposal.frozen_slot
        || gate.freeze_reason_code == 0
    {
        return Err(GovernanceError::InvalidProposalEpoch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_accepted_prestate(
    program_id: &Pubkey,
    checkpoint_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    gate: &ProtocolGateV1,
    expected_digest: &[u8; 32],
    operation_slot: u64,
) -> Result<Box<StateCheckpointV1>, ProgramError> {
    let checkpoint = load_fixed_controller_account::<StateCheckpointV1>(
        program_id,
        checkpoint_info,
        StateCheckpointV1::LEN,
    )?;
    validate_state_checkpoint_digest_v1(&checkpoint)?;
    let expected =
        derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Prestate);
    if expected != (*checkpoint_info.key, checkpoint.bump)
        || *checkpoint_info.key != proposal.prestate_checkpoint
        || checkpoint.phase != StateCheckpointPhaseV1::Prestate
        || checkpoint.controller_config != *config_info.key
        || checkpoint.proposal != *proposal_info.key
        || checkpoint.emergency_resolution != Pubkey::default()
        || checkpoint.subject_digest != proposal.proposal_digest
        || checkpoint.target_program != config.target_program
        || checkpoint.target_programdata != config.target_programdata
        || checkpoint.gate_epoch != gate.epoch
        || checkpoint.target_payload_commitment != proposal.expected_execution_pre_payload_hash
        || checkpoint.target_capacity != proposal.current_capacity
        || checkpoint.checkpoint_digest != *expected_digest
        || !checkpoint.accepted
        || checkpoint.forbidden_drift_count != 0
        || checkpoint.finalized_slot > operation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    // Ordinary proposals bind the concrete pre-upgrade header/raw values in
    // their immutable digest. EmergencyRollback uses its linked primary's
    // mechanically verified ProgramData evidence, so its canonical proposal
    // fields remain zero by design.
    if proposal.proposal_class != ProposalClassV1::EmergencyRollback
        && (checkpoint.target_programdata_slot != proposal.deployed_slot
            || checkpoint.target_raw_programdata_commitment
                != proposal.current_raw_programdata_hash)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(checkpoint)
}

fn expected_unextended_raw_programdata_hash(
    proposal: &UpgradeProposalV2,
    prestate: &StateCheckpointV1,
) -> Result<[u8; 32], ProgramError> {
    let expected = match proposal.proposal_class {
        ProposalClassV1::EmergencyRollback => prestate.target_raw_programdata_commitment,
        ProposalClassV1::RoutineUpgrade
        | ProposalClassV1::EconomicChange
        | ProposalClassV1::ConstitutionalChange => {
            if prestate.target_raw_programdata_commitment != proposal.current_raw_programdata_hash {
                return Err(GovernanceError::CrossAccountMismatch.into());
            }
            proposal.current_raw_programdata_hash
        }
        ProposalClassV1::CouncilSetRotation | ProposalClassV1::TargetImmutability => {
            return Err(GovernanceError::UnsupportedProposalClass.into());
        }
    };
    if expected == [0; 32] {
        return Err(GovernanceError::InvalidProposalCommitment.into());
    }
    Ok(expected)
}

/// Performs the sole maximum-size SHA-256 pass admitted in an extension or
/// upgrade transaction. Header/linkage/capacity are validated separately so a
/// caller cannot turn a differently shaped account into the hashed subject.
fn require_raw_programdata_hash(
    target_programdata: &AccountInfo<'_>,
    expected_raw_hash: &[u8; 32],
) -> ProgramResult {
    let data = target_programdata.try_borrow_data()?;
    if u64::try_from(data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?
        > MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1
    {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    if loader_account_data_hash(&data) != *expected_raw_hash {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    Ok(())
}

/// Checked extension preserves the existing prefix by Loader-v3 contract. The
/// controller re-reads only the appended region here and requires every byte
/// of the exact delta to be zero, avoiding a second full-account hash pass.
fn validate_zero_appended_extension(
    target_programdata: &AccountInfo<'_>,
    payload_offset: usize,
    previous_capacity: u64,
    extension_delta: u64,
) -> ProgramResult {
    let previous_capacity =
        usize::try_from(previous_capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let extension_delta =
        usize::try_from(extension_delta).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let data = target_programdata.try_borrow_data()?;
    let payload = data
        .get(payload_offset..)
        .ok_or(GovernanceError::InvalidRelease1Account)?;
    let expected_capacity = previous_capacity
        .checked_add(extension_delta)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if payload.len() != expected_capacity {
        return Err(GovernanceError::InvalidCapacityPlan.into());
    }
    let appended = payload
        .get(previous_capacity..)
        .ok_or(GovernanceError::InvalidRelease1Account)?;
    if appended.len() != extension_delta || appended.iter().any(|byte| *byte != 0) {
        return Err(GovernanceError::Release1DigestMismatch.into());
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
    let verification = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        verification_info,
        BufferVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    if derive_buffer_check_pda(program_id, proposal_info.key)
        != (*verification_info.key, verification.bump)
        || verification.controller_config != *config_info.key
        || verification.proposal != *proposal_info.key
        || verification.upgradeable_loader != config.upgradeable_loader
        || verification.buffer != *buffer_info.key
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

fn validate_live_sealed_buffer(
    buffer_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    verification: &BufferVerificationV1,
) -> ProgramResult {
    if buffer_info.owner != &config.upgradeable_loader || buffer_info.executable {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let data = buffer_info.try_borrow_data()?;
    let header = parse_upgradeable_buffer(&data)?;
    let header_hash = hashv(&[data
        .get(..LOADER_BUFFER_METADATA_LEN)
        .ok_or(GovernanceError::InvalidRelease1Account)?])
    .to_bytes();
    if header.authority != Some(config.authority_pda)
        || u64::try_from(header.payload_length).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != proposal.artifact_length
        || header_hash != verification.sealed_buffer_header_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_reciprocal_counterpart(
    program_id: &Pubkey,
    counterpart_info: &AccountInfo<'_>,
    counterpart_verification_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    proposal_key: &Pubkey,
    instruction: &ExecuteUpgradeV1,
    slot: u64,
) -> ProgramResult {
    let counterpart = load_proposal(program_id, counterpart_info, config_info, config)?;
    if counterpart.proposal_digest != instruction.expected_counterpart_proposal_digest {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_reciprocal_checkpoint_commitments(proposal, &counterpart)?;
    let verification = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        counterpart_verification_info,
        BufferVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    if derive_buffer_check_pda(program_id, counterpart_info.key)
        != (*counterpart_verification_info.key, verification.bump)
        || verification.controller_config != *config_info.key
        || verification.proposal != *counterpart_info.key
        || verification.buffer != counterpart.buffer_pubkey
        || verification.controller_authority != config.authority_pda
        || verification.upgradeable_loader != config.upgradeable_loader
        || verification.artifact_length != counterpart.artifact_length
        || verification.artifact_sha256 != counterpart.artifact_sha256
        || verification.artifact_chunk_merkle_root != counterpart.artifact_chunk_merkle_root
        || verification.status != instruction.expected_counterpart_buffer_verification_status
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    match proposal.proposal_class {
        ProposalClassV1::EmergencyRollback => {
            if !proposal.primary_proposal.present
                || proposal.primary_proposal.value != *counterpart_info.key
                || counterpart.rollback_proposal.value != *proposal_key
                || counterpart.proposal_class == ProposalClassV1::EmergencyRollback
                || verification.status != BufferVerificationStatusV1::ConsumedByUpgrade
                || !matches!(
                    counterpart.state,
                    ProposalStateV2::UpgradeExecuted
                        | ProposalStateV2::ProgramDataVerified
                        | ProposalStateV2::PoststateAccepted
                )
            {
                return Err(GovernanceError::InvalidProposalCommitment.into());
            }
        }
        ProposalClassV1::RoutineUpgrade
        | ProposalClassV1::EconomicChange
        | ProposalClassV1::ConstitutionalChange => {
            require_primary_execution_rollback_runway(
                slot,
                config.rollback_delay_slots,
                config.council_review_slots(),
                counterpart.expiry_slot,
            )?;
            if !proposal.rollback_proposal.present
                || proposal.rollback_proposal.value != *counterpart_info.key
                || counterpart.primary_proposal.value != *proposal_key
                || counterpart.proposal_class != ProposalClassV1::EmergencyRollback
                || counterpart.state != ProposalStateV2::Timelocked
                || counterpart.not_before_slot > slot
                || counterpart.expiry_slot <= slot
                || verification.status != BufferVerificationStatusV1::Verified
                || proposal.rollback_buffer.value != counterpart.buffer_pubkey
                || proposal.rollback_artifact_sha256 != counterpart.artifact_sha256
                || proposal.rollback_artifact_chunk_root != counterpart.artifact_chunk_merkle_root
            {
                return Err(GovernanceError::InvalidProposalCommitment.into());
            }
        }
        ProposalClassV1::CouncilSetRotation | ProposalClassV1::TargetImmutability => {
            return Err(GovernanceError::UnsupportedProposalClass.into());
        }
    }
    Ok(())
}

fn validate_reciprocal_checkpoint_commitments(
    proposal: &UpgradeProposalV2,
    counterpart: &UpgradeProposalV2,
) -> ProgramResult {
    if counterpart.checkpoint_schema_id != proposal.checkpoint_schema_id
        || counterpart.checkpoint_policy_hash != proposal.checkpoint_policy_hash
    {
        return Err(GovernanceError::InvalidProposalCommitment.into());
    }
    Ok(())
}

fn require_primary_execution_rollback_runway(
    slot: u64,
    rollback_delay_slots: u64,
    council_review_slots: u64,
    rollback_expiry_slot: u64,
) -> ProgramResult {
    let recovery_horizon = slot
        .checked_add(rollback_delay_slots)
        .and_then(|value| value.checked_add(council_review_slots))
        .and_then(|value| value.checked_add(1))
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if recovery_horizon >= rollback_expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn load_programdata_verification(
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
        || verification.capacity != proposal.expected_post_capacity
        || verification.deployed_slot != proposal.upgrade_executed_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

fn validate_current_programdata(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    verification: &ProgramDataVerificationV1,
) -> Result<crate::release1_loader_accounts::UpgradeableProgramDataHeaderV1, ProgramError> {
    let header = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    if header.upgrade_authority != Some(config.authority_pda)
        || header.deployed_slot != verification.deployed_slot
        || u64::try_from(header.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != verification.capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(header)
}

fn require_programdata_verification_expectation(
    verification: &ProgramDataVerificationV1,
    status: ProgramDataVerificationStatusV1,
    payload_bitmap: &[u8; VERIFICATION_BITMAP_BYTES_V1],
    payload_count: u32,
    tail_bitmap: &[u8; VERIFICATION_BITMAP_BYTES_V1],
    tail_count: u32,
) -> ProgramResult {
    if verification.status != status
        || verification.verified_payload_chunk_bitmap != *payload_bitmap
        || verification.verified_payload_chunk_count != payload_count
        || verification.verified_tail_chunk_bitmap != *tail_bitmap
        || verification.verified_tail_chunk_count != tail_count
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn mark_bitmap_bit(
    bitmap: &mut [u8; VERIFICATION_BITMAP_BYTES_V1],
    count: &mut u32,
    limit: u32,
    index: u32,
) -> ProgramResult {
    if index >= limit {
        return Err(GovernanceError::InvalidRelease1Bitmap.into());
    }
    let byte_index = usize::try_from(index / 8).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let bit = 1u8 << (index % 8);
    if bitmap[byte_index] & bit != 0 {
        return Err(GovernanceError::InvalidRelease1Bitmap.into());
    }
    bitmap[byte_index] |= bit;
    *count = count
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    Ok(())
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

fn chunk_count_allow_empty(length: u64, chunk_size: u32) -> Result<u32, ProgramError> {
    if length == 0 {
        return Ok(0);
    }
    let size = u64::from(chunk_size);
    let count = length
        .checked_add(size - 1)
        .ok_or(GovernanceError::ArithmeticOverflow)?
        / size;
    u32::try_from(count).map_err(|_| GovernanceError::InvalidMerkleParameters.into())
}

fn validate_target_account_keys(
    config: &ControllerConfigV1,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    authority_info: &AccountInfo<'_>,
) -> ProgramResult {
    if *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *authority_info.key != config.authority_pda
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn validate_program_and_sysvar_ids(
    loader: &AccountInfo<'_>,
    system: &AccountInfo<'_>,
    rent: Option<&AccountInfo<'_>>,
    clock: Option<&AccountInfo<'_>>,
    instructions_info: &AccountInfo<'_>,
) -> ProgramResult {
    if *loader.key != UPGRADEABLE_LOADER_ID
        || *system.key != system_program::ID
        || rent.is_some_and(|account| *account.key != sysvar_ids::rent::ID)
        || clock.is_some_and(|account| *account.key != sysvar_ids::clock::ID)
        || *instructions_info.key != sysvar_ids::instructions::ID
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
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

fn validate_extend_cpi_shape(
    instruction: &Instruction,
    programdata: &Pubkey,
    program: &Pubkey,
    authority: &Pubkey,
    system: &Pubkey,
    payer: &Pubkey,
) -> ProgramResult {
    if instruction.program_id != UPGRADEABLE_LOADER_ID
        || instruction.accounts.len() != 5
        || instruction.accounts[0].pubkey != *programdata
        || !instruction.accounts[0].is_writable
        || instruction.accounts[0].is_signer
        || instruction.accounts[1].pubkey != *program
        || !instruction.accounts[1].is_writable
        || instruction.accounts[1].is_signer
        || instruction.accounts[2].pubkey != *authority
        || !instruction.accounts[2].is_writable
        || !instruction.accounts[2].is_signer
        || instruction.accounts[3].pubkey != *system
        || instruction.accounts[3].is_writable
        || instruction.accounts[3].is_signer
        || instruction.accounts[4].pubkey != *payer
        || !instruction.accounts[4].is_writable
        || !instruction.accounts[4].is_signer
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_upgrade_cpi_shape(
    instruction: &Instruction,
    programdata: &Pubkey,
    program: &Pubkey,
    buffer: &Pubkey,
    spill: &Pubkey,
    rent: &Pubkey,
    clock: &Pubkey,
    authority: &Pubkey,
) -> ProgramResult {
    let expected = [
        (*programdata, false, true),
        (*program, false, true),
        (*buffer, false, true),
        (*spill, false, true),
        (*rent, false, false),
        (*clock, false, false),
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

fn current_frozen_slot(proposal: &UpgradeProposalV2) -> Result<u64, ProgramError> {
    let slot = Clock::get()?.slot;
    if slot == 0 || slot < proposal.frozen_slot || slot >= proposal.expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(slot)
}

fn require_extension_execution_runway(proposal: &UpgradeProposalV2, slot: u64) -> ProgramResult {
    let earliest_upgrade_slot = slot
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if earliest_upgrade_slot >= proposal.expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn current_post_execution_frozen_slot(proposal: &UpgradeProposalV2) -> Result<u64, ProgramError> {
    let slot = Clock::get()?.slot;
    validate_post_execution_frozen_slot(proposal, slot)?;
    Ok(slot)
}

fn validate_post_execution_frozen_slot(proposal: &UpgradeProposalV2, slot: u64) -> ProgramResult {
    // Expiry is an admission deadline for crossing the loader boundary. Once
    // an upgrade has executed while timely, mechanical ProgramData checking,
    // checkpoint acceptance, rollback, and governed unfreeze must remain
    // available while the gate stays frozen—even after expiry.
    if slot == 0
        || proposal.frozen_slot == 0
        || proposal.upgrade_executed_slot == 0
        || slot < proposal.frozen_slot
        || slot < proposal.upgrade_executed_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
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
    use crate::artifact_merkle::{
        artifact_merkle_proof, artifact_merkle_root, RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    };

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn leaked_account(
        account_key: Pubkey,
        writable: bool,
        signer: bool,
        executable: bool,
        data: Vec<u8>,
    ) -> AccountInfo<'static> {
        let key_ref = Box::leak(Box::new(account_key));
        let owner = Box::leak(Box::new(key(250)));
        let lamports = Box::leak(Box::new(1u64));
        let data = Box::leak(data.into_boxed_slice());
        AccountInfo::new(
            key_ref, signer, writable, lamports, data, owner, executable, 0,
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

    fn instructions_sysvar(
        transaction: &[Instruction],
        current_index: u16,
    ) -> AccountInfo<'static> {
        let borrowed: Vec<_> = transaction.iter().map(borrowed_instruction).collect();
        let mut data = instructions::construct_instructions_data(&borrowed);
        let current_index_offset = data.len().checked_sub(2).unwrap();
        data[current_index_offset..].copy_from_slice(&current_index.to_le_bytes());
        leaked_account(sysvar_ids::instructions::ID, false, false, false, data)
    }

    fn compute_limit_instruction(envelope: &EnvelopeExpectationV1) -> Instruction {
        let mut data = [0u8; 5];
        data[0] = 2;
        data[1..].copy_from_slice(&envelope.compute_unit_limit.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }

    fn compute_price_instruction(envelope: &EnvelopeExpectationV1) -> Instruction {
        let mut data = [0u8; 9];
        data[0] = 3;
        data[1..].copy_from_slice(&envelope.compute_unit_price_micro_lamports.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }

    #[test]
    fn bitmap_rejects_duplicate_and_out_of_range_without_mutation() {
        let mut bitmap = [0u8; VERIFICATION_BITMAP_BYTES_V1];
        let mut count = 0;
        mark_bitmap_bit(&mut bitmap, &mut count, 9, 8).unwrap();
        let before = bitmap;
        assert_eq!(count, 1);
        assert_eq!(
            mark_bitmap_bit(&mut bitmap, &mut count, 9, 8),
            Err(GovernanceError::InvalidRelease1Bitmap.into())
        );
        assert_eq!(bitmap, before);
        assert_eq!(count, 1);
        assert_eq!(
            mark_bitmap_bit(&mut bitmap, &mut count, 9, 9),
            Err(GovernanceError::InvalidRelease1Bitmap.into())
        );
        assert_eq!(bitmap, before);
        assert_eq!(count, 1);
    }

    #[test]
    fn post_execution_verification_remains_live_after_proposal_expiry() {
        let proposal = UpgradeProposalV2 {
            frozen_slot: 10,
            upgrade_executed_slot: 20,
            expiry_slot: 30,
            ..UpgradeProposalV2::default()
        };

        assert_eq!(
            validate_post_execution_frozen_slot(&proposal, 19),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        validate_post_execution_frozen_slot(&proposal, 20).unwrap();
        validate_post_execution_frozen_slot(&proposal, proposal.expiry_slot).unwrap();
        validate_post_execution_frozen_slot(&proposal, 1_000).unwrap();
    }

    #[test]
    fn extension_preserves_a_strictly_later_preexpiry_upgrade_slot() {
        let mut proposal = UpgradeProposalV2 {
            expiry_slot: 30,
            ..UpgradeProposalV2::default()
        };
        let before = proposal.clone();

        require_extension_execution_runway(&proposal, 28).unwrap();
        assert_eq!(
            require_extension_execution_runway(&proposal, 29),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        proposal.expiry_slot = u64::MAX;
        assert_eq!(
            require_extension_execution_runway(&proposal, u64::MAX),
            Err(GovernanceError::ArithmeticOverflow.into())
        );
        proposal.expiry_slot = before.expiry_slot;
        assert_eq!(proposal, before);
    }

    #[test]
    fn primary_execution_preserves_complete_rollback_recovery_runway() {
        // 83 + five-slot delay + ten-slot checkpoint review + one execution
        // slot = 99, which is the final safe horizon before expiry 100.
        require_primary_execution_rollback_runway(83, 5, 10, 100).unwrap();
        assert_eq!(
            require_primary_execution_rollback_runway(84, 5, 10, 100),
            Err(GovernanceError::InvalidProposalTiming.into())
        );
        assert_eq!(
            require_primary_execution_rollback_runway(u64::MAX - 2, 1, 1, u64::MAX),
            Err(GovernanceError::ArithmeticOverflow.into())
        );
    }

    #[test]
    fn execute_pair_requires_identical_checkpoint_schema_and_policy() {
        let primary = UpgradeProposalV2 {
            checkpoint_schema_id: [1; 32],
            checkpoint_policy_hash: [2; 32],
            ..UpgradeProposalV2::default()
        };
        let mut rollback = primary.clone();
        let primary_before = primary.clone();
        validate_reciprocal_checkpoint_commitments(&primary, &rollback).unwrap();

        rollback.checkpoint_schema_id[0] ^= 1;
        assert_eq!(
            validate_reciprocal_checkpoint_commitments(&primary, &rollback),
            Err(GovernanceError::InvalidProposalCommitment.into())
        );
        rollback.checkpoint_schema_id = primary.checkpoint_schema_id;
        rollback.checkpoint_policy_hash[0] ^= 1;
        assert_eq!(
            validate_reciprocal_checkpoint_commitments(&primary, &rollback),
            Err(GovernanceError::InvalidProposalCommitment.into())
        );
        assert_eq!(primary, primary_before);
    }

    #[test]
    fn exact_region_chunk_covers_first_middle_and_final_partial_edges() {
        let size = RELEASE1_ARTIFACT_CHUNK_SIZE_V1 as usize;
        let mut payload = vec![0u8; size * 2 + 17 + 11];
        for (index, byte) in payload.iter_mut().enumerate() {
            *byte = index as u8;
        }
        assert_eq!(
            exact_region_chunk(&payload, 11, (size * 2 + 17) as u64, size as u32, 0)
                .unwrap()
                .len(),
            size
        );
        assert_eq!(
            exact_region_chunk(&payload, 11, (size * 2 + 17) as u64, size as u32, 1)
                .unwrap()
                .len(),
            size
        );
        assert_eq!(
            exact_region_chunk(&payload, 11, (size * 2 + 17) as u64, size as u32, 2)
                .unwrap()
                .len(),
            17
        );
        assert_eq!(
            exact_region_chunk(&payload, 11, (size * 2 + 17) as u64, size as u32, 3),
            Err(GovernanceError::InvalidMerkleProof.into())
        );
    }

    #[test]
    fn deployed_chunk_proofs_bind_first_middle_and_final_partial_bytes() {
        let size = RELEASE1_ARTIFACT_CHUNK_SIZE_V1 as usize;
        let artifact: Vec<u8> = (0..size * 2 + 17)
            .map(|index| (index.wrapping_mul(31) & 0xff) as u8)
            .collect();
        let root = artifact_merkle_root(&artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1).unwrap();
        for index in [0u32, 1, 2] {
            let chunk = exact_region_chunk(
                &artifact,
                0,
                artifact.len() as u64,
                RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
                index,
            )
            .unwrap();
            let proof =
                artifact_merkle_proof(&artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, index).unwrap();
            verify_artifact_chunk_proof(
                &root,
                artifact.len() as u64,
                RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
                index,
                chunk,
                &proof,
            )
            .unwrap();
        }

        let final_chunk = exact_region_chunk(
            &artifact,
            0,
            artifact.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            2,
        )
        .unwrap();
        let proof = artifact_merkle_proof(&artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 2).unwrap();
        let mut wrong_chunk = final_chunk.to_vec();
        wrong_chunk[0] ^= 1;
        assert_eq!(
            verify_artifact_chunk_proof(
                &root,
                artifact.len() as u64,
                RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
                2,
                &wrong_chunk,
                &proof,
            ),
            Err(GovernanceError::InvalidMerkleProof)
        );
        assert_eq!(
            verify_artifact_chunk_proof(
                &root,
                artifact.len() as u64,
                RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
                2,
                &final_chunk[..final_chunk.len() - 1],
                &proof,
            ),
            Err(GovernanceError::InvalidMerkleProof)
        );
    }

    #[test]
    fn raw_programdata_and_appended_zero_region_fail_closed_on_drift() {
        let raw = vec![3u8; 97];
        let expected = loader_account_data_hash(&raw);
        let raw_info = leaked_account(key(10), false, false, false, raw);
        require_raw_programdata_hash(&raw_info, &expected).unwrap();
        raw_info.try_borrow_mut_data().unwrap()[48] ^= 1;
        assert_eq!(
            require_raw_programdata_hash(&raw_info, &expected),
            Err(GovernanceError::Release1DigestMismatch.into())
        );

        let header_len = 45usize;
        let old_capacity = 23usize;
        let delta = 11usize;
        let mut extended = vec![7u8; header_len + old_capacity];
        extended.resize(header_len + old_capacity + delta, 0);
        let extended_info = leaked_account(key(11), false, false, false, extended);
        validate_zero_appended_extension(
            &extended_info,
            header_len,
            old_capacity as u64,
            delta as u64,
        )
        .unwrap();
        extended_info.try_borrow_mut_data().unwrap()[header_len + old_capacity + delta - 1] = 1;
        assert_eq!(
            validate_zero_appended_extension(
                &extended_info,
                header_len,
                old_capacity as u64,
                delta as u64,
            ),
            Err(GovernanceError::Release1DigestMismatch.into())
        );
        assert_eq!(
            validate_zero_appended_extension(
                &extended_info,
                header_len,
                old_capacity as u64,
                (delta - 1) as u64,
            ),
            Err(GovernanceError::InvalidCapacityPlan.into())
        );
    }

    #[test]
    fn canonical_envelope_rejects_siblings_reordering_and_wrong_current_index() {
        let program_id = key(12);
        let current_data = vec![30, 1, 2, 3];
        let envelope = envelope();
        let current = Instruction {
            program_id,
            accounts: vec![],
            data: current_data.clone(),
        };
        let valid = vec![
            compute_limit_instruction(&envelope),
            compute_price_instruction(&envelope),
            current.clone(),
        ];
        let valid_sysvar = instructions_sysvar(&valid, 2);
        validate_canonical_envelope(&program_id, &[], &valid_sysvar, &current_data, &envelope)
            .unwrap();

        let mut sibling = valid.clone();
        sibling.push(Instruction {
            program_id: key(13),
            accounts: vec![],
            data: vec![1],
        });
        let sibling_sysvar = instructions_sysvar(&sibling, 2);
        assert_eq!(
            validate_canonical_envelope(
                &program_id,
                &[],
                &sibling_sysvar,
                &current_data,
                &envelope,
            ),
            Err(GovernanceError::InvalidAccountCount.into())
        );

        let reordered = vec![
            compute_price_instruction(&envelope),
            compute_limit_instruction(&envelope),
            current,
        ];
        let reordered_sysvar = instructions_sysvar(&reordered, 2);
        assert_eq!(
            validate_canonical_envelope(
                &program_id,
                &[],
                &reordered_sysvar,
                &current_data,
                &envelope,
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
        let wrong_index_sysvar = instructions_sysvar(&valid, 1);
        assert_eq!(
            validate_canonical_envelope(
                &program_id,
                &[],
                &wrong_index_sysvar,
                &current_data,
                &envelope,
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn canonical_envelope_accepts_only_exact_optional_nonce_prefix() {
        let program_id = key(14);
        let nonce = key(15);
        let nonce_authority = key(16);
        let mut envelope = envelope();
        envelope.durable_nonce_account =
            crate::instruction::OptionalInstructionPubkeyV1::some(nonce).unwrap();
        envelope.durable_nonce_authority =
            crate::instruction::OptionalInstructionPubkeyV1::some(nonce_authority).unwrap();
        let current_data = vec![31, 9];
        let current = Instruction {
            program_id,
            accounts: vec![],
            data: current_data.clone(),
        };
        let valid = vec![
            system_instruction::advance_nonce_account(&nonce, &nonce_authority),
            compute_limit_instruction(&envelope),
            compute_price_instruction(&envelope),
            current,
        ];
        let valid_sysvar = instructions_sysvar(&valid, 3);
        validate_canonical_envelope(&program_id, &[], &valid_sysvar, &current_data, &envelope)
            .unwrap();

        let mut wrong_nonce = valid;
        wrong_nonce[0] = system_instruction::advance_nonce_account(&key(17), &nonce_authority);
        let wrong_nonce_sysvar = instructions_sysvar(&wrong_nonce, 3);
        assert_eq!(
            validate_canonical_envelope(
                &program_id,
                &[],
                &wrong_nonce_sysvar,
                &current_data,
                &envelope,
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn typed_loader_cpi_shapes_are_exact_and_closed() {
        let program = key(1);
        let programdata = derive_upgradeable_programdata_address(&program).0;
        let authority = key(2);
        let payer = key(3);
        let system = system_program::ID;
        let extend = extend_program_checked(&program, &authority, Some(&payer), 4096);
        validate_extend_cpi_shape(&extend, &programdata, &program, &authority, &system, &payer)
            .unwrap();
        let buffer = key(4);
        let spill = key(5);
        let upgrade = upgrade(&program, &buffer, &authority, &spill);
        validate_upgrade_cpi_shape(
            &upgrade,
            &programdata,
            &program,
            &buffer,
            &spill,
            &sysvar_ids::rent::ID,
            &sysvar_ids::clock::ID,
            &authority,
        )
        .unwrap();
        assert_eq!(upgrade.program_id, UPGRADEABLE_LOADER_ID);
        assert_eq!(upgrade.accounts.len(), 7);
    }

    #[test]
    fn all_exports_reject_wrong_account_count_before_any_state_access() {
        let program_id = key(99);
        let expected = Err(GovernanceError::InvalidAccountCount.into());
        assert_eq!(
            process_extend_target_v1(&program_id, &[], extend_instruction()),
            expected
        );
        assert_eq!(
            process_execute_upgrade_v1(&program_id, &[], execute_instruction()),
            expected
        );
        assert_eq!(
            process_verify_programdata_chunk_v1(&program_id, &[], chunk_instruction()),
            expected
        );
        assert_eq!(
            process_finalize_programdata_verification_v1(&program_id, &[], finalize_instruction()),
            expected
        );
    }

    #[test]
    fn every_export_rejects_privilege_drift_and_aliases_without_mutation() {
        let program_id = key(99);

        let mut extend = extend_accounts();
        extend[0].is_signer = false;
        assert_failed_without_mutation(
            &extend,
            Err(GovernanceError::InvalidAccountPrivileges.into()),
            |accounts| process_extend_target_v1(&program_id, accounts, extend_instruction()),
        );
        let mut extend_alias = extend_accounts();
        extend_alias[2] = extend_alias[1].clone();
        assert_failed_without_mutation(
            &extend_alias,
            Err(GovernanceError::CrossAccountMismatch.into()),
            |accounts| process_extend_target_v1(&program_id, accounts, extend_instruction()),
        );

        let mut execute = execute_accounts();
        execute[0].is_signer = false;
        assert_failed_without_mutation(
            &execute,
            Err(GovernanceError::InvalidAccountPrivileges.into()),
            |accounts| process_execute_upgrade_v1(&program_id, accounts, execute_instruction()),
        );
        let mut execute_alias = execute_accounts();
        execute_alias[2] = execute_alias[1].clone();
        assert_failed_without_mutation(
            &execute_alias,
            Err(GovernanceError::CrossAccountMismatch.into()),
            |accounts| process_execute_upgrade_v1(&program_id, accounts, execute_instruction()),
        );

        let mut chunk = chunk_accounts();
        chunk[0].is_writable = true;
        assert_failed_without_mutation(
            &chunk,
            Err(GovernanceError::InvalidAccountPrivileges.into()),
            |accounts| {
                process_verify_programdata_chunk_v1(&program_id, accounts, chunk_instruction())
            },
        );
        let mut chunk_alias = chunk_accounts();
        chunk_alias[1] = chunk_alias[0].clone();
        assert_failed_without_mutation(
            &chunk_alias,
            Err(GovernanceError::CrossAccountMismatch.into()),
            |accounts| {
                process_verify_programdata_chunk_v1(&program_id, accounts, chunk_instruction())
            },
        );

        let mut finalize = finalize_accounts();
        finalize[0].is_writable = true;
        assert_failed_without_mutation(
            &finalize,
            Err(GovernanceError::InvalidAccountPrivileges.into()),
            |accounts| {
                process_finalize_programdata_verification_v1(
                    &program_id,
                    accounts,
                    finalize_instruction(),
                )
            },
        );
        let mut finalize_alias = finalize_accounts();
        finalize_alias[1] = finalize_alias[0].clone();
        assert_failed_without_mutation(
            &finalize_alias,
            Err(GovernanceError::CrossAccountMismatch.into()),
            |accounts| {
                process_finalize_programdata_verification_v1(
                    &program_id,
                    accounts,
                    finalize_instruction(),
                )
            },
        );
    }

    fn proposal_expectation(state: ProposalStateV2) -> ProposalExpectationV2 {
        ProposalExpectationV2 {
            expected_proposal_digest: [1; 32],
            expected_policy_version: 1,
            expected_policy_hash: [2; 32],
            expected_council_version: 1,
            expected_council_hash: [3; 32],
            expected_gate_status: GateStatusV1::FrozenForUpgrade,
            expected_gate_epoch: 2,
            expected_target_nonce: 2,
            expected_state: state,
            expected_review_start_slot: 2,
            expected_review_end_slot: 3,
            expected_not_before_slot: 4,
            expected_expiry_slot: 5,
        }
    }

    fn extend_instruction() -> ExtendTargetV1 {
        ExtendTargetV1 {
            expected: proposal_expectation(ProposalStateV2::Frozen),
            expected_prestate_checkpoint_digest: [1; 32],
            expected_current_capacity: 1,
            expected_extension_delta: 1,
            expected_post_capacity: 2,
            envelope: envelope(),
        }
    }

    fn execute_instruction() -> ExecuteUpgradeV1 {
        ExecuteUpgradeV1 {
            expected: proposal_expectation(ProposalStateV2::Frozen),
            expected_prestate_checkpoint_digest: [1; 32],
            expected_current_raw_programdata_hash: [2; 32],
            expected_sealed_buffer_header_hash: [3; 32],
            expected_counterpart_proposal_digest: [4; 32],
            expected_programdata_slot: 1,
            expected_capacity: 1,
            expected_verified_chunk_count: 1,
            expected_buffer_verification_status: BufferVerificationStatusV1::Verified,
            expected_counterpart_buffer_verification_status: BufferVerificationStatusV1::Verified,
            envelope: envelope(),
        }
    }

    fn chunk_instruction() -> VerifyProgramDataChunkV1 {
        VerifyProgramDataChunkV1 {
            expected: proposal_expectation(ProposalStateV2::UpgradeExecuted),
            phase: ProgramDataChunkPhaseV1::ZeroTail,
            chunk_index: 0,
            proof: crate::instruction::FixedMerkleProofV1::empty(),
            expected_verification_status: ProgramDataVerificationStatusV1::Verifying,
            expected_verified_payload_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
            expected_verified_payload_chunk_count: 0,
            expected_verified_tail_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
            expected_verified_tail_chunk_count: 0,
        }
    }

    fn finalize_instruction() -> FinalizeProgramDataVerificationV1 {
        FinalizeProgramDataVerificationV1 {
            expected: proposal_expectation(ProposalStateV2::UpgradeExecuted),
            expected_verification_status: ProgramDataVerificationStatusV1::ReadyToFinalize,
            expected_verified_payload_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
            expected_verified_payload_chunk_count: 0,
            expected_verified_tail_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
            expected_verified_tail_chunk_count: 0,
            expected_deployed_slot: 1,
            expected_capacity: 1,
        }
    }

    fn account_set(flags: &[(bool, bool, bool)], first_key: u8) -> Vec<AccountInfo<'static>> {
        flags
            .iter()
            .enumerate()
            .map(|(index, (writable, signer, executable))| {
                leaked_account(
                    key(first_key.wrapping_add(index as u8)),
                    *writable,
                    *signer,
                    *executable,
                    vec![index as u8],
                )
            })
            .collect()
    }

    fn extend_accounts() -> Vec<AccountInfo<'static>> {
        account_set(
            &[
                (true, true, false),
                (false, false, false),
                (false, false, false),
                (true, false, false),
                (false, false, false),
                (true, false, false),
                (true, false, true),
                (true, false, false),
                (false, false, true),
                (false, false, true),
                (false, false, false),
                (false, false, false),
            ],
            20,
        )
    }

    fn execute_accounts() -> Vec<AccountInfo<'static>> {
        account_set(
            &[
                (true, true, false),
                (false, false, false),
                (false, false, false),
                (false, false, false),
                (true, false, false),
                (false, false, false),
                (false, false, false),
                (false, false, false),
                (true, false, false),
                (true, false, false),
                (true, false, false),
                (true, false, true),
                (true, false, false),
                (true, false, false),
                (false, false, false),
                (false, false, false),
                (false, false, false),
                (false, false, true),
                (false, false, true),
                (false, false, false),
            ],
            50,
        )
    }

    fn chunk_accounts() -> Vec<AccountInfo<'static>> {
        account_set(
            &[
                (false, false, false),
                (false, false, false),
                (false, false, false),
                (false, false, true),
                (false, false, false),
                (false, false, false),
                (false, false, true),
                (true, false, false),
            ],
            80,
        )
    }

    fn finalize_accounts() -> Vec<AccountInfo<'static>> {
        account_set(
            &[
                (false, false, false),
                (false, false, false),
                (true, false, false),
                (false, false, true),
                (false, false, false),
                (false, false, false),
                (false, false, true),
                (true, false, false),
            ],
            100,
        )
    }

    fn assert_failed_without_mutation(
        accounts: &[AccountInfo<'_>],
        expected: ProgramResult,
        call: impl FnOnce(&[AccountInfo<'_>]) -> ProgramResult,
    ) {
        let before: Vec<Vec<u8>> = accounts
            .iter()
            .map(|account| account.try_borrow_data().unwrap().to_vec())
            .collect();
        assert_eq!(call(accounts), expected);
        let after: Vec<Vec<u8>> = accounts
            .iter()
            .map(|account| account.try_borrow_data().unwrap().to_vec())
            .collect();
        assert_eq!(after, before);
    }

    fn envelope() -> EnvelopeExpectationV1 {
        EnvelopeExpectationV1 {
            compute_unit_limit: 1_000_000,
            compute_unit_price_micro_lamports: 1,
            durable_nonce_account: crate::instruction::OptionalInstructionPubkeyV1::none(),
            durable_nonce_authority: crate::instruction::OptionalInstructionPubkeyV1::none(),
        }
    }
}
