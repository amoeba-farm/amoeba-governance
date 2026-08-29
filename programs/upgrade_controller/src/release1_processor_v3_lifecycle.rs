//! Capacity-safe Release 1 proposal, guardian, emergency-resolution, and
//! checkpoint processors.
//!
//! This module deliberately contains no Loader mutation. Every entry point
//! validates its complete closed account contract, derives every consensus
//! identity from controller-owned state, prepares exact fixed-width bytes, and
//! performs the first account write only after all fallible checks complete.

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
use solana_system_interface::instruction as system_instruction;

use crate::{
    artifact_merkle::artifact_chunk_count,
    authorization::validate_seat_authority,
    council::{
        record_seat_approval, validate_council_guardian_separation, validate_council_set,
        VALID_APPROVAL_MASK,
    },
    pda::{
        derive_authority_pda, derive_buffer_check_pda, derive_capacity_policy_pda,
        derive_checkpoint_attestation_pda, derive_checkpoint_pda, derive_controller_config_pda,
        derive_council_pda, derive_current_deployment_state_pda,
        derive_emergency_checkpoint_v2_pda, derive_emergency_freeze_observation_pda,
        derive_emergency_resolution_v2_pda, derive_gate_pda, derive_policy_pda,
        derive_programdata_check_pda, derive_programdata_observation_pda, derive_proposal_pda,
        derive_upgradeable_programdata_address, CHECKPOINT_ATTESTATION_SEED, CHECKPOINT_SEED,
        EMERGENCY_CHECKPOINT_V2_SEED, EMERGENCY_FREEZE_OBSERVATION_SEED,
        EMERGENCY_RESOLUTION_V2_SEED, PROPOSAL_SEED, UPGRADEABLE_LOADER_ID, UPGRADE_SEED_DOMAIN_V1,
    },
    policy::validate_policy_against_config,
    release1_account_io::{
        create_fixed_pda_account, encode_fixed_account, load_fixed_controller_account,
        load_upgrade_proposal_v3, require_distinct_accounts, store_fixed_controller_account,
        validate_exact_privileges,
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
    release1_digest::{
        compute_checkpoint_attestation_digest_v1, validate_checkpoint_attestation_digest_v1,
        STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1,
    },
    release1_loader_accounts::{
        validate_buffer_account, validate_program_programdata_linkage, LOADER_BUFFER_METADATA_LEN,
        LOADER_PROGRAMDATA_METADATA_LEN, LOADER_PROGRAM_ACCOUNT_LEN,
    },
    release1_state::{
        BufferVerificationStatusV1, BufferVerificationV1, CheckpointAttestationV1,
        EmergencyFreezeResolutionKindV1, EmergencyFreezeResolutionStateV1, ProposalStateV2,
        StateCheckpointPhaseV1, BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1,
        CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR, CHECKPOINT_ATTESTATION_V1_RESERVED_LEN,
        PROPOSAL_COMPLETED_TERMINAL_REASON_V1, PROPOSAL_EXPIRED_TERMINAL_REASON_V1,
        PROPOSAL_RETIRED_ROLLBACK_TERMINAL_REASON_V1,
        PROPOSAL_SUPERSEDED_BY_ROLLBACK_TERMINAL_REASON_V1, RELEASE1_ACCOUNT_VERSION_V1,
        RELEASE1_APPROVAL_THRESHOLD,
    },
    release1_v3_digest::{
        compute_emergency_freeze_observation_digest_v2,
        compute_emergency_freeze_resolution_digest_v2, compute_state_checkpoint_digest_v2,
        compute_upgrade_proposal_digest_v3, validate_emergency_freeze_observation_digest_v2,
        validate_emergency_freeze_resolution_digest_v2,
        validate_programdata_verification_digest_v2, validate_state_checkpoint_digest_v2,
        validate_upgrade_proposal_digest_v3,
    },
    release1_v3_instruction::{
        ApproveEmergencyResolutionV2, ApproveProposalV3, ApproveUnfreezeV2, CancelProposalV3,
        CheckpointManifestV2, CreateCheckpointV2, CreateEmergencyResolutionV2, CreateProposalV3,
        EmergencyResolutionGuardV2, ExecuteEmergencyResolutionV2, ExecuteUnfreezeV2,
        ExpireEmergencyResolutionV2, ExpireProposalV3, FinalizeCheckpointV2, FinalizeGovernanceV3,
        FreezeProposalV3, GuardianFreezeV2, ProposalGuardV3, QueueEmergencyResolutionV2,
        QueueProposalV3, RecastCheckpointV2, UnfreezeGuardV2,
    },
    release1_v3_state::{
        EmergencyFreezeObservationV2, EmergencyFreezeResolutionV2, ProgramDataVerificationStatusV2,
        ProgramDataVerificationV2, StateCheckpointV2, UpgradeProposalV3,
        CAPACITY_SAFE_ACCOUNT_VERSION_V2, CAPACITY_SAFE_ACCOUNT_VERSION_V3,
        EMERGENCY_FREEZE_OBSERVATION_V2_DIGEST_DOMAIN_ID,
        EMERGENCY_FREEZE_OBSERVATION_V2_DISCRIMINATOR,
        EMERGENCY_FREEZE_OBSERVATION_V2_RESERVED_LEN,
        EMERGENCY_FREEZE_RESOLUTION_V2_DIGEST_DOMAIN_ID,
        EMERGENCY_FREEZE_RESOLUTION_V2_DISCRIMINATOR, EMERGENCY_FREEZE_RESOLUTION_V2_RESERVED_LEN,
        EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V2,
        EMERGENCY_RESOLUTION_EXPIRED_TERMINAL_REASON_V2, STATE_CHECKPOINT_V2_DIGEST_DOMAIN_ID,
        STATE_CHECKPOINT_V2_DISCRIMINATOR, STATE_CHECKPOINT_V2_RESERVED_LEN,
        UPGRADE_PROPOSAL_V3_DIGEST_DOMAIN_ID, UPGRADE_PROPOSAL_V3_DISCRIMINATOR,
        UPGRADE_PROPOSAL_V3_RESERVED_LEN,
    },
    state::{
        CheckpointPhaseV1, ControllerConfigV1, GateStatusV1, GovernanceCouncilSetV1,
        GovernancePolicyV1, OptionalPubkeyV1, ProposalClassV1, ProtocolGateV1, VoteRequirementV1,
    },
    GovernanceError, GovernanceResult,
};

/// Canonical reason used only when an approved V3 proposal consumes the target
/// nonce and crosses the freeze boundary.
pub const GOVERNED_UPGRADE_FREEZE_REASON_V3: u16 = 2;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct RuntimeProgramDataHeaderV2 {
    deployed_slot: u64,
    raw_data_length: u64,
    capacity: u64,
    authority: Option<Pubkey>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ProgramDataObservationExpectationV2 {
    artifact_length: u64,
    artifact_sha256: [u8; 32],
    artifact_merkle_root: [u8; 32],
    artifact_scheme_id: [u8; 32],
    deployed_slot: u64,
    exact_capacity: Option<u64>,
}

fn trusted_observation_expectation(
    deployment: &CurrentDeploymentStateV1,
) -> ProgramDataObservationExpectationV2 {
    ProgramDataObservationExpectationV2 {
        artifact_length: deployment.artifact_length,
        artifact_sha256: deployment.artifact_sha256,
        artifact_merkle_root: deployment.artifact_merkle_root,
        artifact_scheme_id: deployment.artifact_scheme_id,
        deployed_slot: deployment.deployed_slot,
        exact_capacity: Some(deployment.actual_programdata_capacity),
    }
}

fn failed_primary_observation_expectation(
    primary: &UpgradeProposalV3,
) -> ProgramDataObservationExpectationV2 {
    candidate_observation_expectation(
        primary.artifact_length,
        primary.artifact_sha256,
        primary.artifact_chunk_merkle_root,
        primary.artifact_scheme_id,
        primary.upgrade_executed_slot,
    )
}

fn candidate_observation_expectation(
    artifact_length: u64,
    artifact_sha256: [u8; 32],
    artifact_merkle_root: [u8; 32],
    artifact_scheme_id: [u8; 32],
    deployed_slot: u64,
) -> ProgramDataObservationExpectationV2 {
    ProgramDataObservationExpectationV2 {
        artifact_length,
        artifact_sha256,
        artifact_merkle_root,
        artifact_scheme_id,
        deployed_slot,
        // The failed candidate can have a checked extension which was never
        // committed to CurrentDeploymentState. Its live capacity is therefore
        // bound by the finalized observation and checkpoint, not guessed from
        // the last known-good deployment record.
        exact_capacity: None,
    }
}

struct LifecycleContext {
    config: Box<ControllerConfigV1>,
    gate: Box<ProtocolGateV1>,
    capacity: Box<ProgramDataCapacityPolicyV1>,
    deployment: Box<CurrentDeploymentStateV1>,
}

fn current_slot() -> Result<u64, ProgramError> {
    let slot = Clock::get()?.slot;
    if slot == 0 {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(slot)
}

fn checked_nonterminal_increment(value: u64) -> GovernanceResult<u64> {
    let next = value
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if next == u64::MAX {
        return Err(GovernanceError::ArithmeticOverflow);
    }
    Ok(next)
}

fn exact_account_count(accounts: &[AccountInfo<'_>], expected: usize) -> ProgramResult {
    if accounts.len() != expected {
        return Err(GovernanceError::InvalidAccountCount.into());
    }
    Ok(())
}

fn all_distinct(accounts: &[AccountInfo<'_>]) -> ProgramResult {
    let refs = accounts.iter().collect::<Vec<_>>();
    require_distinct_accounts(&refs)
}

fn readonly(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, false, false, false)
}

fn writable(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, true, false, false)
}

fn signer_readonly(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, false, true, false)
}

fn signer_writable(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, true, true, false)
}

fn executable_readonly(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, false, false, true)
}

fn system_program_account(account: &AccountInfo<'_>) -> ProgramResult {
    executable_readonly(account)?;
    if *account.key != system_program::ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
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
    if expected != (*info.key, config.bump)
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
    slot: u64,
) -> Result<Box<GovernancePolicyV1>, ProgramError> {
    let policy = load_fixed_controller_account::<GovernancePolicyV1>(
        program_id,
        info,
        GovernancePolicyV1::LEN,
    )?;
    validate_policy_against_config(&policy, config)?;
    let expected = derive_policy_pda(
        program_id,
        &config.target_program,
        config.current_policy_version,
    );
    if expected != (*info.key, policy.bump)
        || policy.controller_config != *config_info.key
        || policy.activation_slot > slot
    {
        return Err(GovernanceError::InactivePolicy.into());
    }
    Ok(policy)
}

#[allow(clippy::too_many_arguments)]
fn load_council(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    expected_version: u64,
    expected_hash: &[u8; 32],
    slot: u64,
    require_current: bool,
) -> Result<Box<GovernanceCouncilSetV1>, ProgramError> {
    let council = load_fixed_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        info,
        GovernanceCouncilSetV1::LEN,
    )?;
    validate_council_set(&council, policy)?;
    validate_council_guardian_separation(&council, &config.guardian)?;
    let expected = derive_council_pda(program_id, &config.target_program, expected_version);
    if expected != (*info.key, council.bump)
        || council.controller_config != *config_info.key
        || council.target_program != config.target_program
        || council.version != expected_version
        || council.set_hash != *expected_hash
        || !council.active_at(slot)
        || (require_current && council.version != config.current_council_version)
    {
        return Err(GovernanceError::StaleCouncilVersion.into());
    }
    Ok(council)
}

fn load_current_council(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    slot: u64,
) -> Result<Box<GovernanceCouncilSetV1>, ProgramError> {
    let council = load_fixed_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        info,
        GovernanceCouncilSetV1::LEN,
    )?;
    load_council(
        program_id,
        info,
        config_info,
        config,
        policy,
        config.current_council_version,
        &council.set_hash,
        slot,
        true,
    )
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
    if derive_gate_pda(program_id, &config.target_program) != (*info.key, gate.bump)
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
    validate_capacity_policy_digest_v1(&capacity)?;
    if derive_capacity_policy_pda(program_id, &config.target_program) != (*info.key, capacity.bump)
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
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
) -> Result<Box<CurrentDeploymentStateV1>, ProgramError> {
    let deployment = load_fixed_controller_account::<CurrentDeploymentStateV1>(
        program_id,
        info,
        CurrentDeploymentStateV1::LEN,
    )?;
    validate_current_deployment_digest_v1(&deployment)?;
    if derive_current_deployment_state_pda(program_id, &config.target_program)
        != (*info.key, deployment.bump)
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

fn load_lifecycle_context(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
) -> Result<LifecycleContext, ProgramError> {
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    Ok(LifecycleContext {
        config,
        gate,
        capacity,
        deployment,
    })
}

fn read_runtime_programdata_header(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
) -> Result<RuntimeProgramDataHeaderV2, ProgramError> {
    if *target_program.key != config.target_program
        || *target_programdata.key != config.target_programdata
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let header = validate_program_programdata_linkage(
        target_program,
        target_programdata,
        &config.upgradeable_loader,
    )?;
    let raw_data_length = u64::try_from(target_programdata.data_len())
        .map_err(|_| GovernanceError::ArithmeticOverflow)?;
    let runtime = RuntimeProgramDataHeaderV2 {
        deployed_slot: header.deployed_slot,
        raw_data_length,
        capacity: u64::try_from(header.capacity)
            .map_err(|_| GovernanceError::ArithmeticOverflow)?,
        authority: header.upgrade_authority,
    };
    if runtime.deployed_slot == 0
        || runtime.raw_data_length > capacity.maximum_raw_programdata_length
        || runtime.capacity > capacity.maximum_payload_capacity
        || runtime.raw_data_length
            != runtime
                .capacity
                .checked_add(capacity.loader_programdata_metadata_len)
                .ok_or(GovernanceError::ArithmeticOverflow)?
    {
        return Err(GovernanceError::InvalidCapacityPlan.into());
    }
    Ok(runtime)
}

fn require_runtime_matches_trusted_deployment(
    runtime: &RuntimeProgramDataHeaderV2,
    deployment: &CurrentDeploymentStateV1,
    config: &ControllerConfigV1,
) -> ProgramResult {
    // A larger capacity with the same deployed slot and controller authority is
    // the only admitted header drift here. Loader-v3 extension is monotonic and
    // zero-fills appended bytes; byte-level consumers still require a fresh
    // finalized ProgramDataObservationV1 before checkpoint or Loader work.
    if runtime.deployed_slot != deployment.deployed_slot
        || runtime.capacity < deployment.actual_programdata_capacity
        || runtime.authority != Some(config.authority_pda)
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

fn require_guard_deployment(
    capacity: &ProgramDataCapacityPolicyV1,
    deployment: &CurrentDeploymentStateV1,
    expected_capacity_digest: &[u8; 32],
    expected_deployment_digest: &[u8; 32],
    expected_deployment_generation: u64,
) -> ProgramResult {
    if capacity.policy_digest != *expected_capacity_digest
        || deployment.deployment_digest != *expected_deployment_digest
        || deployment.deployment_generation != expected_deployment_generation
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn load_proposal(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    context: &LifecycleContext,
) -> Result<Box<UpgradeProposalV3>, ProgramError> {
    let proposal = load_upgrade_proposal_v3(program_id, info)?;
    validate_upgrade_proposal_digest_v3(&proposal)?;
    let expected = derive_proposal_pda(
        program_id,
        &context.config.target_program,
        proposal.proposal_id,
    );
    if expected != (*info.key, proposal.bump)
        || proposal.controller_program != *program_id
        || proposal.controller_config != *config_info.key
        || proposal.protocol_gate != *gate_info.key
        || proposal.capacity_policy != *capacity_info.key
        || proposal.capacity_policy_digest != context.capacity.policy_digest
        || proposal.current_deployment_state != *deployment_info.key
        || proposal.cluster_domain != context.config.cluster_domain
        || proposal.target_program != context.config.target_program
        || proposal.target_programdata != context.config.target_programdata
        || proposal.upgradeable_loader != context.config.upgradeable_loader
        || proposal.authority_pda != context.config.authority_pda
        || proposal.canonical_spill_treasury != context.config.canonical_spill_treasury
        || proposal.policy_version != context.config.current_policy_version
        || proposal.maximum_supported_raw_programdata_length
            != context.capacity.maximum_raw_programdata_length
        || proposal.programdata_observation_scheme_id != context.capacity.observation_scheme_id
        || proposal.artifact_scheme_id != context.capacity.artifact_scheme_id
        || proposal.artifact_chunk_size != context.capacity.artifact_chunk_size
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(proposal)
}

fn require_proposal_deployment_current(
    proposal: &UpgradeProposalV3,
    deployment: &CurrentDeploymentStateV1,
) -> ProgramResult {
    if proposal.current_deployment_digest != deployment.deployment_digest
        || proposal.current_deployment_generation != deployment.deployment_generation
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

fn check_proposal_guard(
    expected: &ProposalGuardV3,
    proposal: &UpgradeProposalV3,
    context: &LifecycleContext,
) -> ProgramResult {
    require_guard_deployment(
        &context.capacity,
        &context.deployment,
        &expected.expected_capacity_policy_digest,
        &expected.expected_current_deployment_digest,
        expected.expected_current_deployment_generation,
    )?;
    if expected.expected_proposal_digest != proposal.proposal_digest
        || expected.expected_state != proposal.state
        || expected.expected_gate_status != context.gate.status
        || expected.expected_gate_epoch != context.gate.epoch
        || expected.expected_target_nonce != context.config.target_nonce
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_creation_gate(
    proposal: &UpgradeProposalV3,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
) -> ProgramResult {
    if proposal.target_nonce != config.target_nonce
        || proposal.creation_gate_status != gate.status
        || proposal.creation_gate_epoch != gate.epoch
        || gate.active_proposal != Pubkey::default()
        || (gate.status == GateStatusV1::EmergencyFrozen
            && gate.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1)
        || !matches!(
            gate.status,
            GateStatusV1::Active | GateStatusV1::EmergencyFrozen
        )
    {
        return Err(GovernanceError::InvalidProposalEpoch.into());
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
    proposal: &UpgradeProposalV3,
    config: &ControllerConfigV1,
) -> ProgramResult {
    if derive_proposal_timing(config, proposal.proposal_class, proposal.creation_slot)?
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

fn require_approval_window(proposal: &UpgradeProposalV3, slot: u64) -> ProgramResult {
    if slot < proposal.review_start_slot
        || slot > proposal.review_end_slot
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

fn require_exact_recorded_quorum(
    council: &GovernanceCouncilSetV1,
    bitset: u8,
    count: u8,
    approval_slot: u64,
) -> ProgramResult {
    if bitset & !VALID_APPROVAL_MASK != 0
        || bitset.count_ones() as u8 != count
        || count != RELEASE1_APPROVAL_THRESHOLD
        || !council.active_at(approval_slot)
    {
        return Err(GovernanceError::QuorumNotSatisfied.into());
    }
    for (index, seat) in council.seats.iter().enumerate() {
        if bitset & (1u8 << index) != 0 && !seat.term_covers(approval_slot) {
            return Err(GovernanceError::InactiveCouncilSeat.into());
        }
    }
    Ok(())
}

fn is_prefreeze_state(state: ProposalStateV2) -> bool {
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

pub fn process_create_proposal_v3(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateProposalV3,
) -> ProgramResult {
    exact_account_count(accounts, 17)?;
    all_distinct(accounts)?;
    let [payer, creator, config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, target_program, target_programdata, loader, authority, spill, buffer, uploader, proposal_info, system_program_info] =
        accounts
    else {
        unreachable!("account count checked")
    };

    signer_writable(payer)?;
    validate_seat_authority(creator)?;
    writable(config_info)?;
    for info in [
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        deployment_info,
        authority,
        spill,
        buffer,
        uploader,
    ] {
        readonly(info)?;
    }
    executable_readonly(target_program)?;
    readonly(target_programdata)?;
    executable_readonly(loader)?;
    writable(proposal_info)?;
    system_program_account(system_program_info)?;

    let slot = current_slot()?;
    let mut config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info, &config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &config,
        &policy,
        slot,
    )?;
    let gate = load_gate(program_id, gate_info, config_info, &config)?;
    let capacity = load_capacity_policy(program_id, capacity_info, config_info, &config)?;
    let deployment = load_current_deployment(
        program_id,
        deployment_info,
        config_info,
        capacity_info,
        &config,
        &capacity,
    )?;
    if *creator.key == config.guardian
        || !council
            .seats
            .iter()
            .any(|seat| seat.seat_authority == *creator.key && seat.term_covers(slot))
        || !council.active_at(slot)
    {
        return Err(GovernanceError::InactiveCouncilSeat.into());
    }
    if !matches!(
        gate.status,
        GateStatusV1::Active | GateStatusV1::EmergencyFrozen
    ) || gate.active_proposal != Pubkey::default()
        || (gate.status == GateStatusV1::EmergencyFrozen
            && gate.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1)
    {
        return Err(GovernanceError::InvalidGateState.into());
    }
    if *loader.key != config.upgradeable_loader
        || *authority.key != config.authority_pda
        || *spill.key != config.canonical_spill_treasury
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let runtime =
        read_runtime_programdata_header(target_program, target_programdata, &config, &capacity)?;
    require_runtime_matches_trusted_deployment(&runtime, &deployment, &config)?;
    let buffer_header = validate_buffer_account(buffer, &config.upgradeable_loader)?;

    let manifest = &instruction.manifest;
    let expected_proposal =
        derive_proposal_pda(program_id, &config.target_program, config.next_proposal_id);
    let expected_prestate =
        derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Prestate).0;
    let expected_poststate =
        derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Poststate).0;
    let (review_start_slot, review_end_slot, not_before_slot, expiry_slot) =
        derive_proposal_timing(&config, manifest.proposal_class, slot)?;
    if slot > manifest.plan_valid_until_slot
        || expected_proposal.0 != *proposal_info.key
        || manifest.expected_proposal_id != config.next_proposal_id
        || manifest.expected_target_nonce != config.target_nonce
        || manifest.expected_gate_status != gate.status
        || manifest.expected_gate_epoch != gate.epoch
        || manifest.expected_capacity_policy_digest != capacity.policy_digest
        || manifest.expected_current_deployment_digest != deployment.deployment_digest
        || manifest.expected_current_deployment_generation != deployment.deployment_generation
        || manifest.expected_policy_version != policy.version
        || manifest.expected_policy_hash != policy.policy_hash
        || manifest.expected_council_version != council.version
        || manifest.expected_council_hash != council.set_hash
        || manifest.artifact_length > capacity.maximum_artifact_length
        || manifest.minimum_required_capacity < manifest.artifact_length
        || manifest.minimum_required_capacity > capacity.maximum_payload_capacity
        || buffer_header.authority != Some(*uploader.key)
        || u64::try_from(buffer_header.payload_length)
            .map_err(|_| GovernanceError::ArithmeticOverflow)?
            != manifest.artifact_length
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let rollback_artifact_scheme_id = if manifest.rollback_proposal.present {
        capacity.artifact_scheme_id
    } else {
        [0; 32]
    };
    let mut candidate = UpgradeProposalV3 {
        discriminator: UPGRADE_PROPOSAL_V3_DISCRIMINATOR,
        account_version: CAPACITY_SAFE_ACCOUNT_VERSION_V3,
        bump: expected_proposal.1,
        initialized: true,
        proposal_class: manifest.proposal_class,
        state: ProposalStateV2::Draft,
        creation_gate_status: gate.status,
        zero_tail_required: capacity.zero_tail_required,
        proposal_flags: 0,
        proposal_id: config.next_proposal_id,
        target_nonce: config.target_nonce,
        creation_slot: slot,
        cluster_domain: config.cluster_domain,
        controller_program: *program_id,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: capacity.policy_digest,
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
        current_deployment_state: *deployment_info.key,
        current_deployment_digest: deployment.deployment_digest,
        current_deployment_generation: deployment.deployment_generation,
        buffer_pubkey: *buffer.key,
        buffer_loader_owner: config.upgradeable_loader,
        buffer_uploader_authority: *uploader.key,
        buffer_final_authority: config.authority_pda,
        buffer_verification: derive_buffer_check_pda(program_id, proposal_info.key).0,
        programdata_verification: derive_programdata_check_pda(program_id, proposal_info.key).0,
        artifact_length: manifest.artifact_length,
        artifact_sha256: manifest.artifact_sha256,
        artifact_chunk_merkle_root: manifest.artifact_chunk_merkle_root,
        artifact_scheme_id: capacity.artifact_scheme_id,
        artifact_chunk_size: capacity.artifact_chunk_size,
        artifact_chunk_count: artifact_chunk_count(
            manifest.artifact_length,
            capacity.artifact_chunk_size,
        )?,
        source_commit_hash: manifest.source_commit_hash,
        source_tree_hash: manifest.source_tree_hash,
        build_input_inventory_hash: manifest.build_input_inventory_hash,
        reproducible_build_receipt_hash: manifest.reproducible_build_receipt_hash,
        package_receipt_hash: manifest.package_receipt_hash,
        release_intent_hash: manifest.release_intent_hash,
        minimum_required_capacity: manifest.minimum_required_capacity,
        maximum_supported_raw_programdata_length: capacity.maximum_raw_programdata_length,
        programdata_observation_scheme_id: capacity.observation_scheme_id,
        prestate_checkpoint: expected_prestate,
        required_poststate_checkpoint: expected_poststate,
        checkpoint_schema_id: manifest.checkpoint_schema_id,
        checkpoint_policy_hash: manifest.checkpoint_policy_hash,
        primary_proposal: manifest.primary_proposal,
        rollback_proposal: manifest.rollback_proposal,
        rollback_buffer: manifest.rollback_buffer,
        rollback_artifact_length: manifest.rollback_artifact_length,
        rollback_artifact_sha256: manifest.rollback_artifact_sha256,
        rollback_artifact_chunk_root: manifest.rollback_artifact_chunk_root,
        rollback_artifact_scheme_id,
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
        proposal_digest_domain_id: UPGRADE_PROPOSAL_V3_DIGEST_DOMAIN_ID,
        proposal_digest: [0; 32],
        cancellation_reason_code: 0,
        terminal_reason_code: 0,
        reserved: [0; UPGRADE_PROPOSAL_V3_RESERVED_LEN],
    };
    candidate.proposal_digest = compute_upgrade_proposal_digest_v3(&candidate)?;
    validate_upgrade_proposal_digest_v3(&candidate)?;
    let next_proposal_id = config
        .next_proposal_id
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if next_proposal_id == u64::MAX {
        return Err(GovernanceError::ArithmeticOverflow.into());
    }
    config.next_proposal_id = next_proposal_id;
    config.validate_static()?;
    let proposal_bytes = encode_fixed_account(&candidate, UpgradeProposalV3::LEN)?;
    let config_bytes = encode_fixed_account(&*config, ControllerConfigV1::LEN)?;

    let proposal_id = candidate.proposal_id.to_le_bytes();
    let bump = [candidate.bump];
    let seeds: [&[u8]; 5] = [
        UPGRADE_SEED_DOMAIN_V1,
        PROPOSAL_SEED,
        config.target_program.as_ref(),
        &proposal_id,
        &bump,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        proposal_info,
        system_program_info,
        &Rent::get()?,
        UpgradeProposalV3::LEN,
        &seeds,
    )?;
    proposal_info
        .try_borrow_mut_data()?
        .copy_from_slice(&proposal_bytes);
    config_info
        .try_borrow_mut_data()?
        .copy_from_slice(&config_bytes);
    Ok(())
}

fn load_verified_buffer_for_proposal(
    program_id: &Pubkey,
    info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    proposal: &UpgradeProposalV3,
    slot: u64,
) -> Result<Box<BufferVerificationV1>, ProgramError> {
    let verification = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        info,
        BufferVerificationV1::LEN,
    )?;
    verification.validate_schema()?;
    if derive_buffer_check_pda(program_id, proposal_info.key) != (*info.key, verification.bump)
        || proposal.buffer_verification != *info.key
        || verification.controller_config != proposal.controller_config
        || verification.proposal != *proposal_info.key
        || verification.upgradeable_loader != proposal.upgradeable_loader
        || verification.buffer != proposal.buffer_pubkey
        || verification.expected_uploader_authority != proposal.buffer_uploader_authority
        || verification.controller_authority != proposal.authority_pda
        || verification.status != BufferVerificationStatusV1::Verified
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_chunk_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.chunk_hash_domain != proposal.artifact_scheme_id
        || verification.chunk_size != proposal.artifact_chunk_size
        || verification.chunk_count != proposal.artifact_chunk_count
        || verification.finalized_slot == 0
        || verification.finalized_slot > slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

pub fn process_approve_proposal_v3(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveProposalV3,
) -> ProgramResult {
    exact_account_count(accounts, 9)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, proposal_info, buffer_verification_info, seat] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        deployment_info,
        buffer_verification_info,
    ] {
        readonly(info)?;
    }
    writable(proposal_info)?;
    validate_seat_authority(seat)?;

    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    let council = load_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        proposal.creation_council_version,
        &proposal.creation_council_hash,
        slot,
        true,
    )?;
    require_proposal_deployment_current(&proposal, &context.deployment)?;
    check_proposal_guard(&instruction.expected, &proposal, &context)?;
    require_creation_gate(&proposal, &context.config, &context.gate)?;
    require_approval_window(&proposal, slot)?;
    if *seat.key == context.config.guardian
        || proposal.state != ProposalStateV2::BufferVerified
        || instruction.expected_creation_council_version != proposal.creation_council_version
        || instruction.expected_creation_council_hash != proposal.creation_council_hash
        || instruction.expected_approval_bitset != proposal.council_approval_bitset
        || instruction.expected_approval_count != proposal.council_approval_count
        || proposal.council_approval_count >= RELEASE1_APPROVAL_THRESHOLD
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    load_verified_buffer_for_proposal(
        program_id,
        buffer_verification_info,
        proposal_info,
        &proposal,
        slot,
    )?;
    let (bitset, count) = record_seat_approval(
        &council,
        proposal.council_approval_bitset,
        proposal.council_approval_count,
        seat.key,
        slot,
    )?;
    proposal.council_approval_bitset = bitset;
    proposal.council_approval_count = count;
    if proposal.first_approval_slot == 0 {
        proposal.first_approval_slot = slot;
    }
    if count == RELEASE1_APPROVAL_THRESHOLD {
        proposal.state = ProposalStateV2::CouncilApproved;
        proposal.council_approved_slot = slot;
    }
    validate_upgrade_proposal_digest_v3(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV3::LEN,
    )
}

pub fn process_finalize_governance_v3(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FinalizeGovernanceV3,
) -> ProgramResult {
    exact_account_count(accounts, 7)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, proposal_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        deployment_info,
    ] {
        readonly(info)?;
    }
    writable(proposal_info)?;
    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    let council = load_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        proposal.creation_council_version,
        &proposal.creation_council_hash,
        slot,
        false,
    )?;
    require_proposal_deployment_current(&proposal, &context.deployment)?;
    check_proposal_guard(&instruction.expected, &proposal, &context)?;
    require_creation_gate(&proposal, &context.config, &context.gate)?;
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
    validate_upgrade_proposal_digest_v3(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV3::LEN,
    )
}

pub fn process_queue_proposal_v3(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: QueueProposalV3,
) -> ProgramResult {
    exact_account_count(accounts, 6)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, gate_info, capacity_info, deployment_info, proposal_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        gate_info,
        capacity_info,
        deployment_info,
    ] {
        readonly(info)?;
    }
    writable(proposal_info)?;
    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let _policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    require_proposal_deployment_current(&proposal, &context.deployment)?;
    check_proposal_guard(&instruction.expected, &proposal, &context)?;
    require_creation_gate(&proposal, &context.config, &context.gate)?;
    verify_exact_proposal_timing(&proposal, &context.config)?;
    if proposal.state != ProposalStateV2::GovernanceSatisfied
        || proposal.council_approval_count != RELEASE1_APPROVAL_THRESHOLD
        || slot >= proposal.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    proposal.state = ProposalStateV2::Timelocked;
    proposal.queued_slot = slot;
    validate_upgrade_proposal_digest_v3(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV3::LEN,
    )
}

#[allow(clippy::too_many_arguments)]
fn validate_prepared_rollback_v3(
    program_id: &Pubkey,
    context: &LifecycleContext,
    primary_info: &AccountInfo<'_>,
    primary: &UpgradeProposalV3,
    rollback_info: &AccountInfo<'_>,
    verification_info: &AccountInfo<'_>,
    buffer_info: &AccountInfo<'_>,
    slot: u64,
) -> ProgramResult {
    // The builder carries no duplicate singleton accounts for the rollback, so
    // validate its embedded identities against the already validated primary
    // context after strict decoding and digest verification.
    let rollback = load_upgrade_proposal_v3(program_id, rollback_info)?;
    validate_upgrade_proposal_digest_v3(&rollback)?;
    let rollback_pda = derive_proposal_pda(
        program_id,
        &context.config.target_program,
        rollback.proposal_id,
    );
    if rollback_pda != (*rollback_info.key, rollback.bump)
        || rollback.controller_program != *program_id
        || rollback.controller_config != primary.controller_config
        || rollback.protocol_gate != primary.protocol_gate
        || rollback.capacity_policy != primary.capacity_policy
        || rollback.capacity_policy_digest != context.capacity.policy_digest
        || rollback.current_deployment_state != primary.current_deployment_state
        || rollback.current_deployment_digest != primary.current_deployment_digest
        || rollback.current_deployment_generation != primary.current_deployment_generation
        || rollback.target_program != context.config.target_program
        || rollback.target_programdata != context.config.target_programdata
        || rollback.upgradeable_loader != context.config.upgradeable_loader
        || rollback.authority_pda != context.config.authority_pda
        || rollback.canonical_spill_treasury != context.config.canonical_spill_treasury
        || rollback.maximum_supported_raw_programdata_length
            != context.capacity.maximum_raw_programdata_length
        || rollback.programdata_observation_scheme_id != context.capacity.observation_scheme_id
        || rollback.artifact_scheme_id != context.capacity.artifact_scheme_id
        || rollback.artifact_chunk_size != context.capacity.artifact_chunk_size
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let verification = load_verified_buffer_for_proposal(
        program_id,
        verification_info,
        rollback_info,
        &rollback,
        slot,
    )?;
    verify_exact_proposal_timing(&rollback, &context.config)?;
    if !primary.rollback_proposal.present
        || primary.rollback_proposal.value != *rollback_info.key
        || !primary.rollback_buffer.present
        || primary.rollback_buffer.value != *buffer_info.key
        || rollback.proposal_class != ProposalClassV1::EmergencyRollback
        || !rollback.primary_proposal.present
        || rollback.primary_proposal.value != *primary_info.key
        || rollback.rollback_proposal.present
        || rollback.rollback_buffer.present
        || rollback.state != ProposalStateV2::Timelocked
        || rollback.target_nonce != primary.target_nonce
        || rollback.creation_council_version != primary.creation_council_version
        || rollback.creation_council_hash != primary.creation_council_hash
        || rollback.checkpoint_schema_id != primary.checkpoint_schema_id
        || rollback.checkpoint_policy_hash != primary.checkpoint_policy_hash
        || rollback.buffer_pubkey != *buffer_info.key
        || rollback.buffer_verification != *verification_info.key
        || rollback.programdata_verification
            != derive_programdata_check_pda(program_id, rollback_info.key).0
        || rollback.prestate_checkpoint
            != derive_checkpoint_pda(program_id, rollback_info.key, CheckpointPhaseV1::Prestate).0
        || rollback.required_poststate_checkpoint
            != derive_checkpoint_pda(program_id, rollback_info.key, CheckpointPhaseV1::Poststate).0
        || primary.rollback_artifact_length != rollback.artifact_length
        || primary.rollback_artifact_sha256 != rollback.artifact_sha256
        || primary.rollback_artifact_chunk_root != rollback.artifact_chunk_merkle_root
        || primary.rollback_artifact_scheme_id != rollback.artifact_scheme_id
        || rollback.council_approval_count != RELEASE1_APPROVAL_THRESHOLD
        || rollback.governance_satisfied_slot == 0
        || rollback.queued_slot == 0
        || slot >= rollback.expiry_slot
        || verification.status != BufferVerificationStatusV1::Verified
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let rollback_ready = slot
        .checked_add(context.config.rollback_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let primary_runway = primary
        .expiry_slot
        .checked_add(context.config.rollback_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if rollback_ready >= rollback.expiry_slot || rollback.expiry_slot <= primary_runway {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let header = validate_buffer_account(buffer_info, &context.config.upgradeable_loader)?;
    let data = buffer_info.try_borrow_data()?;
    let header_hash = hashv(&[&data[..LOADER_BUFFER_METADATA_LEN]]).to_bytes();
    if header.authority != Some(context.config.authority_pda)
        || u64::try_from(header.payload_length).map_err(|_| GovernanceError::ArithmeticOverflow)?
            != rollback.artifact_length
        || header_hash != verification.sealed_buffer_header_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_freeze_execution_runway(
    needs_extension: bool,
    expiry_slot: u64,
    review_slots: u64,
    slot: u64,
) -> ProgramResult {
    let execution_slots = if needs_extension { 2 } else { 1 };
    let horizon = slot
        .checked_add(review_slots)
        .and_then(|value| value.checked_add(execution_slots))
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if horizon >= expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(())
}

pub fn process_freeze_proposal_v3(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FreezeProposalV3,
) -> ProgramResult {
    exact_account_count(accounts, 14)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, proposal_info, target_program, target_programdata, loader, authority, rollback_info, rollback_verification_info, rollback_buffer] =
        accounts
    else {
        unreachable!("account count checked")
    };
    writable(config_info)?;
    for info in [policy_info, council_info, capacity_info, deployment_info] {
        readonly(info)?;
    }
    writable(gate_info)?;
    writable(proposal_info)?;
    executable_readonly(target_program)?;
    readonly(target_programdata)?;
    executable_readonly(loader)?;
    for info in [
        authority,
        rollback_info,
        rollback_verification_info,
        rollback_buffer,
    ] {
        readonly(info)?;
    }
    let slot = current_slot()?;
    let mut context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    require_proposal_deployment_current(&proposal, &context.deployment)?;
    let council = load_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        proposal.creation_council_version,
        &proposal.creation_council_hash,
        slot,
        false,
    )?;
    check_proposal_guard(&instruction.expected, &proposal, &context)?;
    require_creation_gate(&proposal, &context.config, &context.gate)?;
    verify_exact_proposal_timing(&proposal, &context.config)?;
    let next_nonce = context
        .config
        .target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let next_epoch = checked_nonterminal_increment(context.gate.epoch)?;
    if next_nonce == u64::MAX
        || next_epoch == u64::MAX
        || instruction.expected_next_gate_epoch != next_epoch
        || proposal.state != ProposalStateV2::Timelocked
        || proposal.proposal_class == ProposalClassV1::EmergencyRollback
        || slot < proposal.not_before_slot
        || slot >= proposal.expiry_slot
        || proposal.council_approval_count != RELEASE1_APPROVAL_THRESHOLD
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_recorded_quorum(
        &council,
        proposal.council_approval_bitset,
        proposal.council_approval_count,
        proposal.council_approved_slot,
    )?;
    if *loader.key != context.config.upgradeable_loader
        || *authority.key != context.config.authority_pda
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let runtime = read_runtime_programdata_header(
        target_program,
        target_programdata,
        &context.config,
        &context.capacity,
    )?;
    require_runtime_matches_trusted_deployment(&runtime, &context.deployment, &context.config)?;
    require_freeze_execution_runway(
        runtime.capacity < proposal.minimum_required_capacity,
        proposal.expiry_slot,
        context.config.council_review_slots(),
        slot,
    )?;
    validate_prepared_rollback_v3(
        program_id,
        &context,
        proposal_info,
        &proposal,
        rollback_info,
        rollback_verification_info,
        rollback_buffer,
        slot,
    )?;

    context.config.target_nonce = next_nonce;
    context.gate.epoch = next_epoch;
    context.gate.status = GateStatusV1::FrozenForUpgrade;
    context.gate.active_proposal = *proposal_info.key;
    context.gate.freeze_slot = slot;
    context.gate.freeze_reason_code = GOVERNED_UPGRADE_FREEZE_REASON_V3;
    proposal.state = ProposalStateV2::Frozen;
    proposal.freeze_gate_epoch = next_epoch;
    proposal.frozen_slot = slot;
    context.config.validate_static()?;
    context.gate.validate_static()?;
    validate_upgrade_proposal_digest_v3(&proposal)?;
    let config_bytes = encode_fixed_account(&*context.config, ControllerConfigV1::LEN)?;
    let gate_bytes = encode_fixed_account(&*context.gate, ProtocolGateV1::LEN)?;
    let proposal_bytes = encode_fixed_account(&*proposal, UpgradeProposalV3::LEN)?;
    config_info
        .try_borrow_mut_data()?
        .copy_from_slice(&config_bytes);
    gate_info
        .try_borrow_mut_data()?
        .copy_from_slice(&gate_bytes);
    proposal_info
        .try_borrow_mut_data()?
        .copy_from_slice(&proposal_bytes);
    Ok(())
}

pub fn process_cancel_proposal_v3(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CancelProposalV3,
) -> ProgramResult {
    exact_account_count(accounts, 8)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, proposal_info, seat] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        deployment_info,
    ] {
        readonly(info)?;
    }
    writable(proposal_info)?;
    validate_seat_authority(seat)?;
    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    check_proposal_guard(&instruction.expected, &proposal, &context)?;
    if !is_prefreeze_state(proposal.state)
        || slot >= proposal.expiry_slot
        || instruction.cancellation_reason_code == 0
        || instruction.expected_cancellation_approval_bitset
            != proposal.cancellation_approval_bitset
        || instruction.expected_cancellation_approval_count != proposal.cancellation_approval_count
        || *seat.key == context.config.guardian
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let stale = proposal.cancellation_approval_count != 0
        && (proposal.cancellation_council_version != council.version
            || proposal.cancellation_council_hash != council.set_hash);
    if proposal.cancellation_approval_count == 0 {
        if instruction.expected_cancellation_council_version != council.version
            || instruction.expected_cancellation_council_hash != council.set_hash
        {
            return Err(GovernanceError::StaleCouncilVersion.into());
        }
    } else if instruction.expected_cancellation_council_version
        != proposal.cancellation_council_version
        || instruction.expected_cancellation_council_hash != proposal.cancellation_council_hash
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if stale {
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
    validate_upgrade_proposal_digest_v3(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV3::LEN,
    )
}

pub fn process_expire_proposal_v3(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExpireProposalV3,
) -> ProgramResult {
    exact_account_count(accounts, 5)?;
    all_distinct(accounts)?;
    let [config_info, gate_info, capacity_info, deployment_info, proposal_info] = accounts else {
        unreachable!("account count checked")
    };
    for info in [config_info, gate_info, capacity_info, deployment_info] {
        readonly(info)?;
    }
    writable(proposal_info)?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    check_proposal_guard(&instruction.expected, &proposal, &context)?;
    let slot = current_slot()?;
    if !is_prefreeze_state(proposal.state) || slot < proposal.expiry_slot {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    proposal.state = ProposalStateV2::Expired;
    proposal.terminal_slot = slot;
    proposal.terminal_reason_code = PROPOSAL_EXPIRED_TERMINAL_REASON_V1;
    validate_upgrade_proposal_digest_v3(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV3::LEN,
    )
}

#[allow(clippy::too_many_arguments)]
fn expected_programdata_observation_subject_digest(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    expected_subject: &Pubkey,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    capacity: &ProgramDataCapacityPolicyV1,
    expectation: &ProgramDataObservationExpectationV2,
    purpose: ProgramDataObservationPurposeV1,
    generation: u64,
    minimum_required_capacity: u64,
) -> GovernanceResult<[u8; 32]> {
    compute_programdata_observation_subject_digest_v1(
        program_id,
        config_info.key,
        &config.target_program,
        &config.target_programdata,
        purpose,
        expected_subject,
        generation,
        gate_info.key,
        gate.status,
        gate.epoch,
        &gate.active_proposal,
        gate.freeze_slot,
        gate.freeze_reason_code,
        &capacity.policy_digest,
        expectation.artifact_length,
        &expectation.artifact_sha256,
        &expectation.artifact_merkle_root,
        &expectation.artifact_scheme_id,
        minimum_required_capacity,
    )
}

#[allow(clippy::too_many_arguments)]
fn load_fresh_programdata_observation(
    program_id: &Pubkey,
    observation_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    expected_subject: &Pubkey,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    capacity: &ProgramDataCapacityPolicyV1,
    expectation: &ProgramDataObservationExpectationV2,
    purpose: ProgramDataObservationPurposeV1,
    subject_digest: &[u8; 32],
    expected_generation: u64,
    expected_digest: &[u8; 32],
    minimum_required_capacity: u64,
    slot: u64,
) -> Result<Box<ProgramDataObservationV1>, ProgramError> {
    let observation = load_fixed_controller_account::<ProgramDataObservationV1>(
        program_id,
        observation_info,
        ProgramDataObservationV1::LEN,
    )?;
    validate_programdata_observation_digest_v1(&observation)?;
    if derive_programdata_observation_pda(
        program_id,
        &config.target_program,
        purpose as u8,
        subject_digest,
        expected_generation,
    ) != (*observation_info.key, observation.bump)
        || observation.status != ProgramDataObservationStatusV1::Finalized
        || observation.controller_program != *program_id
        || observation.controller_config != *config_info.key
        || observation.capacity_policy != *capacity_info.key
        || observation.capacity_policy_digest != capacity.policy_digest
        || observation.purpose != purpose
        || observation.subject != *expected_subject
        || observation.subject_digest != *subject_digest
        || observation.generation != expected_generation
        || observation.protocol_gate != *gate_info.key
        || observation.gate_status != gate.status
        || observation.gate_epoch != gate.epoch
        || observation.gate_active_proposal != gate.active_proposal
        || observation.gate_freeze_slot != gate.freeze_slot
        || observation.gate_freeze_reason_code != gate.freeze_reason_code
        || observation.target_program != config.target_program
        || observation.target_programdata != config.target_programdata
        || observation.upgradeable_loader != config.upgradeable_loader
        || observation.expected_artifact_length != expectation.artifact_length
        || observation.expected_artifact_sha256 != expectation.artifact_sha256
        || observation.expected_artifact_merkle_root != expectation.artifact_merkle_root
        || observation.expected_artifact_scheme_id != expectation.artifact_scheme_id
        || expectation.artifact_scheme_id != capacity.artifact_scheme_id
        || observation.artifact_chunk_size != capacity.artifact_chunk_size
        || observation.minimum_required_capacity != minimum_required_capacity
        || observation.raw_observation_scheme_id != capacity.observation_scheme_id
        || observation.raw_chunk_size != capacity.observation_chunk_size
        || observation.deployed_slot != expectation.deployed_slot
        || observation.actual_capacity > capacity.maximum_payload_capacity
        || expectation
            .exact_capacity
            .is_some_and(|expected| observation.actual_capacity != expected)
        || observation.upgrade_authority != OptionalPubkeyV1::some(config.authority_pda)?
        || observation.observation_digest != *expected_digest
        || observation.finalized_slot == 0
        || observation.finalized_slot > slot
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let expected_subject = expected_programdata_observation_subject_digest(
        program_id,
        config_info,
        gate_info,
        expected_subject,
        config,
        gate,
        capacity,
        expectation,
        purpose,
        expected_generation,
        minimum_required_capacity,
    )?;
    if expected_subject != observation.subject_digest {
        return Err(GovernanceError::InvalidProgramDataObservation.into());
    }
    Ok(observation)
}

fn require_observation_matches_runtime(
    observation: &ProgramDataObservationV1,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    capacity: &ProgramDataCapacityPolicyV1,
) -> ProgramResult {
    let runtime =
        read_runtime_programdata_header(target_program, target_programdata, config, capacity)?;
    let program_data = target_program.try_borrow_data()?;
    if program_data.len() != LOADER_PROGRAM_ACCOUNT_LEN {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let mut program_header = [0u8; LOADER_PROGRAM_ACCOUNT_LEN];
    program_header.copy_from_slice(&program_data);
    drop(program_data);
    let programdata_data = target_programdata.try_borrow_data()?;
    let mut programdata_header = [0u8; LOADER_PROGRAMDATA_METADATA_LEN];
    programdata_header.copy_from_slice(
        programdata_data
            .get(..LOADER_PROGRAMDATA_METADATA_LEN)
            .ok_or(GovernanceError::StaleProgramDataObservation)?,
    );
    drop(programdata_data);
    if observation.program_owner != *target_program.owner
        || observation.program_executable != target_program.executable
        || observation.program_data_length != LOADER_PROGRAM_ACCOUNT_LEN as u64
        || observation.program_header_snapshot != program_header
        || observation.linked_programdata != config.target_programdata
        || observation.programdata_owner != *target_programdata.owner
        || observation.programdata_executable != target_programdata.executable
        || observation.programdata_header_snapshot != programdata_header
        || observation.deployed_slot != runtime.deployed_slot
        || observation.raw_data_length != runtime.raw_data_length
        || observation.actual_capacity != runtime.capacity
        || observation.upgrade_authority != OptionalPubkeyV1::some(config.authority_pda)?
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_emergency_freeze_observation(
    program_id: &Pubkey,
    observation_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    context: &LifecycleContext,
) -> Result<Box<EmergencyFreezeObservationV2>, ProgramError> {
    let observation = load_fixed_controller_account::<EmergencyFreezeObservationV2>(
        program_id,
        observation_info,
        EmergencyFreezeObservationV2::LEN,
    )?;
    validate_emergency_freeze_observation_digest_v2(&observation)?;
    if derive_emergency_freeze_observation_pda(
        program_id,
        &context.config.target_program,
        context.gate.epoch,
    ) != (*observation_info.key, observation.bump)
        || context.gate.status != GateStatusV1::EmergencyFrozen
        || context.gate.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
        || context.gate.active_proposal != Pubkey::default()
        || observation.controller_program != *program_id
        || observation.controller_config != *config_info.key
        || observation.protocol_gate != *gate_info.key
        || observation.target_program != context.config.target_program
        || observation.target_programdata != context.config.target_programdata
        || observation.upgradeable_loader != context.config.upgradeable_loader
        || observation.controller_authority != context.config.authority_pda
        || observation.capacity_policy != *capacity_info.key
        || observation.capacity_policy_digest != context.capacity.policy_digest
        || observation.current_deployment_state != *deployment_info.key
        || observation.current_deployment_digest != context.deployment.deployment_digest
        || observation.current_deployment_generation != context.deployment.deployment_generation
        || observation.trusted_artifact_length != context.deployment.artifact_length
        || observation.trusted_artifact_sha256 != context.deployment.artifact_sha256
        || observation.trusted_artifact_merkle_root != context.deployment.artifact_merkle_root
        || observation.trusted_artifact_scheme_id != context.deployment.artifact_scheme_id
        || observation.minimum_required_capacity != context.deployment.artifact_length
        || observation.frozen_epoch != context.gate.epoch
        || observation.freeze_slot != context.gate.freeze_slot
        || observation.freeze_reason_code != context.gate.freeze_reason_code
        || observation.target_nonce != context.config.target_nonce
        || observation.deployed_programdata_slot != context.deployment.deployed_slot
        || observation.actual_capacity != context.deployment.actual_programdata_capacity
        || observation.observed_authority != OptionalPubkeyV1::some(context.config.authority_pda)?
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(observation)
}

pub fn process_guardian_freeze_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: GuardianFreezeV2,
) -> ProgramResult {
    exact_account_count(accounts, 12)?;
    all_distinct(accounts)?;
    let [payer, config_info, gate_info, capacity_info, deployment_info, target_program, target_programdata, loader, authority, guardian, observation_info, system_program_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    signer_writable(payer)?;
    for info in [
        config_info,
        capacity_info,
        deployment_info,
        target_programdata,
        authority,
    ] {
        readonly(info)?;
    }
    writable(gate_info)?;
    executable_readonly(target_program)?;
    executable_readonly(loader)?;
    signer_readonly(guardian)?;
    writable(observation_info)?;
    system_program_account(system_program_info)?;

    let slot = current_slot()?;
    let mut context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let manifest = &instruction.manifest;
    require_guard_deployment(
        &context.capacity,
        &context.deployment,
        &manifest.expected_capacity_policy_digest,
        &manifest.expected_current_deployment_digest,
        manifest.expected_current_deployment_generation,
    )?;
    if slot > manifest.plan_valid_until_slot
        || context.gate.status != GateStatusV1::Active
        || context.gate.active_proposal != Pubkey::default()
        || context.gate.epoch != manifest.expected_gate_epoch
        || context.config.target_nonce != manifest.expected_target_nonce
        || manifest.freeze_reason_code == BOOTSTRAP_INITIALIZATION_FREEZE_REASON_V1
        || *guardian.key != context.config.guardian
        || *loader.key != context.config.upgradeable_loader
        || *authority.key != context.config.authority_pda
    {
        return Err(GovernanceError::InvalidGateState.into());
    }
    let runtime = read_runtime_programdata_header(
        target_program,
        target_programdata,
        &context.config,
        &context.capacity,
    )?;
    require_runtime_matches_trusted_deployment(&runtime, &context.deployment, &context.config)?;
    if runtime.capacity != context.deployment.actual_programdata_capacity {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let next_epoch = checked_nonterminal_increment(context.gate.epoch)?;
    let (expected_observation, observation_bump) = derive_emergency_freeze_observation_pda(
        program_id,
        &context.config.target_program,
        next_epoch,
    );
    if *observation_info.key != expected_observation {
        return Err(GovernanceError::InvalidPda.into());
    }
    let mut observation = EmergencyFreezeObservationV2 {
        discriminator: EMERGENCY_FREEZE_OBSERVATION_V2_DISCRIMINATOR,
        account_version: CAPACITY_SAFE_ACCOUNT_VERSION_V2,
        bump: observation_bump,
        initialized: true,
        finalized: true,
        controller_program: *program_id,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        target_program: context.config.target_program,
        target_programdata: context.config.target_programdata,
        upgradeable_loader: context.config.upgradeable_loader,
        controller_authority: context.config.authority_pda,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: context.capacity.policy_digest,
        current_deployment_state: *deployment_info.key,
        current_deployment_digest: context.deployment.deployment_digest,
        current_deployment_generation: context.deployment.deployment_generation,
        trusted_artifact_length: context.deployment.artifact_length,
        trusted_artifact_sha256: context.deployment.artifact_sha256,
        trusted_artifact_merkle_root: context.deployment.artifact_merkle_root,
        trusted_artifact_scheme_id: context.deployment.artifact_scheme_id,
        minimum_required_capacity: context.deployment.artifact_length,
        frozen_epoch: next_epoch,
        freeze_slot: slot,
        freeze_reason_code: manifest.freeze_reason_code,
        target_nonce: context.config.target_nonce,
        actual_program_owner: *target_program.owner,
        actual_program_executable: target_program.executable,
        actual_program_data_length: u64::try_from(target_program.data_len())
            .map_err(|_| GovernanceError::ArithmeticOverflow)?,
        program_header_present: true,
        actual_linked_programdata: context.config.target_programdata,
        actual_programdata_owner: *target_programdata.owner,
        actual_programdata_executable: target_programdata.executable,
        actual_programdata_data_length: runtime.raw_data_length,
        programdata_header_present: true,
        deployed_programdata_slot: runtime.deployed_slot,
        actual_capacity: runtime.capacity,
        observed_authority: OptionalPubkeyV1::some(context.config.authority_pda)?,
        observation_digest_domain_id: EMERGENCY_FREEZE_OBSERVATION_V2_DIGEST_DOMAIN_ID,
        observation_digest: [0; 32],
        finalized_slot: slot,
        reserved: [0; EMERGENCY_FREEZE_OBSERVATION_V2_RESERVED_LEN],
    };
    observation.observation_digest = compute_emergency_freeze_observation_digest_v2(&observation)?;
    validate_emergency_freeze_observation_digest_v2(&observation)?;
    context.gate.status = GateStatusV1::EmergencyFrozen;
    context.gate.epoch = next_epoch;
    context.gate.active_proposal = Pubkey::default();
    context.gate.freeze_slot = slot;
    context.gate.freeze_reason_code = manifest.freeze_reason_code;
    context.gate.validate_static()?;
    let observation_bytes = encode_fixed_account(&observation, EmergencyFreezeObservationV2::LEN)?;
    let gate_bytes = encode_fixed_account(&*context.gate, ProtocolGateV1::LEN)?;
    let epoch = next_epoch.to_le_bytes();
    let bump = [observation_bump];
    let seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        EMERGENCY_FREEZE_OBSERVATION_SEED,
        context.config.target_program.as_ref(),
        &epoch,
        &bump,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        observation_info,
        system_program_info,
        &Rent::get()?,
        EmergencyFreezeObservationV2::LEN,
        seeds,
    )?;
    observation_info
        .try_borrow_mut_data()?
        .copy_from_slice(&observation_bytes);
    gate_info
        .try_borrow_mut_data()?
        .copy_from_slice(&gate_bytes);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_emergency_resolution(
    program_id: &Pubkey,
    resolution_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    context: &LifecycleContext,
) -> Result<Box<EmergencyFreezeResolutionV2>, ProgramError> {
    let resolution = load_fixed_controller_account::<EmergencyFreezeResolutionV2>(
        program_id,
        resolution_info,
        EmergencyFreezeResolutionV2::LEN,
    )?;
    validate_emergency_freeze_resolution_digest_v2(&resolution)?;
    if derive_emergency_resolution_v2_pda(
        program_id,
        &context.config.target_program,
        resolution.frozen_epoch,
        resolution.approval_council_version,
    ) != (*resolution_info.key, resolution.bump)
        || resolution.controller_config != *config_info.key
        || resolution.protocol_gate != *gate_info.key
        || resolution.target_program != context.config.target_program
        || resolution.target_programdata != context.config.target_programdata
        || resolution.upgradeable_loader != context.config.upgradeable_loader
        || resolution.controller_authority != context.config.authority_pda
        || resolution.capacity_policy != *capacity_info.key
        || resolution.capacity_policy_digest != context.capacity.policy_digest
        || resolution.current_deployment_state != *deployment_info.key
        || resolution.current_deployment_digest != context.deployment.deployment_digest
        || resolution.current_deployment_generation != context.deployment.deployment_generation
        || resolution.frozen_epoch != context.gate.epoch
        || resolution.freeze_slot != context.gate.freeze_slot
        || resolution.freeze_reason_code != context.gate.freeze_reason_code
        || resolution.target_nonce != context.config.target_nonce
        || resolution.artifact_length != context.deployment.artifact_length
        || resolution.artifact_sha256 != context.deployment.artifact_sha256
        || resolution.artifact_merkle_root != context.deployment.artifact_merkle_root
        || resolution.artifact_scheme_id != context.deployment.artifact_scheme_id
        || resolution.minimum_required_capacity != context.deployment.artifact_length
        || resolution.emergency_checkpoint
            != derive_emergency_checkpoint_v2_pda(program_id, resolution_info.key).0
        || context.gate.status != GateStatusV1::EmergencyFrozen
        || context.gate.active_proposal != Pubkey::default()
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(resolution)
}

fn check_emergency_resolution_guard(
    expected: &EmergencyResolutionGuardV2,
    resolution: &EmergencyFreezeResolutionV2,
    context: &LifecycleContext,
) -> ProgramResult {
    require_guard_deployment(
        &context.capacity,
        &context.deployment,
        &expected.expected_capacity_policy_digest,
        &expected.expected_current_deployment_digest,
        expected.expected_current_deployment_generation,
    )?;
    if expected.expected_resolution_digest != resolution.resolution_digest
        || expected.expected_state != resolution.state
        || expected.expected_gate_status != context.gate.status
        || expected.expected_gate_epoch != context.gate.epoch
        || expected.expected_target_nonce != context.config.target_nonce
        || expected.expected_freeze_observation_digest
            != resolution.emergency_freeze_observation_digest
        || expected.expected_programdata_observation_digest != resolution.observation_digest
        || expected.expected_observation_generation != resolution.observation_generation
        || expected.expected_checkpoint_digest != resolution.emergency_checkpoint_digest
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_accepted_emergency_checkpoint(
    program_id: &Pubkey,
    checkpoint_info: &AccountInfo<'_>,
    resolution_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    observation_info: &AccountInfo<'_>,
    council: &GovernanceCouncilSetV1,
    context: &LifecycleContext,
    resolution: &EmergencyFreezeResolutionV2,
) -> Result<Box<StateCheckpointV2>, ProgramError> {
    let checkpoint = load_fixed_controller_account::<StateCheckpointV2>(
        program_id,
        checkpoint_info,
        StateCheckpointV2::LEN,
    )?;
    validate_state_checkpoint_digest_v2(&checkpoint)?;
    if derive_emergency_checkpoint_v2_pda(program_id, resolution_info.key)
        != (*checkpoint_info.key, checkpoint.bump)
        || resolution.emergency_checkpoint != *checkpoint_info.key
        || resolution.emergency_checkpoint_digest != checkpoint.checkpoint_digest
        || checkpoint.phase != StateCheckpointPhaseV1::Emergency
        || checkpoint.controller_config != *config_info.key
        || checkpoint.proposal != Pubkey::default()
        || checkpoint.emergency_resolution != *resolution_info.key
        || checkpoint.subject_digest != resolution.resolution_digest
        || checkpoint.target_program != context.config.target_program
        || checkpoint.target_programdata != context.config.target_programdata
        || checkpoint.capacity_policy != *capacity_info.key
        || checkpoint.capacity_policy_digest != context.capacity.policy_digest
        || checkpoint.current_deployment_state != *deployment_info.key
        || checkpoint.current_deployment_digest != context.deployment.deployment_digest
        || checkpoint.current_deployment_generation != context.deployment.deployment_generation
        || checkpoint.programdata_observation != *observation_info.key
        || checkpoint.observation_purpose != ProgramDataObservationPurposeV1::EmergencyResolution
        || checkpoint.observation_generation != resolution.observation_generation
        || checkpoint.observation_subject_digest != resolution.observation_subject_digest
        || checkpoint.observation_root != resolution.observation_root
        || checkpoint.observation_digest != resolution.observation_digest
        || checkpoint.observation_finalized_slot != resolution.observation_finalized_slot
        || checkpoint.gate_epoch != context.gate.epoch
        || checkpoint.target_programdata_slot != resolution.observed_deployed_slot
        || checkpoint.actual_capacity != resolution.actual_capacity
        || checkpoint.observed_authority != resolution.observed_authority
        || checkpoint.approval_council_version != council.version
        || checkpoint.approval_council_hash != council.set_hash
        || checkpoint.approval_count != RELEASE1_APPROVAL_THRESHOLD
        || !checkpoint.accepted
        || checkpoint.forbidden_drift_count != 0
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(checkpoint)
}

pub fn process_create_emergency_resolution_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateEmergencyResolutionV2,
) -> ProgramResult {
    exact_account_count(accounts, 12)?;
    all_distinct(accounts)?;
    let [payer, creator, config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, freeze_observation_info, programdata_observation_info, resolution_info, system_program_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    signer_writable(payer)?;
    validate_seat_authority(creator)?;
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        deployment_info,
        freeze_observation_info,
        programdata_observation_info,
    ] {
        readonly(info)?;
    }
    writable(resolution_info)?;
    system_program_account(system_program_info)?;

    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    if *creator.key == context.config.guardian
        || !council
            .seats
            .iter()
            .any(|seat| seat.seat_authority == *creator.key && seat.term_covers(slot))
    {
        return Err(GovernanceError::InactiveCouncilSeat.into());
    }
    let freeze_observation = load_emergency_freeze_observation(
        program_id,
        freeze_observation_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    let manifest = &instruction.manifest;
    require_guard_deployment(
        &context.capacity,
        &context.deployment,
        &manifest.expected_capacity_policy_digest,
        &manifest.expected_current_deployment_digest,
        manifest.expected_current_deployment_generation,
    )?;
    if slot > manifest.plan_valid_until_slot
        || context.gate.epoch != manifest.expected_gate_epoch
        || context.config.target_nonce != manifest.expected_target_nonce
        || freeze_observation.observation_digest != manifest.expected_freeze_observation_digest
        || policy.version != manifest.expected_policy_version
        || policy.policy_hash != manifest.expected_policy_hash
        || council.version != manifest.expected_council_version
        || council.set_hash != manifest.expected_council_hash
        || slot < context.gate.freeze_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let observation_expectation = trusted_observation_expectation(&context.deployment);
    let observation_subject_digest = expected_programdata_observation_subject_digest(
        program_id,
        config_info,
        gate_info,
        freeze_observation_info.key,
        &context.config,
        &context.gate,
        &context.capacity,
        &observation_expectation,
        ProgramDataObservationPurposeV1::EmergencyResolution,
        manifest.expected_programdata_observation_generation,
        context.deployment.artifact_length,
    )?;
    let observation = load_fresh_programdata_observation(
        program_id,
        programdata_observation_info,
        config_info,
        gate_info,
        capacity_info,
        freeze_observation_info.key,
        &context.config,
        &context.gate,
        &context.capacity,
        &observation_expectation,
        ProgramDataObservationPurposeV1::EmergencyResolution,
        &observation_subject_digest,
        manifest.expected_programdata_observation_generation,
        &manifest.expected_programdata_observation_digest,
        context.deployment.artifact_length,
        slot,
    )?;
    let (expected_resolution, resolution_bump) = derive_emergency_resolution_v2_pda(
        program_id,
        &context.config.target_program,
        context.gate.epoch,
        council.version,
    );
    if *resolution_info.key != expected_resolution {
        return Err(GovernanceError::InvalidPda.into());
    }
    let review_start_slot = slot
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let review_end_slot = review_start_slot
        .checked_add(context.config.council_review_slots())
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let delay_end = context
        .gate
        .freeze_slot
        .checked_add(context.config.routine_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let not_before_slot = review_end_slot.max(delay_end);
    let expiry_slot = context
        .gate
        .freeze_slot
        .checked_add(context.config.proposal_expiry_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if not_before_slot >= expiry_slot || slot >= expiry_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let mut resolution = EmergencyFreezeResolutionV2 {
        discriminator: EMERGENCY_FREEZE_RESOLUTION_V2_DISCRIMINATOR,
        account_version: CAPACITY_SAFE_ACCOUNT_VERSION_V2,
        bump: resolution_bump,
        initialized: true,
        state: EmergencyFreezeResolutionStateV1::Draft,
        controller_config: *config_info.key,
        protocol_gate: *gate_info.key,
        target_program: context.config.target_program,
        target_programdata: context.config.target_programdata,
        upgradeable_loader: context.config.upgradeable_loader,
        controller_authority: context.config.authority_pda,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: context.capacity.policy_digest,
        current_deployment_state: *deployment_info.key,
        current_deployment_digest: context.deployment.deployment_digest,
        current_deployment_generation: context.deployment.deployment_generation,
        emergency_freeze_observation: *freeze_observation_info.key,
        emergency_freeze_observation_digest: freeze_observation.observation_digest,
        frozen_epoch: context.gate.epoch,
        freeze_slot: context.gate.freeze_slot,
        freeze_reason_code: context.gate.freeze_reason_code,
        resolution_kind: manifest.resolution_kind,
        creation_slot: slot,
        review_start_slot,
        review_end_slot,
        not_before_slot,
        expiry_slot,
        target_nonce: context.config.target_nonce,
        artifact_length: context.deployment.artifact_length,
        artifact_sha256: context.deployment.artifact_sha256,
        artifact_merkle_root: context.deployment.artifact_merkle_root,
        artifact_scheme_id: context.deployment.artifact_scheme_id,
        minimum_required_capacity: context.deployment.artifact_length,
        observation_scheme_id: context.capacity.observation_scheme_id,
        programdata_observation: *programdata_observation_info.key,
        observation_purpose: ProgramDataObservationPurposeV1::EmergencyResolution,
        observation_generation: observation.generation,
        observation_subject_digest: observation.subject_digest,
        observation_root: observation.final_raw_merkle_root,
        observation_digest: observation.observation_digest,
        observation_finalized_slot: observation.finalized_slot,
        observed_deployed_slot: observation.deployed_slot,
        observed_raw_data_length: observation.raw_data_length,
        actual_capacity: observation.actual_capacity,
        observed_authority: observation.upgrade_authority,
        emergency_checkpoint: derive_emergency_checkpoint_v2_pda(program_id, resolution_info.key).0,
        emergency_checkpoint_digest: [0; 32],
        approval_council_version: council.version,
        approval_council_hash: council.set_hash,
        approval_bitset: 0,
        approval_count: 0,
        approval_threshold: RELEASE1_APPROVAL_THRESHOLD,
        resolution_digest_domain_id: EMERGENCY_FREEZE_RESOLUTION_V2_DIGEST_DOMAIN_ID,
        resolution_digest: [0; 32],
        first_approval_slot: 0,
        council_approved_slot: 0,
        queued_slot: 0,
        executed_slot: 0,
        terminal_slot: 0,
        terminal_reason_code: 0,
        reserved: [0; EMERGENCY_FREEZE_RESOLUTION_V2_RESERVED_LEN],
    };
    resolution.resolution_digest = compute_emergency_freeze_resolution_digest_v2(&resolution)?;
    validate_emergency_freeze_resolution_digest_v2(&resolution)?;
    let resolution_bytes = encode_fixed_account(&resolution, EmergencyFreezeResolutionV2::LEN)?;
    let epoch = context.gate.epoch.to_le_bytes();
    let council_version = council.version.to_le_bytes();
    let bump = [resolution_bump];
    let seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        EMERGENCY_RESOLUTION_V2_SEED,
        context.config.target_program.as_ref(),
        &epoch,
        &council_version,
        &bump,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        resolution_info,
        system_program_info,
        &Rent::get()?,
        EmergencyFreezeResolutionV2::LEN,
        seeds,
    )?;
    resolution_info
        .try_borrow_mut_data()?
        .copy_from_slice(&resolution_bytes);
    Ok(())
}

type EmergencyEvidenceV2 = (
    Box<EmergencyFreezeObservationV2>,
    Box<ProgramDataObservationV1>,
    Box<StateCheckpointV2>,
);

#[allow(clippy::too_many_arguments)]
fn validate_emergency_evidence(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    freeze_observation_info: &AccountInfo<'_>,
    programdata_observation_info: &AccountInfo<'_>,
    checkpoint_info: &AccountInfo<'_>,
    resolution_info: &AccountInfo<'_>,
    context: &LifecycleContext,
    council: &GovernanceCouncilSetV1,
    resolution: &EmergencyFreezeResolutionV2,
    slot: u64,
) -> Result<EmergencyEvidenceV2, ProgramError> {
    let freeze_observation = load_emergency_freeze_observation(
        program_id,
        freeze_observation_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        context,
    )?;
    if resolution.emergency_freeze_observation != *freeze_observation_info.key
        || resolution.emergency_freeze_observation_digest != freeze_observation.observation_digest
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let observation_expectation = trusted_observation_expectation(&context.deployment);
    let observation = load_fresh_programdata_observation(
        program_id,
        programdata_observation_info,
        config_info,
        gate_info,
        capacity_info,
        freeze_observation_info.key,
        &context.config,
        &context.gate,
        &context.capacity,
        &observation_expectation,
        ProgramDataObservationPurposeV1::EmergencyResolution,
        &resolution.observation_subject_digest,
        resolution.observation_generation,
        &resolution.observation_digest,
        context.deployment.artifact_length,
        slot,
    )?;
    if resolution.programdata_observation != *programdata_observation_info.key
        || resolution.observation_subject_digest != observation.subject_digest
        || resolution.observation_root != observation.final_raw_merkle_root
        || resolution.observation_finalized_slot != observation.finalized_slot
        || resolution.observed_deployed_slot != observation.deployed_slot
        || resolution.observed_raw_data_length != observation.raw_data_length
        || resolution.actual_capacity != observation.actual_capacity
        || resolution.observed_authority != observation.upgrade_authority
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    let checkpoint = load_accepted_emergency_checkpoint(
        program_id,
        checkpoint_info,
        resolution_info,
        config_info,
        capacity_info,
        deployment_info,
        programdata_observation_info,
        council,
        context,
        resolution,
    )?;
    Ok((freeze_observation, observation, checkpoint))
}

pub fn process_approve_emergency_resolution_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveEmergencyResolutionV2,
) -> ProgramResult {
    exact_account_count(accounts, 11)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, freeze_observation_info, programdata_observation_info, checkpoint_info, resolution_info, seat] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        capacity_info,
        deployment_info,
        freeze_observation_info,
        programdata_observation_info,
        checkpoint_info,
    ] {
        readonly(info)?;
    }
    writable(resolution_info)?;
    validate_seat_authority(seat)?;

    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let mut resolution = load_emergency_resolution(
        program_id,
        resolution_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    check_emergency_resolution_guard(&instruction.expected, &resolution, &context)?;
    if resolution.approval_council_version != council.version
        || resolution.approval_council_hash != council.set_hash
        || resolution.state != EmergencyFreezeResolutionStateV1::Draft
        || slot < resolution.review_start_slot
        || slot > resolution.review_end_slot
        || slot >= resolution.expiry_slot
        || instruction.expected_approval_bitset != resolution.approval_bitset
        || instruction.expected_approval_count != resolution.approval_count
        || *seat.key == context.config.guardian
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let (_, _, checkpoint) = validate_emergency_evidence(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        freeze_observation_info,
        programdata_observation_info,
        checkpoint_info,
        resolution_info,
        &context,
        &council,
        &resolution,
        slot,
    )?;
    if resolution.emergency_checkpoint_digest != checkpoint.checkpoint_digest {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let (bitset, count) = record_seat_approval(
        &council,
        resolution.approval_bitset,
        resolution.approval_count,
        seat.key,
        slot,
    )?;
    if resolution.approval_count == 0 {
        resolution.first_approval_slot = slot;
    }
    resolution.approval_bitset = bitset;
    resolution.approval_count = count;
    if count == RELEASE1_APPROVAL_THRESHOLD {
        resolution.state = EmergencyFreezeResolutionStateV1::CouncilApproved;
        resolution.council_approved_slot = slot;
    }
    validate_emergency_freeze_resolution_digest_v2(&resolution)?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &*resolution,
        EmergencyFreezeResolutionV2::LEN,
    )
}

pub fn process_queue_emergency_resolution_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: QueueEmergencyResolutionV2,
) -> ProgramResult {
    exact_account_count(accounts, 10)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, freeze_observation_info, programdata_observation_info, checkpoint_info, resolution_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in &accounts[..9] {
        readonly(info)?;
    }
    writable(resolution_info)?;
    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let mut resolution = load_emergency_resolution(
        program_id,
        resolution_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    check_emergency_resolution_guard(&instruction.expected, &resolution, &context)?;
    if resolution.state != EmergencyFreezeResolutionStateV1::CouncilApproved
        || resolution.approval_council_version != council.version
        || resolution.approval_council_hash != council.set_hash
        || slot >= resolution.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_recorded_quorum(
        &council,
        resolution.approval_bitset,
        resolution.approval_count,
        resolution.council_approved_slot,
    )?;
    validate_emergency_evidence(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        freeze_observation_info,
        programdata_observation_info,
        checkpoint_info,
        resolution_info,
        &context,
        &council,
        &resolution,
        slot,
    )?;
    resolution.state = EmergencyFreezeResolutionStateV1::Timelocked;
    resolution.queued_slot = slot;
    validate_emergency_freeze_resolution_digest_v2(&resolution)?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &*resolution,
        EmergencyFreezeResolutionV2::LEN,
    )
}

pub fn process_execute_emergency_resolution_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExecuteEmergencyResolutionV2,
) -> ProgramResult {
    exact_account_count(accounts, 15)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, capacity_info, deployment_info, resolution_info, freeze_observation_info, programdata_observation_info, checkpoint_info, target_program, target_programdata, loader, authority, instructions_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        capacity_info,
        freeze_observation_info,
        programdata_observation_info,
        checkpoint_info,
        target_programdata,
        authority,
        instructions_info,
    ] {
        readonly(info)?;
    }
    for info in [gate_info, deployment_info, resolution_info] {
        writable(info)?;
    }
    executable_readonly(target_program)?;
    executable_readonly(loader)?;
    if *loader.key != UPGRADEABLE_LOADER_ID
        || *instructions_info.key != sysvar_ids::instructions::ID
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let slot = current_slot()?;
    let mut context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let mut resolution = load_emergency_resolution(
        program_id,
        resolution_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    check_emergency_resolution_guard(&instruction.expected, &resolution, &context)?;
    if resolution.state != EmergencyFreezeResolutionStateV1::Timelocked
        || resolution.resolution_kind != EmergencyFreezeResolutionKindV1::ResumeWithoutUpgrade
        || resolution.approval_council_version != council.version
        || resolution.approval_council_hash != council.set_hash
        || slot < resolution.not_before_slot
        || slot >= resolution.expiry_slot
        || *authority.key != context.config.authority_pda
        || *loader.key != context.config.upgradeable_loader
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    require_exact_recorded_quorum(
        &council,
        resolution.approval_bitset,
        resolution.approval_count,
        resolution.council_approved_slot,
    )?;
    let (_, observation, checkpoint) = validate_emergency_evidence(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        freeze_observation_info,
        programdata_observation_info,
        checkpoint_info,
        resolution_info,
        &context,
        &council,
        &resolution,
        slot,
    )?;
    if checkpoint.finalized_slot > slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    require_observation_matches_runtime(
        &observation,
        target_program,
        target_programdata,
        &context.config,
        &context.capacity,
    )?;
    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &instruction.pack()?,
        &instruction.envelope,
    )?;

    let next_epoch = checked_nonterminal_increment(context.gate.epoch)?;
    let next_deployment_generation =
        checked_nonterminal_increment(context.deployment.deployment_generation)?;
    context.gate.status = GateStatusV1::Active;
    context.gate.epoch = next_epoch;
    context.gate.active_proposal = Pubkey::default();
    context.gate.freeze_slot = 0;
    context.gate.freeze_reason_code = 0;
    context.gate.validate_static()?;

    context.deployment.programdata_observation = *programdata_observation_info.key;
    context.deployment.observation_generation = observation.generation;
    context.deployment.observation_root = observation.final_raw_merkle_root;
    context.deployment.observation_digest = observation.observation_digest;
    context.deployment.deployed_slot = observation.deployed_slot;
    context.deployment.actual_programdata_capacity = observation.actual_capacity;
    context.deployment.installed_authority = context.config.authority_pda;
    context.deployment.gate_epoch_at_activation = next_epoch;
    context.deployment.deployment_generation = next_deployment_generation;
    context.deployment.last_updated_slot = slot;
    context.deployment.deployment_digest =
        compute_current_deployment_digest_v1(&context.deployment)?;
    validate_current_deployment_digest_v1(&context.deployment)?;

    resolution.state = EmergencyFreezeResolutionStateV1::Executed;
    resolution.executed_slot = slot;
    resolution.terminal_slot = slot;
    resolution.terminal_reason_code = EMERGENCY_RESOLUTION_EXECUTED_TERMINAL_REASON_V2;
    validate_emergency_freeze_resolution_digest_v2(&resolution)?;

    let gate_bytes = encode_fixed_account(&*context.gate, ProtocolGateV1::LEN)?;
    let deployment_bytes =
        encode_fixed_account(&*context.deployment, CurrentDeploymentStateV1::LEN)?;
    let resolution_bytes = encode_fixed_account(&*resolution, EmergencyFreezeResolutionV2::LEN)?;
    gate_info
        .try_borrow_mut_data()?
        .copy_from_slice(&gate_bytes);
    deployment_info
        .try_borrow_mut_data()?
        .copy_from_slice(&deployment_bytes);
    resolution_info
        .try_borrow_mut_data()?
        .copy_from_slice(&resolution_bytes);
    Ok(())
}

pub fn process_expire_emergency_resolution_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExpireEmergencyResolutionV2,
) -> ProgramResult {
    exact_account_count(accounts, 5)?;
    all_distinct(accounts)?;
    let [config_info, gate_info, capacity_info, deployment_info, resolution_info] = accounts else {
        unreachable!("account count checked")
    };
    for info in [config_info, gate_info, capacity_info, deployment_info] {
        readonly(info)?;
    }
    writable(resolution_info)?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let mut resolution = load_emergency_resolution(
        program_id,
        resolution_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    check_emergency_resolution_guard(&instruction.expected, &resolution, &context)?;
    let slot = current_slot()?;
    if !matches!(
        resolution.state,
        EmergencyFreezeResolutionStateV1::Draft
            | EmergencyFreezeResolutionStateV1::CouncilApproved
            | EmergencyFreezeResolutionStateV1::Timelocked
    ) || slot < resolution.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    resolution.state = EmergencyFreezeResolutionStateV1::Expired;
    resolution.terminal_slot = slot;
    resolution.terminal_reason_code = EMERGENCY_RESOLUTION_EXPIRED_TERMINAL_REASON_V2;
    validate_emergency_freeze_resolution_digest_v2(&resolution)?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &*resolution,
        EmergencyFreezeResolutionV2::LEN,
    )
}

enum CheckpointSubjectRecord {
    Proposal(Box<UpgradeProposalV3>),
    Emergency(Box<EmergencyFreezeResolutionV2>),
}

struct CheckpointBindingV2 {
    checkpoint: Pubkey,
    bump: u8,
    checkpoint_subject: Pubkey,
    subject_digest: [u8; 32],
    observation_subject: Pubkey,
    observation_subject_digest: [u8; 32],
    expected_observation: Option<Pubkey>,
    purpose: ProgramDataObservationPurposeV1,
    minimum_required_capacity: u64,
    observation_expectation: ProgramDataObservationExpectationV2,
    record: CheckpointSubjectRecord,
}

fn emergency_checkpoint_subjects(
    resolution: Pubkey,
    resolution_digest: [u8; 32],
    freeze_observation: Pubkey,
    observation_subject_digest: [u8; 32],
) -> (Pubkey, [u8; 32], Pubkey, [u8; 32]) {
    (
        resolution,
        resolution_digest,
        freeze_observation,
        observation_subject_digest,
    )
}

#[allow(clippy::too_many_arguments)]
fn load_checkpoint_subject_binding(
    program_id: &Pubkey,
    subject_info: &AccountInfo<'_>,
    linked_primary_or_authority: &AccountInfo<'_>,
    checkpoint_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    context: &LifecycleContext,
    manifest: &CheckpointManifestV2,
) -> Result<CheckpointBindingV2, ProgramError> {
    match manifest.phase {
        StateCheckpointPhaseV1::Prestate | StateCheckpointPhaseV1::Poststate => {
            let proposal = load_proposal(
                program_id,
                subject_info,
                config_info,
                gate_info,
                capacity_info,
                deployment_info,
                context,
            )?;
            let phase = match manifest.phase {
                StateCheckpointPhaseV1::Prestate => CheckpointPhaseV1::Prestate,
                StateCheckpointPhaseV1::Poststate => CheckpointPhaseV1::Poststate,
                StateCheckpointPhaseV1::Emergency => unreachable!(),
            };
            let expected = derive_checkpoint_pda(program_id, subject_info.key, phase);
            let expected_state = match manifest.phase {
                StateCheckpointPhaseV1::Prestate => ProposalStateV2::Frozen,
                StateCheckpointPhaseV1::Poststate => ProposalStateV2::ProgramDataVerified,
                StateCheckpointPhaseV1::Emergency => unreachable!(),
            };
            let consumed_nonce = proposal
                .target_nonce
                .checked_add(1)
                .ok_or(GovernanceError::ArithmeticOverflow)?;
            if expected.0 != *checkpoint_info.key
                || proposal.state != expected_state
                || proposal.freeze_gate_epoch != context.gate.epoch
                || context.gate.status != GateStatusV1::FrozenForUpgrade
                || context.gate.active_proposal != *subject_info.key
                || context.gate.freeze_slot != proposal.frozen_slot
                || context.config.target_nonce != consumed_nonce
                || manifest.expected_subject_digest != proposal.proposal_digest
                || (manifest.phase == StateCheckpointPhaseV1::Prestate
                    && proposal.prestate_checkpoint != *checkpoint_info.key)
                || (manifest.phase == StateCheckpointPhaseV1::Poststate
                    && proposal.required_poststate_checkpoint != *checkpoint_info.key)
            {
                return Err(GovernanceError::InvalidStateTransition.into());
            }
            let purpose = match (manifest.phase, proposal.proposal_class) {
                (StateCheckpointPhaseV1::Prestate, _) => {
                    ProgramDataObservationPurposeV1::ProposalPrestate
                }
                (StateCheckpointPhaseV1::Poststate, ProposalClassV1::EmergencyRollback) => {
                    ProgramDataObservationPurposeV1::Rollback
                }
                (StateCheckpointPhaseV1::Poststate, _) => {
                    ProgramDataObservationPurposeV1::PostUpgrade
                }
                (StateCheckpointPhaseV1::Emergency, _) => unreachable!(),
            };
            let (minimum_required_capacity, observation_expectation) = if manifest.phase
                == StateCheckpointPhaseV1::Prestate
                && proposal.proposal_class == ProposalClassV1::EmergencyRollback
            {
                if !proposal.primary_proposal.present
                    || proposal.primary_proposal.value != *linked_primary_or_authority.key
                {
                    return Err(GovernanceError::InvalidProposalCommitment.into());
                }
                let primary = load_proposal(
                    program_id,
                    linked_primary_or_authority,
                    config_info,
                    gate_info,
                    capacity_info,
                    deployment_info,
                    context,
                )?;
                let primary_next_epoch = checked_nonterminal_increment(primary.freeze_gate_epoch)?;
                if primary.proposal_class == ProposalClassV1::EmergencyRollback
                    || primary.state != ProposalStateV2::UpgradeExecuted
                    || primary.upgrade_executed_slot == 0
                    || primary.upgrade_executed_slot > proposal.frozen_slot
                    || primary_next_epoch != proposal.freeze_gate_epoch
                    || !primary.rollback_proposal.present
                    || primary.rollback_proposal.value != *subject_info.key
                    || !primary.rollback_buffer.present
                    || primary.rollback_buffer.value != proposal.buffer_pubkey
                    || primary.rollback_artifact_length != proposal.artifact_length
                    || primary.rollback_artifact_sha256 != proposal.artifact_sha256
                    || primary.rollback_artifact_chunk_root != proposal.artifact_chunk_merkle_root
                    || primary.rollback_artifact_scheme_id != proposal.artifact_scheme_id
                    || primary.target_nonce != proposal.target_nonce
                    || primary.checkpoint_schema_id != proposal.checkpoint_schema_id
                    || primary.checkpoint_policy_hash != proposal.checkpoint_policy_hash
                {
                    return Err(GovernanceError::InvalidProposalCommitment.into());
                }
                (
                    primary.minimum_required_capacity,
                    failed_primary_observation_expectation(&primary),
                )
            } else {
                if *linked_primary_or_authority.key != context.config.authority_pda {
                    return Err(GovernanceError::CrossAccountMismatch.into());
                }
                let minimum_required_capacity =
                    if manifest.phase == StateCheckpointPhaseV1::Prestate {
                        context.deployment.artifact_length
                    } else {
                        proposal.minimum_required_capacity
                    };
                (
                    minimum_required_capacity,
                    trusted_observation_expectation(&context.deployment),
                )
            };
            let observation_subject_digest = expected_programdata_observation_subject_digest(
                program_id,
                config_info,
                gate_info,
                subject_info.key,
                &context.config,
                &context.gate,
                &context.capacity,
                &observation_expectation,
                purpose,
                manifest.expected_observation_generation,
                minimum_required_capacity,
            )?;
            Ok(CheckpointBindingV2 {
                checkpoint: expected.0,
                bump: expected.1,
                checkpoint_subject: *subject_info.key,
                subject_digest: proposal.proposal_digest,
                observation_subject: *subject_info.key,
                observation_subject_digest,
                expected_observation: None,
                purpose,
                minimum_required_capacity,
                observation_expectation,
                record: CheckpointSubjectRecord::Proposal(proposal),
            })
        }
        StateCheckpointPhaseV1::Emergency => {
            if *linked_primary_or_authority.key != context.config.authority_pda {
                return Err(GovernanceError::CrossAccountMismatch.into());
            }
            let resolution = load_emergency_resolution(
                program_id,
                subject_info,
                config_info,
                gate_info,
                capacity_info,
                deployment_info,
                context,
            )?;
            let expected = derive_emergency_checkpoint_v2_pda(program_id, subject_info.key);
            if expected.0 != *checkpoint_info.key
                || resolution.state != EmergencyFreezeResolutionStateV1::Draft
                || resolution.approval_count != 0
                || resolution.emergency_checkpoint_digest != [0; 32]
                || resolution.emergency_checkpoint != *checkpoint_info.key
                || manifest.expected_subject_digest != resolution.resolution_digest
                || manifest.expected_observation_generation != resolution.observation_generation
                || manifest.expected_observation_digest != resolution.observation_digest
            {
                return Err(GovernanceError::InvalidStateTransition.into());
            }
            let observation_expectation = trusted_observation_expectation(&context.deployment);
            let observation_subject_digest = expected_programdata_observation_subject_digest(
                program_id,
                config_info,
                gate_info,
                &resolution.emergency_freeze_observation,
                &context.config,
                &context.gate,
                &context.capacity,
                &observation_expectation,
                ProgramDataObservationPurposeV1::EmergencyResolution,
                manifest.expected_observation_generation,
                context.deployment.artifact_length,
            )?;
            let (
                checkpoint_subject,
                subject_digest,
                observation_subject,
                observation_subject_digest,
            ) = emergency_checkpoint_subjects(
                *subject_info.key,
                resolution.resolution_digest,
                resolution.emergency_freeze_observation,
                observation_subject_digest,
            );
            Ok(CheckpointBindingV2 {
                checkpoint: expected.0,
                bump: expected.1,
                checkpoint_subject,
                subject_digest,
                observation_subject,
                observation_subject_digest,
                expected_observation: Some(resolution.programdata_observation),
                purpose: ProgramDataObservationPurposeV1::EmergencyResolution,
                minimum_required_capacity: context.deployment.artifact_length,
                observation_expectation,
                record: CheckpointSubjectRecord::Emergency(resolution),
            })
        }
    }
}

fn compute_checkpoint_hard_root_v2(manifest: &CheckpointManifestV2) -> [u8; 32] {
    hashv(&[
        STATE_CHECKPOINT_HARD_ROOT_DOMAIN_V1,
        &manifest.schema_identifier,
        &manifest.program_owned_state_root,
        &manifest.program_owned_state_count.to_le_bytes(),
        &manifest.logical_compressed_state_root,
        &manifest.logical_compressed_state_count.to_le_bytes(),
        &manifest.semantic_custody_accounting_root,
        &manifest.external_metadata_observation_root,
    ])
    .to_bytes()
}

#[allow(clippy::too_many_arguments)]
fn derive_checkpoint_candidate(
    _program_id: &Pubkey,
    manifest: &CheckpointManifestV2,
    binding: &CheckpointBindingV2,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    observation_info: &AccountInfo<'_>,
    context: &LifecycleContext,
    council: &GovernanceCouncilSetV1,
    observation: &ProgramDataObservationV1,
) -> Result<Box<StateCheckpointV2>, ProgramError> {
    if manifest.expected_gate_epoch != context.gate.epoch
        || manifest.expected_capacity_policy_digest != context.capacity.policy_digest
        || manifest.expected_current_deployment_digest != context.deployment.deployment_digest
        || manifest.expected_current_deployment_generation
            != context.deployment.deployment_generation
        || manifest.expected_observation_digest != observation.observation_digest
        || manifest.expected_observation_generation != observation.generation
        || manifest.expected_council_version != council.version
        || manifest.expected_council_hash != council.set_hash
        || manifest.expected_subject_digest != binding.subject_digest
        || manifest.forbidden_drift_count != 0
        || manifest.hard_combined_root != compute_checkpoint_hard_root_v2(manifest)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let (proposal, emergency_resolution) = match &binding.record {
        CheckpointSubjectRecord::Proposal(_) => (binding.checkpoint_subject, Pubkey::default()),
        CheckpointSubjectRecord::Emergency(_) => (Pubkey::default(), binding.checkpoint_subject),
    };
    let mut checkpoint = Box::new(StateCheckpointV2 {
        discriminator: STATE_CHECKPOINT_V2_DISCRIMINATOR,
        account_version: CAPACITY_SAFE_ACCOUNT_VERSION_V2,
        bump: binding.bump,
        initialized: true,
        phase: manifest.phase,
        controller_config: *config_info.key,
        proposal,
        emergency_resolution,
        subject_digest: binding.subject_digest,
        target_program: context.config.target_program,
        target_programdata: context.config.target_programdata,
        capacity_policy: *capacity_info.key,
        capacity_policy_digest: context.capacity.policy_digest,
        current_deployment_state: *deployment_info.key,
        current_deployment_digest: context.deployment.deployment_digest,
        current_deployment_generation: context.deployment.deployment_generation,
        checkpoint_generation: manifest.checkpoint_generation,
        previous_checkpoint_digest: manifest.previous_checkpoint_digest,
        observation_scheme_id: context.capacity.observation_scheme_id,
        programdata_observation: *observation_info.key,
        observation_purpose: binding.purpose,
        observation_generation: observation.generation,
        observation_subject_digest: observation.subject_digest,
        observation_root: observation.final_raw_merkle_root,
        observation_digest: observation.observation_digest,
        observation_finalized_slot: observation.finalized_slot,
        gate_epoch: context.gate.epoch,
        target_programdata_slot: observation.deployed_slot,
        artifact_length: binding.observation_expectation.artifact_length,
        artifact_sha256: binding.observation_expectation.artifact_sha256,
        artifact_merkle_root: binding.observation_expectation.artifact_merkle_root,
        artifact_scheme_id: binding.observation_expectation.artifact_scheme_id,
        minimum_required_capacity: binding.minimum_required_capacity,
        observed_raw_data_length: observation.raw_data_length,
        actual_capacity: observation.actual_capacity,
        observed_authority: observation.upgrade_authority,
        program_owned_state_root: manifest.program_owned_state_root,
        program_owned_state_count: manifest.program_owned_state_count,
        logical_compressed_state_root: manifest.logical_compressed_state_root,
        logical_compressed_state_count: manifest.logical_compressed_state_count,
        semantic_custody_accounting_root: manifest.semantic_custody_accounting_root,
        hard_combined_root: manifest.hard_combined_root,
        external_metadata_observation_root: manifest.external_metadata_observation_root,
        external_raw_balance_observation_root: manifest.external_raw_balance_observation_root,
        schema_identifier: manifest.schema_identifier,
        admitted_positive_donation_root: manifest.admitted_positive_donation_root,
        admitted_positive_donation_count: manifest.admitted_positive_donation_count,
        forbidden_drift_count: manifest.forbidden_drift_count,
        approval_council_version: council.version,
        approval_council_hash: council.set_hash,
        checkpoint_digest_domain_id: STATE_CHECKPOINT_V2_DIGEST_DOMAIN_ID,
        checkpoint_digest: [0; 32],
        approval_bitset: 0,
        approval_count: 0,
        accepted: false,
        // This value is permissionless lifecycle evidence and is cleared from
        // the digest. At attestation time use the finalized observation slot so
        // the fully reconstructed candidate itself still passes strict schema.
        finalized_slot: observation.finalized_slot,
        reserved: [0; STATE_CHECKPOINT_V2_RESERVED_LEN],
    });
    checkpoint.checkpoint_digest = compute_state_checkpoint_digest_v2(&checkpoint)?;
    if checkpoint.checkpoint_digest != manifest.expected_checkpoint_digest {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_state_checkpoint_digest_v2(&checkpoint)?;
    Ok(checkpoint)
}

type PreparedCheckpointAttestation = (
    LifecycleContext,
    Box<GovernanceCouncilSetV1>,
    CheckpointBindingV2,
    Box<StateCheckpointV2>,
    u64,
);

#[allow(clippy::too_many_arguments)]
fn prepare_checkpoint_attestation(
    program_id: &Pubkey,
    manifest: &CheckpointManifestV2,
    seat_index: u8,
    config_info: &AccountInfo<'_>,
    policy_info: &AccountInfo<'_>,
    council_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    subject_info: &AccountInfo<'_>,
    linked_primary_or_authority: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    observation_info: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    checkpoint_info: &AccountInfo<'_>,
    seat: &AccountInfo<'_>,
) -> Result<PreparedCheckpointAttestation, ProgramError> {
    let slot = current_slot()?;
    if slot > manifest.plan_valid_until_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let seat_record = council
        .seats
        .get(usize::from(seat_index))
        .ok_or(GovernanceError::InactiveCouncilSeat)?;
    if *seat.key == context.config.guardian
        || seat_record.seat_authority != *seat.key
        || !seat_record.term_covers(slot)
    {
        return Err(GovernanceError::InactiveCouncilSeat.into());
    }
    let binding = load_checkpoint_subject_binding(
        program_id,
        subject_info,
        linked_primary_or_authority,
        checkpoint_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
        manifest,
    )?;
    if binding
        .expected_observation
        .is_some_and(|expected| expected != *observation_info.key)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if binding.checkpoint != *checkpoint_info.key
        || checkpoint_info.owner != &system_program::ID
        || checkpoint_info.data_len() != 0
    {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let observation = load_fresh_programdata_observation(
        program_id,
        observation_info,
        config_info,
        gate_info,
        capacity_info,
        &binding.observation_subject,
        &context.config,
        &context.gate,
        &context.capacity,
        &binding.observation_expectation,
        binding.purpose,
        &binding.observation_subject_digest,
        manifest.expected_observation_generation,
        &manifest.expected_observation_digest,
        binding.minimum_required_capacity,
        slot,
    )?;
    require_observation_matches_runtime(
        &observation,
        target_program,
        target_programdata,
        &context.config,
        &context.capacity,
    )?;
    let checkpoint = derive_checkpoint_candidate(
        program_id,
        manifest,
        &binding,
        config_info,
        capacity_info,
        deployment_info,
        observation_info,
        &context,
        &council,
        &observation,
    )?;
    Ok((context, council, binding, checkpoint, slot))
}

#[allow(clippy::too_many_arguments)]
fn build_checkpoint_attestation(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
    council_info: &AccountInfo<'_>,
    subject_info: &AccountInfo<'_>,
    checkpoint: &StateCheckpointV2,
    council: &GovernanceCouncilSetV1,
    seat_index: u8,
    seat: &AccountInfo<'_>,
    slot: u64,
    bump: u8,
) -> GovernanceResult<CheckpointAttestationV1> {
    let mut attestation = CheckpointAttestationV1 {
        discriminator: CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump,
        initialized: true,
        controller_program: *program_id,
        controller_config: *config_info.key,
        checkpoint: derive_checkpoint_identity(checkpoint, program_id),
        subject: *subject_info.key,
        subject_digest: checkpoint.subject_digest,
        phase: checkpoint.phase,
        checkpoint_digest: checkpoint.checkpoint_digest,
        council: *council_info.key,
        council_version: council.version,
        council_hash: council.set_hash,
        gate_epoch: checkpoint.gate_epoch,
        seat_index,
        seat_authority: *seat.key,
        attested_slot: slot,
        attestation_digest: [0; 32],
        reserved: [0; CHECKPOINT_ATTESTATION_V1_RESERVED_LEN],
    };
    attestation.attestation_digest = compute_checkpoint_attestation_digest_v1(&attestation)?;
    validate_checkpoint_attestation_digest_v1(&attestation)?;
    Ok(attestation)
}

fn derive_checkpoint_identity(checkpoint: &StateCheckpointV2, program_id: &Pubkey) -> Pubkey {
    match checkpoint.phase {
        StateCheckpointPhaseV1::Prestate => {
            derive_checkpoint_pda(
                program_id,
                &checkpoint.proposal,
                CheckpointPhaseV1::Prestate,
            )
            .0
        }
        StateCheckpointPhaseV1::Poststate => {
            derive_checkpoint_pda(
                program_id,
                &checkpoint.proposal,
                CheckpointPhaseV1::Poststate,
            )
            .0
        }
        StateCheckpointPhaseV1::Emergency => {
            derive_emergency_checkpoint_v2_pda(program_id, &checkpoint.emergency_resolution).0
        }
    }
}

pub fn process_create_checkpoint_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: Box<CreateCheckpointV2>,
) -> ProgramResult {
    exact_account_count(accounts, 16)?;
    all_distinct(accounts)?;
    let [payer, config_info, policy_info, council_info, gate_info, subject_info, linked_primary_or_authority, capacity_info, deployment_info, observation_info, target_program, target_programdata, checkpoint_info, attestation_info, seat, system_program_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    signer_writable(payer)?;
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        subject_info,
        linked_primary_or_authority,
        capacity_info,
        deployment_info,
        observation_info,
        target_programdata,
        checkpoint_info,
    ] {
        readonly(info)?;
    }
    executable_readonly(target_program)?;
    writable(attestation_info)?;
    validate_seat_authority(seat)?;
    system_program_account(system_program_info)?;

    let (_, council, binding, checkpoint, slot) = prepare_checkpoint_attestation(
        program_id,
        &instruction.attestation.manifest,
        instruction.attestation.seat_index,
        config_info,
        policy_info,
        council_info,
        gate_info,
        subject_info,
        linked_primary_or_authority,
        capacity_info,
        deployment_info,
        observation_info,
        target_program,
        target_programdata,
        checkpoint_info,
        seat,
    )?;
    let (expected_attestation, attestation_bump) = derive_checkpoint_attestation_pda(
        program_id,
        &binding.checkpoint,
        council.version,
        instruction.attestation.seat_index,
    );
    if *attestation_info.key != expected_attestation
        || attestation_info.owner != &system_program::ID
        || attestation_info.data_len() != 0
    {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let attestation = build_checkpoint_attestation(
        program_id,
        config_info,
        council_info,
        subject_info,
        &checkpoint,
        &council,
        instruction.attestation.seat_index,
        seat,
        slot,
        attestation_bump,
    )?;
    let bytes = encode_fixed_account(&attestation, CheckpointAttestationV1::LEN)?;
    let council_version = council.version.to_le_bytes();
    let seat_index = [instruction.attestation.seat_index];
    let bump = [attestation_bump];
    let seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        CHECKPOINT_ATTESTATION_SEED,
        binding.checkpoint.as_ref(),
        &council_version,
        &seat_index,
        &bump,
    ];
    create_fixed_pda_account(
        program_id,
        payer,
        attestation_info,
        system_program_info,
        &Rent::get()?,
        CheckpointAttestationV1::LEN,
        seeds,
    )?;
    attestation_info
        .try_borrow_mut_data()?
        .copy_from_slice(&bytes);
    Ok(())
}

pub fn process_recast_checkpoint_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: Box<RecastCheckpointV2>,
) -> ProgramResult {
    exact_account_count(accounts, 14)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, subject_info, linked_primary_or_authority, capacity_info, deployment_info, observation_info, target_program, target_programdata, checkpoint_info, attestation_info, seat] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        subject_info,
        linked_primary_or_authority,
        capacity_info,
        deployment_info,
        observation_info,
        target_programdata,
        checkpoint_info,
    ] {
        readonly(info)?;
    }
    executable_readonly(target_program)?;
    writable(attestation_info)?;
    validate_seat_authority(seat)?;

    let (_, council, binding, checkpoint, slot) = prepare_checkpoint_attestation(
        program_id,
        &instruction.attestation.manifest,
        instruction.attestation.seat_index,
        config_info,
        policy_info,
        council_info,
        gate_info,
        subject_info,
        linked_primary_or_authority,
        capacity_info,
        deployment_info,
        observation_info,
        target_program,
        target_programdata,
        checkpoint_info,
        seat,
    )?;
    let current = load_fixed_controller_account::<CheckpointAttestationV1>(
        program_id,
        attestation_info,
        CheckpointAttestationV1::LEN,
    )?;
    validate_checkpoint_attestation_digest_v1(&current)?;
    let (expected_attestation, bump) = derive_checkpoint_attestation_pda(
        program_id,
        &binding.checkpoint,
        council.version,
        instruction.attestation.seat_index,
    );
    if *attestation_info.key != expected_attestation
        || current.bump != bump
        || current.controller_program != *program_id
        || current.controller_config != *config_info.key
        || current.checkpoint != binding.checkpoint
        || current.subject != *subject_info.key
        || current.council != *council_info.key
        || current.council_version != council.version
        || current.council_hash != council.set_hash
        || current.gate_epoch != checkpoint.gate_epoch
        || current.seat_index != instruction.attestation.seat_index
        || current.seat_authority != *seat.key
        || current.attestation_digest
            != instruction.attestation.expected_previous_attestation_digest
        || instruction.attestation.manifest.previous_checkpoint_digest != current.checkpoint_digest
        || current.checkpoint_digest == checkpoint.checkpoint_digest
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let recast = build_checkpoint_attestation(
        program_id,
        config_info,
        council_info,
        subject_info,
        &checkpoint,
        &council,
        instruction.attestation.seat_index,
        seat,
        slot,
        bump,
    )?;
    store_fixed_controller_account(
        program_id,
        attestation_info,
        &recast,
        CheckpointAttestationV1::LEN,
    )
}

pub fn process_finalize_checkpoint_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: Box<FinalizeCheckpointV2>,
) -> ProgramResult {
    exact_account_count(accounts, 17)?;
    all_distinct(accounts)?;
    let [payer, config_info, policy_info, council_info, gate_info, subject_info, linked_primary_or_authority, capacity_info, deployment_info, observation_info, target_program, target_programdata, checkpoint_info, first_attestation, second_attestation, third_attestation, system_program_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    signer_writable(payer)?;
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        linked_primary_or_authority,
        capacity_info,
        deployment_info,
        observation_info,
        target_programdata,
        first_attestation,
        second_attestation,
        third_attestation,
    ] {
        readonly(info)?;
    }
    match instruction.manifest.phase {
        StateCheckpointPhaseV1::Prestate => readonly(subject_info)?,
        StateCheckpointPhaseV1::Poststate | StateCheckpointPhaseV1::Emergency => {
            writable(subject_info)?
        }
    }
    executable_readonly(target_program)?;
    writable(checkpoint_info)?;
    system_program_account(system_program_info)?;
    if checkpoint_info.owner != &system_program::ID || checkpoint_info.data_len() != 0 {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }

    let manifest = &instruction.manifest;
    let slot = current_slot()?;
    if slot > manifest.plan_valid_until_slot {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let binding = load_checkpoint_subject_binding(
        program_id,
        subject_info,
        linked_primary_or_authority,
        checkpoint_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
        manifest,
    )?;
    if binding
        .expected_observation
        .is_some_and(|expected| expected != *observation_info.key)
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let observation = load_fresh_programdata_observation(
        program_id,
        observation_info,
        config_info,
        gate_info,
        capacity_info,
        &binding.observation_subject,
        &context.config,
        &context.gate,
        &context.capacity,
        &binding.observation_expectation,
        binding.purpose,
        &binding.observation_subject_digest,
        manifest.expected_observation_generation,
        &manifest.expected_observation_digest,
        binding.minimum_required_capacity,
        slot,
    )?;
    require_observation_matches_runtime(
        &observation,
        target_program,
        target_programdata,
        &context.config,
        &context.capacity,
    )?;
    let mut checkpoint = derive_checkpoint_candidate(
        program_id,
        manifest,
        &binding,
        config_info,
        capacity_info,
        deployment_info,
        observation_info,
        &context,
        &council,
        &observation,
    )?;
    let mut bitset = 0u8;
    let mut previous_index = None;
    for attestation_info in [first_attestation, second_attestation, third_attestation] {
        let attestation = load_fixed_controller_account::<CheckpointAttestationV1>(
            program_id,
            attestation_info,
            CheckpointAttestationV1::LEN,
        )?;
        validate_checkpoint_attestation_digest_v1(&attestation)?;
        let expected = derive_checkpoint_attestation_pda(
            program_id,
            &binding.checkpoint,
            council.version,
            attestation.seat_index,
        );
        let seat = council
            .seats
            .get(usize::from(attestation.seat_index))
            .ok_or(GovernanceError::InactiveCouncilSeat)?;
        if expected != (*attestation_info.key, attestation.bump)
            || attestation.controller_program != *program_id
            || attestation.controller_config != *config_info.key
            || attestation.checkpoint != binding.checkpoint
            || attestation.subject != *subject_info.key
            || attestation.subject_digest != binding.subject_digest
            || attestation.phase != manifest.phase
            || attestation.checkpoint_digest != checkpoint.checkpoint_digest
            || attestation.council != *council_info.key
            || attestation.council_version != council.version
            || attestation.council_hash != council.set_hash
            || attestation.gate_epoch != context.gate.epoch
            || attestation.seat_authority != seat.seat_authority
            || !seat.term_covers(attestation.attested_slot)
            || attestation.attested_slot < observation.finalized_slot
            || attestation.attested_slot > slot
            || previous_index.is_some_and(|index| attestation.seat_index <= index)
        {
            return Err(GovernanceError::CrossAccountMismatch.into());
        }
        bitset |= 1u8 << attestation.seat_index;
        previous_index = Some(attestation.seat_index);
    }
    if bitset.count_ones() as u8 != RELEASE1_APPROVAL_THRESHOLD {
        return Err(GovernanceError::QuorumNotSatisfied.into());
    }
    checkpoint.approval_bitset = bitset;
    checkpoint.approval_count = RELEASE1_APPROVAL_THRESHOLD;
    checkpoint.accepted = true;
    checkpoint.finalized_slot = slot;
    validate_state_checkpoint_digest_v2(&checkpoint)?;
    let checkpoint_bytes = encode_fixed_account(&*checkpoint, StateCheckpointV2::LEN)?;

    let subject_bytes = match binding.record {
        CheckpointSubjectRecord::Proposal(mut proposal) => {
            if manifest.phase == StateCheckpointPhaseV1::Poststate {
                proposal.state = ProposalStateV2::PoststateAccepted;
                proposal.poststate_accepted_slot = slot;
                validate_upgrade_proposal_digest_v3(&proposal)?;
                Some(encode_fixed_account(&*proposal, UpgradeProposalV3::LEN)?)
            } else {
                None
            }
        }
        CheckpointSubjectRecord::Emergency(mut resolution) => {
            resolution.emergency_checkpoint_digest = checkpoint.checkpoint_digest;
            validate_emergency_freeze_resolution_digest_v2(&resolution)?;
            Some(encode_fixed_account(
                &*resolution,
                EmergencyFreezeResolutionV2::LEN,
            )?)
        }
    };

    let bump = [binding.bump];
    let phase = [manifest.phase as u8];
    let proposal_seeds;
    let emergency_seeds;
    let seeds: &[&[u8]] = match manifest.phase {
        StateCheckpointPhaseV1::Prestate | StateCheckpointPhaseV1::Poststate => {
            proposal_seeds = [
                UPGRADE_SEED_DOMAIN_V1,
                CHECKPOINT_SEED,
                subject_info.key.as_ref(),
                &phase,
                &bump,
            ];
            &proposal_seeds
        }
        StateCheckpointPhaseV1::Emergency => {
            emergency_seeds = [
                UPGRADE_SEED_DOMAIN_V1,
                EMERGENCY_CHECKPOINT_V2_SEED,
                subject_info.key.as_ref(),
                &bump,
            ];
            &emergency_seeds
        }
    };
    create_fixed_pda_account(
        program_id,
        payer,
        checkpoint_info,
        system_program_info,
        &Rent::get()?,
        StateCheckpointV2::LEN,
        seeds,
    )?;
    checkpoint_info
        .try_borrow_mut_data()?
        .copy_from_slice(&checkpoint_bytes);
    if let Some(bytes) = subject_bytes {
        subject_info.try_borrow_mut_data()?.copy_from_slice(&bytes);
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn load_verified_programdata_for_unfreeze_v2(
    program_id: &Pubkey,
    verification_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    context: &LifecycleContext,
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
        || verification.status != ProgramDataVerificationStatusV2::Verified
        || !verification.zero_tail_verified
        || verification.finalized_slot == 0
        || verification.finalized_slot != proposal.programdata_verified_slot
        || verification.controller_config != *config_info.key
        || verification.proposal != *proposal_info.key
        || verification.proposal_digest != proposal.proposal_digest
        || verification.protocol_gate != *gate_info.key
        || verification.freeze_gate_epoch != context.gate.epoch
        || verification.target_nonce != context.config.target_nonce
        || verification.capacity_policy != *capacity_info.key
        || verification.capacity_policy_digest != context.capacity.policy_digest
        || verification.current_deployment_state != *deployment_info.key
        || verification.target_program != context.config.target_program
        || verification.target_programdata != context.config.target_programdata
        || verification.upgradeable_loader != context.config.upgradeable_loader
        || verification.controller_authority != context.config.authority_pda
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.artifact_scheme_id != proposal.artifact_scheme_id
        || verification.minimum_required_capacity != proposal.minimum_required_capacity
        || verification.maximum_supported_raw_programdata_length
            != context.capacity.maximum_raw_programdata_length
        || verification.observation_scheme_id != context.capacity.observation_scheme_id
        || verification.observed_deployed_slot != proposal.upgrade_executed_slot
        || verification.observed_authority != OptionalPubkeyV1::some(context.config.authority_pda)?
        || verification.actual_capacity < proposal.minimum_required_capacity
        || verification.observation_finalized_slot > verification.finalized_slot
        || verification.current_deployment_digest != context.deployment.deployment_digest
        || verification.current_deployment_generation != context.deployment.deployment_generation
        || context.deployment.deployment_digest != proposal.current_deployment_digest
        || context.deployment.deployment_generation != proposal.current_deployment_generation
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(verification)
}

#[allow(clippy::too_many_arguments)]
fn load_accepted_poststate_for_unfreeze_v2(
    program_id: &Pubkey,
    checkpoint_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    capacity_info: &AccountInfo<'_>,
    deployment_info: &AccountInfo<'_>,
    context: &LifecycleContext,
    proposal: &UpgradeProposalV3,
    verification: &ProgramDataVerificationV2,
) -> Result<Box<StateCheckpointV2>, ProgramError> {
    let checkpoint = load_fixed_controller_account::<StateCheckpointV2>(
        program_id,
        checkpoint_info,
        StateCheckpointV2::LEN,
    )?;
    validate_state_checkpoint_digest_v2(&checkpoint)?;
    if derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Poststate)
        != (*checkpoint_info.key, checkpoint.bump)
        || proposal.required_poststate_checkpoint != *checkpoint_info.key
        || checkpoint.phase != StateCheckpointPhaseV1::Poststate
        || checkpoint.controller_config != *config_info.key
        || checkpoint.proposal != *proposal_info.key
        || checkpoint.emergency_resolution != Pubkey::default()
        || checkpoint.subject_digest != proposal.proposal_digest
        || checkpoint.target_program != context.config.target_program
        || checkpoint.target_programdata != context.config.target_programdata
        || checkpoint.capacity_policy != *capacity_info.key
        || checkpoint.capacity_policy_digest != context.capacity.policy_digest
        || checkpoint.current_deployment_state != *deployment_info.key
        || checkpoint.current_deployment_digest != context.deployment.deployment_digest
        || checkpoint.current_deployment_generation != context.deployment.deployment_generation
        || checkpoint.observation_scheme_id != context.capacity.observation_scheme_id
        || checkpoint.programdata_observation != verification.programdata_observation
        || checkpoint.observation_purpose != verification.observation_purpose
        || checkpoint.observation_generation != verification.observation_generation
        || checkpoint.observation_subject_digest != verification.observation_subject_digest
        || checkpoint.observation_root != verification.observation_root
        || checkpoint.observation_digest != verification.observation_digest
        || checkpoint.observation_finalized_slot != verification.observation_finalized_slot
        || checkpoint.gate_epoch != context.gate.epoch
        || checkpoint.target_programdata_slot != verification.observed_deployed_slot
        || checkpoint.artifact_length != proposal.artifact_length
        || checkpoint.artifact_sha256 != proposal.artifact_sha256
        || checkpoint.artifact_merkle_root != proposal.artifact_chunk_merkle_root
        || checkpoint.artifact_scheme_id != proposal.artifact_scheme_id
        || checkpoint.minimum_required_capacity != proposal.minimum_required_capacity
        || checkpoint.observed_raw_data_length != verification.observed_raw_data_length
        || checkpoint.actual_capacity != verification.actual_capacity
        || checkpoint.observed_authority != verification.observed_authority
        || checkpoint.schema_identifier != proposal.checkpoint_schema_id
        || checkpoint.approval_count != RELEASE1_APPROVAL_THRESHOLD
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

fn require_unfreeze_gate_binding(
    proposal_key: &Pubkey,
    proposal: &UpgradeProposalV3,
    context: &LifecycleContext,
) -> ProgramResult {
    let consumed_nonce = proposal
        .target_nonce
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if context.gate.status != GateStatusV1::FrozenForUpgrade
        || context.gate.active_proposal != *proposal_key
        || context.gate.epoch != proposal.freeze_gate_epoch
        || context.gate.freeze_slot != proposal.frozen_slot
        || context.config.target_nonce != consumed_nonce
    {
        return Err(GovernanceError::InvalidProposalEpoch.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn check_unfreeze_guard_v2(
    expected: &UnfreezeGuardV2,
    proposal: &UpgradeProposalV3,
    checkpoint: &StateCheckpointV2,
    verification: &ProgramDataVerificationV2,
    context: &LifecycleContext,
    council: &GovernanceCouncilSetV1,
) -> ProgramResult {
    if expected.expected_proposal_digest != proposal.proposal_digest
        || expected.expected_checkpoint_digest != checkpoint.checkpoint_digest
        || expected.expected_checkpoint_generation != checkpoint.checkpoint_generation
        || expected.expected_verification_digest != verification.verification_digest
        || expected.expected_verification_generation != verification.verification_generation
        || expected.expected_original_council_version != proposal.creation_council_version
        || expected.expected_original_council_hash != proposal.creation_council_hash
        || expected.expected_current_council_version != council.version
        || expected.expected_current_council_hash != council.set_hash
        || expected.expected_gate_epoch != context.gate.epoch
        || expected.expected_target_nonce != context.config.target_nonce
        || expected.expected_current_deployment_digest != context.deployment.deployment_digest
        || expected.expected_current_deployment_generation
            != context.deployment.deployment_generation
        || expected.expected_artifact_sha256 != proposal.artifact_sha256
        || expected.expected_artifact_merkle_root != proposal.artifact_chunk_merkle_root
        || expected.expected_actual_capacity != verification.actual_capacity
        || expected.expected_approval_bitset != proposal.unfreeze_approval_bitset
        || expected.expected_approval_count != proposal.unfreeze_approval_count
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn validate_live_verified_programdata_v2(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    authority: &AccountInfo<'_>,
    loader: &AccountInfo<'_>,
    context: &LifecycleContext,
    verification: &ProgramDataVerificationV2,
) -> ProgramResult {
    if *loader.key != context.config.upgradeable_loader
        || *authority.key != context.config.authority_pda
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let runtime = read_runtime_programdata_header(
        target_program,
        target_programdata,
        &context.config,
        &context.capacity,
    )?;
    if runtime.deployed_slot != verification.observed_deployed_slot
        || runtime.raw_data_length != verification.observed_raw_data_length
        || runtime.capacity != verification.actual_capacity
        || runtime.authority != Some(context.config.authority_pda)
    {
        return Err(GovernanceError::StaleProgramDataObservation.into());
    }
    Ok(())
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum UnfreezeAccumulatorActionV2 {
    Continue,
    ResetForCurrentCouncil,
}

fn classify_unfreeze_accumulator_v2(
    state: ProposalStateV2,
    stored_version: u64,
    stored_hash: &[u8; 32],
    count: u8,
    current_version: u64,
    current_hash: &[u8; 32],
) -> GovernanceResult<UnfreezeAccumulatorActionV2> {
    if count != 0 && (stored_version != current_version || stored_hash != current_hash) {
        return Ok(UnfreezeAccumulatorActionV2::ResetForCurrentCouncil);
    }
    if state == ProposalStateV2::UnfreezeApproved {
        return Err(GovernanceError::DuplicateApproval);
    }
    Ok(UnfreezeAccumulatorActionV2::Continue)
}

fn prepare_unfreeze_accumulator_v2(
    proposal: &mut UpgradeProposalV3,
    council: &GovernanceCouncilSetV1,
) -> ProgramResult {
    if classify_unfreeze_accumulator_v2(
        proposal.state,
        proposal.unfreeze_council_version,
        &proposal.unfreeze_council_hash,
        proposal.unfreeze_approval_count,
        council.version,
        &council.set_hash,
    )? == UnfreezeAccumulatorActionV2::ResetForCurrentCouncil
    {
        proposal.unfreeze_council_version = 0;
        proposal.unfreeze_council_hash = [0; 32];
        proposal.unfreeze_approval_bitset = 0;
        proposal.unfreeze_approval_count = 0;
        proposal.unfreeze_approved_slot = 0;
        proposal.state = ProposalStateV2::PoststateAccepted;
    }
    Ok(())
}

fn require_current_unfreeze_quorum_v2(
    proposal: &UpgradeProposalV3,
    council: &GovernanceCouncilSetV1,
    slot: u64,
) -> ProgramResult {
    if proposal.unfreeze_council_version != council.version
        || proposal.unfreeze_council_hash != council.set_hash
        || proposal.unfreeze_approval_bitset & !VALID_APPROVAL_MASK != 0
        || proposal.unfreeze_approval_bitset.count_ones() as u8 != proposal.unfreeze_approval_count
        || proposal.unfreeze_approval_count != RELEASE1_APPROVAL_THRESHOLD
        || !council.active_at(slot)
    {
        return Err(GovernanceError::QuorumNotSatisfied.into());
    }
    for (index, seat) in council.seats.iter().enumerate() {
        if proposal.unfreeze_approval_bitset & (1u8 << index) != 0 && !seat.term_covers(slot) {
            return Err(GovernanceError::InactiveCouncilSeat.into());
        }
    }
    Ok(())
}

fn terminalize_unfreeze_pair_v3(
    proposal: &UpgradeProposalV3,
    proposal_key: &Pubkey,
    linked: &mut UpgradeProposalV3,
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
                || linked.rollback_artifact_length != proposal.artifact_length
                || linked.rollback_artifact_sha256 != proposal.artifact_sha256
                || linked.rollback_artifact_chunk_root != proposal.artifact_chunk_merkle_root
                || linked.rollback_artifact_scheme_id != proposal.artifact_scheme_id
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
                || proposal.rollback_artifact_length != linked.artifact_length
                || proposal.rollback_artifact_sha256 != linked.artifact_sha256
                || proposal.rollback_artifact_chunk_root != linked.artifact_chunk_merkle_root
                || proposal.rollback_artifact_scheme_id != linked.artifact_scheme_id
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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ActivatedDeploymentEvidenceV2 {
    artifact_length: u64,
    artifact_sha256: [u8; 32],
    artifact_merkle_root: [u8; 32],
    artifact_scheme_id: [u8; 32],
    actual_capacity: u64,
    programdata_observation: Pubkey,
    observation_generation: u64,
    observation_root: [u8; 32],
    observation_digest: [u8; 32],
    deployed_slot: u64,
    installed_authority: Pubkey,
    source_commitment: [u8; 32],
    build_inputs_commitment: [u8; 32],
    package_commitment: [u8; 32],
    release_manifest_commitment: [u8; 32],
    release_commitment: Pubkey,
    release_commitment_digest: [u8; 32],
}

fn apply_activated_deployment_v2(
    current: &CurrentDeploymentStateV1,
    evidence: &ActivatedDeploymentEvidenceV2,
    active_gate_epoch: u64,
    slot: u64,
) -> GovernanceResult<CurrentDeploymentStateV1> {
    if active_gate_epoch == 0 || active_gate_epoch == u64::MAX || slot == 0 {
        return Err(GovernanceError::CrossAccountMismatch);
    }
    let mut next = current.clone();
    next.artifact_length = evidence.artifact_length;
    next.artifact_sha256 = evidence.artifact_sha256;
    next.artifact_merkle_root = evidence.artifact_merkle_root;
    next.artifact_scheme_id = evidence.artifact_scheme_id;
    next.actual_programdata_capacity = evidence.actual_capacity;
    next.programdata_observation = evidence.programdata_observation;
    next.observation_generation = evidence.observation_generation;
    next.observation_root = evidence.observation_root;
    next.observation_digest = evidence.observation_digest;
    next.deployed_slot = evidence.deployed_slot;
    next.installed_authority = evidence.installed_authority;
    next.source_commitment = evidence.source_commitment;
    next.build_inputs_commitment = evidence.build_inputs_commitment;
    next.package_commitment = evidence.package_commitment;
    next.release_manifest_commitment = evidence.release_manifest_commitment;
    next.release_commitment = evidence.release_commitment;
    next.release_commitment_digest = evidence.release_commitment_digest;
    next.activation_receipt = OptionalPubkeyV1::none();
    next.completed_proposal = OptionalPubkeyV1::some(evidence.release_commitment)?;
    next.gate_epoch_at_activation = active_gate_epoch;
    next.deployment_generation = checked_nonterminal_increment(current.deployment_generation)?;
    next.last_updated_slot = slot;
    next.deployment_digest = [0; 32];
    next.deployment_digest = compute_current_deployment_digest_v1(&next)?;
    validate_current_deployment_digest_v1(&next)?;
    Ok(next)
}

#[allow(clippy::too_many_arguments)]
fn build_activated_deployment_v2(
    current: &CurrentDeploymentStateV1,
    config: &ControllerConfigV1,
    proposal_key: &Pubkey,
    proposal: &UpgradeProposalV3,
    verification: &ProgramDataVerificationV2,
    active_gate_epoch: u64,
    slot: u64,
) -> GovernanceResult<CurrentDeploymentStateV1> {
    if active_gate_epoch == 0
        || active_gate_epoch == u64::MAX
        || slot == 0
        || verification.status != ProgramDataVerificationStatusV2::Verified
        || !verification.zero_tail_verified
        || verification.finalized_slot == 0
        || verification.finalized_slot > slot
        || verification.proposal != *proposal_key
        || verification.proposal_digest != proposal.proposal_digest
        || verification.artifact_length != proposal.artifact_length
        || verification.artifact_sha256 != proposal.artifact_sha256
        || verification.artifact_merkle_root != proposal.artifact_chunk_merkle_root
        || verification.artifact_scheme_id != proposal.artifact_scheme_id
        || verification.observed_authority != OptionalPubkeyV1::some(config.authority_pda)?
    {
        return Err(GovernanceError::CrossAccountMismatch);
    }
    let evidence = ActivatedDeploymentEvidenceV2 {
        artifact_length: proposal.artifact_length,
        artifact_sha256: proposal.artifact_sha256,
        artifact_merkle_root: proposal.artifact_chunk_merkle_root,
        artifact_scheme_id: proposal.artifact_scheme_id,
        actual_capacity: verification.actual_capacity,
        programdata_observation: verification.programdata_observation,
        observation_generation: verification.observation_generation,
        observation_root: verification.observation_root,
        observation_digest: verification.observation_digest,
        deployed_slot: verification.observed_deployed_slot,
        installed_authority: config.authority_pda,
        source_commitment: proposal.source_commit_hash,
        build_inputs_commitment: proposal.build_input_inventory_hash,
        package_commitment: proposal.package_receipt_hash,
        release_manifest_commitment: proposal.release_intent_hash,
        release_commitment: *proposal_key,
        release_commitment_digest: proposal.proposal_digest,
    };
    apply_activated_deployment_v2(current, &evidence, active_gate_epoch, slot)
}

#[allow(clippy::too_many_arguments)]
fn commit_four_fixed_accounts(
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
    fourth: &AccountInfo<'_>,
    fourth_bytes: &[u8],
    fourth_len: usize,
) -> ProgramResult {
    if first.owner != program_id
        || second.owner != program_id
        || third.owner != program_id
        || fourth.owner != program_id
    {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let mut first_data = first.try_borrow_mut_data()?;
    let mut second_data = second.try_borrow_mut_data()?;
    let mut third_data = third.try_borrow_mut_data()?;
    let mut fourth_data = fourth.try_borrow_mut_data()?;
    if first_data.len() != first_len
        || second_data.len() != second_len
        || third_data.len() != third_len
        || fourth_data.len() != fourth_len
        || first_bytes.len() != first_len
        || second_bytes.len() != second_len
        || third_bytes.len() != third_len
        || fourth_bytes.len() != fourth_len
    {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    first_data.copy_from_slice(first_bytes);
    second_data.copy_from_slice(second_bytes);
    third_data.copy_from_slice(third_bytes);
    fourth_data.copy_from_slice(fourth_bytes);
    Ok(())
}

pub fn process_approve_unfreeze_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveUnfreezeV2,
) -> ProgramResult {
    exact_account_count(accounts, 14)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, proposal_info, checkpoint_info, verification_info, capacity_info, deployment_info, target_program, target_programdata, authority, loader, seat] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        checkpoint_info,
        verification_info,
        capacity_info,
        deployment_info,
        target_programdata,
        authority,
    ] {
        readonly(info)?;
    }
    writable(proposal_info)?;
    executable_readonly(target_program)?;
    executable_readonly(loader)?;
    validate_seat_authority(seat)?;

    let slot = current_slot()?;
    let context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    require_unfreeze_gate_binding(proposal_info.key, &proposal, &context)?;
    if !matches!(
        proposal.state,
        ProposalStateV2::PoststateAccepted | ProposalStateV2::UnfreezeApproved
    ) || proposal.policy_hash != policy.policy_hash
        || *seat.key == context.config.guardian
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let verification = load_verified_programdata_for_unfreeze_v2(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
        &proposal,
    )?;
    let checkpoint = load_accepted_poststate_for_unfreeze_v2(
        program_id,
        checkpoint_info,
        proposal_info,
        config_info,
        capacity_info,
        deployment_info,
        &context,
        &proposal,
        &verification,
    )?;
    validate_live_verified_programdata_v2(
        target_program,
        target_programdata,
        authority,
        loader,
        &context,
        &verification,
    )?;
    prepare_unfreeze_accumulator_v2(&mut proposal, &council)?;
    if proposal.state != ProposalStateV2::PoststateAccepted {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    check_unfreeze_guard_v2(
        &instruction.expected,
        &proposal,
        &checkpoint,
        &verification,
        &context,
        &council,
    )?;
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
    validate_upgrade_proposal_digest_v3(&proposal)?;
    store_fixed_controller_account(
        program_id,
        proposal_info,
        &*proposal,
        UpgradeProposalV3::LEN,
    )
}

pub fn process_execute_unfreeze_v2(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExecuteUnfreezeV2,
) -> ProgramResult {
    exact_account_count(accounts, 15)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, proposal_info, linked_info, checkpoint_info, verification_info, capacity_info, deployment_info, target_program, target_programdata, authority, loader, instructions_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for info in [
        config_info,
        policy_info,
        council_info,
        checkpoint_info,
        verification_info,
        capacity_info,
        target_programdata,
        authority,
        instructions_info,
    ] {
        readonly(info)?;
    }
    for info in [gate_info, proposal_info, linked_info, deployment_info] {
        writable(info)?;
    }
    executable_readonly(target_program)?;
    executable_readonly(loader)?;
    if *loader.key != UPGRADEABLE_LOADER_ID
        || *instructions_info.key != sysvar_ids::instructions::ID
        || instruction.linked_proposal != *linked_info.key
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    let slot = current_slot()?;
    let mut context = load_lifecycle_context(
        program_id,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
    )?;
    let policy = load_policy(program_id, policy_info, config_info, &context.config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info,
        &context.config,
        &policy,
        slot,
    )?;
    let mut proposal = load_proposal(
        program_id,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    let mut linked = load_proposal(
        program_id,
        linked_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
    )?;
    require_unfreeze_gate_binding(proposal_info.key, &proposal, &context)?;
    if proposal.state != ProposalStateV2::UnfreezeApproved
        || proposal.policy_hash != policy.policy_hash
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let verification = load_verified_programdata_for_unfreeze_v2(
        program_id,
        verification_info,
        proposal_info,
        config_info,
        gate_info,
        capacity_info,
        deployment_info,
        &context,
        &proposal,
    )?;
    let checkpoint = load_accepted_poststate_for_unfreeze_v2(
        program_id,
        checkpoint_info,
        proposal_info,
        config_info,
        capacity_info,
        deployment_info,
        &context,
        &proposal,
        &verification,
    )?;
    check_unfreeze_guard_v2(
        &instruction.expected,
        &proposal,
        &checkpoint,
        &verification,
        &context,
        &council,
    )?;
    require_current_unfreeze_quorum_v2(&proposal, &council, slot)?;
    validate_live_verified_programdata_v2(
        target_program,
        target_programdata,
        authority,
        loader,
        &context,
        &verification,
    )?;
    validate_canonical_envelope(
        program_id,
        accounts,
        instructions_info,
        &instruction.pack()?,
        &instruction.envelope,
    )?;

    let next_epoch = checked_nonterminal_increment(context.gate.epoch)?;
    terminalize_unfreeze_pair_v3(
        &proposal,
        proposal_info.key,
        &mut linked,
        linked_info.key,
        slot,
    )?;
    proposal.state = ProposalStateV2::Completed;
    proposal.terminal_slot = slot;
    proposal.terminal_reason_code = PROPOSAL_COMPLETED_TERMINAL_REASON_V1;
    context.gate.epoch = next_epoch;
    context.gate.status = GateStatusV1::Active;
    context.gate.active_proposal = Pubkey::default();
    context.gate.freeze_slot = 0;
    context.gate.freeze_reason_code = 0;
    context.gate.last_completed_proposal = *proposal_info.key;
    let next_deployment = build_activated_deployment_v2(
        &context.deployment,
        &context.config,
        proposal_info.key,
        &proposal,
        &verification,
        next_epoch,
        slot,
    )?;
    validate_upgrade_proposal_digest_v3(&proposal)?;
    validate_upgrade_proposal_digest_v3(&linked)?;
    context.gate.validate_static()?;
    let gate_bytes = encode_fixed_account(&*context.gate, ProtocolGateV1::LEN)?;
    let proposal_bytes = encode_fixed_account(&*proposal, UpgradeProposalV3::LEN)?;
    let linked_bytes = encode_fixed_account(&*linked, UpgradeProposalV3::LEN)?;
    let deployment_bytes = encode_fixed_account(&next_deployment, CurrentDeploymentStateV1::LEN)?;
    commit_four_fixed_accounts(
        program_id,
        gate_info,
        &gate_bytes,
        ProtocolGateV1::LEN,
        proposal_info,
        &proposal_bytes,
        UpgradeProposalV3::LEN,
        linked_info,
        &linked_bytes,
        UpgradeProposalV3::LEN,
        deployment_info,
        &deployment_bytes,
        CurrentDeploymentStateV1::LEN,
    )
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        artifact_merkle::ARTIFACT_MERKLE_SCHEME_ID,
        release1_ceremony_state::{
            CEREMONY_ACCOUNT_VERSION_V1, CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
            CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN,
        },
    };

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn unfreeze_guard() -> UnfreezeGuardV2 {
        UnfreezeGuardV2 {
            expected_proposal_digest: [1; 32],
            expected_checkpoint_digest: [2; 32],
            expected_checkpoint_generation: 1,
            expected_verification_digest: [3; 32],
            expected_verification_generation: 1,
            expected_original_council_version: 1,
            expected_original_council_hash: [4; 32],
            expected_current_council_version: 1,
            expected_current_council_hash: [5; 32],
            expected_gate_epoch: 1,
            expected_target_nonce: 1,
            expected_current_deployment_digest: [6; 32],
            expected_current_deployment_generation: 1,
            expected_artifact_sha256: [7; 32],
            expected_artifact_merkle_root: [8; 32],
            expected_actual_capacity: 1,
            expected_approval_bitset: 0,
            expected_approval_count: 0,
        }
    }

    fn deployment_fixture(generation: u64) -> CurrentDeploymentStateV1 {
        let mut deployment = CurrentDeploymentStateV1 {
            discriminator: CURRENT_DEPLOYMENT_STATE_V1_DISCRIMINATOR,
            version: CEREMONY_ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            controller_program: key(1),
            controller_config: key(2),
            capacity_policy: key(3),
            capacity_policy_digest: [4; 32],
            target_program: key(5),
            target_programdata: key(6),
            upgradeable_loader: UPGRADEABLE_LOADER_ID,
            controller_authority: key(7),
            artifact_length: 16_384,
            artifact_sha256: [8; 32],
            artifact_merkle_root: [9; 32],
            artifact_scheme_id: ARTIFACT_MERKLE_SCHEME_ID,
            actual_programdata_capacity: 32_768,
            programdata_observation: key(10),
            observation_generation: 1,
            observation_root: [11; 32],
            observation_digest: [12; 32],
            deployed_slot: 13,
            installed_authority: key(7),
            source_commitment: [14; 32],
            build_inputs_commitment: [15; 32],
            package_commitment: [16; 32],
            release_manifest_commitment: [17; 32],
            release_commitment: key(18),
            release_commitment_digest: [19; 32],
            activation_receipt: OptionalPubkeyV1::some(key(20)).unwrap(),
            completed_proposal: OptionalPubkeyV1::none(),
            gate_epoch_at_activation: 2,
            deployment_generation: generation,
            deployment_digest: [0; 32],
            last_updated_slot: 22,
            reserved: [0; CURRENT_DEPLOYMENT_STATE_V1_RESERVED_LEN],
        };
        deployment.deployment_digest = compute_current_deployment_digest_v1(&deployment).unwrap();
        validate_current_deployment_digest_v1(&deployment).unwrap();
        deployment
    }

    fn activated_evidence() -> ActivatedDeploymentEvidenceV2 {
        ActivatedDeploymentEvidenceV2 {
            artifact_length: 24_576,
            artifact_sha256: [21; 32],
            artifact_merkle_root: [22; 32],
            artifact_scheme_id: ARTIFACT_MERKLE_SCHEME_ID,
            actual_capacity: 32_768,
            programdata_observation: key(23),
            observation_generation: 2,
            observation_root: [24; 32],
            observation_digest: [25; 32],
            deployed_slot: 26,
            installed_authority: key(7),
            source_commitment: [27; 32],
            build_inputs_commitment: [28; 32],
            package_commitment: [29; 32],
            release_manifest_commitment: [30; 32],
            release_commitment: key(31),
            release_commitment_digest: [32; 32],
        }
    }

    #[test]
    fn monotonic_increment_never_enters_terminal_sentinel() {
        assert_eq!(checked_nonterminal_increment(1), Ok(2));
        assert_eq!(
            checked_nonterminal_increment(u64::MAX - 2),
            Ok(u64::MAX - 1)
        );
        assert_eq!(
            checked_nonterminal_increment(u64::MAX - 1),
            Err(GovernanceError::ArithmeticOverflow)
        );
        assert_eq!(
            checked_nonterminal_increment(u64::MAX),
            Err(GovernanceError::ArithmeticOverflow)
        );
    }

    #[test]
    fn emergency_checkpoint_separates_checkpoint_and_observation_subjects() {
        let resolution = key(1);
        let freeze_observation = key(2);
        let resolution_digest = [3; 32];
        let gate_bound_observation_subject_digest = [4; 32];
        let subjects = emergency_checkpoint_subjects(
            resolution,
            resolution_digest,
            freeze_observation,
            gate_bound_observation_subject_digest,
        );
        assert_eq!(subjects.0, resolution);
        assert_eq!(subjects.1, resolution_digest);
        assert_eq!(subjects.2, freeze_observation);
        assert_eq!(subjects.3, gate_bound_observation_subject_digest);
        assert_ne!(subjects.0, subjects.2);
        assert_ne!(subjects.1, subjects.3);
    }

    #[test]
    fn rollback_prestate_expectation_uses_failed_primary_candidate() {
        let candidate = candidate_observation_expectation(
            24_576,
            [1; 32],
            [2; 32],
            ARTIFACT_MERKLE_SCHEME_ID,
            91,
        );
        assert_eq!(candidate.artifact_length, 24_576);
        assert_eq!(candidate.artifact_sha256, [1; 32]);
        assert_eq!(candidate.artifact_merkle_root, [2; 32]);
        assert_eq!(candidate.artifact_scheme_id, ARTIFACT_MERKLE_SCHEME_ID);
        assert_eq!(candidate.deployed_slot, 91);
        assert_eq!(candidate.exact_capacity, None);
    }

    #[test]
    fn unfreeze_activation_advances_deployment_for_next_proposal() {
        let current = deployment_fixture(7);
        let evidence = activated_evidence();
        let next = apply_activated_deployment_v2(&current, &evidence, 10, 50).unwrap();
        assert_eq!(current.deployment_generation, 7);
        assert_eq!(next.deployment_generation, 8);
        assert_eq!(next.gate_epoch_at_activation, 10);
        assert_eq!(next.last_updated_slot, 50);
        assert_eq!(next.release_commitment, evidence.release_commitment);
        assert_eq!(
            next.release_commitment_digest,
            evidence.release_commitment_digest
        );
        assert_eq!(next.completed_proposal.value, evidence.release_commitment);
        assert!(next.completed_proposal.present);
        assert!(!next.activation_receipt.present);
        assert_ne!(next.deployment_digest, current.deployment_digest);
        // These are the exact two fields CreateProposalV3 requires a fresh
        // operator plan to bind, so the next proposal cannot accidentally use
        // the pre-unfreeze deployment generation.
        let next_plan_binding = (next.deployment_digest, next.deployment_generation);
        assert_eq!(next_plan_binding, (next.deployment_digest, 8));
        validate_current_deployment_digest_v1(&next).unwrap();
    }

    #[test]
    fn unfreeze_activation_rejects_terminal_deployment_generation() {
        let current = deployment_fixture(u64::MAX - 1);
        assert_eq!(
            apply_activated_deployment_v2(&current, &activated_evidence(), 10, 50),
            Err(GovernanceError::ArithmeticOverflow)
        );
    }

    #[test]
    fn freeze_runway_reserves_distinct_extension_and_execution_slots() {
        assert!(require_freeze_execution_runway(false, 13, 10, 1).is_ok());
        assert!(require_freeze_execution_runway(false, 12, 10, 1).is_err());
        assert!(require_freeze_execution_runway(true, 14, 10, 1).is_ok());
        assert!(require_freeze_execution_runway(true, 13, 10, 1).is_err());
    }

    #[test]
    fn unfreeze_accumulator_rotation_resets_but_same_council_duplicate_fails() {
        let old_hash = [1; 32];
        let current_hash = [2; 32];
        assert_eq!(
            classify_unfreeze_accumulator_v2(
                ProposalStateV2::UnfreezeApproved,
                1,
                &old_hash,
                RELEASE1_APPROVAL_THRESHOLD,
                2,
                &current_hash,
            ),
            Ok(UnfreezeAccumulatorActionV2::ResetForCurrentCouncil)
        );
        assert_eq!(
            classify_unfreeze_accumulator_v2(
                ProposalStateV2::UnfreezeApproved,
                2,
                &current_hash,
                RELEASE1_APPROVAL_THRESHOLD,
                2,
                &current_hash,
            ),
            Err(GovernanceError::DuplicateApproval)
        );
        assert_eq!(
            classify_unfreeze_accumulator_v2(
                ProposalStateV2::PoststateAccepted,
                2,
                &current_hash,
                2,
                2,
                &current_hash,
            ),
            Ok(UnfreezeAccumulatorActionV2::Continue)
        );
    }

    #[test]
    fn unfreeze_wrong_account_count_fails_before_writable_bytes_change() {
        let program_id = key(90);
        let account_key = key(91);
        let owner = key(92);
        let mut lamports = 1;
        let mut data = [9u8; 16];
        let info = AccountInfo::new(
            &account_key,
            false,
            true,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        let accounts = [info];
        let before = accounts[0].try_borrow_data().unwrap().to_vec();
        assert_eq!(
            process_approve_unfreeze_v2(
                &program_id,
                &accounts,
                ApproveUnfreezeV2 {
                    expected: unfreeze_guard(),
                },
            ),
            Err(GovernanceError::InvalidAccountCount.into())
        );
        assert_eq!(&**accounts[0].try_borrow_data().unwrap(), before.as_slice());
        assert_eq!(
            process_execute_unfreeze_v2(
                &program_id,
                &accounts,
                ExecuteUnfreezeV2 {
                    expected: unfreeze_guard(),
                    linked_proposal: key(93),
                    envelope: CeremonyEnvelopeV1 {
                        compute_unit_limit: 1,
                        compute_unit_price_micro_lamports: 0,
                        durable_nonce_account: OptionalPubkeyV1::none(),
                        durable_nonce_authority: OptionalPubkeyV1::none(),
                    },
                },
            ),
            Err(GovernanceError::InvalidAccountCount.into())
        );
        assert_eq!(&**accounts[0].try_borrow_data().unwrap(), before.as_slice());
    }

    #[test]
    fn four_account_commit_is_failure_atomic_on_late_size_error() {
        let program_id = key(100);
        let keys = [key(101), key(102), key(103), key(104)];
        let mut first_lamports = 1u64;
        let mut second_lamports = 1u64;
        let mut third_lamports = 1u64;
        let mut fourth_lamports = 1u64;
        let mut first_data = [1u8; 4];
        let mut second_data = [2u8; 4];
        let mut third_data = [3u8; 4];
        let mut fourth_data = [4u8; 3];
        let first = AccountInfo::new(
            &keys[0],
            false,
            true,
            &mut first_lamports,
            &mut first_data,
            &program_id,
            false,
            0,
        );
        let second = AccountInfo::new(
            &keys[1],
            false,
            true,
            &mut second_lamports,
            &mut second_data,
            &program_id,
            false,
            0,
        );
        let third = AccountInfo::new(
            &keys[2],
            false,
            true,
            &mut third_lamports,
            &mut third_data,
            &program_id,
            false,
            0,
        );
        let fourth = AccountInfo::new(
            &keys[3],
            false,
            true,
            &mut fourth_lamports,
            &mut fourth_data,
            &program_id,
            false,
            0,
        );
        let before = [
            first.try_borrow_data().unwrap().to_vec(),
            second.try_borrow_data().unwrap().to_vec(),
            third.try_borrow_data().unwrap().to_vec(),
            fourth.try_borrow_data().unwrap().to_vec(),
        ];
        assert_eq!(
            commit_four_fixed_accounts(
                &program_id,
                &first,
                &[9; 4],
                4,
                &second,
                &[9; 4],
                4,
                &third,
                &[9; 4],
                4,
                &fourth,
                &[9; 4],
                4,
            ),
            Err(GovernanceError::InvalidAccountSize.into())
        );
        for (account, expected) in [&first, &second, &third, &fourth].into_iter().zip(before) {
            assert_eq!(&**account.try_borrow_data().unwrap(), expected.as_slice());
        }
    }
}
