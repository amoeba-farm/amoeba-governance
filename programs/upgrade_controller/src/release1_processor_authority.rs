//! Release 1 controller-immutability, checked authority-handoff, and bootstrap-activation
//! processors.
//!
//! The surface is deliberately closed and typed.  It contains no arbitrary CPI data, no
//! caller-selected program IDs, and no production execution helper.  The checked handoff is
//! finalized atomically by tag 47; the historical tag 48 codec is intentionally not consumed
//! here because a second full ProgramData observation after handoff cannot fit in the same
//! transaction and is not required to prove the typed Loader header transition.

use solana_loader_v3_interface::instruction::set_upgrade_authority_checked;
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
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
    authorization::validate_seat_authority,
    council::{
        record_seat_approval, validate_council_guardian_separation, validate_council_set,
        VALID_APPROVAL_MASK,
    },
    pda::{
        derive_authority_pda, derive_bootstrap_activation_pda,
        derive_bootstrap_activation_receipt_pda, derive_capacity_policy_pda,
        derive_controller_config_pda, derive_controller_immutability_receipt_pda,
        derive_controller_release_commitment_pda, derive_council_pda,
        derive_current_deployment_state_pda, derive_gate_pda, derive_policy_pda,
        derive_programdata_observation_pda,
        derive_target_handoff_pda as derive_target_authority_handoff_pda,
        derive_target_handoff_receipt_pda, derive_upgradeable_programdata_address, AUTHORITY_SEED,
        BOOTSTRAP_ACTIVATION_RECEIPT_SEED, BOOTSTRAP_ACTIVATION_SEED, CONTROLLER_IMMUTABILITY_SEED,
        DEPLOYMENT_STATE_SEED, TARGET_HANDOFF_RECEIPT_SEED, TARGET_HANDOFF_SEED,
        UPGRADEABLE_LOADER_ID, UPGRADE_SEED_DOMAIN_V1,
    },
    policy::validate_policy_against_config,
    release1_account_io::{
        create_fixed_pda_account, encode_fixed_account, load_fixed_controller_account,
        require_distinct_accounts, validate_exact_privileges,
    },
    release1_authority_instruction::{
        AcceptTargetAuthorityCheckedV1, ApproveBootstrapActivationV1,
        ApproveTargetAuthorityHandoffV1, CeremonyEnvelopeV1, CreateBootstrapActivationV1,
        CreateTargetAuthorityHandoffV1, ExecuteBootstrapActivationV1, QueueBootstrapActivationV1,
        QueueTargetAuthorityHandoffV1, RecordControllerImmutabilityV1,
        MAX_CEREMONY_COMPUTE_UNIT_LIMIT_V1, MAX_CEREMONY_COMPUTE_UNIT_PRICE_MICRO_LAMPORTS_V1,
    },
    release1_ceremony_digest::{
        compute_bootstrap_activation_proposal_digest_v1,
        compute_bootstrap_activation_receipt_digest_v1,
        compute_controller_immutability_receipt_digest_v1, compute_current_deployment_digest_v1,
        compute_programdata_observation_subject_digest_v1,
        compute_target_handoff_proposal_digest_v1, compute_target_handoff_receipt_digest_v1,
        validate_bootstrap_activation_proposal_digest_v1,
        validate_controller_immutability_receipt_digest_v1, validate_controller_release_digest_v1,
        validate_current_deployment_digest_v1, validate_programdata_observation_digest_v1,
        validate_target_handoff_proposal_digest_v1, validate_target_handoff_receipt_digest_v1,
    },
    release1_ceremony_state::{
        BootstrapActivationProposalV1, BootstrapActivationReceiptV1, CeremonyProposalStateV1,
        ControllerImmutabilityReceiptV1, ControllerReleaseCommitmentV1, CurrentDeploymentStateV1,
        ProgramDataCapacityPolicyV1, ProgramDataObservationPurposeV1,
        ProgramDataObservationStatusV1, ProgramDataObservationV1, TargetAuthorityHandoffProposalV1,
        TargetAuthorityHandoffReceiptV1, BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR,
        BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN,
        BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR,
        BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN, CEREMONY_ACCOUNT_VERSION_V1,
        CEREMONY_PROPOSAL_COMPLETED_REASON_V1, CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR,
        CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN, CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
        CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN,
        TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR,
        TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN,
        TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_DISCRIMINATOR,
        TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_RESERVED_LEN,
    },
    release1_loader_accounts::{
        parse_upgradeable_programdata, validate_program_programdata_linkage,
        LOADER_PROGRAMDATA_METADATA_LEN,
    },
    release1_state::{BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1, RELEASE1_APPROVAL_THRESHOLD},
    state::{
        ControllerConfigV1, GateStatusV1, GovernanceCouncilSetV1, GovernancePolicyV1,
        OptionalPubkeyV1, ProtocolGateV1,
    },
    GovernanceError,
};

pub const RECORD_CONTROLLER_IMMUTABILITY_V1_ACCOUNT_COUNT: usize = 11;
pub const CREATE_TARGET_AUTHORITY_HANDOFF_V1_ACCOUNT_COUNT: usize = 18;
pub const APPROVE_TARGET_AUTHORITY_HANDOFF_V1_ACCOUNT_COUNT: usize = 16;
pub const QUEUE_TARGET_AUTHORITY_HANDOFF_V1_ACCOUNT_COUNT: usize = 15;
pub const ACCEPT_TARGET_AUTHORITY_CHECKED_V1_ACCOUNT_COUNT: usize = 19;
pub const CREATE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT: usize = 20;
pub const APPROVE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT: usize = 16;
pub const QUEUE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT: usize = 15;
pub const EXECUTE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT: usize = 18;

/// Records the immutable controller release after independently finalized pre/post observations.
///
/// Accounts (exact order): payer W/S; controller Program RO/X; controller ProgramData RO;
/// config RO; capacity policy RO; controller release RO; pre observation RO; post observation RO;
/// immutability receipt W; Upgradeable Loader RO/X; System Program RO/X.
pub fn process_record_controller_immutability_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: RecordControllerImmutabilityV1,
) -> ProgramResult {
    let [payer, controller_program, controller_programdata, config_info, capacity_info, release_info, pre_info, post_info, receipt_info, loader_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(
        accounts.len(),
        RECORD_CONTROLLER_IMMUTABILITY_V1_ACCOUNT_COUNT
    );

    validate_exact_privileges(payer, true, true, false)?;
    validate_exact_privileges(controller_program, false, false, true)?;
    for account in [
        controller_programdata,
        config_info,
        capacity_info,
        release_info,
        pre_info,
        post_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(receipt_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&[
        payer,
        controller_program,
        controller_programdata,
        config_info,
        capacity_info,
        release_info,
        pre_info,
        post_info,
        receipt_info,
        loader_info,
        system_program_info,
    ])?;

    let config = load_config(program_id, config_info)?;
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let release = load_controller_release(
        program_id,
        release_info,
        capacity_info,
        &capacity,
        controller_programdata.key,
        &config,
    )?;
    let pre = load_observation(
        program_id,
        pre_info,
        config_info,
        &config,
        capacity_info,
        &capacity,
        controller_program.key,
        ProgramDataObservationPurposeV1::ControllerImmutability,
        release_info.key,
    )?;
    let post = load_observation(
        program_id,
        post_info,
        config_info,
        &config,
        capacity_info,
        &capacity,
        controller_program.key,
        ProgramDataObservationPurposeV1::ControllerImmutability,
        release_info.key,
    )?;

    if *controller_program.key != *program_id
        || *controller_programdata.key != derive_upgradeable_programdata_address(program_id).0
        || *loader_info.key != UPGRADEABLE_LOADER_ID
        || *system_program_info.key != system_program::ID
        || instruction.expected_capacity_policy_digest != capacity.policy_digest
        || instruction.expected_release_digest != release.release_digest
        || instruction.expected_pre_observation_digest != pre.observation_digest
        || instruction.expected_post_observation_digest != post.observation_digest
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_controller_immutability_transition(
        controller_program,
        controller_programdata,
        &release,
        &pre,
        &post,
    )?;

    let (expected_receipt, receipt_bump) =
        derive_controller_immutability_receipt_pda(program_id, &config.target_program);
    if *receipt_info.key != expected_receipt {
        return Err(GovernanceError::InvalidPda.into());
    }
    let receipt = ControllerImmutabilityReceiptV1 {
        discriminator: CONTROLLER_IMMUTABILITY_RECEIPT_V1_DISCRIMINATOR,
        version: CEREMONY_ACCOUNT_VERSION_V1,
        bump: receipt_bump,
        initialized: true,
        controller_program: *program_id,
        controller_programdata: *controller_programdata.key,
        upgradeable_loader: UPGRADEABLE_LOADER_ID,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: capacity.policy_digest,
        release_commitment: *release_info.key,
        release_commitment_digest: release.release_digest,
        pre_observation: *pre_info.key,
        pre_observation_generation: pre.generation,
        pre_observation_root: pre.final_raw_merkle_root,
        pre_observation_digest: pre.observation_digest,
        pre_upgrade_authority: pre.upgrade_authority,
        post_observation: *post_info.key,
        post_observation_generation: post.generation,
        post_observation_root: post.final_raw_merkle_root,
        post_observation_digest: post.observation_digest,
        post_upgrade_authority: post.upgrade_authority,
        deployed_slot: post.deployed_slot,
        raw_programdata_length: post.raw_data_length,
        programdata_capacity: post.actual_capacity,
        artifact_length: release.artifact_length,
        artifact_sha256: release.artifact_sha256,
        artifact_merkle_root: release.artifact_merkle_root,
        artifact_scheme_id: release.artifact_scheme_id,
        source_commitment: release.source_commitment,
        build_inputs_commitment: release.build_inputs_commitment,
        package_commitment: release.package_commitment,
        release_manifest_commitment: release.release_manifest_commitment,
        finalized_slot: post.finalized_slot,
        receipt_digest: instruction.expected_receipt_digest,
        finalized: true,
        reserved: [0; CONTROLLER_IMMUTABILITY_RECEIPT_V1_RESERVED_LEN],
    };
    if compute_controller_immutability_receipt_digest_v1(&receipt)?
        != instruction.expected_receipt_digest
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_controller_immutability_receipt_digest_v1(&receipt)?;
    let receipt_bytes = encode_fixed_account(&receipt, ControllerImmutabilityReceiptV1::LEN)?;

    let bump_seed = [receipt_bump];
    create_fixed_pda_account(
        program_id,
        payer,
        receipt_info,
        system_program_info,
        &Rent::get()?,
        ControllerImmutabilityReceiptV1::LEN,
        &[
            UPGRADE_SEED_DOMAIN_V1,
            CONTROLLER_IMMUTABILITY_SEED,
            config.target_program.as_ref(),
            &bump_seed,
        ],
    )?;
    commit_preencoded(program_id, &[(receipt_info, &receipt_bytes)])
}

/// Creates the one canonical governed target-authority handoff proposal.
///
/// Accounts: payer W/S; creator seat RO/S; controller Program RO/X; controller ProgramData RO;
/// config, policy, council, gate, capacity, immutability receipt, bridge observation RO;
/// target Program RO/X; target ProgramData RO; legacy authority RO; controller authority RO;
/// handoff proposal W; Loader RO/X; System Program RO/X.
pub fn process_create_target_authority_handoff_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateTargetAuthorityHandoffV1,
) -> ProgramResult {
    let [payer, creator, controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, observation_info, target_program, target_programdata, legacy_authority, authority_info, proposal_info, loader_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(
        accounts.len(),
        CREATE_TARGET_AUTHORITY_HANDOFF_V1_ACCOUNT_COUNT
    );
    validate_exact_privileges(payer, true, true, false)?;
    validate_seat_authority(creator)?;
    validate_exact_privileges(controller_program, false, false, true)?;
    for account in [
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        observation_info,
        target_programdata,
        legacy_authority,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;

    let slot = Clock::get()?.slot;
    let context = load_ceremony_context(
        program_id,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        slot,
    )?;
    reject_guardian(&context.config, creator.key)?;
    require_active_seat(&context.council, creator.key, slot)?;
    validate_bootstrap_gate(&context.gate, &context.config)?;
    let immutable = load_immutability_receipt(
        program_id,
        immutability_info,
        capacity_info,
        &context.capacity,
        &context.config,
    )?;
    validate_controller_still_immutable(
        program_id,
        controller_program,
        controller_programdata,
        &immutable,
    )?;
    let observation = load_observation(
        program_id,
        observation_info,
        config_info,
        &context.config,
        capacity_info,
        &context.capacity,
        target_program.key,
        ProgramDataObservationPurposeV1::TargetHandoffBridge,
        immutability_info.key,
    )?;
    require_live_observation(
        target_program,
        target_programdata,
        &observation,
        Some(*legacy_authority.key),
    )?;
    validate_target_graph(
        &context.config,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
    )?;
    if *system_program_info.key != system_program::ID
        || *legacy_authority.key == Pubkey::default()
        || *legacy_authority.key == context.config.guardian
        || instruction.expected_gate_epoch != context.gate.epoch
        || instruction.expected_target_nonce != context.config.target_nonce
        || instruction.expected_council_version != context.council.version
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let timing = derive_major_timing(&context.config, slot)?;
    if timing
        != (
            instruction.review_start_slot,
            instruction.review_end_slot,
            instruction.not_before_slot,
            instruction.expiry_slot,
        )
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let (expected_proposal, proposal_bump) = derive_target_authority_handoff_pda(
        program_id,
        &context.config.target_program,
        context.council.version,
    );
    if *proposal_info.key != expected_proposal {
        return Err(GovernanceError::InvalidPda.into());
    }
    let proposal = TargetAuthorityHandoffProposalV1 {
        discriminator: TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_DISCRIMINATOR,
        version: CEREMONY_ACCOUNT_VERSION_V1,
        bump: proposal_bump,
        initialized: true,
        state: CeremonyProposalStateV1::Draft,
        cluster_domain: context.config.cluster_domain,
        controller_program: *program_id,
        controller_programdata: *controller_programdata.key,
        controller_immutability_receipt: *immutability_info.key,
        controller_immutability_digest: immutable.receipt_digest,
        controller_config: *config_info.key,
        governance_policy: *policy_info.key,
        governance_policy_hash: context.policy.policy_hash,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: context.capacity.policy_digest,
        gate: *gate_info.key,
        controller_authority: context.config.authority_pda,
        target_program: context.config.target_program,
        target_programdata: context.config.target_programdata,
        upgradeable_loader: context.config.upgradeable_loader,
        legacy_target_authority: *legacy_authority.key,
        bridge_artifact_length: observation.expected_artifact_length,
        bridge_artifact_sha256: observation.expected_artifact_sha256,
        bridge_artifact_merkle_root: observation.expected_artifact_merkle_root,
        bridge_artifact_scheme_id: observation.expected_artifact_scheme_id,
        bridge_source_commitment: instruction.bridge_source_commitment,
        bridge_build_inputs_commitment: instruction.bridge_build_inputs_commitment,
        bridge_package_commitment: instruction.bridge_package_commitment,
        bridge_release_manifest_commitment: instruction.bridge_release_manifest_commitment,
        bridge_observation: *observation_info.key,
        bridge_observation_generation: observation.generation,
        bridge_observation_root: observation.final_raw_merkle_root,
        bridge_observation_digest: observation.observation_digest,
        expected_target_deployed_slot: observation.deployed_slot,
        expected_target_capacity: observation.actual_capacity,
        expected_target_raw_length: observation.raw_data_length,
        bootstrap_gate_status: context.gate.status,
        bootstrap_gate_epoch: context.gate.epoch,
        bootstrap_freeze_reason_code: context.gate.freeze_reason_code,
        bootstrap_freeze_slot: context.gate.freeze_slot,
        target_nonce: context.config.target_nonce,
        council_version: context.council.version,
        council_hash: context.council.set_hash,
        review_start_slot: timing.0,
        review_end_slot: timing.1,
        not_before_slot: timing.2,
        expiry_slot: timing.3,
        approval_bitset: 0,
        approval_count: 0,
        approval_threshold: RELEASE1_APPROVAL_THRESHOLD,
        first_approval_slot: 0,
        council_approved_slot: 0,
        queued_slot: 0,
        executed_slot: 0,
        terminal_slot: 0,
        terminal_reason_code: 0,
        proposal_digest: instruction.expected_proposal_digest,
        creation_slot: slot,
        reserved: [0; TARGET_AUTHORITY_HANDOFF_PROPOSAL_V1_RESERVED_LEN],
    };
    if compute_target_handoff_proposal_digest_v1(&proposal)? != instruction.expected_proposal_digest
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_target_handoff_proposal_digest_v1(&proposal)?;
    let proposal_bytes = encode_fixed_account(&proposal, TargetAuthorityHandoffProposalV1::LEN)?;
    let bump_seed = [proposal_bump];
    let council_version_seed = context.council.version.to_le_bytes();
    create_fixed_pda_account(
        program_id,
        payer,
        proposal_info,
        system_program_info,
        &Rent::get()?,
        TargetAuthorityHandoffProposalV1::LEN,
        &[
            UPGRADE_SEED_DOMAIN_V1,
            TARGET_HANDOFF_SEED,
            context.config.target_program.as_ref(),
            &council_version_seed,
            &bump_seed,
        ],
    )?;
    commit_preencoded(program_id, &[(proposal_info, &proposal_bytes)])
}

pub fn process_approve_target_authority_handoff_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveTargetAuthorityHandoffV1,
) -> ProgramResult {
    let [controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, observation_info, target_program, target_programdata, legacy_authority, authority_info, proposal_info, loader_info, seat] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(
        accounts.len(),
        APPROVE_TARGET_AUTHORITY_HANDOFF_V1_ACCOUNT_COUNT
    );
    validate_handoff_review_privileges(
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        observation_info,
        target_program,
        target_programdata,
        legacy_authority,
        authority_info,
        proposal_info,
        loader_info,
    )?;
    validate_seat_authority(seat)?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;
    let slot = Clock::get()?.slot;
    let mut validated = validate_handoff_review_state(
        program_id,
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        observation_info,
        target_program,
        target_programdata,
        legacy_authority,
        authority_info,
        proposal_info,
        loader_info,
        slot,
    )?;
    reject_guardian(&validated.context.config, seat.key)?;
    if validated.proposal.state != CeremonyProposalStateV1::Draft
        || instruction.expected_proposal_digest != validated.proposal.proposal_digest
        || instruction.expected_council_version != validated.context.council.version
        || instruction.expected_gate_epoch != validated.context.gate.epoch
        || instruction.expected_target_nonce != validated.context.config.target_nonce
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_approval_window(&validated.proposal, slot)?;
    let (bitset, count) = record_seat_approval(
        &validated.context.council,
        validated.proposal.approval_bitset,
        validated.proposal.approval_count,
        seat.key,
        slot,
    )?;
    validated.proposal.approval_bitset = bitset;
    validated.proposal.approval_count = count;
    if validated.proposal.first_approval_slot == 0 {
        validated.proposal.first_approval_slot = slot;
    }
    if count == RELEASE1_APPROVAL_THRESHOLD {
        validated.proposal.state = CeremonyProposalStateV1::CouncilApproved;
        validated.proposal.council_approved_slot = slot;
    }
    validate_target_handoff_proposal_digest_v1(&validated.proposal)?;
    let bytes = encode_fixed_account(&validated.proposal, TargetAuthorityHandoffProposalV1::LEN)?;
    commit_preencoded(program_id, &[(proposal_info, &bytes)])
}

pub fn process_queue_target_authority_handoff_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: QueueTargetAuthorityHandoffV1,
) -> ProgramResult {
    let [controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, observation_info, target_program, target_programdata, legacy_authority, authority_info, proposal_info, loader_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(
        accounts.len(),
        QUEUE_TARGET_AUTHORITY_HANDOFF_V1_ACCOUNT_COUNT
    );
    validate_handoff_review_privileges(
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        observation_info,
        target_program,
        target_programdata,
        legacy_authority,
        authority_info,
        proposal_info,
        loader_info,
    )?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;
    let slot = Clock::get()?.slot;
    let mut validated = validate_handoff_review_state(
        program_id,
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        observation_info,
        target_program,
        target_programdata,
        legacy_authority,
        authority_info,
        proposal_info,
        loader_info,
        slot,
    )?;
    if validated.proposal.state != CeremonyProposalStateV1::CouncilApproved
        || instruction.expected_proposal_digest != validated.proposal.proposal_digest
        || instruction.expected_council_version != validated.context.council.version
        || instruction.expected_gate_epoch != validated.context.gate.epoch
        || instruction.expected_target_nonce != validated.context.config.target_nonce
        || slot >= validated.proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_quorum(
        &validated.context.council,
        validated.proposal.approval_bitset,
        validated.proposal.approval_count,
        slot,
    )?;
    validated.proposal.state = CeremonyProposalStateV1::Timelocked;
    validated.proposal.queued_slot = slot;
    validate_target_handoff_proposal_digest_v1(&validated.proposal)?;
    let bytes = encode_fixed_account(&validated.proposal, TargetAuthorityHandoffProposalV1::LEN)?;
    commit_preencoded(program_id, &[(proposal_info, &bytes)])
}

/// Performs one exact checked Loader-v3 authority transfer and atomically finalizes the receipt.
/// The gate is read-only and remains in its initialization freeze.
pub fn process_accept_target_authority_checked_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: AcceptTargetAuthorityCheckedV1,
) -> ProgramResult {
    let [payer, controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, proposal_info, observation_info, target_program, target_programdata, legacy_authority, authority_info, loader_info, receipt_info, system_program_info, instructions_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(
        accounts.len(),
        ACCEPT_TARGET_AUTHORITY_CHECKED_V1_ACCOUNT_COUNT
    );
    validate_exact_privileges(payer, true, true, false)?;
    validate_exact_privileges(controller_program, false, false, true)?;
    for account in [
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        observation_info,
        authority_info,
        instructions_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(target_programdata, true, false, false)?;
    validate_exact_privileges(legacy_authority, false, true, false)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(receipt_info, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;

    let slot = Clock::get()?.slot;
    let context = load_ceremony_context(
        program_id,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        slot,
    )?;
    validate_bootstrap_gate(&context.gate, &context.config)?;
    let immutable = load_immutability_receipt(
        program_id,
        immutability_info,
        capacity_info,
        &context.capacity,
        &context.config,
    )?;
    validate_controller_still_immutable(
        program_id,
        controller_program,
        controller_programdata,
        &immutable,
    )?;
    let mut proposal = load_handoff_proposal(
        program_id,
        proposal_info,
        config_info,
        policy_info,
        capacity_info,
        gate_info,
        immutability_info,
        &context,
    )?;
    let observation = load_observation(
        program_id,
        observation_info,
        config_info,
        &context.config,
        capacity_info,
        &context.capacity,
        target_program.key,
        ProgramDataObservationPurposeV1::TargetHandoffBridge,
        immutability_info.key,
    )?;
    validate_target_graph(
        &context.config,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
    )?;
    require_live_observation(
        target_program,
        target_programdata,
        &observation,
        Some(*legacy_authority.key),
    )?;
    validate_handoff_proposal_evidence(
        &proposal,
        &context,
        immutability_info,
        &immutable,
        observation_info,
        &observation,
        legacy_authority.key,
    )?;
    if *system_program_info.key != system_program::ID
        || *instructions_info.key != sysvar_ids::instructions::ID
        || *legacy_authority.key == context.config.guardian
        || proposal.state != CeremonyProposalStateV1::Timelocked
        || instruction.expected_proposal_digest != proposal.proposal_digest
        || instruction.expected_bridge_observation_digest != observation.observation_digest
        || instruction.expected_gate_epoch != context.gate.epoch
        || instruction.expected_target_nonce != context.config.target_nonce
        || slot < proposal.not_before_slot
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_quorum(
        &context.council,
        proposal.approval_bitset,
        proposal.approval_count,
        slot,
    )?;
    let expected_current_data = instruction.pack()?;
    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &expected_current_data,
        &instruction.envelope,
    )?;

    let (expected_receipt, receipt_bump) =
        derive_target_handoff_receipt_pda(program_id, &context.config.target_program);
    if *receipt_info.key != expected_receipt {
        return Err(GovernanceError::InvalidPda.into());
    }
    let pre_header = observation.programdata_header_snapshot;
    validate_some_to_some_header_delta(
        &pre_header,
        &expected_handoff_post_header(
            &pre_header,
            *legacy_authority.key,
            context.config.authority_pda,
        )?,
        *legacy_authority.key,
        context.config.authority_pda,
    )?;

    let authority_bump = derive_authority_pda(program_id, &context.config.target_program).1;
    let authority_bump_seed = [authority_bump];
    let authority_seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        AUTHORITY_SEED,
        context.config.target_program.as_ref(),
        &authority_bump_seed,
    ];
    let cpi =
        set_upgrade_authority_checked(target_program.key, legacy_authority.key, authority_info.key);
    validate_checked_handoff_cpi_shape(
        &cpi,
        target_programdata.key,
        legacy_authority.key,
        authority_info.key,
    )?;
    invoke_signed(
        &cpi,
        &[
            target_programdata.clone(),
            legacy_authority.clone(),
            authority_info.clone(),
            loader_info.clone(),
        ],
        &[authority_seeds],
    )?;

    let post_linkage = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &context.config.upgradeable_loader,
    )?;
    let post_header = copy_programdata_header(target_programdata)?;
    validate_some_to_some_header_delta(
        &pre_header,
        &post_header,
        *legacy_authority.key,
        context.config.authority_pda,
    )?;
    if post_linkage.upgrade_authority != Some(context.config.authority_pda)
        || post_linkage.deployed_slot != observation.deployed_slot
        || u64::try_from(post_linkage.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != observation.actual_capacity
    {
        return Err(GovernanceError::InvalidAuthorityTransition.into());
    }

    proposal.state = CeremonyProposalStateV1::Completed;
    proposal.executed_slot = slot;
    proposal.terminal_slot = slot;
    proposal.terminal_reason_code = CEREMONY_PROPOSAL_COMPLETED_REASON_V1;
    validate_target_handoff_proposal_digest_v1(&proposal)?;
    let mut receipt = TargetAuthorityHandoffReceiptV1 {
        discriminator: TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_DISCRIMINATOR,
        version: CEREMONY_ACCOUNT_VERSION_V1,
        bump: receipt_bump,
        initialized: true,
        proposal: *proposal_info.key,
        proposal_digest: proposal.proposal_digest,
        controller_program: *program_id,
        controller_config: *config_info.key,
        controller_authority: context.config.authority_pda,
        controller_immutability_receipt: *immutability_info.key,
        controller_immutability_digest: immutable.receipt_digest,
        target_program: context.config.target_program,
        target_programdata: context.config.target_programdata,
        upgradeable_loader: context.config.upgradeable_loader,
        pre_observation: *observation_info.key,
        pre_observation_generation: observation.generation,
        pre_observation_root: observation.final_raw_merkle_root,
        pre_observation_digest: observation.observation_digest,
        pre_upgrade_authority: OptionalPubkeyV1::some(*legacy_authority.key)?,
        pre_programdata_header_snapshot: pre_header,
        post_programdata_header_snapshot: post_header,
        post_upgrade_authority: OptionalPubkeyV1::some(context.config.authority_pda)?,
        deployed_slot: observation.deployed_slot,
        raw_programdata_length: observation.raw_data_length,
        programdata_capacity: observation.actual_capacity,
        artifact_length: proposal.bridge_artifact_length,
        artifact_sha256: proposal.bridge_artifact_sha256,
        artifact_merkle_root: proposal.bridge_artifact_merkle_root,
        artifact_scheme_id: proposal.bridge_artifact_scheme_id,
        bridge_source_commitment: proposal.bridge_source_commitment,
        bridge_build_inputs_commitment: proposal.bridge_build_inputs_commitment,
        bridge_package_commitment: proposal.bridge_package_commitment,
        bridge_release_manifest_commitment: proposal.bridge_release_manifest_commitment,
        bootstrap_gate_epoch: proposal.bootstrap_gate_epoch,
        target_nonce: proposal.target_nonce,
        council_version: proposal.council_version,
        accepted_slot: slot,
        receipt_digest: [0; 32],
        finalized: true,
        reserved: [0; TARGET_AUTHORITY_HANDOFF_RECEIPT_V1_RESERVED_LEN],
    };
    receipt.receipt_digest = compute_target_handoff_receipt_digest_v1(&receipt)?;
    validate_target_handoff_receipt_digest_v1(&receipt)?;
    let proposal_bytes = encode_fixed_account(&proposal, TargetAuthorityHandoffProposalV1::LEN)?;
    let receipt_bytes = encode_fixed_account(&receipt, TargetAuthorityHandoffReceiptV1::LEN)?;
    let receipt_bump_seed = [receipt_bump];
    create_fixed_pda_account(
        program_id,
        payer,
        receipt_info,
        system_program_info,
        &Rent::get()?,
        TargetAuthorityHandoffReceiptV1::LEN,
        &[
            UPGRADE_SEED_DOMAIN_V1,
            TARGET_HANDOFF_RECEIPT_SEED,
            context.config.target_program.as_ref(),
            &receipt_bump_seed,
        ],
    )?;
    commit_preencoded(
        program_id,
        &[
            (proposal_info, &proposal_bytes),
            (receipt_info, &receipt_bytes),
        ],
    )
}

/// Creates the activation proposal and preallocates its receipt and deployment-state PDAs.  The
/// preallocation is what lets execution remain a strict no-CPI transaction.
pub fn process_create_bootstrap_activation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateBootstrapActivationV1,
) -> ProgramResult {
    let [payer, creator, controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, handoff_receipt_info, observation_info, target_program, target_programdata, authority_info, proposal_info, activation_receipt_info, deployment_info, loader_info, system_program_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(accounts.len(), CREATE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT);
    validate_exact_privileges(payer, true, true, false)?;
    validate_seat_authority(creator)?;
    validate_exact_privileges(controller_program, false, false, true)?;
    for account in [
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_programdata,
        authority_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    for account in [proposal_info, activation_receipt_info, deployment_info] {
        validate_exact_privileges(account, true, false, false)?;
    }
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;

    let slot = Clock::get()?.slot;
    let validated = validate_activation_evidence(
        program_id,
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        slot,
    )?;
    reject_guardian(&validated.context.config, creator.key)?;
    require_active_seat(&validated.context.council, creator.key, slot)?;
    if *system_program_info.key != system_program::ID
        || instruction.expected_controller_immutability_digest != validated.immutable.receipt_digest
        || instruction.expected_handoff_receipt_digest != validated.handoff.receipt_digest
        || instruction.expected_bridge_observation_digest
            != validated.observation.observation_digest
        || instruction.expected_gate_epoch != validated.context.gate.epoch
        || instruction.expected_target_nonce != validated.context.config.target_nonce
        || instruction.expected_council_version != validated.context.council.version
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let timing = derive_major_timing(&validated.context.config, slot)?;
    if timing
        != (
            instruction.review_start_slot,
            instruction.review_end_slot,
            instruction.not_before_slot,
            instruction.expiry_slot,
        )
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let (expected_proposal, proposal_bump) = derive_bootstrap_activation_pda(
        program_id,
        &validated.context.config.target_program,
        validated.context.council.version,
    );
    let (expected_receipt, receipt_bump) = derive_bootstrap_activation_receipt_pda(
        program_id,
        &validated.context.config.target_program,
    );
    let (expected_deployment, deployment_bump) =
        derive_current_deployment_state_pda(program_id, &validated.context.config.target_program);
    if *proposal_info.key != expected_proposal
        || *activation_receipt_info.key != expected_receipt
        || *deployment_info.key != expected_deployment
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    let proposal = BootstrapActivationProposalV1 {
        discriminator: BOOTSTRAP_ACTIVATION_PROPOSAL_V1_DISCRIMINATOR,
        version: CEREMONY_ACCOUNT_VERSION_V1,
        bump: proposal_bump,
        initialized: true,
        state: CeremonyProposalStateV1::Draft,
        cluster_domain: validated.context.config.cluster_domain,
        controller_program: *program_id,
        controller_programdata: *controller_programdata.key,
        controller_config: *config_info.key,
        governance_policy: *policy_info.key,
        governance_policy_hash: validated.context.policy.policy_hash,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: validated.context.capacity.policy_digest,
        controller_immutability_receipt: *immutability_info.key,
        controller_immutability_digest: validated.immutable.receipt_digest,
        target_handoff_receipt: *handoff_receipt_info.key,
        target_handoff_digest: validated.handoff.receipt_digest,
        gate: *gate_info.key,
        target_program: validated.context.config.target_program,
        target_programdata: validated.context.config.target_programdata,
        upgradeable_loader: validated.context.config.upgradeable_loader,
        controller_authority: validated.context.config.authority_pda,
        bridge_artifact_length: validated.handoff.artifact_length,
        bridge_artifact_sha256: validated.handoff.artifact_sha256,
        bridge_artifact_merkle_root: validated.handoff.artifact_merkle_root,
        bridge_artifact_scheme_id: validated.handoff.artifact_scheme_id,
        bridge_source_commitment: validated.handoff.bridge_source_commitment,
        bridge_build_inputs_commitment: validated.handoff.bridge_build_inputs_commitment,
        bridge_package_commitment: validated.handoff.bridge_package_commitment,
        bridge_release_manifest_commitment: validated.handoff.bridge_release_manifest_commitment,
        bridge_observation: *observation_info.key,
        bridge_observation_generation: validated.observation.generation,
        bridge_observation_root: validated.observation.final_raw_merkle_root,
        bridge_observation_digest: validated.observation.observation_digest,
        expected_target_deployed_slot: validated.observation.deployed_slot,
        expected_target_capacity: validated.observation.actual_capacity,
        expected_target_raw_length: validated.observation.raw_data_length,
        bootstrap_gate_status: validated.context.gate.status,
        bootstrap_gate_epoch: validated.context.gate.epoch,
        bootstrap_freeze_reason_code: validated.context.gate.freeze_reason_code,
        bootstrap_freeze_slot: validated.context.gate.freeze_slot,
        target_nonce: validated.context.config.target_nonce,
        council_version: validated.context.council.version,
        council_hash: validated.context.council.set_hash,
        review_start_slot: timing.0,
        review_end_slot: timing.1,
        not_before_slot: timing.2,
        expiry_slot: timing.3,
        approval_bitset: 0,
        approval_count: 0,
        approval_threshold: RELEASE1_APPROVAL_THRESHOLD,
        first_approval_slot: 0,
        council_approved_slot: 0,
        queued_slot: 0,
        executed_slot: 0,
        terminal_slot: 0,
        terminal_reason_code: 0,
        proposal_digest: instruction.expected_proposal_digest,
        creation_slot: slot,
        reserved: [0; BOOTSTRAP_ACTIVATION_PROPOSAL_V1_RESERVED_LEN],
    };
    if compute_bootstrap_activation_proposal_digest_v1(&proposal)?
        != instruction.expected_proposal_digest
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_bootstrap_activation_proposal_digest_v1(&proposal)?;
    let proposal_bytes = encode_fixed_account(&proposal, BootstrapActivationProposalV1::LEN)?;
    let rent = Rent::get()?;
    let proposal_bump_seed = [proposal_bump];
    let council_version_seed = validated.context.council.version.to_le_bytes();
    let receipt_bump_seed = [receipt_bump];
    let deployment_bump_seed = [deployment_bump];
    create_fixed_pda_account(
        program_id,
        payer,
        proposal_info,
        system_program_info,
        &rent,
        BootstrapActivationProposalV1::LEN,
        &[
            UPGRADE_SEED_DOMAIN_V1,
            BOOTSTRAP_ACTIVATION_SEED,
            validated.context.config.target_program.as_ref(),
            &council_version_seed,
            &proposal_bump_seed,
        ],
    )?;
    create_or_reuse_zero_fixed_pda(
        program_id,
        payer,
        activation_receipt_info,
        system_program_info,
        &rent,
        BootstrapActivationReceiptV1::LEN,
        &[
            UPGRADE_SEED_DOMAIN_V1,
            BOOTSTRAP_ACTIVATION_RECEIPT_SEED,
            validated.context.config.target_program.as_ref(),
            &receipt_bump_seed,
        ],
    )?;
    create_or_reuse_zero_fixed_pda(
        program_id,
        payer,
        deployment_info,
        system_program_info,
        &rent,
        CurrentDeploymentStateV1::LEN,
        &[
            UPGRADE_SEED_DOMAIN_V1,
            DEPLOYMENT_STATE_SEED,
            validated.context.config.target_program.as_ref(),
            &deployment_bump_seed,
        ],
    )?;
    commit_preencoded(program_id, &[(proposal_info, &proposal_bytes)])
}

pub fn process_approve_bootstrap_activation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveBootstrapActivationV1,
) -> ProgramResult {
    let [controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, handoff_receipt_info, observation_info, target_program, target_programdata, authority_info, proposal_info, loader_info, seat] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(
        accounts.len(),
        APPROVE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT
    );
    validate_activation_review_privileges(
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        proposal_info,
        loader_info,
    )?;
    validate_seat_authority(seat)?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;
    let slot = Clock::get()?.slot;
    let evidence = validate_activation_evidence(
        program_id,
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        slot,
    )?;
    reject_guardian(&evidence.context.config, seat.key)?;
    let mut proposal = load_activation_proposal(
        program_id,
        proposal_info,
        config_info,
        policy_info,
        capacity_info,
        gate_info,
        immutability_info,
        handoff_receipt_info,
        &evidence.context,
    )?;
    validate_activation_proposal_evidence(
        &proposal,
        &evidence,
        observation_info,
        immutability_info,
        handoff_receipt_info,
    )?;
    if proposal.state != CeremonyProposalStateV1::Draft
        || instruction.expected_proposal_digest != proposal.proposal_digest
        || instruction.expected_council_version != evidence.context.council.version
        || instruction.expected_gate_epoch != evidence.context.gate.epoch
        || instruction.expected_target_nonce != evidence.context.config.target_nonce
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_approval_window_activation(&proposal, slot)?;
    let (bitset, count) = record_seat_approval(
        &evidence.context.council,
        proposal.approval_bitset,
        proposal.approval_count,
        seat.key,
        slot,
    )?;
    proposal.approval_bitset = bitset;
    proposal.approval_count = count;
    if proposal.first_approval_slot == 0 {
        proposal.first_approval_slot = slot;
    }
    if count == RELEASE1_APPROVAL_THRESHOLD {
        proposal.state = CeremonyProposalStateV1::CouncilApproved;
        proposal.council_approved_slot = slot;
    }
    validate_bootstrap_activation_proposal_digest_v1(&proposal)?;
    let bytes = encode_fixed_account(&proposal, BootstrapActivationProposalV1::LEN)?;
    commit_preencoded(program_id, &[(proposal_info, &bytes)])
}

pub fn process_queue_bootstrap_activation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: QueueBootstrapActivationV1,
) -> ProgramResult {
    let [controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, handoff_receipt_info, observation_info, target_program, target_programdata, authority_info, proposal_info, loader_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(accounts.len(), QUEUE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT);
    validate_activation_review_privileges(
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        proposal_info,
        loader_info,
    )?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;
    let slot = Clock::get()?.slot;
    let evidence = validate_activation_evidence(
        program_id,
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        slot,
    )?;
    let mut proposal = load_activation_proposal(
        program_id,
        proposal_info,
        config_info,
        policy_info,
        capacity_info,
        gate_info,
        immutability_info,
        handoff_receipt_info,
        &evidence.context,
    )?;
    validate_activation_proposal_evidence(
        &proposal,
        &evidence,
        observation_info,
        immutability_info,
        handoff_receipt_info,
    )?;
    if proposal.state != CeremonyProposalStateV1::CouncilApproved
        || instruction.expected_proposal_digest != proposal.proposal_digest
        || instruction.expected_council_version != evidence.context.council.version
        || instruction.expected_gate_epoch != evidence.context.gate.epoch
        || instruction.expected_target_nonce != evidence.context.config.target_nonce
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_quorum(
        &evidence.context.council,
        proposal.approval_bitset,
        proposal.approval_count,
        slot,
    )?;
    proposal.state = CeremonyProposalStateV1::Timelocked;
    proposal.queued_slot = slot;
    validate_bootstrap_activation_proposal_digest_v1(&proposal)?;
    let bytes = encode_fixed_account(&proposal, BootstrapActivationProposalV1::LEN)?;
    commit_preencoded(program_id, &[(proposal_info, &bytes)])
}

/// Activates the bootstrap gate in a separate, closed, no-CPI transaction.
pub fn process_execute_bootstrap_activation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExecuteBootstrapActivationV1,
) -> ProgramResult {
    let [controller_program, controller_programdata, config_info, policy_info, council_info, gate_info, capacity_info, immutability_info, handoff_receipt_info, proposal_info, observation_info, target_program, target_programdata, authority_info, loader_info, activation_receipt_info, deployment_info, instructions_info] =
        accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };
    debug_assert_eq!(
        accounts.len(),
        EXECUTE_BOOTSTRAP_ACTIVATION_V1_ACCOUNT_COUNT
    );
    validate_exact_privileges(controller_program, false, false, true)?;
    for account in [
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_programdata,
        authority_info,
        instructions_info,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(gate_info, true, false, false)?;
    validate_exact_privileges(proposal_info, true, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(loader_info, false, false, true)?;
    validate_exact_privileges(activation_receipt_info, true, false, false)?;
    validate_exact_privileges(deployment_info, true, false, false)?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;

    let slot = Clock::get()?.slot;
    let evidence = validate_activation_evidence(
        program_id,
        controller_program,
        controller_programdata,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        immutability_info,
        handoff_receipt_info,
        observation_info,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
        slot,
    )?;
    let mut proposal = load_activation_proposal(
        program_id,
        proposal_info,
        config_info,
        policy_info,
        capacity_info,
        gate_info,
        immutability_info,
        handoff_receipt_info,
        &evidence.context,
    )?;
    validate_activation_proposal_evidence(
        &proposal,
        &evidence,
        observation_info,
        immutability_info,
        handoff_receipt_info,
    )?;
    if *instructions_info.key != sysvar_ids::instructions::ID
        || proposal.state != CeremonyProposalStateV1::Timelocked
        || instruction.expected_proposal_digest != proposal.proposal_digest
        || instruction.expected_bridge_observation_digest != evidence.observation.observation_digest
        || instruction.expected_gate_epoch != evidence.context.gate.epoch
        || instruction.expected_target_nonce != evidence.context.config.target_nonce
        || slot < proposal.not_before_slot
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_quorum(
        &evidence.context.council,
        proposal.approval_bitset,
        proposal.approval_count,
        slot,
    )?;
    let expected_current_data = instruction.pack()?;
    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &expected_current_data,
        &instruction.envelope,
    )?;

    let (expected_receipt, receipt_bump) = derive_bootstrap_activation_receipt_pda(
        program_id,
        &evidence.context.config.target_program,
    );
    let (expected_deployment, deployment_bump) =
        derive_current_deployment_state_pda(program_id, &evidence.context.config.target_program);
    if *activation_receipt_info.key != expected_receipt
        || *deployment_info.key != expected_deployment
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    require_zero_initialized_destination(
        program_id,
        activation_receipt_info,
        BootstrapActivationReceiptV1::LEN,
    )?;
    require_zero_initialized_destination(
        program_id,
        deployment_info,
        CurrentDeploymentStateV1::LEN,
    )?;

    let next_epoch = evidence
        .context
        .gate
        .epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let mut next_gate = (*evidence.context.gate).clone();
    next_gate.status = GateStatusV1::Active;
    next_gate.epoch = next_epoch;
    next_gate.active_proposal = Pubkey::default();
    next_gate.freeze_slot = 0;
    next_gate.freeze_reason_code = 0;
    next_gate.last_completed_proposal = *proposal_info.key;
    next_gate.validate_static()?;

    proposal.state = CeremonyProposalStateV1::Completed;
    proposal.executed_slot = slot;
    proposal.terminal_slot = slot;
    proposal.terminal_reason_code = CEREMONY_PROPOSAL_COMPLETED_REASON_V1;
    validate_bootstrap_activation_proposal_digest_v1(&proposal)?;

    let deployment = CurrentDeploymentStateV1 {
        discriminator: CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
        version: CEREMONY_ACCOUNT_VERSION_V1,
        bump: deployment_bump,
        initialized: true,
        controller_program: *program_id,
        controller_config: *config_info.key,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: evidence.context.capacity.policy_digest,
        target_program: evidence.context.config.target_program,
        target_programdata: evidence.context.config.target_programdata,
        upgradeable_loader: evidence.context.config.upgradeable_loader,
        controller_authority: evidence.context.config.authority_pda,
        artifact_length: evidence.handoff.artifact_length,
        artifact_sha256: evidence.handoff.artifact_sha256,
        artifact_merkle_root: evidence.handoff.artifact_merkle_root,
        artifact_scheme_id: evidence.handoff.artifact_scheme_id,
        actual_programdata_capacity: evidence.observation.actual_capacity,
        programdata_observation: *observation_info.key,
        observation_generation: evidence.observation.generation,
        observation_root: evidence.observation.final_raw_merkle_root,
        observation_digest: evidence.observation.observation_digest,
        deployed_slot: evidence.observation.deployed_slot,
        installed_authority: evidence.context.config.authority_pda,
        source_commitment: evidence.handoff.bridge_source_commitment,
        build_inputs_commitment: evidence.handoff.bridge_build_inputs_commitment,
        package_commitment: evidence.handoff.bridge_package_commitment,
        release_manifest_commitment: evidence.handoff.bridge_release_manifest_commitment,
        release_commitment: *handoff_receipt_info.key,
        release_commitment_digest: evidence.handoff.receipt_digest,
        activation_receipt: OptionalPubkeyV1::some(*activation_receipt_info.key)?,
        completed_proposal: OptionalPubkeyV1::none(),
        gate_epoch_at_activation: next_epoch,
        deployment_generation: 1,
        deployment_digest: instruction.expected_deployment_digest,
        last_updated_slot: slot,
        reserved: [0; CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN],
    };
    if compute_current_deployment_digest_v1(&deployment)? != instruction.expected_deployment_digest
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_current_deployment_digest_v1(&deployment)?;

    let receipt = BootstrapActivationReceiptV1 {
        discriminator: BOOTSTRAP_ACTIVATION_RECEIPT_V1_DISCRIMINATOR,
        version: CEREMONY_ACCOUNT_VERSION_V1,
        bump: receipt_bump,
        initialized: true,
        proposal: *proposal_info.key,
        proposal_digest: proposal.proposal_digest,
        controller_program: *program_id,
        controller_config: *config_info.key,
        governance_policy: *policy_info.key,
        governance_policy_hash: evidence.context.policy.policy_hash,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: evidence.context.capacity.policy_digest,
        controller_immutability_receipt: *immutability_info.key,
        controller_immutability_digest: evidence.immutable.receipt_digest,
        target_handoff_receipt: *handoff_receipt_info.key,
        target_handoff_digest: evidence.handoff.receipt_digest,
        gate: *gate_info.key,
        target_program: evidence.context.config.target_program,
        target_programdata: evidence.context.config.target_programdata,
        upgradeable_loader: evidence.context.config.upgradeable_loader,
        controller_authority: evidence.context.config.authority_pda,
        bridge_observation: *observation_info.key,
        bridge_observation_generation: evidence.observation.generation,
        bridge_observation_root: evidence.observation.final_raw_merkle_root,
        bridge_observation_digest: evidence.observation.observation_digest,
        bridge_artifact_length: evidence.handoff.artifact_length,
        bridge_artifact_sha256: evidence.handoff.artifact_sha256,
        bridge_artifact_merkle_root: evidence.handoff.artifact_merkle_root,
        bridge_artifact_scheme_id: evidence.handoff.artifact_scheme_id,
        actual_target_capacity: evidence.observation.actual_capacity,
        target_deployed_slot: evidence.observation.deployed_slot,
        previous_gate_status: GateStatusV1::EmergencyFrozen,
        previous_gate_epoch: evidence.context.gate.epoch,
        previous_freeze_reason_code: evidence.context.gate.freeze_reason_code,
        previous_freeze_slot: evidence.context.gate.freeze_slot,
        activated_gate_status: GateStatusV1::Active,
        activated_gate_epoch: next_epoch,
        target_nonce: evidence.context.config.target_nonce,
        council_version: evidence.context.council.version,
        council_hash: evidence.context.council.set_hash,
        current_deployment_state: *deployment_info.key,
        current_deployment_digest: deployment.deployment_digest,
        deployment_generation: deployment.deployment_generation,
        finalized_slot: slot,
        receipt_digest: instruction.expected_receipt_digest,
        finalized: true,
        reserved: [0; BOOTSTRAP_ACTIVATION_RECEIPT_V1_RESERVED_LEN],
    };
    if compute_bootstrap_activation_receipt_digest_v1(&receipt)?
        != instruction.expected_receipt_digest
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    crate::release1_ceremony_digest::validate_bootstrap_activation_receipt_digest_v1(&receipt)?;

    let gate_bytes = encode_fixed_account(&next_gate, ProtocolGateV1::LEN)?;
    let proposal_bytes = encode_fixed_account(&proposal, BootstrapActivationProposalV1::LEN)?;
    let receipt_bytes = encode_fixed_account(&receipt, BootstrapActivationReceiptV1::LEN)?;
    let deployment_bytes = encode_fixed_account(&deployment, CurrentDeploymentStateV1::LEN)?;
    commit_preencoded(
        program_id,
        &[
            (gate_info, &gate_bytes),
            (proposal_info, &proposal_bytes),
            (activation_receipt_info, &receipt_bytes),
            (deployment_info, &deployment_bytes),
        ],
    )
}

struct CeremonyContext {
    config: Box<ControllerConfigV1>,
    policy: Box<GovernancePolicyV1>,
    council: Box<GovernanceCouncilSetV1>,
    gate: Box<ProtocolGateV1>,
    capacity: Box<ProgramDataCapacityPolicyV1>,
}

struct HandoffReviewState {
    context: CeremonyContext,
    proposal: Box<TargetAuthorityHandoffProposalV1>,
}

struct ActivationEvidence {
    context: CeremonyContext,
    immutable: Box<ControllerImmutabilityReceiptV1>,
    handoff: Box<TargetAuthorityHandoffReceiptV1>,
    observation: Box<ProgramDataObservationV1>,
}

fn load_config(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
) -> Result<Box<ControllerConfigV1>, ProgramError> {
    let config = load_fixed_controller_account::<ControllerConfigV1>(
        program_id,
        info,
        ControllerConfigV1::LEN,
    )?;
    config.validate_static()?;
    let expected = derive_controller_config_pda(program_id, &config.target_program);
    if expected.0 != *info.key
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
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<GovernancePolicyV1>, ProgramError> {
    let policy = load_fixed_controller_account::<GovernancePolicyV1>(
        program_id,
        info,
        GovernancePolicyV1::LEN,
    )?;
    validate_policy_against_config(&policy, config)?;
    let expected = derive_policy_pda(program_id, &config.target_program, policy.version);
    if expected.0 != *info.key
        || expected.1 != policy.bump
        || policy.controller_config != *config_info.key
        || policy.version != config.current_policy_version
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(policy)
}

fn load_council(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
) -> Result<Box<GovernanceCouncilSetV1>, ProgramError> {
    let council = load_fixed_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        info,
        GovernanceCouncilSetV1::LEN,
    )?;
    validate_council_set(&council, policy)?;
    validate_council_guardian_separation(&council, &config.guardian)?;
    let expected = derive_council_pda(program_id, &config.target_program, council.version);
    if expected.0 != *info.key
        || expected.1 != council.bump
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
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<ProtocolGateV1>, ProgramError> {
    let gate =
        load_fixed_controller_account::<ProtocolGateV1>(program_id, info, ProtocolGateV1::LEN)?;
    gate.validate_static()?;
    let expected = derive_gate_pda(program_id, &config.target_program);
    if expected.0 != *info.key
        || expected.1 != gate.bump
        || *info.key != config.gate_pda
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
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
) -> Result<Box<ProgramDataCapacityPolicyV1>, ProgramError> {
    let capacity = load_fixed_controller_account::<ProgramDataCapacityPolicyV1>(
        program_id,
        info,
        ProgramDataCapacityPolicyV1::LEN,
    )?;
    crate::release1_ceremony_digest::validate_capacity_policy_digest_v1(&capacity)?;
    let expected = derive_capacity_policy_pda(program_id, &config.target_program);
    if expected.0 != *info.key
        || expected.1 != capacity.bump
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

fn load_ceremony_context(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
    policy_info: &AccountInfo<'_>,
    council_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    slot: u64,
) -> Result<CeremonyContext, ProgramError> {
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config)?;
    if slot == 0 || slot < policy.activation_slot {
        return Err(GovernanceError::InactivePolicy.into());
    }
    let council = load_council(program_id, council_info, config_info, &config, &policy)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    Ok(CeremonyContext {
        config,
        policy,
        council,
        gate,
        capacity,
    })
}

fn load_controller_release(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    capacity: &ProgramDataCapacityPolicyV1,
    controller_programdata: &Pubkey,
    config: &ControllerConfigV1,
) -> Result<Box<ControllerReleaseCommitmentV1>, ProgramError> {
    let release = load_fixed_controller_account::<ControllerReleaseCommitmentV1>(
        program_id,
        info,
        ControllerReleaseCommitmentV1::LEN,
    )?;
    validate_controller_release_digest_v1(&release)?;
    let expected = derive_controller_release_commitment_pda(program_id, &config.target_program);
    if expected.0 != *info.key
        || expected.1 != release.bump
        || release.controller_program != *program_id
        || release.controller_programdata != *controller_programdata
        || release.upgradeable_loader != config.upgradeable_loader
        || release.capacity_policy != *capacity_info.key
        || release.capacity_policy_digest != capacity.policy_digest
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(release)
}

#[allow(clippy::too_many_arguments)]
fn load_observation(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity_info: &AccountInfo<'_>,
    capacity: &ProgramDataCapacityPolicyV1,
    observed_program: &Pubkey,
    purpose: ProgramDataObservationPurposeV1,
    subject: &Pubkey,
) -> Result<Box<ProgramDataObservationV1>, ProgramError> {
    let observation = load_fixed_controller_account::<ProgramDataObservationV1>(
        program_id,
        info,
        ProgramDataObservationV1::LEN,
    )?;
    validate_programdata_observation_digest_v1(&observation)?;
    let expected = derive_programdata_observation_pda(
        program_id,
        observed_program,
        purpose as u8,
        observation.generation,
    );
    let expected_subject_digest = compute_programdata_observation_subject_digest_v1(
        program_id,
        config_info.key,
        observed_program,
        &observation.target_programdata,
        purpose,
        subject,
        observation.generation,
        &capacity.policy_digest,
        &observation.expected_artifact_sha256,
        &observation.expected_artifact_merkle_root,
        observation.minimum_required_capacity,
    )?;
    if expected.0 != *info.key
        || expected.1 != observation.bump
        || observation.controller_program != *program_id
        || observation.controller_config != *config_info.key
        || observation.capacity_policy != *capacity_info.key
        || observation.capacity_policy_digest != capacity.policy_digest
        || observation.purpose != purpose
        || observation.subject != *subject
        || observation.subject_digest != expected_subject_digest
        || observation.target_program != *observed_program
        || observation.target_programdata
            != derive_upgradeable_programdata_address(observed_program).0
        || observation.upgradeable_loader != config.upgradeable_loader
        || observation.status != ProgramDataObservationStatusV1::Finalized
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(observation)
}

fn load_immutability_receipt(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    capacity: &ProgramDataCapacityPolicyV1,
    config: &ControllerConfigV1,
) -> Result<Box<ControllerImmutabilityReceiptV1>, ProgramError> {
    let receipt = load_fixed_controller_account::<ControllerImmutabilityReceiptV1>(
        program_id,
        info,
        ControllerImmutabilityReceiptV1::LEN,
    )?;
    validate_controller_immutability_receipt_digest_v1(&receipt)?;
    let expected = derive_controller_immutability_receipt_pda(program_id, &config.target_program);
    if expected.0 != *info.key
        || expected.1 != receipt.bump
        || receipt.controller_program != *program_id
        || receipt.controller_programdata != derive_upgradeable_programdata_address(program_id).0
        || receipt.upgradeable_loader != config.upgradeable_loader
        || receipt.capacity_policy != *capacity_info.key
        || receipt.capacity_policy_digest != capacity.policy_digest
    {
        return Err(GovernanceError::ControllerNotImmutable.into());
    }
    Ok(receipt)
}

#[allow(clippy::too_many_arguments)]
fn load_handoff_proposal(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    policy_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    immutability_info: &AccountInfo<'_>,
    context: &CeremonyContext,
) -> Result<Box<TargetAuthorityHandoffProposalV1>, ProgramError> {
    let proposal = load_fixed_controller_account::<TargetAuthorityHandoffProposalV1>(
        program_id,
        info,
        TargetAuthorityHandoffProposalV1::LEN,
    )?;
    validate_target_handoff_proposal_digest_v1(&proposal)?;
    let expected = derive_target_authority_handoff_pda(
        program_id,
        &context.config.target_program,
        context.council.version,
    );
    if expected.0 != *info.key
        || expected.1 != proposal.bump
        || proposal.controller_program != *program_id
        || proposal.controller_config != *config_info.key
        || proposal.governance_policy != *policy_info.key
        || proposal.governance_policy_hash != context.policy.policy_hash
        || proposal.capacity_policy != *capacity_info.key
        || proposal.capacity_policy_digest != context.capacity.policy_digest
        || proposal.gate != *gate_info.key
        || proposal.controller_immutability_receipt != *immutability_info.key
        || proposal.cluster_domain != context.config.cluster_domain
        || proposal.controller_authority != context.config.authority_pda
        || proposal.target_program != context.config.target_program
        || proposal.target_programdata != context.config.target_programdata
        || proposal.upgradeable_loader != context.config.upgradeable_loader
        || proposal.council_version != context.council.version
        || proposal.council_hash != context.council.set_hash
        || proposal.bootstrap_gate_epoch != context.gate.epoch
        || proposal.target_nonce != context.config.target_nonce
        || derive_major_timing(&context.config, proposal.creation_slot)?
            != (
                proposal.review_start_slot,
                proposal.review_end_slot,
                proposal.not_before_slot,
                proposal.expiry_slot,
            )
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(proposal)
}

fn load_handoff_receipt(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    immutability_info: &AccountInfo<'_>,
    context: &CeremonyContext,
) -> Result<Box<TargetAuthorityHandoffReceiptV1>, ProgramError> {
    let receipt = load_fixed_controller_account::<TargetAuthorityHandoffReceiptV1>(
        program_id,
        info,
        TargetAuthorityHandoffReceiptV1::LEN,
    )?;
    validate_target_handoff_receipt_digest_v1(&receipt)?;
    let expected = derive_target_handoff_receipt_pda(program_id, &context.config.target_program);
    if expected.0 != *info.key
        || expected.1 != receipt.bump
        || receipt.controller_program != *program_id
        || receipt.controller_config != *config_info.key
        || receipt.controller_authority != context.config.authority_pda
        || receipt.controller_immutability_receipt != *immutability_info.key
        || receipt.target_program != context.config.target_program
        || receipt.target_programdata != context.config.target_programdata
        || receipt.upgradeable_loader != context.config.upgradeable_loader
        || receipt.bootstrap_gate_epoch != context.gate.epoch
        || receipt.target_nonce != context.config.target_nonce
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(receipt)
}

#[allow(clippy::too_many_arguments)]
fn load_activation_proposal(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    policy_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    immutability_info: &AccountInfo<'_>,
    handoff_receipt_info: &AccountInfo<'_>,
    context: &CeremonyContext,
) -> Result<Box<BootstrapActivationProposalV1>, ProgramError> {
    let proposal = load_fixed_controller_account::<BootstrapActivationProposalV1>(
        program_id,
        info,
        BootstrapActivationProposalV1::LEN,
    )?;
    validate_bootstrap_activation_proposal_digest_v1(&proposal)?;
    let expected = derive_bootstrap_activation_pda(
        program_id,
        &context.config.target_program,
        context.council.version,
    );
    if expected.0 != *info.key
        || expected.1 != proposal.bump
        || proposal.controller_program != *program_id
        || proposal.controller_programdata != derive_upgradeable_programdata_address(program_id).0
        || proposal.controller_config != *config_info.key
        || proposal.governance_policy != *policy_info.key
        || proposal.governance_policy_hash != context.policy.policy_hash
        || proposal.capacity_policy != *capacity_info.key
        || proposal.capacity_policy_digest != context.capacity.policy_digest
        || proposal.controller_immutability_receipt != *immutability_info.key
        || proposal.target_handoff_receipt != *handoff_receipt_info.key
        || proposal.gate != *gate_info.key
        || proposal.cluster_domain != context.config.cluster_domain
        || proposal.target_program != context.config.target_program
        || proposal.target_programdata != context.config.target_programdata
        || proposal.upgradeable_loader != context.config.upgradeable_loader
        || proposal.controller_authority != context.config.authority_pda
        || proposal.council_version != context.council.version
        || proposal.council_hash != context.council.set_hash
        || proposal.bootstrap_gate_epoch != context.gate.epoch
        || proposal.target_nonce != context.config.target_nonce
        || derive_major_timing(&context.config, proposal.creation_slot)?
            != (
                proposal.review_start_slot,
                proposal.review_end_slot,
                proposal.not_before_slot,
                proposal.expiry_slot,
            )
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(proposal)
}

fn validate_bootstrap_gate(gate: &ProtocolGateV1, config: &ControllerConfigV1) -> ProgramResult {
    if gate.status != GateStatusV1::EmergencyFrozen
        || gate.epoch == 0
        || gate.active_proposal != Pubkey::default()
        || gate.freeze_slot == 0
        || gate.freeze_reason_code != BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
        || gate.target_program != config.target_program
        || gate.target_programdata != config.target_programdata
    {
        return Err(GovernanceError::InvalidGateState.into());
    }
    Ok(())
}

fn validate_controller_immutability_transition(
    controller_program: &AccountInfo<'_>,
    controller_programdata: &AccountInfo<'_>,
    release: &ControllerReleaseCommitmentV1,
    pre: &ProgramDataObservationV1,
    post: &ProgramDataObservationV1,
) -> ProgramResult {
    if pre.generation >= post.generation
        || pre.target_program != *controller_program.key
        || post.target_program != *controller_program.key
        || pre.target_programdata != *controller_programdata.key
        || post.target_programdata != *controller_programdata.key
        || pre.program_header_snapshot != post.program_header_snapshot
        || pre.deployed_slot != post.deployed_slot
        || pre.raw_data_length != post.raw_data_length
        || pre.actual_capacity != post.actual_capacity
        || pre.expected_artifact_length != post.expected_artifact_length
        || pre.expected_artifact_sha256 != post.expected_artifact_sha256
        || pre.expected_artifact_merkle_root != post.expected_artifact_merkle_root
        || pre.expected_artifact_scheme_id != post.expected_artifact_scheme_id
        || pre.final_raw_merkle_root == post.final_raw_merkle_root
        || pre.observation_digest == post.observation_digest
        || pre.upgrade_authority != release.pre_immutability_authority
        || post.upgrade_authority != OptionalPubkeyV1::none()
        || release.artifact_length != post.expected_artifact_length
        || release.artifact_sha256 != post.expected_artifact_sha256
        || release.artifact_merkle_root != post.expected_artifact_merkle_root
        || release.artifact_scheme_id != post.expected_artifact_scheme_id
        || release.expected_programdata_capacity != post.actual_capacity
    {
        return Err(GovernanceError::ControllerNotImmutable.into());
    }
    validate_some_to_none_header_delta(
        &pre.programdata_header_snapshot,
        &post.programdata_header_snapshot,
        release.pre_immutability_authority.value,
    )?;
    require_live_observation(controller_program, controller_programdata, post, None)
}

fn validate_controller_still_immutable(
    program_id: &Pubkey,
    controller_program: &AccountInfo<'_>,
    controller_programdata: &AccountInfo<'_>,
    receipt: &ControllerImmutabilityReceiptV1,
) -> ProgramResult {
    if *controller_program.key != *program_id
        || *controller_programdata.key != receipt.controller_programdata
    {
        return Err(GovernanceError::ControllerNotImmutable.into());
    }
    let header = validate_program_programdata_linkage(
        controller_program,
        controller_programdata,
        &receipt.upgradeable_loader,
    )?;
    if header.upgrade_authority.is_some()
        || header.deployed_slot != receipt.deployed_slot
        || u64::try_from(header.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != receipt.programdata_capacity
    {
        return Err(GovernanceError::ControllerNotImmutable.into());
    }
    Ok(())
}

fn require_live_observation(
    program: &AccountInfo<'_>,
    programdata: &AccountInfo<'_>,
    observation: &ProgramDataObservationV1,
    expected_authority: Option<Pubkey>,
) -> ProgramResult {
    if *program.key != observation.target_program
        || *programdata.key != observation.target_programdata
        || program.owner != &observation.program_owner
        || programdata.owner != &observation.programdata_owner
        || program.executable != observation.program_executable
        || programdata.executable != observation.programdata_executable
        || u64::try_from(program.data_len()).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != observation.program_data_length
        || u64::try_from(programdata.data_len()).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != observation.raw_data_length
        || copy_program_header(program)? != observation.program_header_snapshot
        || copy_programdata_header(programdata)? != observation.programdata_header_snapshot
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let header = validate_program_programdata_linkage(
        program,
        programdata,
        &observation.upgradeable_loader,
    )?;
    if header.deployed_slot != observation.deployed_slot
        || u64::try_from(header.capacity).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != observation.actual_capacity
        || header.upgrade_authority != expected_authority
        || !optional_matches(&observation.upgrade_authority, expected_authority)
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

fn validate_target_graph(
    config: &ControllerConfigV1,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    authority: &AccountInfo<'_>,
    loader: &AccountInfo<'_>,
) -> ProgramResult {
    if *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
        || *authority.key != config.authority_pda
        || *loader.key != config.upgradeable_loader
        || config.upgradeable_loader != UPGRADEABLE_LOADER_ID
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_handoff_proposal_evidence(
    proposal: &TargetAuthorityHandoffProposalV1,
    context: &CeremonyContext,
    immutability_info: &AccountInfo<'_>,
    immutable: &ControllerImmutabilityReceiptV1,
    observation_info: &AccountInfo<'_>,
    observation: &ProgramDataObservationV1,
    legacy_authority: &Pubkey,
) -> ProgramResult {
    if proposal.controller_immutability_digest != immutable.receipt_digest
        || proposal.bridge_observation != *observation_info.key
        || proposal.bridge_observation_generation != observation.generation
        || proposal.bridge_observation_root != observation.final_raw_merkle_root
        || proposal.bridge_observation_digest != observation.observation_digest
        || proposal.legacy_target_authority != *legacy_authority
        || proposal.bridge_artifact_length != observation.expected_artifact_length
        || proposal.bridge_artifact_sha256 != observation.expected_artifact_sha256
        || proposal.bridge_artifact_merkle_root != observation.expected_artifact_merkle_root
        || proposal.bridge_artifact_scheme_id != observation.expected_artifact_scheme_id
        || proposal.expected_target_deployed_slot != observation.deployed_slot
        || proposal.expected_target_capacity != observation.actual_capacity
        || proposal.expected_target_raw_length != observation.raw_data_length
        || proposal.bootstrap_gate_status != context.gate.status
        || proposal.bootstrap_freeze_reason_code != context.gate.freeze_reason_code
        || proposal.bootstrap_freeze_slot != context.gate.freeze_slot
        || proposal.controller_immutability_receipt != *immutability_info.key
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_handoff_review_state(
    program_id: &Pubkey,
    controller_program: &AccountInfo<'_>,
    controller_programdata: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    policy_info: &AccountInfo<'_>,
    council_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    immutability_info: &AccountInfo<'_>,
    observation_info: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    legacy_authority: &AccountInfo<'_>,
    authority_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    loader_info: &AccountInfo<'_>,
    slot: u64,
) -> Result<HandoffReviewState, ProgramError> {
    let context = load_ceremony_context(
        program_id,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        slot,
    )?;
    validate_bootstrap_gate(&context.gate, &context.config)?;
    let immutable = load_immutability_receipt(
        program_id,
        immutability_info,
        capacity_info,
        &context.capacity,
        &context.config,
    )?;
    validate_controller_still_immutable(
        program_id,
        controller_program,
        controller_programdata,
        &immutable,
    )?;
    let observation = load_observation(
        program_id,
        observation_info,
        config_info,
        &context.config,
        capacity_info,
        &context.capacity,
        target_program.key,
        ProgramDataObservationPurposeV1::TargetHandoffBridge,
        immutability_info.key,
    )?;
    require_live_observation(
        target_program,
        target_programdata,
        &observation,
        Some(*legacy_authority.key),
    )?;
    validate_target_graph(
        &context.config,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
    )?;
    let proposal = load_handoff_proposal(
        program_id,
        proposal_info,
        config_info,
        policy_info,
        capacity_info,
        gate_info,
        immutability_info,
        &context,
    )?;
    validate_handoff_proposal_evidence(
        &proposal,
        &context,
        immutability_info,
        &immutable,
        observation_info,
        &observation,
        legacy_authority.key,
    )?;
    Ok(HandoffReviewState { context, proposal })
}

#[allow(clippy::too_many_arguments)]
fn validate_activation_evidence(
    program_id: &Pubkey,
    controller_program: &AccountInfo<'_>,
    controller_programdata: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    policy_info: &AccountInfo<'_>,
    council_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    immutability_info: &AccountInfo<'_>,
    handoff_receipt_info: &AccountInfo<'_>,
    observation_info: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    authority_info: &AccountInfo<'_>,
    loader_info: &AccountInfo<'_>,
    slot: u64,
) -> Result<ActivationEvidence, ProgramError> {
    let context = load_ceremony_context(
        program_id,
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        slot,
    )?;
    validate_bootstrap_gate(&context.gate, &context.config)?;
    let immutable = load_immutability_receipt(
        program_id,
        immutability_info,
        capacity_info,
        &context.capacity,
        &context.config,
    )?;
    validate_controller_still_immutable(
        program_id,
        controller_program,
        controller_programdata,
        &immutable,
    )?;
    let handoff = load_handoff_receipt(
        program_id,
        handoff_receipt_info,
        config_info,
        immutability_info,
        &context,
    )?;
    if handoff.controller_immutability_digest != immutable.receipt_digest {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let observation = load_observation(
        program_id,
        observation_info,
        config_info,
        &context.config,
        capacity_info,
        &context.capacity,
        target_program.key,
        ProgramDataObservationPurposeV1::BootstrapActivation,
        handoff_receipt_info.key,
    )?;
    validate_target_graph(
        &context.config,
        target_program,
        target_programdata,
        authority_info,
        loader_info,
    )?;
    require_live_observation(
        target_program,
        target_programdata,
        &observation,
        Some(context.config.authority_pda),
    )?;
    if observation.expected_artifact_length != handoff.artifact_length
        || observation.expected_artifact_sha256 != handoff.artifact_sha256
        || observation.expected_artifact_merkle_root != handoff.artifact_merkle_root
        || observation.expected_artifact_scheme_id != handoff.artifact_scheme_id
        || observation.deployed_slot != handoff.deployed_slot
        || observation.actual_capacity != handoff.programdata_capacity
        || observation.raw_data_length != handoff.raw_programdata_length
        || *authority_info.key != handoff.controller_authority
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(ActivationEvidence {
        context,
        immutable,
        handoff,
        observation,
    })
}

fn validate_activation_proposal_evidence(
    proposal: &BootstrapActivationProposalV1,
    evidence: &ActivationEvidence,
    observation_info: &AccountInfo<'_>,
    immutability_info: &AccountInfo<'_>,
    handoff_receipt_info: &AccountInfo<'_>,
) -> ProgramResult {
    if proposal.controller_immutability_receipt != *immutability_info.key
        || proposal.controller_immutability_digest != evidence.immutable.receipt_digest
        || proposal.target_handoff_receipt != *handoff_receipt_info.key
        || proposal.target_handoff_digest != evidence.handoff.receipt_digest
        || proposal.bridge_observation != *observation_info.key
        || proposal.bridge_observation_generation != evidence.observation.generation
        || proposal.bridge_observation_root != evidence.observation.final_raw_merkle_root
        || proposal.bridge_observation_digest != evidence.observation.observation_digest
        || proposal.bridge_artifact_length != evidence.handoff.artifact_length
        || proposal.bridge_artifact_sha256 != evidence.handoff.artifact_sha256
        || proposal.bridge_artifact_merkle_root != evidence.handoff.artifact_merkle_root
        || proposal.bridge_artifact_scheme_id != evidence.handoff.artifact_scheme_id
        || proposal.bridge_source_commitment != evidence.handoff.bridge_source_commitment
        || proposal.bridge_build_inputs_commitment
            != evidence.handoff.bridge_build_inputs_commitment
        || proposal.bridge_package_commitment != evidence.handoff.bridge_package_commitment
        || proposal.bridge_release_manifest_commitment
            != evidence.handoff.bridge_release_manifest_commitment
        || proposal.expected_target_deployed_slot != evidence.observation.deployed_slot
        || proposal.expected_target_capacity != evidence.observation.actual_capacity
        || proposal.expected_target_raw_length != evidence.observation.raw_data_length
        || proposal.bootstrap_gate_status != evidence.context.gate.status
        || proposal.bootstrap_freeze_reason_code != evidence.context.gate.freeze_reason_code
        || proposal.bootstrap_freeze_slot != evidence.context.gate.freeze_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn validate_handoff_review_privileges<'a>(
    controller_program: &AccountInfo<'a>,
    controller_programdata: &AccountInfo<'a>,
    config: &AccountInfo<'a>,
    policy: &AccountInfo<'a>,
    council: &AccountInfo<'a>,
    gate: &AccountInfo<'a>,
    capacity: &AccountInfo<'a>,
    immutable: &AccountInfo<'a>,
    observation: &AccountInfo<'a>,
    target_program: &AccountInfo<'a>,
    target_programdata: &AccountInfo<'a>,
    legacy_authority: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    proposal: &AccountInfo<'a>,
    loader: &AccountInfo<'a>,
) -> ProgramResult {
    validate_exact_privileges(controller_program, false, false, true)?;
    for account in [
        controller_programdata,
        config,
        policy,
        council,
        gate,
        capacity,
        immutable,
        observation,
        target_programdata,
        legacy_authority,
        authority,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(proposal, true, false, false)?;
    validate_exact_privileges(loader, false, false, true)
}

#[allow(clippy::too_many_arguments)]
fn validate_activation_review_privileges<'a>(
    controller_program: &AccountInfo<'a>,
    controller_programdata: &AccountInfo<'a>,
    config: &AccountInfo<'a>,
    policy: &AccountInfo<'a>,
    council: &AccountInfo<'a>,
    gate: &AccountInfo<'a>,
    capacity: &AccountInfo<'a>,
    immutable: &AccountInfo<'a>,
    handoff: &AccountInfo<'a>,
    observation: &AccountInfo<'a>,
    target_program: &AccountInfo<'a>,
    target_programdata: &AccountInfo<'a>,
    authority: &AccountInfo<'a>,
    proposal: &AccountInfo<'a>,
    loader: &AccountInfo<'a>,
) -> ProgramResult {
    validate_exact_privileges(controller_program, false, false, true)?;
    for account in [
        controller_programdata,
        config,
        policy,
        council,
        gate,
        capacity,
        immutable,
        handoff,
        observation,
        target_programdata,
        authority,
    ] {
        validate_exact_privileges(account, false, false, false)?;
    }
    validate_exact_privileges(target_program, false, false, true)?;
    validate_exact_privileges(proposal, true, false, false)?;
    validate_exact_privileges(loader, false, false, true)
}

fn derive_major_timing(
    config: &ControllerConfigV1,
    creation_slot: u64,
) -> Result<(u64, u64, u64, u64), ProgramError> {
    derive_major_timing_from_values(
        config.council_review_slots(),
        config.major_delay_slots,
        config.proposal_expiry_slots,
        creation_slot,
    )
}

fn derive_major_timing_from_values(
    review_slots: u64,
    major_delay_slots: u64,
    proposal_expiry_slots: u64,
    creation_slot: u64,
) -> Result<(u64, u64, u64, u64), ProgramError> {
    let review_start = creation_slot
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let review_end = review_start
        .checked_add(review_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let not_before = review_end
        .checked_add(major_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let expiry = creation_slot
        .checked_add(proposal_expiry_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if not_before >= expiry {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok((review_start, review_end, not_before, expiry))
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

fn reject_guardian(config: &ControllerConfigV1, authority: &Pubkey) -> ProgramResult {
    if *authority == config.guardian {
        Err(GovernanceError::UnknownSeatAuthority.into())
    } else {
        Ok(())
    }
}

fn require_approval_window(
    proposal: &TargetAuthorityHandoffProposalV1,
    slot: u64,
) -> ProgramResult {
    if slot < proposal.review_start_slot
        || slot > proposal.review_end_slot
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn require_approval_window_activation(
    proposal: &BootstrapActivationProposalV1,
    slot: u64,
) -> ProgramResult {
    if slot < proposal.review_start_slot
        || slot > proposal.review_end_slot
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn require_exact_quorum(
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

fn copy_program_header(program: &AccountInfo<'_>) -> Result<[u8; 36], ProgramError> {
    let data = program.try_borrow_data()?;
    data.get(..36)
        .ok_or(GovernanceError::InvalidRelease1Account)?
        .try_into()
        .map_err(|_| GovernanceError::InvalidRelease1Account.into())
}

fn copy_programdata_header(
    programdata: &AccountInfo<'_>,
) -> Result<[u8; LOADER_PROGRAMDATA_METADATA_LEN], ProgramError> {
    let data = programdata.try_borrow_data()?;
    data.get(..LOADER_PROGRAMDATA_METADATA_LEN)
        .ok_or(GovernanceError::InvalidRelease1Account)?
        .try_into()
        .map_err(|_| GovernanceError::InvalidRelease1Account.into())
}

fn optional_matches(value: &OptionalPubkeyV1, expected: Option<Pubkey>) -> bool {
    match expected {
        Some(key) => value.present && value.value == key,
        None => !value.present && value.value == Pubkey::default(),
    }
}

fn validate_some_to_none_header_delta(
    pre: &[u8; LOADER_PROGRAMDATA_METADATA_LEN],
    post: &[u8; LOADER_PROGRAMDATA_METADATA_LEN],
    authority: Pubkey,
) -> ProgramResult {
    let pre_parsed = parse_upgradeable_programdata(pre)?;
    let post_parsed = parse_upgradeable_programdata(post)?;
    if pre_parsed.deployed_slot != post_parsed.deployed_slot
        || pre_parsed.upgrade_authority != Some(authority)
        || post_parsed.upgrade_authority.is_some()
        || pre[..12] != post[..12]
        || pre[12] != 1
        || post[12] != 0
        || pre[13..] != post[13..]
    {
        return Err(GovernanceError::InvalidAuthorityTransition.into());
    }
    Ok(())
}

fn expected_handoff_post_header(
    pre: &[u8; LOADER_PROGRAMDATA_METADATA_LEN],
    legacy: Pubkey,
    controller: Pubkey,
) -> Result<[u8; LOADER_PROGRAMDATA_METADATA_LEN], ProgramError> {
    if parse_upgradeable_programdata(pre)?.upgrade_authority != Some(legacy) {
        return Err(GovernanceError::InvalidAuthorityTransition.into());
    }
    let mut post = *pre;
    post[12] = 1;
    post[13..45].copy_from_slice(controller.as_ref());
    Ok(post)
}

fn validate_some_to_some_header_delta(
    pre: &[u8; LOADER_PROGRAMDATA_METADATA_LEN],
    post: &[u8; LOADER_PROGRAMDATA_METADATA_LEN],
    legacy: Pubkey,
    controller: Pubkey,
) -> ProgramResult {
    if parse_upgradeable_programdata(pre)?.upgrade_authority != Some(legacy)
        || parse_upgradeable_programdata(post)?.upgrade_authority != Some(controller)
        || pre[..12] != post[..12]
        || pre[12] != 1
        || post[12] != 1
        || post[13..45] != controller.to_bytes()
        || pre[13..45] != legacy.to_bytes()
    {
        return Err(GovernanceError::InvalidAuthorityTransition.into());
    }
    Ok(())
}

fn validate_checked_handoff_cpi_shape(
    instruction: &Instruction,
    programdata: &Pubkey,
    legacy: &Pubkey,
    controller: &Pubkey,
) -> ProgramResult {
    if instruction.program_id != UPGRADEABLE_LOADER_ID
        || instruction.accounts.len() != 3
        || instruction.accounts[0].pubkey != *programdata
        || !instruction.accounts[0].is_writable
        || instruction.accounts[0].is_signer
        || instruction.accounts[1].pubkey != *legacy
        || instruction.accounts[1].is_writable
        || !instruction.accounts[1].is_signer
        || instruction.accounts[2].pubkey != *controller
        || instruction.accounts[2].is_writable
        || !instruction.accounts[2].is_signer
        || instruction.data != 7u32.to_le_bytes()
    {
        return Err(GovernanceError::InvalidAuthorityTransition.into());
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
        || *instructions_info.key != sysvar_ids::instructions::ID
    {
        return Err(ProgramError::InvalidInstructionData);
    }
    let nonce = if envelope.durable_nonce_account.present {
        Some(envelope.durable_nonce_account.value)
    } else {
        None
    };
    let nonce_authority = if envelope.durable_nonce_authority.present {
        Some(envelope.durable_nonce_authority.value)
    } else {
        None
    };
    if nonce.is_some() != nonce_authority.is_some() {
        return Err(ProgramError::InvalidInstructionData);
    }
    let current_index = if nonce.is_some() { 3usize } else { 2usize };
    if usize::from(instructions::load_current_index_checked(instructions_info)?) != current_index {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let mut index = 0usize;
    if let (Some(nonce), Some(authority)) = (nonce, nonce_authority) {
        if instructions::load_instruction_at_checked(index, instructions_info)?
            != system_instruction::advance_nonce_account(&nonce, &authority)
        {
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

fn require_zero_initialized_destination(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    expected_len: usize,
) -> ProgramResult {
    if account.owner != program_id || account.data_len() != expected_len {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    if account.lamports() < Rent::get()?.minimum_balance(expected_len) {
        return Err(GovernanceError::InvalidRelease1Account.into());
    }
    if account.try_borrow_data()?.iter().any(|byte| *byte != 0) {
        return Err(GovernanceError::CeremonyAlreadyFinalized.into());
    }
    Ok(())
}

/// Creates a one-time result PDA, or reuses its exact untouched preallocation after a council
/// rotation made the prior versioned proposal stale.  A reusable destination must already be the
/// canonical PDA, controller-owned, exact-size, rent-exempt, and byte-for-byte zero.
#[allow(clippy::too_many_arguments)]
fn create_or_reuse_zero_fixed_pda<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    pda: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    rent: &Rent,
    space: usize,
    signer_seeds: &[&[u8]],
) -> ProgramResult {
    validate_exact_privileges(payer, true, true, false)?;
    validate_exact_privileges(pda, true, false, false)?;
    validate_exact_privileges(system_program_info, false, false, true)?;
    let expected = Pubkey::create_program_address(signer_seeds, program_id)
        .map_err(|_| GovernanceError::InvalidPda)?;
    if expected != *pda.key || *system_program_info.key != system_program::ID {
        return Err(GovernanceError::InvalidPda.into());
    }
    if pda.owner == program_id {
        if pda.data_len() != space || pda.lamports() < rent.minimum_balance(space) {
            return Err(GovernanceError::InvalidRelease1Account.into());
        }
        if pda.try_borrow_data()?.iter().any(|byte| *byte != 0) {
            return Err(GovernanceError::CeremonyAlreadyFinalized.into());
        }
        return Ok(());
    }
    if pda.owner != &system_program::ID || pda.data_len() != 0 {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    create_fixed_pda_account(
        program_id,
        payer,
        pda,
        system_program_info,
        rent,
        space,
        signer_seeds,
    )
}

/// Borrows every destination before the first copy, so an account-borrow or length failure cannot
/// leave a partially written controller state in native tests.  Runtime transaction atomicity also
/// rolls back any earlier System/Loader CPI if this commit fails.
fn commit_preencoded(
    program_id: &Pubkey,
    destinations: &[(&AccountInfo<'_>, &Vec<u8>)],
) -> ProgramResult {
    for (account, bytes) in destinations {
        if account.owner != program_id {
            return Err(GovernanceError::IncorrectAccountOwner.into());
        }
        if account.data_len() != bytes.len() {
            return Err(GovernanceError::InvalidAccountSize.into());
        }
    }
    let mut borrows = Vec::with_capacity(destinations.len());
    for (account, _) in destinations {
        borrows.push(account.try_borrow_mut_data()?);
    }
    for ((_, bytes), data) in destinations.iter().zip(borrows.iter_mut()) {
        data.copy_from_slice(bytes);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use solana_program::instruction::{AccountMeta, Instruction};

    use super::*;
    use crate::state::{CouncilSeatV1, GovernanceCouncilSetV1, COUNCIL_SEAT_RESERVED_LEN};

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn programdata_header(slot: u64, authority: Option<Pubkey>) -> [u8; 45] {
        let mut out = [0u8; 45];
        out[..4].copy_from_slice(&3u32.to_le_bytes());
        out[4..12].copy_from_slice(&slot.to_le_bytes());
        if let Some(authority) = authority {
            out[12] = 1;
            out[13..].copy_from_slice(authority.as_ref());
        }
        out
    }

    fn council() -> GovernanceCouncilSetV1 {
        GovernanceCouncilSetV1 {
            discriminator: crate::state::GOVERNANCE_COUNCIL_DISCRIMINATOR,
            account_version: crate::state::ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            controller_config: key(1),
            version: 1,
            target_program: key(2),
            activation_slot: 1,
            deactivation_slot: 0,
            seats: std::array::from_fn(|index| CouncilSeatV1 {
                seat_authority: key(10 + index as u8),
                term_start_slot: 1,
                term_end_slot: 1_000,
                active: true,
                reserved: [0; COUNCIL_SEAT_RESERVED_LEN],
            }),
            routine_threshold: 3,
            terminal_threshold: 4,
            policy_flags: 0,
            set_hash: [1; 32],
            reserved: [0; crate::state::GOVERNANCE_COUNCIL_RESERVED_LEN],
        }
    }

    #[test]
    fn header_deltas_are_exact_and_payload_metadata_cannot_drift() {
        let legacy = key(1);
        let controller = key(2);
        let pre = programdata_header(44, Some(legacy));
        let post = expected_handoff_post_header(&pre, legacy, controller).unwrap();
        validate_some_to_some_header_delta(&pre, &post, legacy, controller).unwrap();
        let mut wrong_slot = post;
        wrong_slot[4] ^= 1;
        assert_eq!(
            validate_some_to_some_header_delta(&pre, &wrong_slot, legacy, controller),
            Err(GovernanceError::InvalidAuthorityTransition.into())
        );

        let mut immutable = pre;
        immutable[12] = 0;
        validate_some_to_none_header_delta(&pre, &immutable, legacy).unwrap();
        immutable[13] ^= 1;
        assert_eq!(
            validate_some_to_none_header_delta(&pre, &immutable, legacy),
            Err(GovernanceError::InvalidAuthorityTransition.into())
        );
    }

    #[test]
    fn all_32_masks_enforce_exact_three_of_five_for_ceremony_execution() {
        let council = council();
        for mask in 0u8..32 {
            let count = mask.count_ones() as u8;
            assert_eq!(
                require_exact_quorum(&council, mask, count, 100).is_ok(),
                count == 3,
                "mask {mask:05b}"
            );
        }
        assert_eq!(
            require_exact_quorum(&council, 0b00111, 2, 100),
            Err(GovernanceError::QuorumNotSatisfied.into())
        );
    }

    #[test]
    fn versioned_proposal_creation_seeds_match_pda_derivations() {
        let program_id = key(31);
        let target = key(32);
        let mut handoff_addresses = Vec::new();
        let mut activation_addresses = Vec::new();
        for council_version in [1u64, 2, u64::MAX] {
            let council_version_seed = council_version.to_le_bytes();

            let (handoff, handoff_bump) =
                derive_target_authority_handoff_pda(&program_id, &target, council_version);
            let handoff_bump_seed = [handoff_bump];
            assert_eq!(
                Pubkey::create_program_address(
                    &[
                        UPGRADE_SEED_DOMAIN_V1,
                        TARGET_HANDOFF_SEED,
                        target.as_ref(),
                        &council_version_seed,
                        &handoff_bump_seed,
                    ],
                    &program_id,
                )
                .unwrap(),
                handoff
            );
            handoff_addresses.push(handoff);

            let (activation, activation_bump) =
                derive_bootstrap_activation_pda(&program_id, &target, council_version);
            let activation_bump_seed = [activation_bump];
            assert_eq!(
                Pubkey::create_program_address(
                    &[
                        UPGRADE_SEED_DOMAIN_V1,
                        BOOTSTRAP_ACTIVATION_SEED,
                        target.as_ref(),
                        &council_version_seed,
                        &activation_bump_seed,
                    ],
                    &program_id,
                )
                .unwrap(),
                activation
            );
            activation_addresses.push(activation);
        }
        assert_eq!(
            handoff_addresses
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            handoff_addresses.len()
        );
        assert_eq!(
            activation_addresses
                .iter()
                .collect::<std::collections::HashSet<_>>()
                .len(),
            activation_addresses.len()
        );
    }

    #[test]
    fn council_rotation_stales_proposals_but_preserves_one_time_destinations() {
        let program_id = key(33);
        let target = key(34);
        let old_handoff = derive_target_authority_handoff_pda(&program_id, &target, 8).0;
        let current_handoff = derive_target_authority_handoff_pda(&program_id, &target, 9).0;
        let old_activation = derive_bootstrap_activation_pda(&program_id, &target, 8).0;
        let current_activation = derive_bootstrap_activation_pda(&program_id, &target, 9).0;
        assert_ne!(old_handoff, current_handoff);
        assert_ne!(old_activation, current_activation);
        assert_eq!(
            derive_target_handoff_receipt_pda(&program_id, &target),
            derive_target_handoff_receipt_pda(&program_id, &target)
        );
        assert_eq!(
            derive_bootstrap_activation_receipt_pda(&program_id, &target),
            derive_bootstrap_activation_receipt_pda(&program_id, &target)
        );
        assert_eq!(
            derive_current_deployment_state_pda(&program_id, &target),
            derive_current_deployment_state_pda(&program_id, &target)
        );
    }

    #[test]
    fn rotated_activation_can_reuse_only_untouched_rent_exempt_destinations() {
        let program_id = key(35);
        let target = key(36);
        let (pda_key, bump) = derive_bootstrap_activation_receipt_pda(&program_id, &target);
        let rent = Rent::default();
        let space = BootstrapActivationReceiptV1::LEN;
        let pda = leaked_owned_account(
            pda_key,
            program_id,
            rent.minimum_balance(space),
            true,
            false,
            false,
            vec![0; space],
        );
        let payer = leaked_owned_account(key(37), key(38), 1, true, true, false, vec![]);
        let system =
            leaked_owned_account(system_program::ID, key(39), 1, false, false, true, vec![]);
        let bump_seed = [bump];
        let seeds: &[&[u8]] = &[
            UPGRADE_SEED_DOMAIN_V1,
            BOOTSTRAP_ACTIVATION_RECEIPT_SEED,
            target.as_ref(),
            &bump_seed,
        ];
        create_or_reuse_zero_fixed_pda(&program_id, &payer, &pda, &system, &rent, space, seeds)
            .unwrap();

        pda.try_borrow_mut_data().unwrap()[0] = 1;
        assert_eq!(
            create_or_reuse_zero_fixed_pda(&program_id, &payer, &pda, &system, &rent, space, seeds,),
            Err(GovernanceError::CeremonyAlreadyFinalized.into())
        );
    }

    #[test]
    fn checked_loader_cpi_shape_is_exact() {
        let target = key(3);
        let programdata = derive_upgradeable_programdata_address(&target).0;
        let legacy = key(4);
        let controller = key(5);
        let instruction = set_upgrade_authority_checked(&target, &legacy, &controller);
        validate_checked_handoff_cpi_shape(&instruction, &programdata, &legacy, &controller)
            .unwrap();
        let mut unchecked = instruction;
        unchecked.data = 4u32.to_le_bytes().to_vec();
        assert_eq!(
            validate_checked_handoff_cpi_shape(&unchecked, &programdata, &legacy, &controller,),
            Err(GovernanceError::InvalidAuthorityTransition.into())
        );
    }

    #[test]
    fn major_timing_is_immutable_and_overflow_safe() {
        assert_eq!(
            derive_major_timing_from_values(10, 20, 100, 5).unwrap(),
            (6, 16, 36, 105)
        );
        assert!(derive_major_timing_from_values(10, 20, 100, u64::MAX).is_err());
        assert!(derive_major_timing_from_values(10, 90, 100, 5).is_err());
    }

    #[test]
    fn envelope_rejects_siblings_and_privilege_drift() {
        let program_id = key(6);
        let envelope = CeremonyEnvelopeV1 {
            compute_unit_limit: 1_000_000,
            compute_unit_price_micro_lamports: 7,
            durable_nonce_account: OptionalPubkeyV1::none(),
            durable_nonce_authority: OptionalPubkeyV1::none(),
        };
        let current_data = vec![47, 1, 2, 3];
        let account_key = key(7);
        let info = leaked_account(account_key, true, false, false, vec![]);
        let ix_sysvar_key = sysvar_ids::instructions::ID;
        let sysvar_info = leaked_account(ix_sysvar_key, false, false, false, vec![]);
        let mut current_accounts = vec![info, sysvar_info];
        let current = Instruction {
            program_id,
            accounts: vec![
                AccountMeta::new(account_key, false),
                AccountMeta::new_readonly(ix_sysvar_key, false),
            ],
            data: current_data.clone(),
        };
        let prefix = [
            compute_limit(&envelope),
            compute_price(&envelope),
            current.clone(),
        ];
        current_accounts[1] = instructions_sysvar(&prefix, 2);
        validate_canonical_envelope(
            &program_id,
            &current_accounts,
            &current_accounts[1],
            &current_data,
            &envelope,
        )
        .unwrap();

        let sibling = Instruction {
            program_id: key(8),
            accounts: vec![],
            data: vec![1],
        };
        let with_sibling = [prefix[0].clone(), prefix[1].clone(), current, sibling];
        current_accounts[1] = instructions_sysvar(&with_sibling, 2);
        assert!(validate_canonical_envelope(
            &program_id,
            &current_accounts,
            &current_accounts[1],
            &current_data,
            &envelope,
        )
        .is_err());
    }

    fn leaked_account(
        account_key: Pubkey,
        writable: bool,
        signer: bool,
        executable: bool,
        data: Vec<u8>,
    ) -> AccountInfo<'static> {
        leaked_owned_account(account_key, key(250), 1, writable, signer, executable, data)
    }

    #[allow(clippy::too_many_arguments)]
    fn leaked_owned_account(
        account_key: Pubkey,
        owner: Pubkey,
        lamports: u64,
        writable: bool,
        signer: bool,
        executable: bool,
        data: Vec<u8>,
    ) -> AccountInfo<'static> {
        AccountInfo::new(
            Box::leak(Box::new(account_key)),
            signer,
            writable,
            Box::leak(Box::new(lamports)),
            Box::leak(data.into_boxed_slice()),
            Box::leak(Box::new(owner)),
            executable,
            0,
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
        let offset = data.len() - 2;
        data[offset..].copy_from_slice(&current_index.to_le_bytes());
        leaked_account(sysvar_ids::instructions::ID, false, false, false, data)
    }

    fn compute_limit(envelope: &CeremonyEnvelopeV1) -> Instruction {
        let mut data = [0u8; 5];
        data[0] = 2;
        data[1..].copy_from_slice(&envelope.compute_unit_limit.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }

    fn compute_price(envelope: &CeremonyEnvelopeV1) -> Instruction {
        let mut data = [0u8; 9];
        data[0] = 3;
        data[1..].copy_from_slice(&envelope.compute_unit_price_micro_lamports.to_le_bytes());
        Instruction {
            program_id: compute_budget::ID,
            accounts: vec![],
            data: data.to_vec(),
        }
    }
}
