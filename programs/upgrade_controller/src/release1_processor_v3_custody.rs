//! Capacity-safe V3 custody, Loader-v3, and deployed-byte processors.
//!
//! The only CPIs in this module are the four concrete checked Loader-v3
//! operations selected below.  No instruction accepts arbitrary CPI bytes,
//! program IDs, or account vectors.  Capacity-sensitive transitions bind a
//! finalized scalable observation and re-read the live Loader graph before any
//! mutation.

use solana_loader_v3_interface::instruction::{
    close, extend_program_checked, set_buffer_authority_checked, upgrade,
};
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
        artifact_chunk_node_hash, verify_artifact_chunk_proof, MAX_ARTIFACT_PROOF_DEPTH_V1,
        MAX_PADDED_ARTIFACT_CHUNKS_V1,
    },
    pda::{
        derive_authority_pda, derive_buffer_check_pda, derive_capacity_policy_pda,
        derive_checkpoint_pda, derive_controller_config_pda, derive_current_deployment_state_pda,
        derive_gate_pda, derive_policy_pda, derive_programdata_check_pda,
        derive_programdata_failure_observation_pda, derive_programdata_observation_pda,
        derive_proposal_pda, derive_upgradeable_programdata_address, AUTHORITY_SEED,
        BUFFER_CHECK_SEED, PROGRAMDATA_CHECK_SEED, PROGRAMDATA_FAILURE_OBSERVATION_SEED,
        UPGRADEABLE_LOADER_ID, UPGRADE_SEED_DOMAIN_V1,
    },
    policy::validate_policy_against_config,
    release1_account_io::{
        create_fixed_pda_account, encode_fixed_account, load_fixed_controller_account,
        load_upgrade_proposal_v3, require_distinct_accounts, validate_exact_privileges,
    },
    release1_authority_instruction::{
        CeremonyEnvelopeV1, MAX_CEREMONY_COMPUTE_UNIT_LIMIT_V1,
        MAX_CEREMONY_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
    },
    release1_ceremony_digest::{
        compute_current_deployment_digest_v1, compute_programdata_observation_subject_digest_v1,
        validate_capacity_policy_digest_v1, validate_current_deployment_digest_v1,
        validate_programdata_observation_digest_v1,
    },
    release1_ceremony_state::{
        CurrentDeploymentStateV1, ProgramDataCapacityPolicyV1, ProgramDataObservationPurposeV1,
        ProgramDataObservationStatusV1, ProgramDataObservationV1,
    },
    release1_loader_accounts::{
        parse_upgradeable_buffer, parse_upgradeable_program, parse_upgradeable_programdata,
        validate_buffer_account, validate_program_programdata_linkage, LOADER_BUFFER_METADATA_LEN,
        LOADER_PROGRAMDATA_METADATA_LEN, LOADER_PROGRAM_ACCOUNT_LEN,
    },
    release1_state::{
        BufferVerificationStatusV1, BufferVerificationV1, ProposalStateV2, StateCheckpointPhaseV1,
        BUFFER_VERIFICATION_V1_DISCRIMINATOR, BUFFER_VERIFICATION_V1_RESERVED_LEN,
        NO_FAILING_CHUNK_INDEX_V1, RELEASE1_ACCOUNT_VERSION_V1, VERIFICATION_BITMAP_BYTES_V1,
    },
    release1_v3_custody_instruction::{
        ActivateRollbackV2, AdoptBufferV2, CloseAbandonedBufferV2, ExecuteUpgradeV2,
        ExtendTargetV2, FinalizeBufferVerificationV2, VerifyBufferChunkV2,
    },
    release1_v3_digest::{
        compute_programdata_failure_observation_digest_v2,
        compute_programdata_verification_digest_v2,
        validate_programdata_failure_observation_digest_v2,
        validate_programdata_verification_digest_v2, validate_state_checkpoint_digest_v2,
        validate_upgrade_proposal_digest_v3,
    },
    release1_v3_instruction::{
        BindProgramDataVerificationV2, FinalizeProgramDataVerificationV2,
        ObserveProgramDataFailureV2, ProgramDataFailureWitnessV2, ProposalGuardV3,
    },
    release1_v3_state::{
        ProgramDataFailureObservationV2, ProgramDataMismatchClassV2,
        ProgramDataVerificationStatusV2, ProgramDataVerificationV2, StateCheckpointV2,
        UpgradeProposalV3, CAPACITY_SAFE_ACCOUNT_VERSION_V2,
        PROGRAMDATA_FAILURE_OBSERVATION_V2_DIGEST_DOMAIN_ID,
        PROGRAMDATA_FAILURE_OBSERVATION_V2_DISCRIMINATOR,
        PROGRAMDATA_FAILURE_OBSERVATION_V2_RESERVED_LEN,
        PROGRAMDATA_VERIFICATION_V2_DIGEST_DOMAIN_ID, PROGRAMDATA_VERIFICATION_V2_DISCRIMINATOR,
        PROGRAMDATA_VERIFICATION_V2_RESERVED_LEN,
    },
    state::{
        CheckpointPhaseV1, ControllerConfigV1, GateStatusV1, GovernancePolicyV1, OptionalPubkeyV1,
        ProposalClassV1, ProtocolGateV1,
    },
    GovernanceError,
};

const ROLLBACK_ACTIVATION_FREEZE_REASON_V1: u16 = 3;

/// Transfers one exact Loader buffer from the recorded uploader to the
/// controller PDA and creates its fixed verification record.
pub fn process_adopt_buffer_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: AdoptBufferV2,
) -> ProgramResult {
    let [payer, config_info, gate_info, proposal_info, capacity_info, deployment_info, buffer_info, uploader_authority, authority_info, verification_info, loader_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(payer, true, true, false)?;
    for account in [
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(buffer_info, true, false, false)?;
    validate_exact_privileges(uploader_authority, false, true, false)?;
    validate_exact_privileges(verification_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        gate_info,
        proposal_info,
        capacity_info,
        deployment_info,
        buffer_info,
        uploader_authority,
        authority_info,
        verification_info,
        loader_info,
        system_program_info,
    ])?;
    require_program_ids(loader_info, Some(system_program_info), None, None, None)?;

    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::Draft {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    require_deployment_guard(&instruction.expected, &proposal, &deployment)?;
    if *buffer_info.key != proposal.buffer_pubkey
        || buffer_info.owner != &proposal.buffer_loader_owner
        || *uploader_authority.key != proposal.buffer_uploader_authority
        || *authority_info.key != proposal.buffer_final_authority
        || *authority_info.key != config.authority_pda
        || proposal.buffer_loader_owner != UPGRADEABLE_LOADER_ID
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let (expected_authority, authority_bump) =
        derive_authority_pda(program_id, &config.target_program);
    let (expected_verification, verification_bump) =
        derive_buffer_check_pda(program_id, proposal_info.key);
    if expected_authority != *authority_info.key
        || expected_verification != *verification_info.key
        || proposal.buffer_verification != *verification_info.key
        || verification_info.owner != &system_program::ID
        || verification_info.data_len() != 0
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    let header = validate_buffer_account(buffer_info, &config.upgradeable_loader)?;
    if header.authority != Some(*uploader_authority.key)
        || u64::try_from(header.payload_length).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != proposal.artifact_length
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let slot = current_preexpiry_slot(&proposal)?;
    let sealed_header = canonical_buffer_header(authority_info.key);
    let sealed_header_hash = hashv(&[&sealed_header]).to_bytes();

    let mut next_proposal = (*proposal).clone();
    next_proposal.state = ProposalStateV2::BufferAdopted;
    validate_upgrade_proposal_digest_v3(&next_proposal)?;
    let verification = BufferVerificationV1 {
        discriminator: BUFFER_VERIFICATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: verification_bump,
        initialized: true,
        status: BufferVerificationStatusV1::Adopted,
        controller_config: *config_info.key,
        proposal: *proposal_info.key,
        upgradeable_loader: config.upgradeable_loader,
        buffer: *buffer_info.key,
        expected_uploader_authority: *uploader_authority.key,
        controller_authority: *authority_info.key,
        artifact_length: proposal.artifact_length,
        artifact_sha256: proposal.artifact_sha256,
        artifact_chunk_merkle_root: proposal.artifact_chunk_merkle_root,
        chunk_hash_domain: proposal.artifact_scheme_id,
        chunk_size: proposal.artifact_chunk_size,
        chunk_count: proposal.artifact_chunk_count,
        verified_chunk_bitmap: [0; VERIFICATION_BITMAP_BYTES_V1],
        verified_chunk_count: 0,
        adopted_slot: slot,
        finalized_slot: 0,
        sealed_buffer_header_hash: sealed_header_hash,
        terminal_slot: 0,
        reserved: [0; BUFFER_VERIFICATION_V1_RESERVED_LEN],
    };
    verification.validate_schema()?;
    let proposal_bytes = encode_fixed_account(&next_proposal, UpgradeProposalV3::LEN)?;
    let verification_bytes = encode_fixed_account(&verification, BufferVerificationV1::LEN)?;

    let authority_bump_seed = [authority_bump];
    let authority_signer_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        AUTHORITY_SEED,
        config.target_program.as_ref(),
        &authority_bump_seed,
    ];
    let set_authority =
        set_buffer_authority_checked(buffer_info.key, uploader_authority.key, authority_info.key);
    validate_set_buffer_authority_checked_cpi_shape(
        &set_authority,
        buffer_info.key,
        uploader_authority.key,
        authority_info.key,
    )?;
    invoke_signed(
        &set_authority,
        &[
            buffer_info.clone(),
            uploader_authority.clone(),
            authority_info.clone(),
            loader_info.clone(),
        ],
        &[authority_signer_seeds],
    )?;
    let sealed = validate_buffer_account(buffer_info, &config.upgradeable_loader)?;
    let buffer_data = buffer_info.try_borrow_data()?;
    let observed_header_hash = hashv(&[buffer_data
        .get(..LOADER_BUFFER_METADATA_LEN)
        .ok_or(GovernanceError::InvalidRelease1Account)?])
    .to_bytes();
    drop(buffer_data);
    if sealed.authority != Some(*authority_info.key)
        || sealed.payload_length != header.payload_length
        || observed_header_hash != sealed_header_hash
    {
        return Err(GovernanceError::InvalidAuthorityTransition.into());
    }
    let verification_bump_seed = [verification_bump];
    let verification_signer_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        BUFFER_CHECK_SEED,
        proposal_info.key.as_ref(),
        &verification_bump_seed,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        verification_info,
        system_program_info,
        &Rent::get()?,
        BufferVerificationV1::LEN,
        verification_signer_seeds,
    )?;
    commit_two_fixed_accounts(
        program_id,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV3::LEN,
        verification_info,
        &verification_bytes,
        BufferVerificationV1::LEN,
    )
}

/// Verifies one exact, never-before-counted chunk from the locked buffer.
pub fn process_verify_buffer_chunk_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: VerifyBufferChunkV2,
) -> ProgramResult {
    let [config_info, gate_info, proposal_info, buffer_info, verification_info, authority_info, loader_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [
        config_info,
        gate_info,
        proposal_info,
        buffer_info,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(verification_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        gate_info,
        proposal_info,
        buffer_info,
        verification_info,
        authority_info,
        loader_info,
    ])?;
    require_program_ids(loader_info, None, None, None, None)?;
    instruction.proof.validate()?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::BufferAdopted {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    current_preexpiry_slot(&proposal)?;
    let verification = load_buffer_verification(
        program_id,
        verification_info,
        proposal_info,
        buffer_info,
        authority_info,
        config_info,
        &config,
        &proposal,
    )?;
    require_buffer_expectation(
        &verification,
        instruction.expected_verification_status,
        &instruction.expected_verified_chunk_bitmap,
        instruction.expected_verified_chunk_count,
    )?;
    validate_sealed_buffer(buffer_info, authority_info.key, &config, &verification)?;
    let buffer_data = buffer_info.try_borrow_data()?;
    let payload = buffer_data
        .get(LOADER_BUFFER_METADATA_LEN..)
        .ok_or(GovernanceError::InvalidRelease1Account)?;
    let exact_chunk = exact_artifact_chunk(
        payload,
        proposal.artifact_length,
        proposal.artifact_chunk_size,
        instruction.chunk_index,
    )?;
    let next = verify_and_mark_chunk(
        &verification,
        instruction.chunk_index,
        exact_chunk,
        &instruction.proof.nodes[..usize::from(instruction.proof.proof_len)],
    )?;
    let bytes = encode_fixed_account(&next, BufferVerificationV1::LEN)?;
    drop(buffer_data);
    commit_one_fixed_account(
        program_id,
        verification_info,
        &bytes,
        BufferVerificationV1::LEN,
    )
}

/// Finalizes the complete chunk bitmap after every buffer byte has been bound
/// through the proposal's artifact Merkle root. The proposal SHA-256 remains a
/// release-identity commitment; this bounded instruction never one-shot hashes
/// a multi-megabyte Loader buffer.
pub fn process_finalize_buffer_verification_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FinalizeBufferVerificationV2,
) -> ProgramResult {
    let [config_info, gate_info, proposal_info, buffer_info, verification_info, authority_info, loader_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(config_info, false, false, false)?;
    validate_exact_privileges(gate_info, false, false, false)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(buffer_info, false, false, false)?;
    validate_exact_privileges(verification_info, true, false, false)?;
    validate_exact_privileges(authority_info, false, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        gate_info,
        proposal_info,
        buffer_info,
        verification_info,
        authority_info,
        loader_info,
    ])?;
    require_program_ids(loader_info, None, None, None, None)?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::BufferAdopted {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let slot = current_preexpiry_slot(&proposal)?;
    let verification = load_buffer_verification(
        program_id,
        verification_info,
        proposal_info,
        buffer_info,
        authority_info,
        config_info,
        &config,
        &proposal,
    )?;
    require_buffer_expectation(
        &verification,
        instruction.expected_verification_status,
        &instruction.expected_verified_chunk_bitmap,
        instruction.expected_verified_chunk_count,
    )?;
    if verification.sealed_buffer_header_hash != instruction.expected_sealed_buffer_header_hash {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_sealed_buffer(buffer_info, authority_info.key, &config, &verification)?;
    if verification.status != BufferVerificationStatusV1::ReadyToFinalize {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let mut next_verification = (*verification).clone();
    next_verification.status = BufferVerificationStatusV1::Verified;
    next_verification.finalized_slot = slot;
    next_verification.validate_schema()?;
    let mut next_proposal = (*proposal).clone();
    next_proposal.state = ProposalStateV2::BufferVerified;
    validate_upgrade_proposal_digest_v3(&next_proposal)?;
    let verification_bytes = encode_fixed_account(&next_verification, BufferVerificationV1::LEN)?;
    let proposal_bytes = encode_fixed_account(&next_proposal, UpgradeProposalV3::LEN)?;
    commit_two_fixed_accounts(
        program_id,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV3::LEN,
        verification_info,
        &verification_bytes,
        BufferVerificationV1::LEN,
    )
}

/// Performs one exact `ExtendProgramChecked` CPI.  The accepted prestate and a
/// live finalized observation establish the old byte graph; the controller
/// proves the appended range is all zero and advances the deployment evidence
/// generation while leaving the gate frozen.
pub fn process_extend_target_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExtendTargetV2,
) -> ProgramResult {
    let [payer, config_info, gate_info, proposal_info, capacity_info, deployment_info, observation_info, prestate_info, target_programdata, target_program, authority_info, loader_info, system_program_info, rent_info, instructions_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(payer, true, true, false)?;
    for account in [
        config_info,
        gate_info,
        capacity_info,
        observation_info,
        prestate_info,
        rent_info,
        instructions_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(deployment_info, false, false, false)?;
    validate_exact_privileges(target_programdata, true, false, false)?;
    validate_exact_privileges(target_program, true, false, true)?;
    validate_exact_privileges(authority_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        gate_info,
        proposal_info,
        capacity_info,
        deployment_info,
        observation_info,
        prestate_info,
        target_programdata,
        target_program,
        authority_info,
        loader_info,
        system_program_info,
        rent_info,
        instructions_info,
    ])?;
    require_program_ids(
        loader_info,
        Some(system_program_info),
        Some(rent_info),
        None,
        Some(instructions_info),
    )?;
    let _rent = Rent::from_account_info(rent_info)?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::Frozen {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    require_deployment_guard(&instruction.expected, &proposal, &deployment)?;
    let prestate = load_accepted_prestate_at_epoch(
        program_id,
        prestate_info,
        proposal_info,
        config_info,
        capacity_info,
        deployment_info,
        observation_info,
        &config,
        &capacity,
        &proposal,
        gate.epoch,
        &deployment,
        &instruction.expected_prestate_checkpoint_digest,
        instruction.expected_prestate_checkpoint_generation,
    )?;
    let observation = load_fresh_observation(
        program_id,
        observation_info,
        config_info,
        capacity_info,
        proposal_info,
        target_program,
        target_programdata,
        loader_info,
        &config,
        &capacity,
        &gate,
        ProgramDataObservationPurposeV1::ProposalPrestate,
        deployment.artifact_length,
        &deployment.artifact_sha256,
        &deployment.artifact_merkle_root,
        deployment.artifact_length,
    )?;
    require_observation_guard(
        &observation,
        &instruction.expected_observation_digest,
        instruction.expected_observation_generation,
        &instruction.expected_observation_root,
        instruction.expected_observation_finalized_slot,
        instruction.expected_current_capacity,
    )?;
    if prestate.programdata_observation != *observation_info.key
        || prestate.observation_digest != observation.observation_digest
        || prestate.actual_capacity != observation.actual_capacity
        || prestate.target_programdata_slot != observation.deployed_slot
        || instruction.expected_current_capacity != deployment.actual_programdata_capacity
        || instruction.expected_current_capacity != observation.actual_capacity
        || instruction.expected_post_capacity != proposal.minimum_required_capacity
        || instruction.expected_extension_delta
            != proposal
                .minimum_required_capacity
                .checked_sub(observation.actual_capacity)
                .ok_or(GovernanceError::InvalidCapacityPlan)?
        || instruction.expected_post_capacity > capacity.maximum_payload_capacity
        || instruction.expected_post_capacity <= instruction.expected_current_capacity
    {
        return Err(GovernanceError::InvalidCapacityPlan.into());
    }
    validate_target_keys(&config, target_program, target_programdata, authority_info)?;
    let slot = current_frozen_slot(&proposal)?;
    if slot >= proposal.expiry_slot || slot < prestate.finalized_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let before = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    if before.deployed_slot != observation.deployed_slot
        || before.upgrade_authority != Some(config.authority_pda)
        || u64::try_from(before.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != instruction.expected_current_capacity
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &instruction.pack()?,
        &instruction.envelope,
    )?;
    let delta = u32::try_from(instruction.expected_extension_delta)
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

    let mut next_proposal = (*proposal).clone();
    next_proposal.state = ProposalStateV2::Extended;
    next_proposal.extension_executed_slot = slot;
    validate_upgrade_proposal_digest_v3(&next_proposal)?;
    let mut next_deployment = (*deployment).clone();
    next_deployment.actual_programdata_capacity = instruction.expected_post_capacity;
    next_deployment.deployed_slot = slot;
    next_deployment.deployment_generation = next_deployment
        .deployment_generation
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    next_deployment.last_updated_slot = slot;
    next_deployment.deployment_digest = instruction.expected_next_deployment_digest;
    if next_deployment.deployment_generation != instruction.expected_next_deployment_generation
        || compute_current_deployment_digest_v1(&next_deployment)?
            != instruction.expected_next_deployment_digest
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_current_deployment_digest_v1(&next_deployment)?;
    let proposal_bytes = encode_fixed_account(&next_proposal, UpgradeProposalV3::LEN)?;
    let deployment_bytes = encode_fixed_account(&next_deployment, CurrentDeploymentStateV1::LEN)?;

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
            != instruction.expected_post_capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_zero_appended_extension(
        target_programdata,
        after.payload_offset,
        instruction.expected_current_capacity,
        instruction.expected_extension_delta,
    )?;
    commit_two_fixed_accounts(
        program_id,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV3::LEN,
        deployment_info,
        &deployment_bytes,
        CurrentDeploymentStateV1::LEN,
    )
}

/// Executes one exact Loader-v3 Upgrade CPI after re-observing the current
/// ProgramData graph.  Success consumes the locked buffer and advances only to
/// `UpgradeExecuted`; the gate remains frozen and no deployment is trusted yet.
pub fn process_execute_upgrade_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExecuteUpgradeV2,
) -> ProgramResult {
    let [config_info, policy_info, gate_info, proposal_info, counterpart_info, counterpart_verification_info, capacity_info, deployment_info, prestate_observation_info, prestate_info, current_observation_info, buffer_verification_info, target_programdata, target_program, buffer_info, spill_info, rent_info, clock_info, authority_info, loader_info, instructions_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [
        config_info,
        policy_info,
        gate_info,
        counterpart_info,
        counterpart_verification_info,
        capacity_info,
        deployment_info,
        prestate_observation_info,
        prestate_info,
        current_observation_info,
        rent_info,
        clock_info,
        authority_info,
        instructions_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(buffer_verification_info, true, false, false)?;
    validate_exact_privileges(target_programdata, true, false, false)?;
    validate_exact_privileges(target_program, true, false, true)?;
    validate_exact_privileges(buffer_info, true, false, false)?;
    validate_exact_privileges(spill_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        gate_info,
        proposal_info,
        counterpart_info,
        counterpart_verification_info,
        capacity_info,
        deployment_info,
        prestate_observation_info,
        prestate_info,
        current_observation_info,
        buffer_verification_info,
        target_programdata,
        target_program,
        buffer_info,
        spill_info,
        rent_info,
        clock_info,
        authority_info,
        loader_info,
        instructions_info,
    ])?;
    require_program_ids(
        loader_info,
        None,
        Some(rent_info),
        Some(clock_info),
        Some(instructions_info),
    )?;
    let _rent = Rent::from_account_info(rent_info)?;
    let clock = Clock::from_account_info(clock_info)?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if policy.version != proposal.policy_version
        || policy.policy_hash != proposal.policy_hash
        || clock.slot == 0
        || clock.slot < proposal.not_before_slot
        || clock.slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    require_deployment_guard(&instruction.expected, &proposal, &deployment)?;
    let rollback_primary = if proposal.proposal_class == ProposalClassV1::EmergencyRollback {
        let primary = load_proposal(program_id, counterpart_info, config_info, &config)?;
        if !proposal.primary_proposal.present
            || proposal.primary_proposal.value != *counterpart_info.key
            || primary.proposal_class == ProposalClassV1::EmergencyRollback
        {
            return Err(GovernanceError::InvalidProposalCommitment.into());
        }
        Some(primary)
    } else {
        None
    };
    // A rollback reuses the primary proposal's accepted protected prestate.
    // That checkpoint predates the failed candidate, is bound to the prior
    // frozen epoch, and remains the only exact known-good state anchor while
    // the gate stays continuously frozen.
    let (prestate_subject_info, prestate_proposal, prestate_epoch) =
        if let Some(primary) = rollback_primary.as_deref() {
            (counterpart_info, primary, primary.freeze_gate_epoch)
        } else {
            (proposal_info, proposal.as_ref(), gate.epoch)
        };
    let prestate = load_accepted_prestate_at_epoch(
        program_id,
        prestate_info,
        prestate_subject_info,
        config_info,
        capacity_info,
        deployment_info,
        prestate_observation_info,
        &config,
        &capacity,
        prestate_proposal,
        prestate_epoch,
        &deployment,
        &instruction.expected_prestate_checkpoint_digest,
        instruction.expected_prestate_checkpoint_generation,
    )?;
    let (
        expected_prestate_length,
        expected_prestate_sha,
        expected_prestate_root,
        expected_prestate_minimum,
        observed_deployed_slot,
        observed_actual_capacity,
    ) = if let Some(primary) = rollback_primary.as_deref() {
        let failure = load_and_revalidate_rollback_failure(
            program_id,
            current_observation_info,
            config_info,
            gate_info,
            counterpart_info,
            capacity_info,
            deployment_info,
            proposal_info,
            target_program,
            target_programdata,
            &config,
            &capacity,
            &gate,
            &deployment,
            primary,
            &proposal,
        )?;
        require_rollback_failure_guard(&failure, &instruction)?;
        (
            proposal.artifact_length,
            proposal.artifact_sha256,
            proposal.artifact_chunk_merkle_root,
            proposal.minimum_required_capacity,
            failure.actual_programdata_slot,
            failure.actual_capacity,
        )
    } else {
        let observation = load_fresh_observation(
            program_id,
            current_observation_info,
            config_info,
            capacity_info,
            proposal_info,
            target_program,
            target_programdata,
            loader_info,
            &config,
            &capacity,
            &gate,
            ProgramDataObservationPurposeV1::ProposalPrestate,
            deployment.artifact_length,
            &deployment.artifact_sha256,
            &deployment.artifact_merkle_root,
            deployment.artifact_length,
        )?;
        require_observation_guard(
            &observation,
            &instruction.expected_observation_digest,
            instruction.expected_observation_generation,
            &instruction.expected_observation_root,
            instruction.expected_observation_finalized_slot,
            instruction.expected_actual_capacity,
        )?;
        (
            deployment.artifact_length,
            deployment.artifact_sha256,
            deployment.artifact_merkle_root,
            deployment.artifact_length,
            observation.deployed_slot,
            observation.actual_capacity,
        )
    };
    if observed_actual_capacity != deployment.actual_programdata_capacity
        || !prestate.accepted
        || prestate.programdata_observation != *prestate_observation_info.key
        || prestate.artifact_length != expected_prestate_length
        || prestate.artifact_sha256 != expected_prestate_sha
        || prestate.artifact_merkle_root != expected_prestate_root
        || prestate.minimum_required_capacity != expected_prestate_minimum
        || !prestate.observed_authority.present
        || prestate.observed_authority.value != config.authority_pda
        || *spill_info.key != config.canonical_spill_treasury
        || *spill_info.key != proposal.canonical_spill_treasury
        || *current_observation_info.key == *prestate_observation_info.key
        || *buffer_info.key != proposal.buffer_pubkey
        || *buffer_verification_info.key != proposal.buffer_verification
        || proposal.minimum_required_capacity > observed_actual_capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if !matches!(
        proposal.state,
        ProposalStateV2::Frozen | ProposalStateV2::Extended
    ) || (proposal.state == ProposalStateV2::Frozen && proposal.extension_executed_slot != 0)
        || (proposal.state == ProposalStateV2::Extended
            && (proposal.extension_executed_slot == 0
                || proposal.extension_executed_slot >= clock.slot))
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_target_keys(&config, target_program, target_programdata, authority_info)?;
    let before = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    if before.deployed_slot != observed_deployed_slot
        || before.upgrade_authority != Some(config.authority_pda)
        || u64::try_from(before.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != observed_actual_capacity
        || clock.slot <= before.deployed_slot
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let mut buffer_verification = load_buffer_verification(
        program_id,
        buffer_verification_info,
        proposal_info,
        buffer_info,
        authority_info,
        config_info,
        &config,
        &proposal,
    )?;
    if buffer_verification.status != instruction.expected_buffer_verification_status
        || buffer_verification.status != BufferVerificationStatusV1::Verified
        || buffer_verification.verified_chunk_count != instruction.expected_verified_chunk_count
        || buffer_verification.verified_chunk_count != proposal.artifact_chunk_count
        || buffer_verification.sealed_buffer_header_hash
            != instruction.expected_sealed_buffer_header_hash
        || buffer_verification.finalized_slot == 0
        || buffer_verification.finalized_slot > clock.slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_sealed_buffer(
        buffer_info,
        authority_info.key,
        &config,
        &buffer_verification,
    )?;
    validate_counterpart(
        program_id,
        counterpart_info,
        counterpart_verification_info,
        config_info,
        authority_info,
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
        &instruction.pack()?,
        &instruction.envelope,
    )?;
    let mut next_proposal = (*proposal).clone();
    next_proposal.state = ProposalStateV2::UpgradeExecuted;
    next_proposal.upgrade_executed_slot = clock.slot;
    validate_upgrade_proposal_digest_v3(&next_proposal)?;
    buffer_verification.status = BufferVerificationStatusV1::ConsumedByUpgrade;
    buffer_verification.terminal_slot = clock.slot;
    buffer_verification.validate_schema()?;
    let proposal_bytes = encode_fixed_account(&next_proposal, UpgradeProposalV3::LEN)?;
    let buffer_bytes = encode_fixed_account(&*buffer_verification, BufferVerificationV1::LEN)?;
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
    let bump_seed = [authority_bump];
    let signer_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        AUTHORITY_SEED,
        config.target_program.as_ref(),
        &bump_seed,
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
        &[signer_seeds],
    )?;
    let after = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    if after.deployed_slot != clock.slot
        || after.upgrade_authority != Some(config.authority_pda)
        || u64::try_from(after.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != observed_actual_capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let consumed = buffer_info.try_borrow_data()?;
    if buffer_info.lamports() != 0
        || consumed.len() != LOADER_BUFFER_METADATA_LEN
        || parse_upgradeable_buffer(&consumed)?.authority != Some(config.authority_pda)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    drop(consumed);
    commit_two_fixed_accounts(
        program_id,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV3::LEN,
        buffer_verification_info,
        &buffer_bytes,
        BufferVerificationV1::LEN,
    )
}

/// Binds one finalized post-upgrade observation to the fixed verification PDA.
/// A stale accumulating generation may be replaced only by an exact digest
/// chain step; a verified generation is terminal.
pub fn process_bind_programdata_verification_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: BindProgramDataVerificationV2,
) -> ProgramResult {
    let [payer, config_info, gate_info, proposal_info, capacity_info, deployment_info, observation_info, target_program, target_programdata, authority_info, loader_info, verification_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    validate_exact_privileges(payer, true, true, false)?;
    for account in [
        config_info,
        gate_info,
        proposal_info,
        capacity_info,
        deployment_info,
        observation_info,
        target_programdata,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(verification_info, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        gate_info,
        proposal_info,
        capacity_info,
        deployment_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        verification_info,
        system_program_info,
    ])?;
    require_program_ids(loader_info, Some(system_program_info), None, None, None)?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.manifest.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if proposal.state != ProposalStateV2::UpgradeExecuted {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    require_deployment_guard(&instruction.manifest.expected, &proposal, &deployment)?;
    let purpose = if proposal.proposal_class == ProposalClassV1::EmergencyRollback {
        ProgramDataObservationPurposeV1::Rollback
    } else {
        ProgramDataObservationPurposeV1::PostUpgrade
    };
    let observation = load_fresh_observation(
        program_id,
        observation_info,
        config_info,
        capacity_info,
        proposal_info,
        target_program,
        target_programdata,
        loader_info,
        &config,
        &capacity,
        &gate,
        purpose,
        proposal.artifact_length,
        &proposal.artifact_sha256,
        &proposal.artifact_chunk_merkle_root,
        proposal.minimum_required_capacity,
    )?;
    require_observation_guard(
        &observation,
        &instruction.manifest.expected_observation_digest,
        instruction.manifest.expected_observation_generation,
        &instruction.manifest.expected_observation_root,
        instruction.manifest.expected_observation_finalized_slot,
        observation.actual_capacity,
    )?;
    validate_target_keys(&config, target_program, target_programdata, authority_info)?;
    let slot = Clock::get()?.slot;
    if slot == 0
        || slot < observation.finalized_slot
        || slot < proposal.upgrade_executed_slot
        || slot > instruction.manifest.plan_valid_until_slot
        || observation.deployed_slot != proposal.upgrade_executed_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let (expected_verification, verification_bump) =
        derive_programdata_check_pda(program_id, proposal_info.key);
    if expected_verification != *verification_info.key
        || proposal.programdata_verification != *verification_info.key
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    let is_new =
        verification_info.owner == &system_program::ID && verification_info.data_len() == 0;
    if is_new {
        if instruction.manifest.verification_generation != 1
            || instruction.manifest.previous_verification_digest != [0; 32]
        {
            return Err(GovernanceError::InvalidRelease1Account.into());
        }
    } else {
        let prior = load_fixed_controller_account::<ProgramDataVerificationV2>(
            program_id,
            verification_info,
            ProgramDataVerificationV2::LEN,
        )?;
        validate_programdata_verification_digest_v2(&prior)?;
        if prior.status != ProgramDataVerificationStatusV2::ObservationBound
            || instruction.manifest.verification_generation
                != prior
                    .verification_generation
                    .checked_add(1)
                    .ok_or(GovernanceError::ArithmeticOverflow)?
            || instruction.manifest.previous_verification_digest != prior.verification_digest
        {
            return Err(GovernanceError::InvalidStateTransition.into());
        }
    }
    let mut candidate = ProgramDataVerificationV2 {
        discriminator: PROGRAMDATA_VERIFICATION_V2_DISCRIMINATOR,
        account_version: CAPACITY_SAFE_ACCOUNT_VERSION_V2,
        bump: verification_bump,
        initialized: true,
        status: ProgramDataVerificationStatusV2::ObservationBound,
        controller_config: *config_info.key,
        proposal: *proposal_info.key,
        proposal_digest: proposal.proposal_digest,
        protocol_gate: *gate_info.key,
        freeze_gate_epoch: gate.epoch,
        target_nonce: config.target_nonce,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: capacity.policy_digest,
        current_deployment_state: *deployment_info.key,
        current_deployment_digest: deployment.deployment_digest,
        current_deployment_generation: deployment.deployment_generation,
        target_program: *target_program.key,
        target_programdata: *target_programdata.key,
        upgradeable_loader: *loader_info.key,
        controller_authority: *authority_info.key,
        artifact_length: proposal.artifact_length,
        artifact_sha256: proposal.artifact_sha256,
        artifact_merkle_root: proposal.artifact_chunk_merkle_root,
        artifact_scheme_id: proposal.artifact_scheme_id,
        minimum_required_capacity: proposal.minimum_required_capacity,
        maximum_supported_raw_programdata_length: capacity.maximum_raw_programdata_length,
        observation_scheme_id: capacity.observation_scheme_id,
        programdata_observation: *observation_info.key,
        observation_purpose: observation.purpose,
        observation_generation: observation.generation,
        observation_subject_digest: observation.subject_digest,
        observation_root: observation.final_raw_merkle_root,
        observation_digest: observation.observation_digest,
        observation_finalized_slot: observation.finalized_slot,
        observed_deployed_slot: observation.deployed_slot,
        observed_raw_data_length: observation.raw_data_length,
        actual_capacity: observation.actual_capacity,
        observed_authority: observation.upgrade_authority,
        zero_tail_verified: false,
        verification_generation: instruction.manifest.verification_generation,
        previous_verification_digest: instruction.manifest.previous_verification_digest,
        verification_digest_domain_id: PROGRAMDATA_VERIFICATION_V2_DIGEST_DOMAIN_ID,
        verification_digest: [0; 32],
        bound_slot: slot,
        finalized_slot: 0,
        reserved: [0; PROGRAMDATA_VERIFICATION_V2_RESERVED_LEN],
    };
    candidate.verification_digest = compute_programdata_verification_digest_v2(&candidate)?;
    validate_programdata_verification_digest_v2(&candidate)?;
    let bytes = encode_fixed_account(&candidate, ProgramDataVerificationV2::LEN)?;
    if is_new {
        let bump_seed = [verification_bump];
        let signer_seeds: &[&[u8]] = &[
            UPGRADE_SEED_DOMAIN_V1,
            PROGRAMDATA_CHECK_SEED,
            proposal_info.key.as_ref(),
            &bump_seed,
        ];
        create_fixed_pda_account(
            program_id,
            payer,
            verification_info,
            system_program_info,
            &Rent::get()?,
            ProgramDataVerificationV2::LEN,
            signer_seeds,
        )?;
    } else if verification_info.owner != program_id
        || verification_info.data_len() != ProgramDataVerificationV2::LEN
    {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    commit_one_fixed_account(
        program_id,
        verification_info,
        &bytes,
        ProgramDataVerificationV2::LEN,
    )
}

/// Finalizes exact deployed bytes and advances the frozen proposal. The
/// canonical deployment remains unchanged until the separate governed
/// `ExecuteUnfreezeV2` transaction activates the verified artifact.
pub fn process_finalize_programdata_verification_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FinalizeProgramDataVerificationV2,
) -> ProgramResult {
    let [config_info, gate_info, proposal_info, capacity_info, deployment_info, observation_info, target_program, target_programdata, authority_info, loader_info, verification_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [
        config_info,
        gate_info,
        capacity_info,
        observation_info,
        target_programdata,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(deployment_info, false, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(verification_info, true, false, false)?;
    require_distinct_accounts(&[
        config_info,
        gate_info,
        proposal_info,
        capacity_info,
        deployment_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        verification_info,
    ])?;
    require_program_ids(loader_info, None, None, None, None)?;
    instruction.expected.validate()?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    if proposal.state != ProposalStateV2::UpgradeExecuted
        || gate.status != GateStatusV1::FrozenForUpgrade
        || gate.active_proposal != *proposal_info.key
        || gate.epoch != proposal.freeze_gate_epoch
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    let bound = load_programdata_verification(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        &proposal,
    )?;
    if bound.status != ProgramDataVerificationStatusV2::ObservationBound
        || instruction.expected.expected_status != ProgramDataVerificationStatusV2::ObservationBound
        || bound.proposal_digest != instruction.expected.expected_proposal_digest
        || bound.verification_digest != instruction.expected.expected_verification_digest
        || bound.verification_generation != instruction.expected.expected_verification_generation
        || gate.epoch != instruction.expected.expected_gate_epoch
        || config.target_nonce != instruction.expected.expected_target_nonce
        || capacity.policy_digest != instruction.expected.expected_capacity_policy_digest
        || deployment.deployment_digest != instruction.expected.expected_current_deployment_digest
        || deployment.deployment_generation
            != instruction.expected.expected_current_deployment_generation
        || bound.protocol_gate != *gate_info.key
        || bound.freeze_gate_epoch != gate.epoch
        || bound.target_nonce != config.target_nonce
        || bound.capacity_policy != *capacity_info.key
        || bound.capacity_policy_digest != capacity.policy_digest
        || bound.current_deployment_state != *deployment_info.key
        || bound.current_deployment_digest != deployment.deployment_digest
        || bound.current_deployment_generation != deployment.deployment_generation
        || bound.target_program != config.target_program
        || bound.target_programdata != config.target_programdata
        || bound.upgradeable_loader != config.upgradeable_loader
        || bound.controller_authority != config.authority_pda
        || bound.maximum_supported_raw_programdata_length != capacity.maximum_raw_programdata_length
        || bound.observation_scheme_id != capacity.observation_scheme_id
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let purpose = if proposal.proposal_class == ProposalClassV1::EmergencyRollback {
        ProgramDataObservationPurposeV1::Rollback
    } else {
        ProgramDataObservationPurposeV1::PostUpgrade
    };
    let observation = load_fresh_observation(
        program_id,
        observation_info,
        config_info,
        capacity_info,
        proposal_info,
        target_program,
        target_programdata,
        loader_info,
        &config,
        &capacity,
        &gate,
        purpose,
        proposal.artifact_length,
        &proposal.artifact_sha256,
        &proposal.artifact_chunk_merkle_root,
        proposal.minimum_required_capacity,
    )?;
    validate_target_keys(&config, target_program, target_programdata, authority_info)?;
    let slot = Clock::get()?.slot;
    if slot == 0 || slot < observation.finalized_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    if observation.observation_digest != instruction.expected.expected_observation_digest
        || observation.generation != instruction.expected.expected_observation_generation
        || observation.actual_capacity != instruction.expected.expected_actual_capacity
        || *authority_info.key != instruction.expected.expected_authority
        || bound.programdata_observation != *observation_info.key
        || bound.observation_purpose != observation.purpose
        || bound.observation_generation != observation.generation
        || bound.observation_subject_digest != observation.subject_digest
        || bound.observation_root != observation.final_raw_merkle_root
        || bound.observation_digest != observation.observation_digest
        || bound.observation_finalized_slot != observation.finalized_slot
        || bound.observed_deployed_slot != observation.deployed_slot
        || bound.observed_raw_data_length != observation.raw_data_length
        || bound.actual_capacity != observation.actual_capacity
        || bound.observed_authority != observation.upgrade_authority
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let mut expected_finalized = (*bound).clone();
    expected_finalized.status = ProgramDataVerificationStatusV2::Verified;
    expected_finalized.zero_tail_verified = true;
    expected_finalized.finalized_slot = slot;
    expected_finalized.verification_digest = [0; 32];
    expected_finalized.verification_digest =
        compute_programdata_verification_digest_v2(&expected_finalized)?;
    validate_programdata_verification_digest_v2(&expected_finalized)?;
    let mut next_proposal = (*proposal).clone();
    next_proposal.state = ProposalStateV2::ProgramDataVerified;
    next_proposal.programdata_verified_slot = slot;
    validate_upgrade_proposal_digest_v3(&next_proposal)?;
    let proposal_bytes = encode_fixed_account(&next_proposal, UpgradeProposalV3::LEN)?;
    let verification_bytes =
        encode_fixed_account(&expected_finalized, ProgramDataVerificationV2::LEN)?;
    // ProgramData verification proves the frozen candidate, but does not make
    // it the canonical active deployment. CurrentDeploymentStateV1 advances
    // only in the later, separately governed ExecuteUnfreezeV2 transaction.
    commit_two_fixed_accounts(
        program_id,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV3::LEN,
        verification_info,
        &verification_bytes,
        ProgramDataVerificationV2::LEN,
    )
}

/// Closes only a terminal abandoned buffer to the one configured treasury.
pub fn process_close_abandoned_buffer_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CloseAbandonedBufferV2,
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
    require_program_ids(loader_info, None, None, None, None)?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, proposal_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected,
        &proposal,
        &config,
        &gate,
        proposal_info.key,
    )?;
    if !matches!(
        proposal.state,
        ProposalStateV2::Cancelled | ProposalStateV2::Expired | ProposalStateV2::Retired
    ) || (proposal.state == ProposalStateV2::Retired
        && proposal.proposal_class != ProposalClassV1::EmergencyRollback)
        || *treasury_info.key != config.canonical_spill_treasury
        || *treasury_info.key != proposal.canonical_spill_treasury
        || *buffer_info.key != proposal.buffer_pubkey
        || *verification_info.key != proposal.buffer_verification
        || *authority_info.key != config.authority_pda
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let mut verification = load_buffer_verification(
        program_id,
        verification_info,
        proposal_info,
        buffer_info,
        authority_info,
        config_info,
        &config,
        &proposal,
    )?;
    require_buffer_expectation(
        &verification,
        instruction.expected_verification_status,
        &instruction.expected_verified_chunk_bitmap,
        instruction.expected_verified_chunk_count,
    )?;
    if verification.finalized_slot != instruction.expected_buffer_verification_finalized_slot
        || matches!(
            verification.status,
            BufferVerificationStatusV1::ConsumedByUpgrade
                | BufferVerificationStatusV1::ClosedAbandoned
        )
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_sealed_buffer(buffer_info, authority_info.key, &config, &verification)?;
    let slot = Clock::get()?.slot;
    if slot == 0 {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    verification.status = BufferVerificationStatusV1::ClosedAbandoned;
    verification.terminal_slot = slot;
    verification.validate_schema()?;
    let bytes = encode_fixed_account(&*verification, BufferVerificationV1::LEN)?;
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
        &bytes,
        BufferVerificationV1::LEN,
    )
}

/// Constructs immutable V2 failure evidence from live accounts and a compact
/// authenticated witness.  Structural fields are never operator-trusted;
/// payload leaves authenticate against the proposal root and zero-tail hashes
/// are derived from the exact on-chain bytes.
pub fn process_observe_programdata_failure_witness_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ObserveProgramDataFailureV2,
) -> ProgramResult {
    let instruction = instruction.witness;
    let [payer, config_info, gate_info, primary_info, verification_info, capacity_info, deployment_info, observation_info, target_program, target_programdata, authority_info, loader_info, failure_info, system_program_info] =
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
        capacity_info,
        deployment_info,
        observation_info,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    // Executable state is itself failure evidence for these two accounts, so
    // only their signer/writable privileges are fixed at the ABI boundary.
    if target_program.is_signer
        || target_program.is_writable
        || target_programdata.is_signer
        || target_programdata.is_writable
    {
        return Err(GovernanceError::InvalidAccountPrivileges.into());
    }
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(failure_info, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        config_info,
        gate_info,
        primary_info,
        verification_info,
        capacity_info,
        deployment_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        failure_info,
        system_program_info,
    ])?;
    require_program_ids(loader_info, Some(system_program_info), None, None, None)?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let proposal = load_proposal(program_id, primary_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected_proposal,
        &proposal,
        &config,
        &gate,
        primary_info.key,
    )?;
    if proposal.proposal_class == ProposalClassV1::EmergencyRollback
        || proposal.state != ProposalStateV2::UpgradeExecuted
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    require_deployment_guard(&instruction.expected_proposal, &proposal, &deployment)?;
    let verification_present = instruction.expected_verification_digest != [0; 32];
    if verification_present {
        let verification = load_programdata_verification(
            program_id,
            verification_info,
            primary_info,
            config_info,
            &proposal,
        )?;
        if verification.status == ProgramDataVerificationStatusV2::Verified
            || verification.verification_digest != instruction.expected_verification_digest
            || verification.verification_generation != instruction.expected_verification_generation
        {
            return Err(GovernanceError::InvalidStateTransition.into());
        }
    } else if *verification_info.key != proposal.programdata_verification
        || verification_info.owner != &system_program::ID
        || verification_info.data_len() != 0
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let observation = load_observation_any_status(
        program_id,
        observation_info,
        config_info,
        capacity_info,
        primary_info,
        &config,
        &capacity,
    )?;
    let observation_bytes = observation_info.try_borrow_data()?;
    let observation_state_hash = hashv(&[&observation_bytes]).to_bytes();
    drop(observation_bytes);
    if instruction.expected_observation_state_hash == [0; 32]
        || observation.generation != instruction.expected_observation_generation
        || observation_state_hash != instruction.expected_observation_state_hash
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    validate_failure_observation_binding(&observation, &proposal, &capacity)?;
    if *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *authority_info.key != config.authority_pda
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let runtime = capture_runtime_graph(target_program, target_programdata)?;
    let (expected_leaf_hash, actual_leaf_hash) = validate_failure_witness(
        &instruction,
        &proposal,
        &capacity,
        &observation,
        target_programdata,
        &runtime,
        &config,
    )?;
    let slot = Clock::get()?.slot;
    if slot == 0
        || slot < proposal.upgrade_executed_slot
        || slot > instruction.plan_valid_until_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let (expected_failure, failure_bump) =
        derive_programdata_failure_observation_pda(program_id, primary_info.key, gate.epoch);
    if expected_failure != *failure_info.key
        || failure_info.owner != &system_program::ID
        || failure_info.data_len() != 0
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    let observation_finalized = observation.status == ProgramDataObservationStatusV1::Finalized;
    let mut failure = ProgramDataFailureObservationV2 {
        discriminator: PROGRAMDATA_FAILURE_OBSERVATION_V2_DISCRIMINATOR,
        account_version: CAPACITY_SAFE_ACCOUNT_VERSION_V2,
        bump: failure_bump,
        initialized: true,
        finalized: true,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        primary_proposal: *primary_info.key,
        proposal_digest: proposal.proposal_digest,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: capacity.policy_digest,
        current_deployment_state: *deployment_info.key,
        current_deployment_digest: deployment.deployment_digest,
        current_deployment_generation: deployment.deployment_generation,
        target_program: *target_program.key,
        target_programdata: *target_programdata.key,
        upgradeable_loader: *loader_info.key,
        frozen_epoch: gate.epoch,
        target_nonce: config.target_nonce,
        expected_artifact_length: proposal.artifact_length,
        expected_artifact_sha256: proposal.artifact_sha256,
        expected_artifact_merkle_root: proposal.artifact_chunk_merkle_root,
        expected_artifact_scheme_id: proposal.artifact_scheme_id,
        minimum_required_capacity: proposal.minimum_required_capacity,
        observation_scheme_id: capacity.observation_scheme_id,
        programdata_observation: *observation_info.key,
        observation_purpose: observation.purpose,
        observation_generation: observation.generation,
        observation_subject_digest: observation.subject_digest,
        observation_finalized,
        observation_root: if observation_finalized {
            observation.final_raw_merkle_root
        } else {
            [0; 32]
        },
        observation_digest: if observation_finalized {
            observation.observation_digest
        } else {
            [0; 32]
        },
        actual_program_owner: runtime.program_owner,
        actual_program_executable: runtime.program_executable,
        actual_program_data_length: runtime.program_data_length,
        program_header_present: runtime.program_header_present,
        actual_linked_programdata: runtime.linked_programdata,
        actual_programdata_owner: runtime.programdata_owner,
        actual_programdata_executable: runtime.programdata_executable,
        actual_programdata_data_length: runtime.programdata_data_length,
        programdata_header_present: runtime.programdata_header_present,
        actual_programdata_slot: runtime.deployed_slot,
        actual_capacity: runtime.actual_capacity,
        actual_authority: runtime.authority,
        mismatch_class: instruction.mismatch_class,
        failing_chunk_index: instruction.failing_chunk_index,
        expected_leaf_hash,
        actual_leaf_hash,
        failure_digest_domain_id: PROGRAMDATA_FAILURE_OBSERVATION_V2_DIGEST_DOMAIN_ID,
        failure_digest: [0; 32],
        finalized_slot: slot,
        reserved: [0; PROGRAMDATA_FAILURE_OBSERVATION_V2_RESERVED_LEN],
    };
    failure.failure_digest = compute_programdata_failure_observation_digest_v2(&failure)?;
    validate_programdata_failure_observation_digest_v2(&failure)?;
    let bytes = encode_fixed_account(&failure, ProgramDataFailureObservationV2::LEN)?;
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
        ProgramDataFailureObservationV2::LEN,
        signer_seeds,
    )?;
    commit_one_fixed_account(
        program_id,
        failure_info,
        &bytes,
        ProgramDataFailureObservationV2::LEN,
    )
}

/// Switches the continuously frozen gate from a failed primary to its exact
/// precommitted rollback.  No nonce is consumed and no Loader CPI occurs.
pub fn process_activate_rollback_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ActivateRollbackV2,
) -> ProgramResult {
    let [config_info, policy_info, gate_info, primary_info, rollback_info, rollback_buffer_verification_info, primary_verification_info, failure_info, capacity_info, deployment_info, observation_info, target_program, target_programdata, authority_info, loader_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    for account in [
        config_info,
        policy_info,
        primary_info,
        rollback_buffer_verification_info,
        primary_verification_info,
        failure_info,
        capacity_info,
        deployment_info,
        observation_info,
        target_programdata,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(rollback_info, true, false, false)?;
    if target_program.is_signer || target_program.is_writable {
        return Err(GovernanceError::InvalidAccountPrivileges.into());
    }
    validate_exact_privileges(loader_info, false, false, true)?;
    require_distinct_accounts(&[
        config_info,
        policy_info,
        gate_info,
        primary_info,
        rollback_info,
        rollback_buffer_verification_info,
        primary_verification_info,
        failure_info,
        capacity_info,
        deployment_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
    ])?;
    require_program_ids(loader_info, None, None, None, None)?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    let mut gate = load_gate(program_id, gate_info, config_info, &config)?;
    let primary = load_proposal(program_id, primary_info, config_info, &config)?;
    let rollback = load_proposal(program_id, rollback_info, config_info, &config)?;
    validate_proposal_guard(
        &instruction.expected_primary,
        &primary,
        &config,
        &gate,
        primary_info.key,
    )?;
    validate_nonactive_rollback_guard(&instruction.expected_rollback, &rollback, &config, &gate)?;
    if gate.status != GateStatusV1::FrozenForUpgrade
        || gate.active_proposal != *primary_info.key
        || primary.state != ProposalStateV2::UpgradeExecuted
        || rollback.state != ProposalStateV2::Timelocked
        || rollback.proposal_class != ProposalClassV1::EmergencyRollback
        || !rollback.primary_proposal.present
        || rollback.primary_proposal.value != *primary_info.key
        || !primary.rollback_proposal.present
        || primary.rollback_proposal.value != *rollback_info.key
        || !primary.rollback_buffer.present
        || primary.rollback_buffer.value != rollback.buffer_pubkey
        || primary.rollback_artifact_length != rollback.artifact_length
        || primary.rollback_artifact_sha256 != rollback.artifact_sha256
        || primary.rollback_artifact_chunk_root != rollback.artifact_chunk_merkle_root
        || primary.rollback_artifact_scheme_id != rollback.artifact_scheme_id
        || primary.target_nonce != rollback.target_nonce
    {
        return Err(GovernanceError::InvalidProposalCommitment.into());
    }
    let slot = Clock::get()?.slot;
    if slot == 0
        || slot < policy.activation_slot
        || slot < rollback.not_before_slot
        || slot >= rollback.expiry_slot
        || slot < primary.upgrade_executed_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    require_deployment_guard(&instruction.expected_primary, &primary, &deployment)?;
    require_deployment_guard(&instruction.expected_rollback, &rollback, &deployment)?;
    let primary_verification_generation =
        if instruction.expected_primary_verification_generation == 0 {
            if *primary_verification_info.key != primary.programdata_verification
                || primary_verification_info.owner != &system_program::ID
                || primary_verification_info.data_len() != 0
            {
                return Err(GovernanceError::CrossAccountMismatch.into());
            }
            0
        } else {
            let verification = load_programdata_verification(
                program_id,
                primary_verification_info,
                primary_info,
                config_info,
                &primary,
            )?;
            if verification.status == ProgramDataVerificationStatusV2::Verified {
                return Err(GovernanceError::InvalidStateTransition.into());
            }
            verification.verification_generation
        };
    let failure = load_fixed_controller_account::<ProgramDataFailureObservationV2>(
        program_id,
        failure_info,
        ProgramDataFailureObservationV2::LEN,
    )?;
    validate_programdata_failure_observation_digest_v2(&failure)?;
    if derive_programdata_failure_observation_pda(program_id, primary_info.key, gate.epoch)
        != (*failure_info.key, failure.bump)
        || failure.primary_proposal != *primary_info.key
        || failure.proposal_digest != primary.proposal_digest
        || failure.protocol_gate != *gate_info.key
        || failure.frozen_epoch != gate.epoch
        || failure.failure_digest != instruction.expected_failure_evidence_digest
        || failure.programdata_observation != *observation_info.key
        || failure.observation_generation != instruction.expected_programdata_observation_generation
        || primary_verification_generation != instruction.expected_primary_verification_generation
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let observation = load_observation_any_status(
        program_id,
        observation_info,
        config_info,
        capacity_info,
        primary_info,
        &config,
        &capacity,
    )?;
    let observation_bytes = observation_info.try_borrow_data()?;
    let observation_state_hash = hashv(&[&observation_bytes]).to_bytes();
    drop(observation_bytes);
    if observation.generation != instruction.expected_programdata_observation_generation
        || observation_state_hash != instruction.expected_programdata_observation_state_hash
        || observation.purpose != failure.observation_purpose
        || observation.subject_digest != failure.observation_subject_digest
        || (observation.status == ProgramDataObservationStatusV1::Finalized)
            != failure.observation_finalized
        || (failure.observation_finalized
            && (observation.final_raw_merkle_root != failure.observation_root
                || observation.observation_digest != failure.observation_digest))
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    if *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *authority_info.key != config.authority_pda
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let runtime = capture_runtime_graph(target_program, target_programdata)?;
    if !runtime_matches_failure_observation(&runtime, &failure) {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let rollback_verification = load_buffer_verification_without_live_buffer(
        program_id,
        rollback_buffer_verification_info,
        rollback_info,
        config_info,
        &config,
        &rollback,
    )?;
    if rollback_verification.status != instruction.expected_rollback_buffer_verification_status
        || rollback_verification.status != BufferVerificationStatusV1::Verified
        || rollback_verification.verified_chunk_bitmap
            != instruction.expected_rollback_verified_chunk_bitmap
        || rollback_verification.verified_chunk_count
            != instruction.expected_rollback_verified_chunk_count
        || rollback_verification.verified_chunk_count != rollback.artifact_chunk_count
        || rollback_verification.finalized_slot
            != instruction.expected_rollback_buffer_finalized_slot
        || rollback_verification.finalized_slot == 0
        || rollback_verification.finalized_slot > primary.upgrade_executed_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let next_epoch = gate
        .epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if next_epoch != instruction.expected_next_gate_epoch {
        return Err(GovernanceError::InvalidProposalEpoch.into());
    }
    let mut next_rollback = (*rollback).clone();
    next_rollback.state = ProposalStateV2::Frozen;
    next_rollback.freeze_gate_epoch = next_epoch;
    next_rollback.frozen_slot = slot;
    validate_upgrade_proposal_digest_v3(&next_rollback)?;
    gate.epoch = next_epoch;
    gate.status = GateStatusV1::FrozenForUpgrade;
    gate.active_proposal = *rollback_info.key;
    gate.freeze_slot = slot;
    gate.freeze_reason_code = ROLLBACK_ACTIVATION_FREEZE_REASON_V1;
    gate.validate_static()?;
    let gate_bytes = encode_fixed_account(&*gate, ProtocolGateV1::LEN)?;
    let rollback_bytes = encode_fixed_account(&next_rollback, UpgradeProposalV3::LEN)?;
    commit_two_fixed_accounts(
        program_id,
        gate_info,
        &gate_bytes,
        ProtocolGateV1::LEN,
        rollback_info,
        &rollback_bytes,
        UpgradeProposalV3::LEN,
    )
}

fn require_program_ids(
    loader: &AccountInfo<'_>,
    system: Option<&AccountInfo<'_>>,
    rent: Option<&AccountInfo<'_>>,
    clock: Option<&AccountInfo<'_>>,
    instructions_info: Option<&AccountInfo<'_>>,
) -> ProgramResult {
    if *loader.key != UPGRADEABLE_LOADER_ID
        || system.is_some_and(|account| *account.key != system_program::ID)
        || rent.is_some_and(|account| *account.key != sysvar_ids::rent::ID)
        || clock.is_some_and(|account| *account.key != sysvar_ids::clock::ID)
        || instructions_info.is_some_and(|account| *account.key != sysvar_ids::instructions::ID)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
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

fn load_capacity_policy(
    program_id: &Pubkey,
    capacity_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<ProgramDataCapacityPolicyV1>, ProgramError> {
    let capacity = load_fixed_controller_account::<ProgramDataCapacityPolicyV1>(
        program_id,
        capacity_info,
        ProgramDataCapacityPolicyV1::LEN,
    )?;
    validate_capacity_policy_digest_v1(&capacity)?;
    if derive_capacity_policy_pda(program_id, &config.target_program)
        != (*capacity_info.key, capacity.bump)
        || capacity.controller_program != *program_id
        || capacity.controller_config != *config_info.key
        || capacity.target_program != config.target_program
        || capacity.target_programdata != config.target_programdata
        || capacity.upgradeable_loader != config.upgradeable_loader
    {
        return Err(GovernanceError::CapacityPolicyMismatch.into());
    }
    Ok(capacity)
}

fn load_current_deployment(
    program_id: &Pubkey,
    deployment_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
) -> Result<Box<CurrentDeploymentStateV1>, ProgramError> {
    let deployment = load_fixed_controller_account::<CurrentDeploymentStateV1>(
        program_id,
        deployment_info,
        CurrentDeploymentStateV1::LEN,
    )?;
    validate_current_deployment_digest_v1(&deployment)?;
    if derive_current_deployment_state_pda(program_id, &config.target_program)
        != (*deployment_info.key, deployment.bump)
        || deployment.controller_program != *program_id
        || deployment.controller_config != *config_info.key
        || deployment.capacity_policy != *capacity_info.key
        || deployment.capacity_policy_digest != capacity.policy_digest
        || deployment.target_program != config.target_program
        || deployment.target_programdata != config.target_programdata
        || deployment.upgradeable_loader != config.upgradeable_loader
        || deployment.controller_authority != config.authority_pda
        || deployment.installed_authority != config.authority_pda
        || deployment.actual_programdata_capacity > capacity.maximum_payload_capacity
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(deployment)
}

fn load_proposal(
    program_id: &Pubkey,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<UpgradeProposalV3>, ProgramError> {
    let proposal = load_upgrade_proposal_v3(program_id, proposal_info)?;
    validate_upgrade_proposal_digest_v3(&proposal)?;
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

fn validate_proposal_guard(
    expected: &ProposalGuardV3,
    proposal: &UpgradeProposalV3,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    proposal_key: &Pubkey,
) -> ProgramResult {
    if expected.expected_proposal_digest != proposal.proposal_digest
        || expected.expected_state != proposal.state
        || expected.expected_gate_status != gate.status
        || expected.expected_gate_epoch != gate.epoch
        || expected.expected_target_nonce != config.target_nonce
        || expected.expected_capacity_policy_digest != proposal.capacity_policy_digest
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let frozen_lifecycle = matches!(
        proposal.state,
        ProposalStateV2::Frozen
            | ProposalStateV2::Extended
            | ProposalStateV2::UpgradeExecuted
            | ProposalStateV2::ProgramDataVerified
            | ProposalStateV2::PoststateAccepted
            | ProposalStateV2::UnfreezeApproved
    );
    if frozen_lifecycle {
        let consumed = proposal
            .target_nonce
            .checked_add(1)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
        if gate.status != GateStatusV1::FrozenForUpgrade
            || gate.active_proposal != *proposal_key
            || gate.epoch != proposal.freeze_gate_epoch
            || config.target_nonce != consumed
            || gate.freeze_slot != proposal.frozen_slot
            || gate.freeze_reason_code == 0
        {
            return Err(GovernanceError::InvalidProposalEpoch.into());
        }
    } else if !matches!(
        proposal.state,
        ProposalStateV2::Cancelled | ProposalStateV2::Expired | ProposalStateV2::Retired
    ) && (proposal.target_nonce != config.target_nonce
        || proposal.creation_gate_epoch != gate.epoch
        || proposal.creation_gate_status != gate.status)
    {
        return Err(GovernanceError::InvalidProposalEpoch.into());
    }
    Ok(())
}

fn require_deployment_guard(
    expected: &ProposalGuardV3,
    proposal: &UpgradeProposalV3,
    deployment: &CurrentDeploymentStateV1,
) -> ProgramResult {
    if expected.expected_current_deployment_digest != deployment.deployment_digest
        || expected.expected_current_deployment_generation != deployment.deployment_generation
        || proposal.current_deployment_state == Pubkey::default()
        || deployment.deployment_generation < proposal.current_deployment_generation
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
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
    proposal: &UpgradeProposalV3,
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

fn current_preexpiry_slot(proposal: &UpgradeProposalV3) -> Result<u64, ProgramError> {
    let slot = Clock::get()?.slot;
    if slot == 0 || slot >= proposal.expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(slot)
}

fn current_frozen_slot(proposal: &UpgradeProposalV3) -> Result<u64, ProgramError> {
    let slot = Clock::get()?.slot;
    if slot == 0 || slot < proposal.frozen_slot || slot >= proposal.expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(slot)
}

#[allow(clippy::too_many_arguments)]
fn load_observation_any_status(
    program_id: &Pubkey,
    observation_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    subject_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
) -> Result<Box<ProgramDataObservationV1>, ProgramError> {
    let observation = load_fixed_controller_account::<ProgramDataObservationV1>(
        program_id,
        observation_info,
        ProgramDataObservationV1::LEN,
    )?;
    observation.validate_static()?;
    if derive_programdata_observation_pda(
        program_id,
        &config.target_program,
        observation.purpose as u8,
        &observation.subject_digest,
        observation.generation,
    ) != (*observation_info.key, observation.bump)
        || observation.controller_program != *program_id
        || observation.controller_config != *config_info.key
        || observation.capacity_policy != *capacity_info.key
        || observation.capacity_policy_digest != capacity.policy_digest
        || observation.protocol_gate != config.gate_pda
        || observation.subject != *subject_info.key
        || observation.target_program != config.target_program
        || observation.target_programdata != config.target_programdata
        || observation.upgradeable_loader != config.upgradeable_loader
        || observation.expected_artifact_scheme_id != capacity.artifact_scheme_id
        || observation.artifact_chunk_size != capacity.artifact_chunk_size
        || observation.raw_observation_scheme_id != capacity.observation_scheme_id
        || observation.raw_chunk_size != capacity.observation_chunk_size
    {
        return Err(GovernanceError::InvalidProgramDataObservation.into());
    }
    let expected_subject = compute_programdata_observation_subject_digest_v1(
        program_id,
        config_info.key,
        &config.target_program,
        &config.target_programdata,
        observation.purpose,
        subject_info.key,
        observation.generation,
        &observation.protocol_gate,
        observation.gate_status,
        observation.gate_epoch,
        &observation.gate_active_proposal,
        observation.gate_freeze_slot,
        observation.gate_freeze_reason_code,
        &capacity.policy_digest,
        observation.expected_artifact_length,
        &observation.expected_artifact_sha256,
        &observation.expected_artifact_merkle_root,
        &observation.expected_artifact_scheme_id,
        observation.minimum_required_capacity,
    )?;
    if expected_subject != observation.subject_digest {
        return Err(GovernanceError::InvalidProgramDataObservation.into());
    }
    if observation.status == ProgramDataObservationStatusV1::Finalized {
        validate_programdata_observation_digest_v1(&observation)?;
    }
    Ok(observation)
}

#[allow(clippy::too_many_arguments)]
fn load_fresh_observation(
    program_id: &Pubkey,
    observation_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    subject_info: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    loader_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
    gate: &ProtocolGateV1,
    purpose: ProgramDataObservationPurposeV1,
    artifact_length: u64,
    artifact_sha256: &[u8; 32],
    artifact_root: &[u8; 32],
    minimum_required_capacity: u64,
) -> Result<Box<ProgramDataObservationV1>, ProgramError> {
    let observation = load_observation_any_status(
        program_id,
        observation_info,
        config_info,
        capacity_info,
        subject_info,
        config,
        capacity,
    )?;
    if observation.status != ProgramDataObservationStatusV1::Finalized
        || observation.purpose != purpose
        || observation.expected_artifact_length != artifact_length
        || observation.expected_artifact_sha256 != *artifact_sha256
        || observation.expected_artifact_merkle_root != *artifact_root
        || observation.minimum_required_capacity != minimum_required_capacity
        || observation.protocol_gate != config.gate_pda
        || observation.gate_status != gate.status
        || observation.gate_epoch != gate.epoch
        || observation.gate_active_proposal != gate.active_proposal
        || observation.gate_freeze_slot != gate.freeze_slot
        || observation.gate_freeze_reason_code != gate.freeze_reason_code
        || *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *loader_info.key != config.upgradeable_loader
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let header = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    let program_data = target_program.try_borrow_data()?;
    let mut program_snapshot = [0u8; LOADER_PROGRAM_ACCOUNT_LEN];
    if program_data.len() != LOADER_PROGRAM_ACCOUNT_LEN {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    program_snapshot.copy_from_slice(&program_data);
    drop(program_data);
    let programdata_data = target_programdata.try_borrow_data()?;
    let raw_len =
        u64::try_from(programdata_data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let mut programdata_snapshot = [0u8; LOADER_PROGRAMDATA_METADATA_LEN];
    programdata_snapshot.copy_from_slice(
        programdata_data
            .get(..LOADER_PROGRAMDATA_METADATA_LEN)
            .ok_or(GovernanceError::StaleProgramDataObservation)?,
    );
    drop(programdata_data);
    if observation.program_owner != *target_program.owner
        || observation.program_executable != target_program.executable
        || observation.program_data_length != LOADER_PROGRAM_ACCOUNT_LEN as u64
        || observation.program_header_snapshot != program_snapshot
        || observation.linked_programdata != config.target_programdata
        || observation.programdata_owner != *target_programdata.owner
        || observation.programdata_executable != target_programdata.executable
        || observation.programdata_header_snapshot != programdata_snapshot
        || observation.deployed_slot != header.deployed_slot
        || !observation.upgrade_authority.present
        || observation.upgrade_authority.value != config.authority_pda
        || observation.raw_data_length != raw_len
        || observation.actual_capacity
            != u64::try_from(header.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
        || raw_len
            != observation
                .actual_capacity
                .checked_add(LOADER_PROGRAMDATA_METADATA_LEN as u64)
                .ok_or(GovernanceError::ArithmeticOverflow)?
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(observation)
}

fn require_observation_guard(
    observation: &ProgramDataObservationV1,
    expected_digest: &[u8; 32],
    expected_generation: u64,
    expected_root: &[u8; 32],
    expected_finalized_slot: u64,
    expected_capacity: u64,
) -> ProgramResult {
    if observation.observation_digest != *expected_digest
        || observation.generation != expected_generation
        || observation.final_raw_merkle_root != *expected_root
        || observation.finalized_slot != expected_finalized_slot
        || observation.actual_capacity != expected_capacity
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

/// Loads the immutable primary-failure PDA selected by an EmergencyRollback
/// execution and proves that the same Loader-executable mismatch is still
/// present in the live ProgramData.  This is deliberately narrower than the
/// failure-observation surface: malformed linkage, ownership, header, or
/// authority cannot safely reach Loader Upgrade and therefore cannot be used
/// as an execution capability.
#[allow(clippy::too_many_arguments)]
fn load_and_revalidate_rollback_failure(
    program_id: &Pubkey,
    failure_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    primary_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    rollback_info: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
    gate: &ProtocolGateV1,
    deployment: &CurrentDeploymentStateV1,
    primary: &UpgradeProposalV3,
    rollback: &UpgradeProposalV3,
) -> Result<Box<ProgramDataFailureObservationV2>, ProgramError> {
    let failure = load_fixed_controller_account::<ProgramDataFailureObservationV2>(
        program_id,
        failure_info,
        ProgramDataFailureObservationV2::LEN,
    )?;
    validate_programdata_failure_observation_digest_v2(&failure)?;
    let next_epoch = failure
        .frozen_epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let consumed_nonce = primary
        .target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if derive_programdata_failure_observation_pda(
        program_id,
        primary_info.key,
        failure.frozen_epoch,
    ) != (*failure_info.key, failure.bump)
        || !failure.finalized
        || failure.controller_config != *config_info.key
        || failure.protocol_gate != *gate_info.key
        || failure.primary_proposal != *primary_info.key
        || failure.proposal_digest != primary.proposal_digest
        || failure.capacity_policy != *capacity_info.key
        || failure.capacity_policy_digest != capacity.policy_digest
        || failure.current_deployment_state != *deployment_info.key
        || failure.current_deployment_digest != primary.current_deployment_digest
        || failure.current_deployment_generation != primary.current_deployment_generation
        || failure.target_program != config.target_program
        || failure.target_programdata != config.target_programdata
        || failure.upgradeable_loader != config.upgradeable_loader
        || failure.frozen_epoch != primary.freeze_gate_epoch
        || next_epoch != gate.epoch
        || rollback.freeze_gate_epoch != gate.epoch
        || gate.status != GateStatusV1::FrozenForUpgrade
        || gate.active_proposal != *rollback_info.key
        || failure.target_nonce != consumed_nonce
        || failure.target_nonce != config.target_nonce
        || failure.expected_artifact_length != primary.artifact_length
        || failure.expected_artifact_sha256 != primary.artifact_sha256
        || failure.expected_artifact_merkle_root != primary.artifact_chunk_merkle_root
        || failure.expected_artifact_scheme_id != primary.artifact_scheme_id
        || failure.minimum_required_capacity != primary.minimum_required_capacity
        || failure.observation_scheme_id != capacity.observation_scheme_id
        || failure.observation_purpose != ProgramDataObservationPurposeV1::PostUpgrade
        || failure.actual_programdata_slot != primary.upgrade_executed_slot
        || failure.actual_capacity != deployment.actual_programdata_capacity
        || !failure.actual_authority.present
        || failure.actual_authority.value != config.authority_pda
        || failure.finalized_slot < primary.upgrade_executed_slot
        || failure.finalized_slot > rollback.frozen_slot
        || !matches!(
            failure.mismatch_class,
            ProgramDataMismatchClassV2::ArtifactPayload | ProgramDataMismatchClassV2::ZeroTail
        )
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let runtime = capture_runtime_graph(target_program, target_programdata)?;
    if !runtime_matches_failure_observation(&runtime, &failure)
        || !runtime.program_header_present
        || !runtime.linked_programdata.present
        || runtime.linked_programdata.value != config.target_programdata
        || runtime.program_owner != config.upgradeable_loader
        || !runtime.program_executable
        || runtime.programdata_owner != config.upgradeable_loader
        || runtime.programdata_executable
        || !runtime.programdata_header_present
        || !runtime.authority.present
        || runtime.authority.value != config.authority_pda
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let data = target_programdata.try_borrow_data()?;
    let payload = data
        .get(LOADER_PROGRAMDATA_METADATA_LEN..)
        .ok_or(GovernanceError::InvalidRelease1Account)?;
    let (expected_leaf, actual_leaf) = match failure.mismatch_class {
        ProgramDataMismatchClassV2::ArtifactPayload => {
            let exact = exact_region_chunk(
                payload,
                0,
                primary.artifact_length,
                primary.artifact_chunk_size,
                failure.failing_chunk_index,
            )?;
            (
                failure.expected_leaf_hash,
                artifact_chunk_leaf_hash(failure.failing_chunk_index, exact)?,
            )
        }
        ProgramDataMismatchClassV2::ZeroTail => {
            let tail_length = runtime
                .actual_capacity
                .checked_sub(primary.artifact_length)
                .ok_or(GovernanceError::InvalidCapacityPlan)?;
            let exact = exact_region_chunk(
                payload,
                primary.artifact_length,
                tail_length,
                primary.artifact_chunk_size,
                failure.failing_chunk_index,
            )?;
            (
                programdata_zero_tail_zero_hash(failure.failing_chunk_index, exact.len())?,
                programdata_zero_tail_chunk_hash(failure.failing_chunk_index, exact)?,
            )
        }
        _ => return Err(GovernanceError::InvalidRelease1Account.into()),
    };
    if expected_leaf != failure.expected_leaf_hash
        || actual_leaf != failure.actual_leaf_hash
        || expected_leaf == actual_leaf
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    drop(data);
    Ok(failure)
}

fn require_rollback_failure_guard(
    failure: &ProgramDataFailureObservationV2,
    instruction: &ExecuteUpgradeV2,
) -> ProgramResult {
    if instruction.expected_observation_digest != failure.failure_digest
        || instruction.expected_observation_generation != failure.observation_generation
        || instruction.expected_observation_root != failure.actual_leaf_hash
        || instruction.expected_observation_finalized_slot != failure.finalized_slot
        || instruction.expected_actual_capacity != failure.actual_capacity
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_buffer_verification(
    program_id: &Pubkey,
    verification_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    buffer_info: &AccountInfo<'_>,
    authority_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV3,
) -> Result<Box<BufferVerificationV1>, ProgramError> {
    let verification = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        verification_info,
        BufferVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    if derive_buffer_check_pda(program_id, proposal_info.key)
        != (*verification_info.key, verification.bump)
        || proposal.buffer_verification != *verification_info.key
        || verification.controller_config != *config_info.key
        || verification.proposal != *proposal_info.key
        || verification.upgradeable_loader != config.upgradeable_loader
        || verification.buffer != *buffer_info.key
        || verification.buffer != proposal.buffer_pubkey
        || verification.expected_uploader_authority != proposal.buffer_uploader_authority
        || verification.controller_authority != *authority_info.key
        || verification.controller_authority != config.authority_pda
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_chunk_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.chunk_hash_domain != proposal.artifact_scheme_id
        || verification.chunk_size != proposal.artifact_chunk_size
        || verification.chunk_count != proposal.artifact_chunk_count
    {
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
    proposal: &UpgradeProposalV3,
) -> Result<Box<BufferVerificationV1>, ProgramError> {
    let verification = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        verification_info,
        BufferVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    if derive_buffer_check_pda(program_id, proposal_info.key)
        != (*verification_info.key, verification.bump)
        || proposal.buffer_verification != *verification_info.key
        || verification.controller_config != *config_info.key
        || verification.proposal != *proposal_info.key
        || verification.upgradeable_loader != config.upgradeable_loader
        || verification.buffer != proposal.buffer_pubkey
        || verification.expected_uploader_authority != proposal.buffer_uploader_authority
        || verification.controller_authority != config.authority_pda
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_chunk_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.chunk_hash_domain != proposal.artifact_scheme_id
        || verification.chunk_size != proposal.artifact_chunk_size
        || verification.chunk_count != proposal.artifact_chunk_count
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

fn require_buffer_expectation(
    verification: &BufferVerificationV1,
    status: BufferVerificationStatusV1,
    bitmap: &[u8; VERIFICATION_BITMAP_BYTES_V1],
    count: u32,
) -> ProgramResult {
    if verification.status != status
        || verification.verified_chunk_bitmap != *bitmap
        || verification.verified_chunk_count != count
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn validate_sealed_buffer(
    buffer_info: &AccountInfo<'_>,
    authority: &Pubkey,
    config: &ControllerConfigV1,
    verification: &BufferVerificationV1,
) -> ProgramResult {
    let header = validate_buffer_account(buffer_info, &config.upgradeable_loader)?;
    let data = buffer_info.try_borrow_data()?;
    let header_hash = hashv(&[data
        .get(..LOADER_BUFFER_METADATA_LEN)
        .ok_or(GovernanceError::InvalidRelease1Account)?])
    .to_bytes();
    if header.authority != Some(*authority)
        || u64::try_from(header.payload_length).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != verification.artifact_length
        || header_hash != verification.sealed_buffer_header_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn exact_artifact_chunk(
    payload: &[u8],
    artifact_length: u64,
    chunk_size: u32,
    chunk_index: u32,
) -> Result<&[u8], ProgramError> {
    if u64::try_from(payload.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?
        != artifact_length
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    exact_region_chunk(payload, 0, artifact_length, chunk_size, chunk_index)
}

fn verify_and_mark_chunk(
    verification: &BufferVerificationV1,
    chunk_index: u32,
    exact_chunk: &[u8],
    proof: &[[u8; 32]],
) -> Result<BufferVerificationV1, ProgramError> {
    if !matches!(
        verification.status,
        BufferVerificationStatusV1::Adopted | BufferVerificationStatusV1::Verifying
    ) || chunk_index >= verification.chunk_count
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let byte_index =
        usize::try_from(chunk_index / 8).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let bit = 1u8 << (chunk_index % 8);
    if verification.verified_chunk_bitmap[byte_index] & bit != 0 {
        return Err(GovernanceError::InvalidRelease1Bitmap.into());
    }
    verify_artifact_chunk_proof(
        &verification.artifact_chunk_merkle_root,
        verification.artifact_length,
        verification.chunk_size,
        chunk_index,
        exact_chunk,
        proof,
    )?;
    let mut next = verification.clone();
    next.verified_chunk_bitmap[byte_index] |= bit;
    next.verified_chunk_count = next
        .verified_chunk_count
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    next.status = if next.verified_chunk_count == next.chunk_count {
        BufferVerificationStatusV1::ReadyToFinalize
    } else {
        BufferVerificationStatusV1::Verifying
    };
    next.validate_schema()?;
    Ok(next)
}

fn canonical_buffer_header(authority: &Pubkey) -> [u8; LOADER_BUFFER_METADATA_LEN] {
    let mut bytes = [0u8; LOADER_BUFFER_METADATA_LEN];
    bytes[..4].copy_from_slice(&1u32.to_le_bytes());
    bytes[4] = 1;
    bytes[5..].copy_from_slice(authority.as_ref());
    bytes
}

#[allow(clippy::too_many_arguments)]
fn load_accepted_prestate_at_epoch(
    program_id: &Pubkey,
    checkpoint_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    observation_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
    proposal: &UpgradeProposalV3,
    expected_gate_epoch: u64,
    deployment: &CurrentDeploymentStateV1,
    expected_digest: &[u8; 32],
    expected_generation: u64,
) -> Result<Box<StateCheckpointV2>, ProgramError> {
    let checkpoint = load_fixed_controller_account::<StateCheckpointV2>(
        program_id,
        checkpoint_info,
        StateCheckpointV2::LEN,
    )?;
    validate_state_checkpoint_digest_v2(&checkpoint)?;
    let observation = load_observation_any_status(
        program_id,
        observation_info,
        config_info,
        capacity_info,
        proposal_info,
        config,
        capacity,
    )?;
    if observation.status != ProgramDataObservationStatusV1::Finalized {
        return Err(GovernanceError::IncompleteProgramDataObservation.into());
    }
    if derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Prestate)
        != (*checkpoint_info.key, checkpoint.bump)
        || proposal.prestate_checkpoint != *checkpoint_info.key
        || checkpoint.phase != StateCheckpointPhaseV1::Prestate
        || checkpoint.controller_config != *config_info.key
        || checkpoint.proposal != *proposal_info.key
        || checkpoint.emergency_resolution != Pubkey::default()
        || checkpoint.subject_digest != proposal.proposal_digest
        || checkpoint.target_program != proposal.target_program
        || checkpoint.target_programdata != proposal.target_programdata
        || checkpoint.capacity_policy != *capacity_info.key
        || checkpoint.capacity_policy_digest != proposal.capacity_policy_digest
        || checkpoint.current_deployment_state != *deployment_info.key
        || checkpoint.current_deployment_digest != proposal.current_deployment_digest
        || checkpoint.current_deployment_generation != proposal.current_deployment_generation
        || checkpoint.checkpoint_generation != expected_generation
        || checkpoint.programdata_observation != *observation_info.key
        || checkpoint.observation_generation != observation.generation
        || checkpoint.observation_subject_digest != observation.subject_digest
        || checkpoint.observation_root != observation.final_raw_merkle_root
        || checkpoint.observation_digest != observation.observation_digest
        || checkpoint.observation_finalized_slot != observation.finalized_slot
        || checkpoint.gate_epoch != expected_gate_epoch
        || checkpoint.target_programdata_slot != observation.deployed_slot
        || checkpoint.artifact_length != observation.expected_artifact_length
        || checkpoint.artifact_sha256 != observation.expected_artifact_sha256
        || checkpoint.artifact_merkle_root != observation.expected_artifact_merkle_root
        || checkpoint.artifact_scheme_id != observation.expected_artifact_scheme_id
        || checkpoint.minimum_required_capacity != observation.minimum_required_capacity
        || checkpoint.observed_raw_data_length != observation.raw_data_length
        || checkpoint.actual_capacity != observation.actual_capacity
        || checkpoint.observed_authority != observation.upgrade_authority
        || checkpoint.checkpoint_digest != *expected_digest
        || !checkpoint.accepted
        || checkpoint.approval_count < 3
        || checkpoint.forbidden_drift_count != 0
        || deployment.deployment_generation < proposal.current_deployment_generation
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(checkpoint)
}

fn validate_target_keys(
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
    let appended = payload
        .get(previous_capacity..)
        .ok_or(GovernanceError::InvalidRelease1Account)?;
    if payload.len() != expected_capacity
        || appended.len() != extension_delta
        || appended.iter().any(|byte| *byte != 0)
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    Ok(())
}

fn validate_canonical_envelope(
    program_id: &Pubkey,
    current_accounts: &[AccountInfo<'_>],
    instructions_info: &AccountInfo<'_>,
    expected_current_data: &[u8],
    envelope: &CeremonyEnvelopeV1,
) -> ProgramResult {
    envelope.validate()?;
    if envelope.compute_unit_limit == 0
        || envelope.compute_unit_limit > MAX_CEREMONY_COMPUTE_UNIT_LIMIT_V1
        || envelope.compute_unit_price_micro_lamports
            > MAX_CEREMONY_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    let nonce = envelope
        .durable_nonce_account
        .present
        .then_some(envelope.durable_nonce_account.value);
    let nonce_authority = envelope
        .durable_nonce_authority
        .present
        .then_some(envelope.durable_nonce_authority.value);
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

fn validate_set_buffer_authority_checked_cpi_shape(
    instruction: &Instruction,
    buffer: &Pubkey,
    current_authority: &Pubkey,
    new_authority: &Pubkey,
) -> ProgramResult {
    let expected = [
        (*buffer, false, true),
        (*current_authority, true, false),
        (*new_authority, true, false),
    ];
    validate_closed_loader_instruction(instruction, &expected)
}

fn validate_extend_cpi_shape(
    instruction: &Instruction,
    programdata: &Pubkey,
    program: &Pubkey,
    authority: &Pubkey,
    system: &Pubkey,
    payer: &Pubkey,
) -> ProgramResult {
    let expected = [
        (*programdata, false, true),
        (*program, false, true),
        (*authority, true, true),
        (*system, false, false),
        (*payer, true, true),
    ];
    validate_closed_loader_instruction(instruction, &expected)
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
    validate_closed_loader_instruction(instruction, &expected)
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
    validate_closed_loader_instruction(instruction, &expected)
}

fn validate_closed_loader_instruction(
    instruction: &Instruction,
    expected: &[(Pubkey, bool, bool)],
) -> ProgramResult {
    if instruction.program_id != UPGRADEABLE_LOADER_ID
        || instruction.accounts.len() != expected.len()
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    for (meta, (key, signer, writable)) in instruction.accounts.iter().zip(expected) {
        if meta.pubkey != *key || meta.is_signer != *signer || meta.is_writable != *writable {
            return Err(GovernanceError::CrossAccountMismatch.into());
        }
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_counterpart(
    program_id: &Pubkey,
    counterpart_info: &AccountInfo<'_>,
    counterpart_verification_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    _authority_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV3,
    proposal_key: &Pubkey,
    instruction: &ExecuteUpgradeV2,
    slot: u64,
) -> ProgramResult {
    let counterpart = load_proposal(program_id, counterpart_info, config_info, config)?;
    if counterpart.proposal_digest != instruction.expected_counterpart_proposal_digest
        || counterpart.checkpoint_schema_id != proposal.checkpoint_schema_id
        || counterpart.checkpoint_policy_hash != proposal.checkpoint_policy_hash
        || counterpart.capacity_policy != proposal.capacity_policy
        || counterpart.capacity_policy_digest != proposal.capacity_policy_digest
        || counterpart.target_nonce != proposal.target_nonce
    {
        return Err(GovernanceError::InvalidProposalCommitment.into());
    }
    let verification = load_buffer_verification_without_live_buffer(
        program_id,
        counterpart_verification_info,
        counterpart_info,
        config_info,
        config,
        &counterpart,
    )?;
    if verification.status != instruction.expected_counterpart_buffer_verification_status {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    match proposal.proposal_class {
        ProposalClassV1::EmergencyRollback => {
            if !proposal.primary_proposal.present
                || proposal.primary_proposal.value != *counterpart_info.key
                || !counterpart.rollback_proposal.present
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
                || !counterpart.primary_proposal.present
                || counterpart.primary_proposal.value != *proposal_key
                || counterpart.proposal_class != ProposalClassV1::EmergencyRollback
                || counterpart.state != ProposalStateV2::Timelocked
                || counterpart.not_before_slot > slot
                || counterpart.expiry_slot <= slot
                || verification.status != BufferVerificationStatusV1::Verified
                || verification.finalized_slot == 0
                || verification.finalized_slot > slot
                || !proposal.rollback_buffer.present
                || proposal.rollback_buffer.value != counterpart.buffer_pubkey
                || proposal.rollback_artifact_length != counterpart.artifact_length
                || proposal.rollback_artifact_sha256 != counterpart.artifact_sha256
                || proposal.rollback_artifact_chunk_root != counterpart.artifact_chunk_merkle_root
                || proposal.rollback_artifact_scheme_id != counterpart.artifact_scheme_id
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
    proposal: &UpgradeProposalV3,
) -> Result<Box<ProgramDataVerificationV2>, ProgramError> {
    let verification = load_fixed_controller_account::<ProgramDataVerificationV2>(
        program_id,
        verification_info,
        ProgramDataVerificationV2::LEN,
    )?;
    validate_programdata_verification_digest_v2(&verification)?;
    if derive_programdata_check_pda(program_id, proposal_info.key)
        != (*verification_info.key, verification.bump)
        || proposal.programdata_verification != *verification_info.key
        || verification.controller_config != *config_info.key
        || verification.proposal != *proposal_info.key
        || verification.proposal_digest != proposal.proposal_digest
        || verification.protocol_gate != proposal.protocol_gate
        || verification.freeze_gate_epoch != proposal.freeze_gate_epoch
        || verification.target_nonce
            != proposal
                .target_nonce
                .checked_add(1)
                .ok_or(GovernanceError::ArithmeticOverflow)?
        || verification.target_program != proposal.target_program
        || verification.target_programdata != proposal.target_programdata
        || verification.upgradeable_loader != proposal.upgradeable_loader
        || verification.controller_authority != proposal.authority_pda
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.artifact_scheme_id != proposal.artifact_scheme_id
        || verification.minimum_required_capacity != proposal.minimum_required_capacity
        || verification.observed_deployed_slot != proposal.upgrade_executed_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

fn validate_nonactive_rollback_guard(
    expected: &ProposalGuardV3,
    rollback: &UpgradeProposalV3,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    if expected.expected_proposal_digest != rollback.proposal_digest
        || expected.expected_state != rollback.state
        || expected.expected_gate_status != gate.status
        || expected.expected_gate_epoch != gate.epoch
        || expected.expected_target_nonce != config.target_nonce
        || expected.expected_capacity_policy_digest != rollback.capacity_policy_digest
        || rollback.state != ProposalStateV2::Timelocked
        || rollback.proposal_class != ProposalClassV1::EmergencyRollback
        || config.target_nonce
            != rollback
                .target_nonce
                .checked_add(1)
                .ok_or(GovernanceError::ArithmeticOverflow)?
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct RuntimeProgramDataGraphV2 {
    program_owner: Pubkey,
    program_executable: bool,
    program_data_length: u64,
    program_header_present: bool,
    linked_programdata: OptionalPubkeyV1,
    programdata_owner: Pubkey,
    programdata_executable: bool,
    programdata_data_length: u64,
    programdata_header_present: bool,
    deployed_slot: u64,
    actual_capacity: u64,
    authority: OptionalPubkeyV1,
}

fn state_optional_pubkey(value: Option<Pubkey>) -> Result<OptionalPubkeyV1, ProgramError> {
    value.map_or_else(
        || Ok(OptionalPubkeyV1::none()),
        |key| OptionalPubkeyV1::some(key).map_err(ProgramError::from),
    )
}

fn capture_runtime_graph(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
) -> Result<RuntimeProgramDataGraphV2, ProgramError> {
    let program_data = target_program.try_borrow_data()?;
    let parsed_program = parse_upgradeable_program(&program_data).ok();
    let program_data_length =
        u64::try_from(program_data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    drop(program_data);
    let programdata_data = target_programdata.try_borrow_data()?;
    let parsed_programdata = parse_upgradeable_programdata(&programdata_data).ok();
    let programdata_data_length =
        u64::try_from(programdata_data.len()).map_err(|_| GovernanceError::ArithmeticOverflow)?;
    drop(programdata_data);
    Ok(RuntimeProgramDataGraphV2 {
        program_owner: *target_program.owner,
        program_executable: target_program.executable,
        program_data_length,
        program_header_present: parsed_program.is_some(),
        linked_programdata: state_optional_pubkey(
            parsed_program.map(|header| header.programdata_address),
        )?,
        programdata_owner: *target_programdata.owner,
        programdata_executable: target_programdata.executable,
        programdata_data_length,
        programdata_header_present: parsed_programdata.is_some(),
        deployed_slot: parsed_programdata
            .as_ref()
            .map_or(0, |header| header.deployed_slot),
        actual_capacity: parsed_programdata.as_ref().map_or(0, |header| {
            u64::try_from(header.capacity).unwrap_or(u64::MAX)
        }),
        authority: state_optional_pubkey(
            parsed_programdata.and_then(|header| header.upgrade_authority),
        )?,
    })
}

fn runtime_matches_observation(
    runtime: &RuntimeProgramDataGraphV2,
    observation: &ProgramDataObservationV1,
) -> bool {
    runtime.program_owner == observation.program_owner
        && runtime.program_executable == observation.program_executable
        && runtime.program_data_length == observation.program_data_length
        && runtime.program_header_present == observation.program_header_present
        && runtime.linked_programdata.present
        && runtime.linked_programdata.value == observation.linked_programdata
        && runtime.programdata_owner == observation.programdata_owner
        && runtime.programdata_executable == observation.programdata_executable
        && runtime.programdata_header_present == observation.programdata_header_present
        && runtime.deployed_slot == observation.deployed_slot
        && runtime.actual_capacity == observation.actual_capacity
        && runtime.authority == observation.upgrade_authority
        && runtime.programdata_data_length == observation.raw_data_length
}

fn runtime_matches_failure_observation(
    runtime: &RuntimeProgramDataGraphV2,
    failure: &ProgramDataFailureObservationV2,
) -> bool {
    runtime.program_owner == failure.actual_program_owner
        && runtime.program_executable == failure.actual_program_executable
        && runtime.program_data_length == failure.actual_program_data_length
        && runtime.program_header_present == failure.program_header_present
        && runtime.linked_programdata == failure.actual_linked_programdata
        && runtime.programdata_owner == failure.actual_programdata_owner
        && runtime.programdata_executable == failure.actual_programdata_executable
        && runtime.programdata_data_length == failure.actual_programdata_data_length
        && runtime.programdata_header_present == failure.programdata_header_present
        && runtime.deployed_slot == failure.actual_programdata_slot
        && runtime.actual_capacity == failure.actual_capacity
        && runtime.authority == failure.actual_authority
}

fn validate_failure_observation_binding(
    observation: &ProgramDataObservationV1,
    proposal: &UpgradeProposalV3,
    capacity: &ProgramDataCapacityPolicyV1,
) -> ProgramResult {
    if observation.purpose != ProgramDataObservationPurposeV1::PostUpgrade
        || observation.deployed_slot != proposal.upgrade_executed_slot
        || observation.start_slot <= proposal.upgrade_executed_slot
        || observation.expected_artifact_length != proposal.artifact_length
        || observation.expected_artifact_sha256 != proposal.artifact_sha256
        || observation.expected_artifact_merkle_root != proposal.artifact_chunk_merkle_root
        || observation.expected_artifact_scheme_id != proposal.artifact_scheme_id
        || observation.artifact_chunk_size != proposal.artifact_chunk_size
        || observation.artifact_chunk_count != proposal.artifact_chunk_count
        || observation.minimum_required_capacity != proposal.minimum_required_capacity
        || observation.raw_observation_scheme_id != capacity.observation_scheme_id
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_failure_witness(
    instruction: &ProgramDataFailureWitnessV2,
    proposal: &UpgradeProposalV3,
    capacity: &ProgramDataCapacityPolicyV1,
    observation: &ProgramDataObservationV1,
    target_programdata: &AccountInfo<'_>,
    runtime: &RuntimeProgramDataGraphV2,
    config: &ControllerConfigV1,
) -> Result<([u8; 32], [u8; 32]), ProgramError> {
    validate_rollback_authorizing_mismatch_class(instruction.mismatch_class)?;
    let proof_present = instruction.proof.proof_len != 0
        || instruction.proof.nodes.iter().any(|node| *node != [0; 32]);
    match instruction.mismatch_class {
        ProgramDataMismatchClassV2::ArtifactPayload => {
            if instruction.failing_chunk_index == NO_FAILING_CHUNK_INDEX_V1
                || instruction.expected_leaf_hash == [0; 32]
            {
                return Err(GovernanceError::InvalidMerkleProof.into());
            }
        }
        ProgramDataMismatchClassV2::ZeroTail => {
            if instruction.failing_chunk_index == NO_FAILING_CHUNK_INDEX_V1
                || instruction.expected_leaf_hash != [0; 32]
                || proof_present
            {
                return Err(GovernanceError::InvalidMerkleProof.into());
            }
        }
        _ => {
            if instruction.failing_chunk_index != NO_FAILING_CHUNK_INDEX_V1
                || instruction.expected_leaf_hash != [0; 32]
                || proof_present
            {
                return Err(GovernanceError::InvalidMerkleProof.into());
            }
        }
    }
    let program_linkage = runtime.program_header_present
        && runtime.linked_programdata.present
        && runtime.linked_programdata.value == config.target_programdata;
    let program_owner = runtime.program_owner == config.upgradeable_loader;
    let program_executable = runtime.program_executable;
    let programdata_owner = runtime.programdata_owner == config.upgradeable_loader;
    let programdata_executable = !runtime.programdata_executable;
    let header_shape = runtime.programdata_header_present
        && runtime.deployed_slot != 0
        && runtime.programdata_data_length
            == runtime
                .actual_capacity
                .checked_add(LOADER_PROGRAMDATA_METADATA_LEN as u64)
                .ok_or(GovernanceError::ArithmeticOverflow)?;
    let authority = runtime.authority.present && runtime.authority.value == config.authority_pda;
    let canonical_prefix = program_linkage
        && program_owner
        && program_executable
        && programdata_owner
        && programdata_executable
        && header_shape;
    let observation_scheme_matches = observation.raw_observation_scheme_id
        == capacity.observation_scheme_id
        && observation.expected_artifact_scheme_id == proposal.artifact_scheme_id
        && observation.artifact_chunk_size == proposal.artifact_chunk_size
        && observation.artifact_chunk_count == proposal.artifact_chunk_count;
    let observation_artifact_matches = observation.expected_artifact_length
        == proposal.artifact_length
        && observation.expected_artifact_sha256 == proposal.artifact_sha256
        && observation.expected_artifact_merkle_root == proposal.artifact_chunk_merkle_root
        && observation.minimum_required_capacity == proposal.minimum_required_capacity;

    match instruction.mismatch_class {
        ProgramDataMismatchClassV2::ProgramLinkage => {
            if program_linkage {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::ProgramOwner => {
            if !program_linkage || program_owner {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::ProgramExecutable => {
            if !program_linkage || !program_owner || program_executable {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::ProgramDataOwner => {
            if !program_linkage || !program_owner || !program_executable || programdata_owner {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::ProgramDataExecutable => {
            if !program_linkage
                || !program_owner
                || !program_executable
                || !programdata_owner
                || programdata_executable
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::Header => {
            if program_linkage
                && program_owner
                && program_executable
                && programdata_owner
                && programdata_executable
                && header_shape
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            if !program_linkage
                || !program_owner
                || !program_executable
                || !programdata_owner
                || !programdata_executable
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::Authority => {
            if !canonical_prefix || authority {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::CapacityDecrease => {
            if !canonical_prefix
                || !authority
                || runtime.actual_capacity >= proposal.minimum_required_capacity
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::CapacityAboveRuntimeMaximum => {
            if !canonical_prefix
                || !authority
                || runtime.programdata_data_length <= capacity.maximum_raw_programdata_length
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok(([0; 32], [0; 32]))
        }
        ProgramDataMismatchClassV2::ArtifactLength => {
            // A Loader ProgramData account exposes capacity, not the logical
            // artifact length. The active proposal and PostUpgrade observation
            // are required to agree on the length before this helper runs, so
            // this class has no independent live proof in the compact V2 ABI.
            // Reject it instead of treating caller-authored observation fields
            // as rollback authority.
            Err(GovernanceError::InvalidRelease1Account.into())
        }
        ProgramDataMismatchClassV2::ObservationStale => {
            // Staleness is a restart signal, not rollback authority. In
            // particular, a benign zero-only extension must be handled by a
            // fresh observation generation.
            Err(GovernanceError::InvalidRelease1Account.into())
        }
        ProgramDataMismatchClassV2::ObservationScheme => {
            // The observation scheme is pinned by the capacity policy and has
            // no independent live mismatch witness. It cannot be downgraded
            // into a caller-created rollback trigger.
            Err(GovernanceError::InvalidRelease1Account.into())
        }
        ProgramDataMismatchClassV2::ArtifactPayload => {
            if !canonical_prefix
                || !authority
                || !observation_scheme_matches
                || !observation_artifact_matches
                || !runtime_matches_observation(runtime, observation)
                || runtime.actual_capacity < proposal.minimum_required_capacity
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            validate_expected_leaf_proof(
                &proposal.artifact_chunk_merkle_root,
                proposal.artifact_length,
                proposal.artifact_chunk_size,
                instruction.failing_chunk_index,
                &instruction.expected_leaf_hash,
                instruction.proof.proof_len,
                &instruction.proof.nodes,
            )?;
            let data = target_programdata.try_borrow_data()?;
            let payload = data
                .get(LOADER_PROGRAMDATA_METADATA_LEN..)
                .ok_or(GovernanceError::InvalidRelease1Account)?;
            let exact = exact_region_chunk(
                payload,
                0,
                proposal.artifact_length,
                proposal.artifact_chunk_size,
                instruction.failing_chunk_index,
            )?;
            let actual = artifact_chunk_leaf_hash(instruction.failing_chunk_index, exact)?;
            if actual == instruction.expected_leaf_hash {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            Ok((instruction.expected_leaf_hash, actual))
        }
        ProgramDataMismatchClassV2::ZeroTail => {
            if !canonical_prefix
                || !authority
                || !observation_scheme_matches
                || !observation_artifact_matches
                || !runtime_matches_observation(runtime, observation)
                || runtime.actual_capacity < proposal.minimum_required_capacity
            {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            let tail_length = runtime
                .actual_capacity
                .checked_sub(proposal.artifact_length)
                .ok_or(GovernanceError::InvalidCapacityPlan)?;
            let data = target_programdata.try_borrow_data()?;
            let payload = data
                .get(LOADER_PROGRAMDATA_METADATA_LEN..)
                .ok_or(GovernanceError::InvalidRelease1Account)?;
            let exact = exact_region_chunk(
                payload,
                proposal.artifact_length,
                tail_length,
                proposal.artifact_chunk_size,
                instruction.failing_chunk_index,
            )?;
            if exact.iter().all(|byte| *byte == 0) {
                return Err(GovernanceError::InvalidRelease1Account.into());
            }
            let expected =
                programdata_zero_tail_zero_hash(instruction.failing_chunk_index, exact.len())?;
            let actual = programdata_zero_tail_chunk_hash(instruction.failing_chunk_index, exact)?;
            Ok((expected, actual))
        }
    }
}

fn validate_rollback_authorizing_mismatch_class(
    mismatch_class: ProgramDataMismatchClassV2,
) -> ProgramResult {
    if matches!(
        mismatch_class,
        ProgramDataMismatchClassV2::ArtifactLength
            | ProgramDataMismatchClassV2::ObservationStale
            | ProgramDataMismatchClassV2::ObservationScheme
    ) {
        return Err(GovernanceError::InvalidRelease1Account.into());
    }
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

fn validate_expected_leaf_proof(
    expected_root: &[u8; 32],
    artifact_length: u64,
    chunk_size: u32,
    chunk_index: u32,
    expected_leaf: &[u8; 32],
    proof_len: u8,
    proof_nodes: &[[u8; 32]; MAX_ARTIFACT_PROOF_DEPTH_V1],
) -> ProgramResult {
    let chunk_count = artifact_chunk_count(artifact_length, chunk_size)?;
    if chunk_index >= chunk_count || *expected_leaf == [0; 32] {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    let padded_count = (chunk_count as usize).next_power_of_two();
    let expected_depth = padded_count.trailing_zeros() as usize;
    let proof_len = usize::from(proof_len);
    if proof_len != expected_depth
        || proof_len > MAX_ARTIFACT_PROOF_DEPTH_V1
        || proof_nodes[proof_len..].iter().any(|node| *node != [0; 32])
    {
        return Err(GovernanceError::InvalidMerkleProof.into());
    }
    let mut current = *expected_leaf;
    let mut index = chunk_index;
    for (level, sibling) in proof_nodes[..proof_len].iter().enumerate() {
        validate_padding_sibling(sibling, index, level, chunk_count as usize, padded_count)?;
        current = if index & 1 == 0 {
            artifact_chunk_node_hash(&current, sibling)
        } else {
            artifact_chunk_node_hash(sibling, &current)
        };
        index >>= 1;
    }
    if current != *expected_root {
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
        && *sibling != padding_subtree_hash(sibling_start, sibling_leaf_count)?
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
        level.push(artifact_chunk_empty_hash(
            u32::try_from(index).map_err(|_| GovernanceError::InvalidMerkleProof)?,
        )?);
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

const PROGRAMDATA_ZERO_TAIL_CHUNK_DOMAIN_V1: &[u8] = b"AMOEBA_PROGRAMDATA_ZERO_TAIL_CHUNK_V1";
const PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1: usize = 1_024;
const PROGRAMDATA_ZERO_HASH_BLOCK_V1: [u8; PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1] =
    [0; PROGRAMDATA_ZERO_HASH_BLOCK_BYTES_V1];
const MAX_PROGRAMDATA_ZERO_HASH_BLOCKS_V1: usize = 16;

fn programdata_zero_tail_chunk_hash(
    chunk_index: u32,
    exact_chunk: &[u8],
) -> Result<[u8; 32], ProgramError> {
    if exact_chunk.is_empty() || exact_chunk.len() > 16_384 {
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
    if actual_length == 0 || actual_length > 16_384 {
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
    let count = if remainder == 0 {
        3 + full_blocks
    } else {
        slices[3 + full_blocks] = &PROGRAMDATA_ZERO_HASH_BLOCK_V1[..remainder];
        4 + full_blocks
    };
    Ok(hashv(&slices[..count]).to_bytes())
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
#[cfg(test)]
mod tests {
    use super::*;
    use crate::artifact_merkle::{
        artifact_merkle_proof, artifact_merkle_root, RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
    };
    use borsh::BorshDeserialize;

    fn exact_failure_binding_fixture() -> (
        ProgramDataObservationV1,
        UpgradeProposalV3,
        ProgramDataCapacityPolicyV1,
    ) {
        let mut observation =
            ProgramDataObservationV1::try_from_slice(&vec![0; ProgramDataObservationV1::LEN])
                .unwrap();
        let mut proposal =
            UpgradeProposalV3::try_from_slice(&vec![0; UpgradeProposalV3::LEN]).unwrap();
        let mut capacity =
            ProgramDataCapacityPolicyV1::try_from_slice(&vec![0; ProgramDataCapacityPolicyV1::LEN])
                .unwrap();

        proposal.upgrade_executed_slot = 41;
        proposal.artifact_length = 23_451;
        proposal.artifact_sha256 = [0x11; 32];
        proposal.artifact_chunk_merkle_root = [0x22; 32];
        proposal.artifact_scheme_id = [0x33; 32];
        proposal.artifact_chunk_size = 16_384;
        proposal.artifact_chunk_count = 2;
        proposal.minimum_required_capacity = 32_768;
        capacity.observation_scheme_id = [0x44; 32];

        observation.purpose = ProgramDataObservationPurposeV1::PostUpgrade;
        observation.deployed_slot = proposal.upgrade_executed_slot;
        observation.start_slot = proposal.upgrade_executed_slot + 1;
        observation.expected_artifact_length = proposal.artifact_length;
        observation.expected_artifact_sha256 = proposal.artifact_sha256;
        observation.expected_artifact_merkle_root = proposal.artifact_chunk_merkle_root;
        observation.expected_artifact_scheme_id = proposal.artifact_scheme_id;
        observation.artifact_chunk_size = proposal.artifact_chunk_size;
        observation.artifact_chunk_count = proposal.artifact_chunk_count;
        observation.minimum_required_capacity = proposal.minimum_required_capacity;
        observation.raw_observation_scheme_id = capacity.observation_scheme_id;

        (observation, proposal, capacity)
    }

    #[test]
    fn compact_failure_proof_authenticates_the_expected_leaf() {
        let chunk_size = RELEASE1_ARTIFACT_CHUNK_SIZE_V1 as usize;
        let artifact = vec![0x5a; chunk_size + 17];
        let root = artifact_merkle_root(&artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1).unwrap();
        let proof = artifact_merkle_proof(&artifact, RELEASE1_ARTIFACT_CHUNK_SIZE_V1, 1).unwrap();
        let leaf = artifact_chunk_leaf_hash(1, &artifact[chunk_size..]).unwrap();
        let mut nodes = [[0; 32]; MAX_ARTIFACT_PROOF_DEPTH_V1];
        nodes[..proof.len()].copy_from_slice(&proof);
        validate_expected_leaf_proof(
            &root,
            artifact.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            1,
            &leaf,
            proof.len() as u8,
            &nodes,
        )
        .unwrap();

        let mut wrong_leaf = leaf;
        wrong_leaf[0] ^= 1;
        assert!(validate_expected_leaf_proof(
            &root,
            artifact.len() as u64,
            RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            1,
            &wrong_leaf,
            proof.len() as u8,
            &nodes,
        )
        .is_err());
    }

    #[test]
    fn zero_tail_hash_is_derived_from_exact_index_length_and_bytes() {
        let zero = vec![0; 1_037];
        let expected = programdata_zero_tail_zero_hash(3, zero.len()).unwrap();
        assert_eq!(
            expected,
            programdata_zero_tail_chunk_hash(3, &zero).unwrap()
        );

        let mut nonzero = zero.clone();
        nonzero[1_036] = 1;
        assert_ne!(
            expected,
            programdata_zero_tail_chunk_hash(3, &nonzero).unwrap()
        );
        assert_ne!(
            expected,
            programdata_zero_tail_zero_hash(4, zero.len()).unwrap()
        );
    }

    #[test]
    fn exact_region_chunk_preserves_the_final_partial_length() {
        let payload: Vec<u8> = (0..31).collect();
        assert_eq!(
            exact_region_chunk(&payload, 3, 20, 8, 0).unwrap(),
            &payload[3..11]
        );
        assert_eq!(
            exact_region_chunk(&payload, 3, 20, 8, 2).unwrap(),
            &payload[19..23]
        );
        assert!(exact_region_chunk(&payload, 3, 20, 8, 3).is_err());
    }

    #[test]
    fn caller_authored_wrong_failure_observations_are_rejected() {
        let (observation, proposal, capacity) = exact_failure_binding_fixture();
        validate_failure_observation_binding(&observation, &proposal, &capacity).unwrap();

        let mut wrong = observation.clone();
        wrong.expected_artifact_length += 1;
        assert!(validate_failure_observation_binding(&wrong, &proposal, &capacity).is_err());

        let mut wrong = observation.clone();
        wrong.expected_artifact_sha256[0] ^= 1;
        assert!(validate_failure_observation_binding(&wrong, &proposal, &capacity).is_err());

        let mut wrong = observation.clone();
        wrong.expected_artifact_merkle_root[0] ^= 1;
        assert!(validate_failure_observation_binding(&wrong, &proposal, &capacity).is_err());

        let mut wrong = observation.clone();
        wrong.expected_artifact_scheme_id[0] ^= 1;
        assert!(validate_failure_observation_binding(&wrong, &proposal, &capacity).is_err());

        let mut wrong = observation.clone();
        wrong.raw_observation_scheme_id[0] ^= 1;
        assert!(validate_failure_observation_binding(&wrong, &proposal, &capacity).is_err());

        let mut wrong = observation.clone();
        wrong.deployed_slot -= 1;
        assert!(validate_failure_observation_binding(&wrong, &proposal, &capacity).is_err());

        let mut wrong = observation.clone();
        wrong.start_slot = proposal.upgrade_executed_slot;
        assert!(validate_failure_observation_binding(&wrong, &proposal, &capacity).is_err());
    }

    #[test]
    fn unprovable_or_restart_only_failure_classes_cannot_authorize_rollback() {
        for mismatch_class in [
            ProgramDataMismatchClassV2::ArtifactLength,
            ProgramDataMismatchClassV2::ObservationStale,
            ProgramDataMismatchClassV2::ObservationScheme,
        ] {
            assert!(validate_rollback_authorizing_mismatch_class(mismatch_class).is_err());
        }
        for mismatch_class in [
            ProgramDataMismatchClassV2::ProgramLinkage,
            ProgramDataMismatchClassV2::Header,
            ProgramDataMismatchClassV2::Authority,
            ProgramDataMismatchClassV2::CapacityDecrease,
            ProgramDataMismatchClassV2::ArtifactPayload,
            ProgramDataMismatchClassV2::ZeroTail,
        ] {
            validate_rollback_authorizing_mismatch_class(mismatch_class).unwrap();
        }
    }
}
