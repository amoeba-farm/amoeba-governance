//! Closed Release 1 checkpoint, council-rotation, and expiry processors.
//!
//! Every public entry point validates the complete account contract and builds
//! the final account bytes before the first write.  Canonical checkpoints are
//! never stored in a draft state: seats attest through independent PDAs and a
//! permissionless finalizer creates the checkpoint only after observing three
//! byte-identical, current-council attestations.

use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint::ProgramResult,
    program_error::ProgramError, pubkey::Pubkey, rent::Rent, sysvar::Sysvar,
};
use solana_sdk_ids::system_program;

use crate::{
    council::{
        compute_council_set_hash, record_seat_approval, validate_council_guardian_separation,
        validate_council_set, VALID_APPROVAL_MASK,
    },
    instruction::{
        ActivateCouncilRotationV1, ApproveCouncilRotationV1, CancelCouncilRotationV1,
        CheckpointCandidateV1, CheckpointSubjectStateV1, CouncilRotationExpectationV1,
        CreateCandidateCouncilSetV1, CreateCheckpointAttestationV1, CreateCouncilRotationV1,
        ExpireCouncilRotationV1, ExpireEmergencyResolutionV1, FinalizeCheckpointV1,
        QueueCouncilRotationV1, RecastCheckpointAttestationV1,
    },
    pda::{
        derive_authority_pda, derive_buffer_check_pda, derive_checkpoint_attestation_pda,
        derive_checkpoint_pda, derive_controller_config_pda, derive_council_pda,
        derive_emergency_checkpoint_pda, derive_emergency_freeze_observation_pda,
        derive_emergency_resolution_pda, derive_gate_pda, derive_policy_pda,
        derive_programdata_check_pda, derive_programdata_failure_observation_pda,
        derive_proposal_pda, derive_upgradeable_programdata_address, CHECKPOINT_ATTESTATION_SEED,
        CHECKPOINT_SEED, COUNCIL_ROTATION_SEED, COUNCIL_SEED, EMERGENCY_CHECKPOINT_SEED,
        UPGRADEABLE_LOADER_ID, UPGRADE_SEED_DOMAIN_V1,
    },
    policy::validate_policy_against_config,
    release1_account_io::{
        create_fixed_pda_account, encode_fixed_account, load_fixed_controller_account,
        require_distinct_accounts, store_fixed_controller_account, validate_exact_privileges,
    },
    release1_digest::{
        compute_checkpoint_attestation_digest_v1, compute_council_rotation_digest_v1,
        compute_state_checkpoint_digest_v1, compute_state_checkpoint_hard_combined_root_v1,
        validate_checkpoint_attestation_digest_v1, validate_council_rotation_digest_v1,
        validate_emergency_freeze_observation_digest_v1, validate_emergency_resolution_digest_v1,
        validate_programdata_failure_observation_digest_v1, validate_proposal_digest_v2,
        validate_state_checkpoint_digest_v1,
    },
    release1_loader_accounts::{loader_account_data_hash, validate_program_programdata_linkage},
    release1_state::{
        BufferVerificationStatusV1, BufferVerificationV1, CheckpointAttestationV1,
        CouncilRotationProposalV1, CouncilRotationStateV1, EmergencyFreezeObservationV1,
        EmergencyFreezeResolutionStateV1, EmergencyFreezeResolutionV1,
        ProgramDataFailureObservationV1, ProgramDataMismatchClassV1,
        ProgramDataVerificationStatusV1, ProgramDataVerificationV1, ProposalStateV2,
        StateCheckpointPhaseV1, StateCheckpointV1, UpgradeProposalV2,
        CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR, CHECKPOINT_ATTESTATION_V1_RESERVED_LEN,
        COUNCIL_ROTATION_ACTIVATED_TERMINAL_REASON_V1, COUNCIL_ROTATION_EXPIRED_TERMINAL_REASON_V1,
        COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR, COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN,
        EMERGENCY_RESOLUTION_EXPIRED_TERMINAL_REASON_V1, LOADER_V3_PROGRAMDATA_METADATA_LEN_V1,
        LOADER_V3_PROGRAM_ACCOUNT_LEN_V1, RELEASE1_ACCOUNT_VERSION_V1, RELEASE1_APPROVAL_THRESHOLD,
        STATE_CHECKPOINT_V1_DISCRIMINATOR, STATE_CHECKPOINT_V1_RESERVED_LEN,
    },
    state::{
        CheckpointPhaseV1, ControllerConfigV1, CouncilSeatV1, GateStatusV1, GovernanceCouncilSetV1,
        GovernancePolicyV1, ProposalClassV1, ProtocolGateV1, ACCOUNT_VERSION_V1,
        COUNCIL_SEAT_RESERVED_LEN, GOVERNANCE_COUNCIL_DISCRIMINATOR,
        GOVERNANCE_COUNCIL_RESERVED_LEN,
    },
    GovernanceError, GovernanceResult,
};

const EXACT_ROUTINE_APPROVAL_MASK_COUNT: u8 = RELEASE1_APPROVAL_THRESHOLD;

#[derive(Debug)]
enum CheckpointSubject {
    Proposal(Box<UpgradeProposalV2>),
    Emergency(Box<EmergencyFreezeResolutionV1>),
}

#[derive(Debug)]
struct CheckpointBinding {
    subject: CheckpointSubject,
    subject_key: Pubkey,
    subject_digest: [u8; 32],
    checkpoint: Pubkey,
    checkpoint_bump: u8,
}

struct CheckpointSubjectContext<'a, 'info> {
    program_id: &'a Pubkey,
    subject_info: &'a AccountInfo<'info>,
    checkpoint_info: &'a AccountInfo<'info>,
    config_key: &'a Pubkey,
    config: &'a ControllerConfigV1,
    gate_key: &'a Pubkey,
    gate: &'a ProtocolGateV1,
    candidate: &'a CheckpointCandidateV1,
}

#[derive(Clone, Copy)]
struct CheckpointFinalizationFields {
    council_version: u64,
    council_hash: [u8; 32],
    approval_bitset: u8,
    finalized_slot: u64,
}

#[derive(Clone, Copy)]
struct RollbackPrestateCommitment {
    primary_proposal: Pubkey,
    expected_candidate_full_payload_sha256: [u8; 32],
    artifact_chunk_merkle_root: [u8; 32],
    chunk_hash_domain: [u8; 32],
    capacity: u64,
}

struct AttestationBuildContext<'a> {
    program_id: &'a Pubkey,
    attestation_bump: u8,
    checkpoint: Pubkey,
    subject: Pubkey,
    candidate: &'a CheckpointCandidateV1,
    council_key: Pubkey,
    council: &'a GovernanceCouncilSetV1,
    seat_index: u8,
    seat_authority: Pubkey,
    slot: u64,
    config_key: Pubkey,
}

struct AttestationFinalizationContext<'a> {
    program_id: &'a Pubkey,
    checkpoint: &'a StateCheckpointV1,
    checkpoint_key: &'a Pubkey,
    subject_key: &'a Pubkey,
    council_key: &'a Pubkey,
    council: &'a GovernanceCouncilSetV1,
    minimum_slot: u64,
    finalization_slot: u64,
}

struct RotationAccountContext<'a, 'info> {
    program_id: &'a Pubkey,
    config_info: &'a AccountInfo<'info>,
    policy_info: &'a AccountInfo<'info>,
    current_council_info: &'a AccountInfo<'info>,
    candidate_info: &'a AccountInfo<'info>,
    gate_info: &'a AccountInfo<'info>,
    rotation_info: &'a AccountInfo<'info>,
    expected: &'a CouncilRotationExpectationV1,
    slot: u64,
}

struct LoadedRotationContext {
    config: Box<ControllerConfigV1>,
    current_council: Box<GovernanceCouncilSetV1>,
    candidate: Box<GovernanceCouncilSetV1>,
    rotation: Box<CouncilRotationProposalV1>,
}

fn current_slot() -> Result<u64, ProgramError> {
    let slot = Clock::get()?.slot;
    if slot == 0 {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    Ok(slot)
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

/// Candidate authorities remain real account inputs so executable accounts are
/// rejected and smart-account/PDA authorities preserve their runtime identity.
/// The only admitted duplicate role is the current-seat creator appearing once
/// in the candidate council. Solana coalesces duplicate-account privileges, so
/// that candidate occurrence must also be a read-only signer. Every other
/// candidate authority is exactly read-only/non-signer and may not alias any
/// other instruction role.
#[allow(clippy::too_many_arguments)]
fn validate_candidate_creation_authority_contract<'info>(
    payer: &AccountInfo<'info>,
    creator: &AccountInfo<'info>,
    config_info: &AccountInfo<'info>,
    policy_info: &AccountInfo<'info>,
    current_council_info: &AccountInfo<'info>,
    gate_info: &AccountInfo<'info>,
    candidate_info: &AccountInfo<'info>,
    candidate_authorities: &[AccountInfo<'info>],
    system_program_info: &AccountInfo<'info>,
) -> ProgramResult {
    let fixed_roles = [
        payer,
        creator,
        config_info,
        policy_info,
        current_council_info,
        gate_info,
        candidate_info,
        system_program_info,
    ];
    require_distinct_accounts(&fixed_roles)?;
    let candidate_refs = candidate_authorities.iter().collect::<Vec<_>>();
    require_distinct_accounts(&candidate_refs)?;

    for authority in candidate_authorities {
        let creator_alias = authority.key == creator.key;
        if !creator_alias
            && fixed_roles
                .iter()
                .any(|fixed_role| fixed_role.key == authority.key)
        {
            return Err(GovernanceError::CrossAccountMismatch.into());
        }
        validate_exact_privileges(authority, false, creator_alias, false)?;
    }
    Ok(())
}

fn validate_readonly(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, false, false, false)
}

fn validate_writable(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, true, false, false)
}

fn validate_signer_readonly(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, false, true, false)
}

fn validate_signer_writable(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, true, true, false)
}

fn validate_system_program(account: &AccountInfo<'_>) -> ProgramResult {
    validate_exact_privileges(account, false, false, true)?;
    if *account.key != system_program::ID {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(())
}

fn require_absent_system_account(account: &AccountInfo<'_>) -> ProgramResult {
    if account.owner != &system_program::ID || account.data_len() != 0 || account.executable {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    Ok(())
}

fn load_config(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
) -> Result<Box<ControllerConfigV1>, ProgramError> {
    let config = load_fixed_controller_account::<ControllerConfigV1>(
        program_id,
        account,
        ControllerConfigV1::LEN,
    )?;
    config.validate_static()?;
    let (expected, bump) = derive_controller_config_pda(program_id, &config.target_program);
    let (programdata, _) = derive_upgradeable_programdata_address(&config.target_program);
    let (authority, _) = derive_authority_pda(program_id, &config.target_program);
    let (gate, _) = derive_gate_pda(program_id, &config.target_program);
    if *account.key != expected
        || config.bump != bump
        || config.upgradeable_loader != UPGRADEABLE_LOADER_ID
        || config.target_programdata != programdata
        || config.authority_pda != authority
        || config.gate_pda != gate
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    Ok(config)
}

fn load_gate(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    config_key: &Pubkey,
    config: &ControllerConfigV1,
) -> Result<Box<ProtocolGateV1>, ProgramError> {
    let gate =
        load_fixed_controller_account::<ProtocolGateV1>(program_id, account, ProtocolGateV1::LEN)?;
    gate.validate_static()?;
    let (expected, bump) = derive_gate_pda(program_id, &config.target_program);
    if *account.key != expected
        || *account.key != config.gate_pda
        || gate.bump != bump
        || gate.controller_config != *config_key
        || gate.target_program != config.target_program
        || gate.target_programdata != config.target_programdata
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(gate)
}

fn load_policy(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    config_key: &Pubkey,
    config: &ControllerConfigV1,
    slot: u64,
) -> Result<Box<GovernancePolicyV1>, ProgramError> {
    let policy = load_fixed_controller_account::<GovernancePolicyV1>(
        program_id,
        account,
        GovernancePolicyV1::LEN,
    )?;
    validate_policy_against_config(&policy, config)?;
    let (expected, bump) = derive_policy_pda(
        program_id,
        &config.target_program,
        config.current_policy_version,
    );
    if *account.key != expected
        || policy.bump != bump
        || policy.controller_config != *config_key
        || policy.activation_slot > slot
    {
        return Err(GovernanceError::InactivePolicy.into());
    }
    Ok(policy)
}

fn load_current_council(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    config_key: &Pubkey,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    slot: u64,
) -> Result<Box<GovernanceCouncilSetV1>, ProgramError> {
    let council = load_fixed_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        account,
        GovernanceCouncilSetV1::LEN,
    )?;
    validate_council_set(&council, policy)?;
    validate_council_guardian_separation(&council, &config.guardian)?;
    let (expected, bump) = derive_council_pda(
        program_id,
        &config.target_program,
        config.current_council_version,
    );
    if *account.key != expected
        || council.bump != bump
        || council.controller_config != *config_key
        || council.version != config.current_council_version
        || !council.active_at(slot)
    {
        return Err(GovernanceError::StaleCouncilVersion.into());
    }
    Ok(council)
}

fn validate_gate_guard(
    gate: &ProtocolGateV1,
    expected_status: GateStatusV1,
    expected_epoch: u64,
) -> GovernanceResult<()> {
    if gate.status != expected_status || gate.epoch != expected_epoch {
        return Err(GovernanceError::InvalidProposalEpoch);
    }
    Ok(())
}

fn validate_current_seat_at_index(
    council: &GovernanceCouncilSetV1,
    seat_index: u8,
    authority: &Pubkey,
    slot: u64,
) -> GovernanceResult<()> {
    let seat = council
        .seats
        .get(usize::from(seat_index))
        .ok_or(GovernanceError::UnknownSeatAuthority)?;
    if seat.seat_authority != *authority {
        return Err(GovernanceError::UnknownSeatAuthority);
    }
    if !council.active_at(slot) || !seat.term_covers(slot) {
        return Err(GovernanceError::InactiveCouncilSeat);
    }
    Ok(())
}

fn validate_approval_mask_at(
    council: &GovernanceCouncilSetV1,
    bitset: u8,
    count: u8,
    slot: u64,
) -> GovernanceResult<()> {
    if bitset & !VALID_APPROVAL_MASK != 0 {
        return Err(GovernanceError::InvalidApprovalBitset);
    }
    if bitset.count_ones() as u8 != count {
        return Err(GovernanceError::ApprovalCountMismatch);
    }
    if count != EXACT_ROUTINE_APPROVAL_MASK_COUNT || !council.active_at(slot) {
        return Err(GovernanceError::QuorumNotSatisfied);
    }
    for (index, seat) in council.seats.iter().enumerate() {
        if bitset & (1 << index) != 0 && !seat.term_covers(slot) {
            return Err(GovernanceError::InactiveCouncilSeat);
        }
    }
    Ok(())
}

fn validate_checkpoint_council_guard(
    instruction_council_version: u64,
    instruction_council_hash: &[u8; 32],
    council: &GovernanceCouncilSetV1,
) -> GovernanceResult<()> {
    if instruction_council_version != council.version {
        return Err(GovernanceError::StaleCouncilVersion);
    }
    if instruction_council_hash != &council.set_hash {
        return Err(GovernanceError::ProposalCouncilHashMismatch);
    }
    Ok(())
}

fn phase_to_pda_phase(phase: StateCheckpointPhaseV1) -> GovernanceResult<CheckpointPhaseV1> {
    match phase {
        StateCheckpointPhaseV1::Prestate => Ok(CheckpointPhaseV1::Prestate),
        StateCheckpointPhaseV1::Poststate => Ok(CheckpointPhaseV1::Poststate),
        StateCheckpointPhaseV1::Emergency => Err(GovernanceError::InvalidRelease1Account),
    }
}

fn validate_proposal_subject(
    context: &CheckpointSubjectContext<'_, '_>,
) -> Result<CheckpointBinding, ProgramError> {
    let program_id = context.program_id;
    let subject_info = context.subject_info;
    let checkpoint_info = context.checkpoint_info;
    let config_key = context.config_key;
    let config = context.config;
    let gate_key = context.gate_key;
    let gate = context.gate;
    let candidate = context.candidate;
    let proposal = load_fixed_controller_account::<UpgradeProposalV2>(
        program_id,
        subject_info,
        UpgradeProposalV2::LEN,
    )?;
    validate_proposal_digest_v2(&proposal)?;
    let (proposal_pda, bump) =
        derive_proposal_pda(program_id, &config.target_program, proposal.proposal_id);
    if *subject_info.key != proposal_pda
        || proposal.bump != bump
        || proposal.controller_program != *program_id
        || proposal.controller_config != *config_key
        || proposal.protocol_gate != *gate_key
        || proposal.target_program != config.target_program
        || proposal.target_programdata != config.target_programdata
        || proposal.upgradeable_loader != config.upgradeable_loader
        || proposal.authority_pda != config.authority_pda
        || proposal.target_nonce.checked_add(1) != Some(config.target_nonce)
        || proposal.freeze_gate_epoch != gate.epoch
        || gate.status != GateStatusV1::FrozenForUpgrade
        || gate.active_proposal != *subject_info.key
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let (required_state, required_subject_state, required_checkpoint) = match candidate.phase {
        StateCheckpointPhaseV1::Prestate => (
            ProposalStateV2::Frozen,
            CheckpointSubjectStateV1::ProposalFrozen,
            proposal.prestate_checkpoint,
        ),
        StateCheckpointPhaseV1::Poststate => (
            ProposalStateV2::ProgramDataVerified,
            CheckpointSubjectStateV1::ProposalProgramDataVerified,
            proposal.required_poststate_checkpoint,
        ),
        StateCheckpointPhaseV1::Emergency => {
            return Err(GovernanceError::InvalidStateTransition.into())
        }
    };
    if proposal.state != required_state
        || candidate.expected_subject_state != required_subject_state
        || candidate.expected_subject_digest != proposal.proposal_digest
        || candidate.expected_gate_status != GateStatusV1::FrozenForUpgrade
        || candidate.expected_gate_epoch != gate.epoch
        || candidate.schema_identifier != proposal.checkpoint_schema_id
        || candidate.finalized_observation_slot < gate.freeze_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let pda_phase = phase_to_pda_phase(candidate.phase)?;
    let (checkpoint, checkpoint_bump) =
        derive_checkpoint_pda(program_id, subject_info.key, pda_phase);
    if *checkpoint_info.key != checkpoint || checkpoint != required_checkpoint {
        return Err(GovernanceError::InvalidPda.into());
    }
    Ok(CheckpointBinding {
        subject: CheckpointSubject::Proposal(proposal),
        subject_key: *subject_info.key,
        subject_digest: candidate.expected_subject_digest,
        checkpoint,
        checkpoint_bump,
    })
}

fn validate_emergency_subject(
    context: &CheckpointSubjectContext<'_, '_>,
) -> Result<CheckpointBinding, ProgramError> {
    let program_id = context.program_id;
    let subject_info = context.subject_info;
    let checkpoint_info = context.checkpoint_info;
    let config_key = context.config_key;
    let config = context.config;
    let gate_key = context.gate_key;
    let gate = context.gate;
    let candidate = context.candidate;
    let resolution = load_fixed_controller_account::<EmergencyFreezeResolutionV1>(
        program_id,
        subject_info,
        EmergencyFreezeResolutionV1::LEN,
    )?;
    validate_emergency_resolution_digest_v1(&resolution)?;
    let (resolution_pda, bump) = derive_emergency_resolution_pda(
        program_id,
        &config.target_program,
        resolution.frozen_epoch,
    );
    if *subject_info.key != resolution_pda
        || resolution.bump != bump
        || resolution.controller_config != *config_key
        || resolution.protocol_gate != *gate_key
        || resolution.target_program != config.target_program
        || resolution.target_programdata != config.target_programdata
        || resolution.target_nonce != config.target_nonce
        || resolution.frozen_epoch != gate.epoch
        || resolution.freeze_slot != gate.freeze_slot
        || resolution.freeze_reason_code != gate.freeze_reason_code
        || gate.status != GateStatusV1::EmergencyFrozen
        || gate.active_proposal != Pubkey::default()
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if resolution.state != EmergencyFreezeResolutionStateV1::Timelocked
        || candidate.phase != StateCheckpointPhaseV1::Emergency
        || candidate.expected_subject_state
            != CheckpointSubjectStateV1::EmergencyResolutionTimelocked
        || candidate.expected_subject_digest != resolution.resolution_digest
        || candidate.expected_gate_status != GateStatusV1::EmergencyFrozen
        || candidate.expected_gate_epoch != gate.epoch
        || candidate.finalized_observation_slot < gate.freeze_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let (checkpoint, checkpoint_bump) = derive_emergency_checkpoint_pda(
        program_id,
        &config.target_program,
        resolution.frozen_epoch,
    );
    if *checkpoint_info.key != checkpoint || checkpoint != resolution.emergency_checkpoint {
        return Err(GovernanceError::InvalidPda.into());
    }
    Ok(CheckpointBinding {
        subject: CheckpointSubject::Emergency(resolution),
        subject_key: *subject_info.key,
        subject_digest: candidate.expected_subject_digest,
        checkpoint,
        checkpoint_bump,
    })
}

fn validate_checkpoint_subject(
    context: &CheckpointSubjectContext<'_, '_>,
) -> Result<CheckpointBinding, ProgramError> {
    match context.candidate.phase {
        StateCheckpointPhaseV1::Prestate | StateCheckpointPhaseV1::Poststate => {
            validate_proposal_subject(context)
        }
        StateCheckpointPhaseV1::Emergency => validate_emergency_subject(context),
    }
}

fn checkpoint_from_candidate(
    candidate: &CheckpointCandidateV1,
    binding: &CheckpointBinding,
    config_key: Pubkey,
    config: &ControllerConfigV1,
    finalization: CheckpointFinalizationFields,
) -> StateCheckpointV1 {
    let (proposal, emergency_resolution) = match &binding.subject {
        CheckpointSubject::Proposal(_) => (binding.subject_key, Pubkey::default()),
        CheckpointSubject::Emergency(_) => (Pubkey::default(), binding.subject_key),
    };
    StateCheckpointV1 {
        discriminator: STATE_CHECKPOINT_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: binding.checkpoint_bump,
        initialized: true,
        phase: candidate.phase,
        controller_config: config_key,
        proposal,
        emergency_resolution,
        subject_digest: binding.subject_digest,
        target_program: config.target_program,
        target_programdata: config.target_programdata,
        finalized_observation_slot: candidate.finalized_observation_slot,
        gate_epoch: candidate.expected_gate_epoch,
        target_programdata_slot: candidate.target_programdata_slot,
        target_payload_commitment: candidate.target_payload_commitment,
        target_raw_programdata_commitment: candidate.target_raw_programdata_commitment,
        target_capacity: candidate.target_capacity,
        program_owned_state_root: candidate.program_owned_state_root,
        program_owned_state_count: candidate.program_owned_state_count,
        logical_compressed_state_root: candidate.logical_compressed_state_root,
        logical_compressed_state_count: candidate.logical_compressed_state_count,
        semantic_custody_accounting_root: candidate.semantic_custody_accounting_root,
        hard_combined_root: candidate.hard_combined_root,
        external_metadata_observation_root: candidate.external_metadata_observation_root,
        external_raw_balance_observation_root: candidate.external_raw_balance_observation_root,
        schema_identifier: candidate.schema_identifier,
        admitted_positive_donation_root: candidate.admitted_positive_donation_root,
        admitted_positive_donation_count: candidate.admitted_positive_donation_count,
        forbidden_drift_count: candidate.forbidden_drift_count,
        approval_council_version: finalization.council_version,
        approval_council_hash: finalization.council_hash,
        checkpoint_digest: candidate.expected_checkpoint_digest,
        approval_bitset: finalization.approval_bitset,
        approval_count: finalization.approval_bitset.count_ones() as u8,
        accepted: candidate.forbidden_drift_count == 0,
        finalized_slot: finalization.finalized_slot,
        reserved: [0; STATE_CHECKPOINT_V1_RESERVED_LEN],
    }
}

fn validate_checkpoint_candidate(
    candidate: &CheckpointCandidateV1,
    binding: &CheckpointBinding,
    config_key: Pubkey,
    config: &ControllerConfigV1,
    council: &GovernanceCouncilSetV1,
    slot: u64,
) -> Result<StateCheckpointV1, ProgramError> {
    validate_checkpoint_acceptance_shape(candidate)?;
    if candidate.finalized_observation_slot == 0
        || candidate.finalized_observation_slot > slot
        || candidate.target_programdata_slot > candidate.finalized_observation_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let prototype = checkpoint_from_candidate(
        candidate,
        binding,
        config_key,
        config,
        CheckpointFinalizationFields {
            council_version: council.version,
            council_hash: council.set_hash,
            approval_bitset: 0b0000_0111,
            finalized_slot: slot,
        },
    );
    prototype.validate_schema()?;
    if compute_state_checkpoint_hard_combined_root_v1(&prototype)? != candidate.hard_combined_root
        || compute_state_checkpoint_digest_v1(&prototype)? != candidate.expected_checkpoint_digest
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    Ok(prototype)
}

fn validate_checkpoint_acceptance_shape(candidate: &CheckpointCandidateV1) -> GovernanceResult<()> {
    // Prestate and emergency resolution are admissibility proofs and therefore
    // cannot be stored as rejected evidence.  Poststate has a typed rejected
    // lane for rollback, but finalization validates its concrete mismatch
    // against the accepted Prestate before creating the checkpoint PDA.
    if candidate.phase != StateCheckpointPhaseV1::Poststate && candidate.forbidden_drift_count != 0
    {
        return Err(GovernanceError::InvalidRelease1Account);
    }
    Ok(())
}

fn build_attestation(
    context: &AttestationBuildContext<'_>,
) -> Result<CheckpointAttestationV1, ProgramError> {
    let mut attestation = CheckpointAttestationV1 {
        discriminator: CHECKPOINT_ATTESTATION_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: context.attestation_bump,
        initialized: true,
        controller_program: *context.program_id,
        controller_config: context.config_key,
        checkpoint: context.checkpoint,
        subject: context.subject,
        subject_digest: context.candidate.expected_subject_digest,
        phase: context.candidate.phase,
        checkpoint_digest: context.candidate.expected_checkpoint_digest,
        council: context.council_key,
        council_version: context.council.version,
        council_hash: context.council.set_hash,
        gate_epoch: context.candidate.expected_gate_epoch,
        seat_index: context.seat_index,
        seat_authority: context.seat_authority,
        attested_slot: context.slot,
        attestation_digest: [0; 32],
        reserved: [0; CHECKPOINT_ATTESTATION_V1_RESERVED_LEN],
    };
    attestation.attestation_digest = compute_checkpoint_attestation_digest_v1(&attestation)?;
    validate_checkpoint_attestation_digest_v1(&attestation)?;
    Ok(attestation)
}

fn create_attestation_pda<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    attestation_info: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    attestation: &CheckpointAttestationV1,
) -> ProgramResult {
    let council_version = attestation.council_version.to_le_bytes();
    let seat_index = [attestation.seat_index];
    let bump = [attestation.bump];
    let seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        CHECKPOINT_ATTESTATION_SEED,
        attestation.checkpoint.as_ref(),
        &council_version,
        &seat_index,
        &bump,
    ];
    let encoded = encode_fixed_account(attestation, CheckpointAttestationV1::LEN)?;
    create_fixed_pda_account(
        program_id,
        payer,
        attestation_info,
        system_program_info,
        &Rent::get()?,
        CheckpointAttestationV1::LEN,
        seeds,
    )?;
    let mut data = attestation_info.try_borrow_mut_data()?;
    data.copy_from_slice(&encoded);
    Ok(())
}

pub fn process_create_checkpoint_attestation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateCheckpointAttestationV1,
) -> ProgramResult {
    exact_account_count(accounts, 10)?;
    all_distinct(accounts)?;
    let [payer, config_info, policy_info, council_info, gate_info, subject_info, checkpoint_info, attestation_info, seat_authority, system_program_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    validate_signer_writable(payer)?;
    for readonly in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        subject_info,
        checkpoint_info,
    ] {
        validate_readonly(readonly)?;
    }
    validate_writable(attestation_info)?;
    validate_signer_readonly(seat_authority)?;
    validate_system_program(system_program_info)?;
    require_absent_system_account(checkpoint_info)?;
    require_absent_system_account(attestation_info)?;

    let slot = current_slot()?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info.key, &config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info.key,
        &config,
        &policy,
        slot,
    )?;
    let gate = load_gate(program_id, gate_info, config_info.key, &config)?;
    validate_checkpoint_council_guard(
        instruction.expected_council_version,
        &instruction.expected_council_hash,
        &council,
    )?;
    validate_gate_guard(
        &gate,
        instruction.candidate.expected_gate_status,
        instruction.candidate.expected_gate_epoch,
    )?;
    validate_current_seat_at_index(&council, instruction.seat_index, seat_authority.key, slot)?;
    let subject_context = CheckpointSubjectContext {
        program_id,
        subject_info,
        checkpoint_info,
        config_key: config_info.key,
        config: &config,
        gate_key: gate_info.key,
        gate: &gate,
        candidate: &instruction.candidate,
    };
    let binding = validate_checkpoint_subject(&subject_context)?;
    validate_checkpoint_candidate(
        &instruction.candidate,
        &binding,
        *config_info.key,
        &config,
        &council,
        slot,
    )?;
    let (expected_attestation, attestation_bump) = derive_checkpoint_attestation_pda(
        program_id,
        &binding.checkpoint,
        council.version,
        instruction.seat_index,
    );
    if *attestation_info.key != expected_attestation {
        return Err(GovernanceError::InvalidPda.into());
    }
    let attestation = build_attestation(&AttestationBuildContext {
        program_id,
        attestation_bump,
        checkpoint: binding.checkpoint,
        subject: binding.subject_key,
        candidate: &instruction.candidate,
        council_key: *council_info.key,
        council: &council,
        seat_index: instruction.seat_index,
        seat_authority: *seat_authority.key,
        slot,
        config_key: *config_info.key,
    })?;
    create_attestation_pda(
        program_id,
        payer,
        attestation_info,
        system_program_info,
        &attestation,
    )
}

pub fn process_recast_checkpoint_attestation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: RecastCheckpointAttestationV1,
) -> ProgramResult {
    exact_account_count(accounts, 8)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, council_info, gate_info, subject_info, checkpoint_info, attestation_info, seat_authority] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for readonly in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        subject_info,
        checkpoint_info,
    ] {
        validate_readonly(readonly)?;
    }
    validate_writable(attestation_info)?;
    validate_signer_readonly(seat_authority)?;
    require_absent_system_account(checkpoint_info)?;

    let slot = current_slot()?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info.key, &config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info.key,
        &config,
        &policy,
        slot,
    )?;
    let gate = load_gate(program_id, gate_info, config_info.key, &config)?;
    validate_checkpoint_council_guard(
        instruction.expected_council_version,
        &instruction.expected_council_hash,
        &council,
    )?;
    validate_gate_guard(
        &gate,
        instruction.candidate.expected_gate_status,
        instruction.candidate.expected_gate_epoch,
    )?;
    validate_current_seat_at_index(&council, instruction.seat_index, seat_authority.key, slot)?;
    let subject_context = CheckpointSubjectContext {
        program_id,
        subject_info,
        checkpoint_info,
        config_key: config_info.key,
        config: &config,
        gate_key: gate_info.key,
        gate: &gate,
        candidate: &instruction.candidate,
    };
    let binding = validate_checkpoint_subject(&subject_context)?;
    validate_checkpoint_candidate(
        &instruction.candidate,
        &binding,
        *config_info.key,
        &config,
        &council,
        slot,
    )?;

    let current_attestation = load_fixed_controller_account::<CheckpointAttestationV1>(
        program_id,
        attestation_info,
        CheckpointAttestationV1::LEN,
    )?;
    validate_checkpoint_attestation_digest_v1(&current_attestation)?;
    let (expected_attestation, bump) = derive_checkpoint_attestation_pda(
        program_id,
        &binding.checkpoint,
        council.version,
        instruction.seat_index,
    );
    if *attestation_info.key != expected_attestation
        || current_attestation.bump != bump
        || current_attestation.controller_program != *program_id
        || current_attestation.controller_config != *config_info.key
        || current_attestation.checkpoint != binding.checkpoint
        || current_attestation.subject != binding.subject_key
        || current_attestation.council != *council_info.key
        || current_attestation.council_version != council.version
        || current_attestation.council_hash != council.set_hash
        || current_attestation.gate_epoch != gate.epoch
        || current_attestation.seat_index != instruction.seat_index
        || current_attestation.seat_authority != *seat_authority.key
        || current_attestation.attestation_digest
            != instruction.expected_previous_attestation_digest
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let recast = build_attestation(&AttestationBuildContext {
        program_id,
        attestation_bump: bump,
        checkpoint: binding.checkpoint,
        subject: binding.subject_key,
        candidate: &instruction.candidate,
        council_key: *council_info.key,
        council: &council,
        seat_index: instruction.seat_index,
        seat_authority: *seat_authority.key,
        slot,
        config_key: *config_info.key,
    })?;
    store_fixed_controller_account(
        program_id,
        attestation_info,
        &recast,
        CheckpointAttestationV1::LEN,
    )
}

fn validate_target_snapshot(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    candidate: &CheckpointCandidateV1,
) -> ProgramResult {
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
    let data = target_programdata.try_borrow_data()?;
    // One full-account SHA pass is the mechanical live-byte check.  The
    // checkpoint's payload commitment remains governance-attested and is
    // cross-bound by the phase-specific proposal or verification evidence;
    // recomputing the convenience payload SHA here would exceed the maximum
    // transaction compute budget for a maximum-size ProgramData account.
    let raw_hash = loader_account_data_hash(&data);
    if header.deployed_slot != candidate.target_programdata_slot
        || header.capacity as u64 != candidate.target_capacity
        || raw_hash != candidate.target_raw_programdata_commitment
        || header.upgrade_authority != Some(config.authority_pda)
    {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    Ok(())
}

fn validate_buffer_phase_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    let evidence = load_fixed_controller_account::<BufferVerificationV1>(
        program_id,
        evidence_info,
        BufferVerificationV1::LEN,
    )?;
    evidence.validate_schema()?;
    let (expected, bump) = derive_buffer_check_pda(program_id, &proposal_key(program_id, proposal));
    if *evidence_info.key != expected
        || evidence.bump != bump
        || evidence.status != BufferVerificationStatusV1::Verified
        || evidence.controller_config != *config_info.key
        || evidence.proposal != proposal_key(program_id, proposal)
        || evidence.upgradeable_loader != config.upgradeable_loader
        || evidence.buffer != proposal.buffer_pubkey
        || evidence.expected_uploader_authority != proposal.buffer_uploader_authority
        || evidence.controller_authority != config.authority_pda
        || evidence.artifact_length != proposal.artifact_length
        || evidence.artifact_sha256 != proposal.artifact_sha256
        || evidence.artifact_chunk_merkle_root != proposal.artifact_chunk_merkle_root
        || evidence.chunk_hash_domain != proposal.chunk_hash_domain
        || evidence.chunk_size != proposal.chunk_size
        || evidence.chunk_count != proposal.chunk_count
        || evidence.finalized_slot == 0
        || evidence.finalized_slot > candidate.finalized_observation_slot
        || proposal.deployed_slot != candidate.target_programdata_slot
        || proposal.current_capacity != candidate.target_capacity
        || proposal.current_raw_programdata_hash != candidate.target_raw_programdata_commitment
        || proposal.expected_execution_pre_payload_hash != candidate.target_payload_commitment
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(evidence.finalized_slot)
}

fn validate_rollback_prestate_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    rollback: &UpgradeProposalV2,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    if rollback.proposal_class != ProposalClassV1::EmergencyRollback
        || !rollback.primary_proposal.present
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_rollback_prestate_evidence_commitment(
        program_id,
        evidence_info,
        config_info,
        config,
        &RollbackPrestateCommitment {
            primary_proposal: rollback.primary_proposal.value,
            expected_candidate_full_payload_sha256: rollback.expected_execution_pre_payload_hash,
            artifact_chunk_merkle_root: rollback.expected_execution_pre_chunk_root,
            chunk_hash_domain: rollback.chunk_hash_domain,
            capacity: rollback.current_capacity,
        },
        candidate,
    )
}

fn validate_rollback_prestate_evidence_commitment(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    commitment: &RollbackPrestateCommitment,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    match evidence_info.data_len() {
        ProgramDataVerificationV1::LEN => validate_rollback_verified_programdata_evidence(
            program_id,
            evidence_info,
            config_info,
            config,
            commitment,
            candidate,
        ),
        ProgramDataFailureObservationV1::LEN => validate_rollback_programdata_failure_evidence(
            program_id,
            evidence_info,
            config_info,
            config,
            commitment,
            candidate,
        ),
        _ => Err(GovernanceError::InvalidAccountSize.into()),
    }
}

#[inline(never)]
fn validate_rollback_verified_programdata_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    commitment: &RollbackPrestateCommitment,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    let evidence = load_fixed_controller_account::<ProgramDataVerificationV1>(
        program_id,
        evidence_info,
        ProgramDataVerificationV1::LEN,
    )?;
    evidence.validate_schema()?;
    let (expected, bump) = derive_programdata_check_pda(program_id, &commitment.primary_proposal);
    if *evidence_info.key != expected
        || evidence.bump != bump
        || evidence.status != ProgramDataVerificationStatusV1::Verified
        || evidence.controller_config != *config_info.key
        || evidence.proposal != commitment.primary_proposal
        || evidence.target_program != config.target_program
        || evidence.target_programdata != config.target_programdata
        || evidence.upgradeable_loader != config.upgradeable_loader
        || evidence.controller_authority != config.authority_pda
        || evidence.artifact_chunk_merkle_root != commitment.artifact_chunk_merkle_root
        || evidence.chunk_hash_domain != commitment.chunk_hash_domain
        || !evidence.zero_tail_verified
        || evidence.deployed_slot != candidate.target_programdata_slot
        || evidence.raw_programdata_hash != candidate.target_raw_programdata_commitment
        || evidence.capacity != commitment.capacity
        || evidence.capacity != candidate.target_capacity
        || candidate.target_payload_commitment != commitment.expected_candidate_full_payload_sha256
        || evidence.finalized_slot == 0
        || evidence.finalized_slot > candidate.finalized_observation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(evidence.finalized_slot)
}

#[inline(never)]
fn validate_rollback_programdata_failure_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    commitment: &RollbackPrestateCommitment,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    let evidence = load_fixed_controller_account::<ProgramDataFailureObservationV1>(
        program_id,
        evidence_info,
        ProgramDataFailureObservationV1::LEN,
    )?;
    validate_programdata_failure_observation_digest_v1(&evidence)?;

    // Rollback activation is a continuously frozen epoch transition. The
    // failure observation belongs to the primary epoch and the rollback
    // Prestate belongs to the immediately following epoch.
    let rollback_epoch = evidence
        .frozen_epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let actual_data_length = evidence
        .actual_capacity
        .checked_add(LOADER_V3_PROGRAMDATA_METADATA_LEN_V1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let (expected, bump) = derive_programdata_failure_observation_pda(
        program_id,
        &commitment.primary_proposal,
        evidence.frozen_epoch,
    );
    let leaf_failure = matches!(
        evidence.mismatch_class,
        ProgramDataMismatchClassV1::PayloadLeaf | ProgramDataMismatchClassV1::ZeroTail
    );
    if *evidence_info.key != expected
        || evidence.bump != bump
        || evidence.controller_config != *config_info.key
        || evidence.protocol_gate != config.gate_pda
        || evidence.primary_proposal != commitment.primary_proposal
        || evidence.target_program != config.target_program
        || evidence.target_programdata != config.target_programdata
        || rollback_epoch != candidate.expected_gate_epoch
        || evidence.actual_program_owner != config.upgradeable_loader
        || !evidence.actual_program_executable
        || evidence.actual_program_data_length != LOADER_V3_PROGRAM_ACCOUNT_LEN_V1
        || !evidence.program_header_present
        || !evidence.actual_linked_programdata.present
        || evidence.actual_linked_programdata.value != config.target_programdata
        || !evidence.raw_hash_complete
        || evidence.actual_raw_programdata_sha256 != candidate.target_raw_programdata_commitment
        || evidence.actual_owner != config.upgradeable_loader
        || evidence.actual_executable
        || evidence.actual_data_length != actual_data_length
        || !evidence.programdata_header_present
        || evidence.actual_programdata_slot != candidate.target_programdata_slot
        || evidence.actual_capacity != commitment.capacity
        || evidence.actual_capacity != candidate.target_capacity
        || !evidence.actual_authority.present
        || evidence.actual_authority.value != config.authority_pda
        || !leaf_failure
        // A leaf mismatch proves that the deployed payload is not the expected
        // candidate payload. This checkpoint field intentionally records the
        // rollback proposal's expected candidate full-capacity payload
        // commitment; the separate raw ProgramData commitment records the
        // actual deployed bytes observed in the failure account.
        || candidate.target_payload_commitment
            != commitment.expected_candidate_full_payload_sha256
        || evidence.finalized_slot > candidate.finalized_observation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(evidence.finalized_slot)
}

fn validate_programdata_phase_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    proposal: &UpgradeProposalV2,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    let evidence = load_fixed_controller_account::<ProgramDataVerificationV1>(
        program_id,
        evidence_info,
        ProgramDataVerificationV1::LEN,
    )?;
    evidence.validate_schema()?;
    let proposal_key = proposal_key(program_id, proposal);
    let (expected, bump) = derive_programdata_check_pda(program_id, &proposal_key);
    if *evidence_info.key != expected
        || evidence.bump != bump
        || evidence.status != ProgramDataVerificationStatusV1::Verified
        || evidence.controller_config != *config_info.key
        || evidence.proposal != proposal_key
        || evidence.target_program != config.target_program
        || evidence.target_programdata != config.target_programdata
        || evidence.upgradeable_loader != config.upgradeable_loader
        || evidence.controller_authority != config.authority_pda
        || evidence.artifact_length != proposal.artifact_length
        || evidence.artifact_sha256 != proposal.artifact_sha256
        || evidence.artifact_chunk_merkle_root != proposal.artifact_chunk_merkle_root
        || evidence.chunk_hash_domain != proposal.chunk_hash_domain
        || evidence.chunk_size != proposal.chunk_size
        || evidence.payload_chunk_count != proposal.chunk_count
        || evidence.deployed_slot != candidate.target_programdata_slot
        || evidence.capacity != candidate.target_capacity
        || evidence.raw_programdata_hash != candidate.target_raw_programdata_commitment
        || evidence.finalized_slot == 0
        || evidence.finalized_slot != proposal.programdata_verified_slot
        || evidence.finalized_slot > candidate.finalized_observation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(evidence.finalized_slot)
}

fn proposal_key(program_id: &Pubkey, proposal: &UpgradeProposalV2) -> Pubkey {
    derive_proposal_pda(program_id, &proposal.target_program, proposal.proposal_id).0
}

fn validate_emergency_phase_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    resolution: &EmergencyFreezeResolutionV1,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    let observation = load_fixed_controller_account::<EmergencyFreezeObservationV1>(
        program_id,
        evidence_info,
        EmergencyFreezeObservationV1::LEN,
    )?;
    validate_emergency_freeze_observation_digest_v1(&observation)?;
    let (expected, bump) = derive_emergency_freeze_observation_pda(
        program_id,
        &config.target_program,
        resolution.frozen_epoch,
    );
    if *evidence_info.key != expected
        || observation.bump != bump
        || resolution.emergency_freeze_observation != *evidence_info.key
        || observation.controller_program != *program_id
        || observation.controller_config != *config_info.key
        || observation.protocol_gate != *gate_info.key
        || observation.target_program != config.target_program
        || observation.target_programdata != config.target_programdata
        || observation.upgradeable_loader != config.upgradeable_loader
        || observation.controller_authority != config.authority_pda
        || observation.frozen_epoch != resolution.frozen_epoch
        || observation.freeze_slot != resolution.freeze_slot
        || observation.freeze_reason_code != resolution.freeze_reason_code
        || observation.actual_program_owner != resolution.observed_program_owner
        || observation.actual_program_executable != resolution.observed_program_executable
        || observation.actual_program_data_length != resolution.observed_program_data_length
        || observation.program_header_present != resolution.observed_program_header_present
        || observation.actual_linked_programdata != resolution.observed_linked_programdata
        || observation.actual_programdata_owner != resolution.observed_programdata_owner
        || observation.actual_programdata_executable != resolution.observed_programdata_executable
        || observation.actual_programdata_data_length != resolution.observed_programdata_data_length
        || observation.programdata_header_present != resolution.observed_programdata_header_present
        || observation.deployed_programdata_slot != resolution.observed_programdata_slot
        || observation.raw_hash_complete != resolution.observed_raw_hash_complete
        || observation.raw_programdata_sha256 != resolution.observed_raw_programdata_hash
        || observation.capacity != resolution.observed_capacity
        || observation.observed_authority != resolution.observed_authority
        || observation.finalized_slot > candidate.finalized_observation_slot
        || resolution.creation_slot > candidate.finalized_observation_slot
        || (observation.raw_hash_complete
            && observation.raw_programdata_sha256 != candidate.target_raw_programdata_commitment)
        || (observation.programdata_header_present
            && (observation.deployed_programdata_slot != candidate.target_programdata_slot
                || observation.capacity != candidate.target_capacity))
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    Ok(observation.finalized_slot)
}

fn validate_phase_evidence(
    program_id: &Pubkey,
    evidence_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    gate_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    binding: &CheckpointBinding,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    match &binding.subject {
        CheckpointSubject::Proposal(proposal) => match candidate.phase {
            StateCheckpointPhaseV1::Prestate => {
                if proposal.proposal_class == ProposalClassV1::EmergencyRollback {
                    validate_rollback_prestate_evidence(
                        program_id,
                        evidence_info,
                        config_info,
                        config,
                        proposal,
                        candidate,
                    )
                } else {
                    validate_buffer_phase_evidence(
                        program_id,
                        evidence_info,
                        config_info,
                        config,
                        proposal,
                        candidate,
                    )
                }
            }
            StateCheckpointPhaseV1::Poststate => validate_programdata_phase_evidence(
                program_id,
                evidence_info,
                config_info,
                config,
                proposal,
                candidate,
            ),
            StateCheckpointPhaseV1::Emergency => {
                Err(GovernanceError::InvalidStateTransition.into())
            }
        },
        CheckpointSubject::Emergency(resolution) => {
            if candidate.phase != StateCheckpointPhaseV1::Emergency {
                return Err(GovernanceError::InvalidStateTransition.into());
            }
            validate_emergency_phase_evidence(
                program_id,
                evidence_info,
                config_info,
                gate_info,
                config,
                resolution,
                candidate,
            )
        }
    }
}

fn validate_poststate_baseline(
    program_id: &Pubkey,
    baseline_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    binding: &CheckpointBinding,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    let CheckpointSubject::Proposal(proposal) = &binding.subject else {
        return Err(GovernanceError::InvalidStateTransition.into());
    };
    let baseline = load_fixed_controller_account::<StateCheckpointV1>(
        program_id,
        baseline_info,
        StateCheckpointV1::LEN,
    )?;
    validate_state_checkpoint_digest_v1(&baseline)?;
    let proposal_key = proposal_key(program_id, proposal);
    let (expected, bump) =
        derive_checkpoint_pda(program_id, &proposal_key, CheckpointPhaseV1::Prestate);
    if *baseline_info.key != expected
        || baseline.bump != bump
        || proposal.prestate_checkpoint != *baseline_info.key
        || baseline.phase != StateCheckpointPhaseV1::Prestate
        || !baseline.accepted
        || baseline.forbidden_drift_count != 0
        || baseline.controller_config != *config_info.key
        || baseline.proposal != proposal_key
        || baseline.emergency_resolution != Pubkey::default()
        || baseline.subject_digest != proposal.proposal_digest
        || baseline.target_program != config.target_program
        || baseline.target_programdata != config.target_programdata
        || baseline.gate_epoch != candidate.expected_gate_epoch
        || baseline.finalized_slot > candidate.finalized_observation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    validate_poststate_outcome(&baseline, candidate)?;
    Ok(baseline.finalized_slot)
}

fn validate_rollback_prestate_baseline(
    program_id: &Pubkey,
    baseline_info: &AccountInfo<'_>,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    binding: &CheckpointBinding,
    candidate: &CheckpointCandidateV1,
) -> Result<u64, ProgramError> {
    let CheckpointSubject::Proposal(rollback) = &binding.subject else {
        return Err(GovernanceError::InvalidStateTransition.into());
    };
    if candidate.phase != StateCheckpointPhaseV1::Prestate
        || rollback.proposal_class != ProposalClassV1::EmergencyRollback
        || !rollback.primary_proposal.present
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    let baseline = load_fixed_controller_account::<StateCheckpointV1>(
        program_id,
        baseline_info,
        StateCheckpointV1::LEN,
    )?;
    validate_state_checkpoint_digest_v1(&baseline)?;
    let (expected, bump) = derive_checkpoint_pda(
        program_id,
        &rollback.primary_proposal.value,
        CheckpointPhaseV1::Prestate,
    );
    let rollback_epoch = baseline
        .gate_epoch
        .checked_add(1)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if *baseline_info.key != expected
        || baseline.bump != bump
        || baseline.phase != StateCheckpointPhaseV1::Prestate
        || !baseline.accepted
        || baseline.forbidden_drift_count != 0
        || baseline.controller_config != *config_info.key
        || baseline.proposal != rollback.primary_proposal.value
        || baseline.emergency_resolution != Pubkey::default()
        || baseline.target_program != config.target_program
        || baseline.target_programdata != config.target_programdata
        || baseline.schema_identifier != rollback.checkpoint_schema_id
        || rollback_epoch != candidate.expected_gate_epoch
        || baseline.finalized_slot > candidate.finalized_observation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }

    // A rollback is not allowed to establish a new protected-state baseline.
    // It inherits the primary's accepted Prestate exactly; only the existing,
    // explicitly attested nonnegative-donation lane may explain raw external
    // balance drift.
    validate_poststate_hard_invariants(&baseline, candidate)?;
    Ok(baseline.finalized_slot)
}

fn validate_poststate_outcome(
    baseline: &StateCheckpointV1,
    candidate: &CheckpointCandidateV1,
) -> GovernanceResult<()> {
    if candidate.forbidden_drift_count == 0 {
        validate_poststate_hard_invariants(baseline, candidate)
    } else {
        validate_rejected_poststate_invariants(baseline, candidate)
    }
}

fn validate_poststate_hard_invariants(
    baseline: &StateCheckpointV1,
    candidate: &CheckpointCandidateV1,
) -> GovernanceResult<()> {
    let hard_equal = baseline.schema_identifier == candidate.schema_identifier
        && baseline.program_owned_state_root == candidate.program_owned_state_root
        && baseline.program_owned_state_count == candidate.program_owned_state_count
        && baseline.logical_compressed_state_root == candidate.logical_compressed_state_root
        && baseline.logical_compressed_state_count == candidate.logical_compressed_state_count
        && baseline.semantic_custody_accounting_root == candidate.semantic_custody_accounting_root
        && baseline.external_metadata_observation_root
            == candidate.external_metadata_observation_root
        && baseline.hard_combined_root == candidate.hard_combined_root;
    let raw_balances_equal = baseline.external_raw_balance_observation_root
        == candidate.external_raw_balance_observation_root;
    let explicit_donation = candidate.admitted_positive_donation_count != 0
        && candidate.admitted_positive_donation_root != [0; 32];
    if candidate.forbidden_drift_count != 0
        || !hard_equal
        || (!raw_balances_equal && !explicit_donation)
        || (raw_balances_equal && explicit_donation)
    {
        return Err(GovernanceError::InvalidRelease1Account);
    }
    Ok(())
}

fn validate_rejected_poststate_invariants(
    baseline: &StateCheckpointV1,
    candidate: &CheckpointCandidateV1,
) -> GovernanceResult<()> {
    let protected_state_differs = baseline.schema_identifier != candidate.schema_identifier
        || baseline.program_owned_state_root != candidate.program_owned_state_root
        || baseline.program_owned_state_count != candidate.program_owned_state_count
        || baseline.logical_compressed_state_root != candidate.logical_compressed_state_root
        || baseline.logical_compressed_state_count != candidate.logical_compressed_state_count
        || baseline.semantic_custody_accounting_root != candidate.semantic_custody_accounting_root
        || baseline.external_metadata_observation_root
            != candidate.external_metadata_observation_root
        || baseline.hard_combined_root != candidate.hard_combined_root;
    let external_balance_failure = baseline.external_raw_balance_observation_root
        != candidate.external_raw_balance_observation_root;
    if candidate.forbidden_drift_count == 0
        || (!protected_state_differs && !external_balance_failure)
    {
        return Err(GovernanceError::InvalidRelease1Account);
    }
    Ok(())
}

fn validate_attestation_for_finalization(
    attestation_info: &AccountInfo<'_>,
    context: &AttestationFinalizationContext<'_>,
) -> Result<u8, ProgramError> {
    let attestation = load_fixed_controller_account::<CheckpointAttestationV1>(
        context.program_id,
        attestation_info,
        CheckpointAttestationV1::LEN,
    )?;
    validate_checkpoint_attestation_digest_v1(&attestation)?;
    let (expected, bump) = derive_checkpoint_attestation_pda(
        context.program_id,
        context.checkpoint_key,
        context.council.version,
        attestation.seat_index,
    );
    if *attestation_info.key != expected
        || attestation.bump != bump
        || attestation.controller_program != *context.program_id
        || attestation.controller_config != context.checkpoint.controller_config
        || attestation.checkpoint != *context.checkpoint_key
        || attestation.subject != *context.subject_key
        || attestation.subject_digest != context.checkpoint.subject_digest
        || attestation.phase != context.checkpoint.phase
        || attestation.checkpoint_digest != context.checkpoint.checkpoint_digest
        || attestation.council != *context.council_key
        || attestation.council_version != context.council.version
        || attestation.council_hash != context.council.set_hash
        || attestation.gate_epoch != context.checkpoint.gate_epoch
        || attestation.attested_slot < context.minimum_slot
        || attestation.attested_slot > context.finalization_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_current_seat_at_index(
        context.council,
        attestation.seat_index,
        &attestation.seat_authority,
        attestation.attested_slot,
    )?;
    validate_current_seat_at_index(
        context.council,
        attestation.seat_index,
        &attestation.seat_authority,
        context.finalization_slot,
    )?;
    Ok(attestation.seat_index)
}

fn create_checkpoint_pda_account<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    checkpoint_info: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    checkpoint: &StateCheckpointV1,
) -> ProgramResult {
    let encoded = encode_fixed_account(checkpoint, StateCheckpointV1::LEN)?;
    match checkpoint.phase {
        StateCheckpointPhaseV1::Prestate | StateCheckpointPhaseV1::Poststate => {
            let phase = [checkpoint.phase as u8];
            let bump = [checkpoint.bump];
            let seeds: &[&[u8]] = &[
                UPGRADE_SEED_DOMAIN_V1,
                CHECKPOINT_SEED,
                checkpoint.proposal.as_ref(),
                &phase,
                &bump,
            ];
            create_fixed_pda_account(
                program_id,
                payer,
                checkpoint_info,
                system_program_info,
                &Rent::get()?,
                StateCheckpointV1::LEN,
                seeds,
            )?;
        }
        StateCheckpointPhaseV1::Emergency => {
            let epoch = checkpoint.gate_epoch.to_le_bytes();
            let bump = [checkpoint.bump];
            let seeds: &[&[u8]] = &[
                UPGRADE_SEED_DOMAIN_V1,
                EMERGENCY_CHECKPOINT_SEED,
                checkpoint.target_program.as_ref(),
                &epoch,
                &bump,
            ];
            create_fixed_pda_account(
                program_id,
                payer,
                checkpoint_info,
                system_program_info,
                &Rent::get()?,
                StateCheckpointV1::LEN,
                seeds,
            )?;
        }
    }
    let mut data = checkpoint_info.try_borrow_mut_data()?;
    data.copy_from_slice(&encoded);
    Ok(())
}

pub fn process_finalize_checkpoint_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: FinalizeCheckpointV1,
) -> ProgramResult {
    let poststate = instruction.candidate.phase == StateCheckpointPhaseV1::Poststate;
    match instruction.candidate.phase {
        StateCheckpointPhaseV1::Poststate if accounts.len() != 15 => {
            return Err(GovernanceError::InvalidAccountCount.into())
        }
        StateCheckpointPhaseV1::Emergency if accounts.len() != 14 => {
            return Err(GovernanceError::InvalidAccountCount.into())
        }
        StateCheckpointPhaseV1::Prestate if !matches!(accounts.len(), 14 | 15) => {
            return Err(GovernanceError::InvalidAccountCount.into())
        }
        _ => {}
    }
    all_distinct(accounts)?;

    let payer = &accounts[0];
    let config_info = &accounts[1];
    let policy_info = &accounts[2];
    let council_info = &accounts[3];
    let gate_info = &accounts[4];
    let subject_info = &accounts[5];
    let target_program = &accounts[6];
    let target_programdata = &accounts[7];
    let evidence_info = &accounts[8];
    let baseline_info = (accounts.len() == 15).then(|| &accounts[9]);
    let checkpoint_index = if baseline_info.is_some() { 10 } else { 9 };
    let checkpoint_info = &accounts[checkpoint_index];
    let attestation_infos = &accounts[checkpoint_index + 1..checkpoint_index + 4];
    let system_program_info = &accounts[checkpoint_index + 4];

    validate_signer_writable(payer)?;
    for readonly in [
        config_info,
        policy_info,
        council_info,
        gate_info,
        evidence_info,
    ] {
        validate_readonly(readonly)?;
    }
    validate_exact_privileges(subject_info, poststate, false, false)?;
    validate_exact_privileges(target_program, false, false, true)?;
    validate_readonly(target_programdata)?;
    if let Some(baseline) = baseline_info {
        validate_readonly(baseline)?;
    }
    validate_writable(checkpoint_info)?;
    for attestation in attestation_infos {
        validate_readonly(attestation)?;
    }
    validate_system_program(system_program_info)?;
    require_absent_system_account(checkpoint_info)?;

    let slot = current_slot()?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info.key, &config, slot)?;
    let council = load_current_council(
        program_id,
        council_info,
        config_info.key,
        &config,
        &policy,
        slot,
    )?;
    let gate = load_gate(program_id, gate_info, config_info.key, &config)?;
    validate_checkpoint_council_guard(
        instruction.expected_council_version,
        &instruction.expected_council_hash,
        &council,
    )?;
    validate_gate_guard(
        &gate,
        instruction.candidate.expected_gate_status,
        instruction.candidate.expected_gate_epoch,
    )?;
    let subject_context = CheckpointSubjectContext {
        program_id,
        subject_info,
        checkpoint_info,
        config_key: config_info.key,
        config: &config,
        gate_key: gate_info.key,
        gate: &gate,
        candidate: &instruction.candidate,
    };
    let mut binding = validate_checkpoint_subject(&subject_context)?;
    let rollback_prestate = matches!(
        &binding.subject,
        CheckpointSubject::Proposal(proposal)
            if instruction.candidate.phase == StateCheckpointPhaseV1::Prestate
                && proposal.proposal_class == ProposalClassV1::EmergencyRollback
    );
    if baseline_info.is_some() != (poststate || rollback_prestate) {
        return Err(GovernanceError::InvalidAccountCount.into());
    }
    let mut checkpoint = validate_checkpoint_candidate(
        &instruction.candidate,
        &binding,
        *config_info.key,
        &config,
        &council,
        slot,
    )?;
    validate_target_snapshot(
        target_program,
        target_programdata,
        &config,
        &instruction.candidate,
    )?;
    let evidence_slot = validate_phase_evidence(
        program_id,
        evidence_info,
        config_info,
        gate_info,
        &config,
        &binding,
        &instruction.candidate,
    )?;
    let baseline_slot = match (baseline_info, poststate, rollback_prestate) {
        (Some(baseline), true, false) => validate_poststate_baseline(
            program_id,
            baseline,
            config_info,
            &config,
            &binding,
            &instruction.candidate,
        )?,
        (Some(baseline), false, true) => validate_rollback_prestate_baseline(
            program_id,
            baseline,
            config_info,
            &config,
            &binding,
            &instruction.candidate,
        )?,
        (None, false, false) => 0,
        _ => return Err(GovernanceError::InvalidAccountCount.into()),
    };
    let minimum_attestation_slot = instruction
        .candidate
        .finalized_observation_slot
        .max(evidence_slot)
        .max(baseline_slot);
    let attestation_context = AttestationFinalizationContext {
        program_id,
        checkpoint: &checkpoint,
        checkpoint_key: &binding.checkpoint,
        subject_key: &binding.subject_key,
        council_key: council_info.key,
        council: &council,
        minimum_slot: minimum_attestation_slot,
        finalization_slot: slot,
    };
    let mut approval_bitset = 0u8;
    for attestation in attestation_infos {
        let seat_index = validate_attestation_for_finalization(attestation, &attestation_context)?;
        let bit = 1u8 << seat_index;
        if approval_bitset & bit != 0 {
            return Err(GovernanceError::DuplicateApproval.into());
        }
        approval_bitset |= bit;
    }
    validate_approval_mask_at(
        &council,
        approval_bitset,
        approval_bitset.count_ones() as u8,
        slot,
    )?;
    checkpoint.approval_bitset = approval_bitset;
    checkpoint.approval_count = approval_bitset.count_ones() as u8;
    checkpoint.finalized_slot = slot;
    validate_state_checkpoint_digest_v1(&checkpoint)?;
    let proposal_bytes = if poststate && checkpoint.accepted {
        let CheckpointSubject::Proposal(proposal) = &mut binding.subject else {
            return Err(GovernanceError::InvalidStateTransition.into());
        };
        // The subject was decoded into a detached heap allocation. Mutate that
        // allocation only after every checkpoint/evidence/quorum check, then
        // encode before the first account write. A second 1,792-byte proposal
        // copy is unnecessary and unsafe for the SBPF-v0 stack.
        proposal.state = ProposalStateV2::PoststateAccepted;
        proposal.poststate_accepted_slot = slot;
        validate_proposal_digest_v2(proposal)?;
        Some(encode_fixed_account(&**proposal, UpgradeProposalV2::LEN)?)
    } else {
        None
    };

    // Account creation is the first mutation.  Every byte and every possible
    // poststate proposal update has already been validated and encoded.
    create_checkpoint_pda_account(
        program_id,
        payer,
        checkpoint_info,
        system_program_info,
        &checkpoint,
    )?;
    if let Some(bytes) = proposal_bytes {
        let mut proposal_data = subject_info.try_borrow_mut_data()?;
        proposal_data.copy_from_slice(&bytes);
    }
    Ok(())
}

fn require_active_seat_authority(
    council: &GovernanceCouncilSetV1,
    authority: &Pubkey,
    slot: u64,
) -> GovernanceResult<()> {
    let seat = council
        .seats
        .iter()
        .find(|seat| seat.seat_authority == *authority)
        .ok_or(GovernanceError::UnknownSeatAuthority)?;
    if !council.active_at(slot) || !seat.term_covers(slot) {
        return Err(GovernanceError::InactiveCouncilSeat);
    }
    Ok(())
}

fn validate_mask_members_active(
    council: &GovernanceCouncilSetV1,
    bitset: u8,
    count: u8,
    slot: u64,
) -> GovernanceResult<()> {
    if bitset & !VALID_APPROVAL_MASK != 0 {
        return Err(GovernanceError::InvalidApprovalBitset);
    }
    if bitset.count_ones() as u8 != count {
        return Err(GovernanceError::ApprovalCountMismatch);
    }
    if !council.active_at(slot) {
        return Err(GovernanceError::InactiveCouncilSeat);
    }
    for (index, seat) in council.seats.iter().enumerate() {
        if bitset & (1 << index) != 0 && !seat.term_covers(slot) {
            return Err(GovernanceError::InactiveCouncilSeat);
        }
    }
    Ok(())
}

fn validate_candidate_seats_at_slot(
    candidate: &GovernanceCouncilSetV1,
    slot: u64,
) -> GovernanceResult<()> {
    if !candidate.active_at(slot) {
        return Err(GovernanceError::InvalidCouncilActivation);
    }
    for seat in &candidate.seats {
        if !seat.term_covers(slot) {
            return Err(GovernanceError::InactiveCouncilSeat);
        }
    }
    Ok(())
}

fn create_council_pda_account<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    council_info: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    council: &GovernanceCouncilSetV1,
) -> ProgramResult {
    let version = council.version.to_le_bytes();
    let bump = [council.bump];
    let seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        COUNCIL_SEED,
        council.target_program.as_ref(),
        &version,
        &bump,
    ];
    let encoded = encode_fixed_account(council, GovernanceCouncilSetV1::LEN)?;
    create_fixed_pda_account(
        program_id,
        payer,
        council_info,
        system_program_info,
        &Rent::get()?,
        GovernanceCouncilSetV1::LEN,
        seeds,
    )?;
    let mut data = council_info.try_borrow_mut_data()?;
    data.copy_from_slice(&encoded);
    Ok(())
}

pub fn process_create_candidate_council_set_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateCandidateCouncilSetV1,
) -> ProgramResult {
    exact_account_count(accounts, 13)?;
    let payer = &accounts[0];
    let creator = &accounts[1];
    let config_info = &accounts[2];
    let policy_info = &accounts[3];
    let current_council_info = &accounts[4];
    let gate_info = &accounts[5];
    let candidate_info = &accounts[6];
    let candidate_authorities = &accounts[7..12];
    let system_program_info = &accounts[12];

    validate_candidate_creation_authority_contract(
        payer,
        creator,
        config_info,
        policy_info,
        current_council_info,
        gate_info,
        candidate_info,
        candidate_authorities,
        system_program_info,
    )?;

    validate_signer_writable(payer)?;
    validate_signer_readonly(creator)?;
    for readonly in [config_info, policy_info, current_council_info, gate_info] {
        validate_readonly(readonly)?;
    }
    validate_writable(candidate_info)?;
    for authority in candidate_authorities {
        if *authority.key == Pubkey::default() {
            return Err(GovernanceError::DefaultPubkey.into());
        }
    }
    validate_system_program(system_program_info)?;
    require_absent_system_account(candidate_info)?;

    let slot = current_slot()?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info.key, &config, slot)?;
    let current_council = load_current_council(
        program_id,
        current_council_info,
        config_info.key,
        &config,
        &policy,
        slot,
    )?;
    let gate = load_gate(program_id, gate_info, config_info.key, &config)?;
    require_active_seat_authority(&current_council, creator.key, slot)?;
    if instruction.expected_current_council_version != current_council.version
        || instruction.expected_current_council_hash != current_council.set_hash
        || instruction.expected_target_nonce != config.target_nonce
        || instruction.expected_gate_status != gate.status
        || instruction.expected_gate_epoch != gate.epoch
        || instruction.candidate_council_version <= current_council.version
        || instruction.candidate_council_version == u64::MAX
    {
        return Err(GovernanceError::StaleCouncilVersion.into());
    }
    let minimum_activation = slot
        .checked_add(config.major_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if instruction.activation_slot < minimum_activation {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let (candidate_pda, candidate_bump) = derive_council_pda(
        program_id,
        &config.target_program,
        instruction.candidate_council_version,
    );
    if *candidate_info.key != candidate_pda {
        return Err(GovernanceError::InvalidPda.into());
    }
    let mut seats = [CouncilSeatV1::default(); 5];
    for (index, (authority, term)) in candidate_authorities
        .iter()
        .zip(instruction.seat_terms.iter())
        .enumerate()
    {
        if term.term_start_slot >= term.term_end_slot
            || term.term_start_slot > instruction.activation_slot
            || instruction.activation_slot >= term.term_end_slot
        {
            return Err(GovernanceError::InactiveCouncilSeat.into());
        }
        seats[index] = CouncilSeatV1 {
            seat_authority: *authority.key,
            term_start_slot: term.term_start_slot,
            term_end_slot: term.term_end_slot,
            active: true,
            reserved: [0; COUNCIL_SEAT_RESERVED_LEN],
        };
    }
    let mut candidate = GovernanceCouncilSetV1 {
        discriminator: GOVERNANCE_COUNCIL_DISCRIMINATOR,
        account_version: ACCOUNT_VERSION_V1,
        bump: candidate_bump,
        initialized: true,
        controller_config: *config_info.key,
        version: instruction.candidate_council_version,
        target_program: config.target_program,
        activation_slot: instruction.activation_slot,
        deactivation_slot: 0,
        seats,
        routine_threshold: policy.routine_threshold,
        terminal_threshold: policy.terminal_threshold,
        policy_flags: 0,
        set_hash: [0; 32],
        reserved: [0; GOVERNANCE_COUNCIL_RESERVED_LEN],
    };
    candidate.set_hash = compute_council_set_hash(&candidate);
    if candidate.set_hash != instruction.expected_candidate_council_hash {
        return Err(GovernanceError::CouncilHashMismatch.into());
    }
    validate_council_set(&candidate, &policy)?;
    validate_council_guardian_separation(&candidate, &config.guardian)?;
    create_council_pda_account(
        program_id,
        payer,
        candidate_info,
        system_program_info,
        &candidate,
    )
}

fn load_candidate_council(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    config_key: &Pubkey,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
) -> Result<Box<GovernanceCouncilSetV1>, ProgramError> {
    let candidate = load_fixed_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        account,
        GovernanceCouncilSetV1::LEN,
    )?;
    validate_council_set(&candidate, policy)?;
    validate_council_guardian_separation(&candidate, &config.guardian)?;
    let (expected, bump) =
        derive_council_pda(program_id, &config.target_program, candidate.version);
    if *account.key != expected
        || candidate.bump != bump
        || candidate.controller_config != *config_key
        || candidate.target_program != config.target_program
        || candidate.version <= config.current_council_version
        || candidate.version == u64::MAX
        || candidate.deactivation_slot != 0
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    Ok(candidate)
}

fn create_rotation_pda_account<'a>(
    program_id: &Pubkey,
    payer: &AccountInfo<'a>,
    rotation_info: &AccountInfo<'a>,
    system_program_info: &AccountInfo<'a>,
    rotation: &CouncilRotationProposalV1,
) -> ProgramResult {
    let version = rotation.candidate_council_version.to_le_bytes();
    let bump = [rotation.bump];
    let seeds: &[&[u8]] = &[
        UPGRADE_SEED_DOMAIN_V1,
        COUNCIL_ROTATION_SEED,
        rotation.target_program.as_ref(),
        &version,
        &bump,
    ];
    let encoded = encode_fixed_account(rotation, CouncilRotationProposalV1::LEN)?;
    create_fixed_pda_account(
        program_id,
        payer,
        rotation_info,
        system_program_info,
        &Rent::get()?,
        CouncilRotationProposalV1::LEN,
        seeds,
    )?;
    let mut data = rotation_info.try_borrow_mut_data()?;
    data.copy_from_slice(&encoded);
    Ok(())
}

pub fn process_create_council_rotation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CreateCouncilRotationV1,
) -> ProgramResult {
    exact_account_count(accounts, 9)?;
    all_distinct(accounts)?;
    let [payer, creator, config_info, policy_info, current_council_info, candidate_info, gate_info, rotation_info, system_program_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    validate_signer_writable(payer)?;
    validate_signer_readonly(creator)?;
    for readonly in [
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
    ] {
        validate_readonly(readonly)?;
    }
    validate_writable(rotation_info)?;
    validate_system_program(system_program_info)?;
    require_absent_system_account(rotation_info)?;

    let slot = current_slot()?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info.key, &config, slot)?;
    let current_council = load_current_council(
        program_id,
        current_council_info,
        config_info.key,
        &config,
        &policy,
        slot,
    )?;
    let candidate = load_candidate_council(
        program_id,
        candidate_info,
        config_info.key,
        &config,
        &policy,
    )?;
    let gate = load_gate(program_id, gate_info, config_info.key, &config)?;
    require_active_seat_authority(&current_council, creator.key, slot)?;
    if instruction.creation_slot != slot
        || instruction.expected_current_council_version != current_council.version
        || instruction.expected_current_council_hash != current_council.set_hash
        || instruction.expected_candidate_council_version != candidate.version
        || instruction.expected_candidate_council_hash != candidate.set_hash
        || instruction.expected_gate_status != gate.status
        || instruction.expected_gate_epoch != gate.epoch
        || instruction.expected_target_nonce != config.target_nonce
        || instruction.not_before_slot != candidate.activation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    let minimum_not_before = slot
        .checked_add(config.major_delay_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    let exact_expiry = slot
        .checked_add(config.proposal_expiry_slots)
        .ok_or(GovernanceError::ArithmeticOverflow)?;
    if instruction.not_before_slot < minimum_not_before
        || instruction.expiry_slot != exact_expiry
        || instruction.not_before_slot >= instruction.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    let (rotation_pda, rotation_bump) = crate::pda::derive_council_rotation_pda(
        program_id,
        &config.target_program,
        candidate.version,
    );
    if *rotation_info.key != rotation_pda {
        return Err(GovernanceError::InvalidPda.into());
    }
    let mut rotation = CouncilRotationProposalV1 {
        discriminator: COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
        account_version: RELEASE1_ACCOUNT_VERSION_V1,
        bump: rotation_bump,
        initialized: true,
        state: CouncilRotationStateV1::Draft,
        controller_config: *config_info.key,
        target_program: config.target_program,
        current_council: *current_council_info.key,
        current_council_version: current_council.version,
        current_council_hash: current_council.set_hash,
        candidate_council: *candidate_info.key,
        candidate_council_version: candidate.version,
        candidate_council_hash: candidate.set_hash,
        creation_slot: slot,
        not_before_slot: instruction.not_before_slot,
        expiry_slot: instruction.expiry_slot,
        target_nonce: config.target_nonce,
        approval_bitset: 0,
        approval_count: 0,
        cancellation_approval_bitset: 0,
        cancellation_approval_count: 0,
        rotation_digest: [0; 32],
        activated_slot: 0,
        cancellation_reason_code: 0,
        terminal_reason_code: 0,
        reserved: [0; COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN],
    };
    rotation.rotation_digest = compute_council_rotation_digest_v1(&rotation)?;
    if rotation.rotation_digest != instruction.expected_rotation_digest {
        return Err(GovernanceError::Release1DigestMismatch.into());
    }
    validate_council_rotation_digest_v1(&rotation)?;
    create_rotation_pda_account(
        program_id,
        payer,
        rotation_info,
        system_program_info,
        &rotation,
    )
}

fn load_rotation(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    config_key: &Pubkey,
    config: &ControllerConfigV1,
) -> Result<Box<CouncilRotationProposalV1>, ProgramError> {
    let rotation = load_fixed_controller_account::<CouncilRotationProposalV1>(
        program_id,
        account,
        CouncilRotationProposalV1::LEN,
    )?;
    validate_council_rotation_digest_v1(&rotation)?;
    let (expected, bump) = crate::pda::derive_council_rotation_pda(
        program_id,
        &config.target_program,
        rotation.candidate_council_version,
    );
    if *account.key != expected
        || rotation.bump != bump
        || rotation.controller_config != *config_key
        || rotation.target_program != config.target_program
    {
        return Err(GovernanceError::InvalidPda.into());
    }
    Ok(rotation)
}

fn validate_rotation_expectation(
    expected: &CouncilRotationExpectationV1,
    config: &ControllerConfigV1,
    gate: &ProtocolGateV1,
    rotation: &CouncilRotationProposalV1,
) -> GovernanceResult<()> {
    if expected.expected_rotation_digest != rotation.rotation_digest
        || expected.expected_current_council_version != rotation.current_council_version
        || expected.expected_current_council_hash != rotation.current_council_hash
        || expected.expected_candidate_council_version != rotation.candidate_council_version
        || expected.expected_candidate_council_hash != rotation.candidate_council_hash
        || expected.expected_gate_status != gate.status
        || expected.expected_gate_epoch != gate.epoch
        || expected.expected_target_nonce != rotation.target_nonce
        || expected.expected_target_nonce != config.target_nonce
        || expected.expected_state != rotation.state
        || expected.expected_not_before_slot != rotation.not_before_slot
        || expected.expected_expiry_slot != rotation.expiry_slot
        || config.current_council_version != rotation.current_council_version
    {
        return Err(GovernanceError::CrossAccountMismatch);
    }
    Ok(())
}

fn validate_rotation_graph(
    rotation: &CouncilRotationProposalV1,
    current_council_key: &Pubkey,
    current_council: &GovernanceCouncilSetV1,
    candidate_key: &Pubkey,
    candidate: &GovernanceCouncilSetV1,
) -> GovernanceResult<()> {
    if rotation.current_council != *current_council_key
        || rotation.current_council_version != current_council.version
        || rotation.current_council_hash != current_council.set_hash
        || rotation.candidate_council != *candidate_key
        || rotation.candidate_council_version != candidate.version
        || rotation.candidate_council_hash != candidate.set_hash
        || rotation.not_before_slot != candidate.activation_slot
    {
        return Err(GovernanceError::CrossAccountMismatch);
    }
    Ok(())
}

fn load_rotation_context(
    context: &RotationAccountContext<'_, '_>,
) -> Result<LoadedRotationContext, ProgramError> {
    let config = load_config(context.program_id, context.config_info)?;
    let policy = load_policy(
        context.program_id,
        context.policy_info,
        context.config_info.key,
        &config,
        context.slot,
    )?;
    let current_council = load_current_council(
        context.program_id,
        context.current_council_info,
        context.config_info.key,
        &config,
        &policy,
        context.slot,
    )?;
    let candidate = load_candidate_council(
        context.program_id,
        context.candidate_info,
        context.config_info.key,
        &config,
        &policy,
    )?;
    let gate = load_gate(
        context.program_id,
        context.gate_info,
        context.config_info.key,
        &config,
    )?;
    let rotation = load_rotation(
        context.program_id,
        context.rotation_info,
        context.config_info.key,
        &config,
    )?;
    validate_rotation_expectation(context.expected, &config, &gate, &rotation)?;
    validate_rotation_graph(
        &rotation,
        context.current_council_info.key,
        &current_council,
        context.candidate_info.key,
        &candidate,
    )?;
    Ok(LoadedRotationContext {
        config,
        current_council,
        candidate,
        rotation,
    })
}

pub fn process_approve_council_rotation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ApproveCouncilRotationV1,
) -> ProgramResult {
    exact_account_count(accounts, 7)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, current_council_info, candidate_info, gate_info, rotation_info, seat_authority] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for readonly in [
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
    ] {
        validate_readonly(readonly)?;
    }
    validate_writable(rotation_info)?;
    validate_signer_readonly(seat_authority)?;
    let slot = current_slot()?;
    let rotation_context = RotationAccountContext {
        program_id,
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
        rotation_info,
        expected: &instruction.expected,
        slot,
    };
    let LoadedRotationContext {
        current_council: council,
        mut rotation,
        ..
    } = load_rotation_context(&rotation_context)?;
    if rotation.state != CouncilRotationStateV1::Draft
        || rotation.approval_bitset != instruction.expected_approval_bitset
        || rotation.approval_count != instruction.expected_approval_count
        || slot < rotation.creation_slot
        || slot >= rotation.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_mask_members_active(
        &council,
        rotation.approval_bitset,
        rotation.approval_count,
        slot,
    )?;
    let (next_bitset, next_count) = record_seat_approval(
        &council,
        rotation.approval_bitset,
        rotation.approval_count,
        seat_authority.key,
        slot,
    )?;
    rotation.approval_bitset = next_bitset;
    rotation.approval_count = next_count;
    if next_count == RELEASE1_APPROVAL_THRESHOLD {
        rotation.state = CouncilRotationStateV1::CouncilApproved;
    }
    validate_mask_members_active(&council, next_bitset, next_count, slot)?;
    validate_council_rotation_digest_v1(&rotation)?;
    store_fixed_controller_account(
        program_id,
        rotation_info,
        &*rotation,
        CouncilRotationProposalV1::LEN,
    )
}

pub fn process_queue_council_rotation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: QueueCouncilRotationV1,
) -> ProgramResult {
    exact_account_count(accounts, 6)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, current_council_info, candidate_info, gate_info, rotation_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for readonly in [
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
    ] {
        validate_readonly(readonly)?;
    }
    validate_writable(rotation_info)?;
    let slot = current_slot()?;
    let rotation_context = RotationAccountContext {
        program_id,
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
        rotation_info,
        expected: &instruction.expected,
        slot,
    };
    let LoadedRotationContext {
        current_council: council,
        mut rotation,
        ..
    } = load_rotation_context(&rotation_context)?;
    if rotation.state != CouncilRotationStateV1::CouncilApproved
        || rotation.approval_bitset != instruction.expected_approval_bitset
        || rotation.approval_count != instruction.expected_approval_count
        || slot < rotation.creation_slot
        || slot >= rotation.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_approval_mask_at(
        &council,
        rotation.approval_bitset,
        rotation.approval_count,
        slot,
    )?;
    rotation.state = CouncilRotationStateV1::Timelocked;
    validate_council_rotation_digest_v1(&rotation)?;
    store_fixed_controller_account(
        program_id,
        rotation_info,
        &*rotation,
        CouncilRotationProposalV1::LEN,
    )
}

fn store_config_and_rotation(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    rotation_info: &AccountInfo<'_>,
    rotation: &CouncilRotationProposalV1,
) -> ProgramResult {
    if config_info.owner != program_id || rotation_info.owner != program_id {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    let config_bytes = encode_fixed_account(config, ControllerConfigV1::LEN)?;
    let rotation_bytes = encode_fixed_account(rotation, CouncilRotationProposalV1::LEN)?;
    let mut config_data = config_info.try_borrow_mut_data()?;
    let mut rotation_data = rotation_info.try_borrow_mut_data()?;
    if config_data.len() != ControllerConfigV1::LEN
        || rotation_data.len() != CouncilRotationProposalV1::LEN
    {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    config_data.copy_from_slice(&config_bytes);
    rotation_data.copy_from_slice(&rotation_bytes);
    Ok(())
}

pub fn process_activate_council_rotation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ActivateCouncilRotationV1,
) -> ProgramResult {
    exact_account_count(accounts, 6)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, current_council_info, candidate_info, gate_info, rotation_info] =
        accounts
    else {
        unreachable!("account count checked")
    };
    validate_writable(config_info)?;
    for readonly in [policy_info, current_council_info, candidate_info, gate_info] {
        validate_readonly(readonly)?;
    }
    validate_writable(rotation_info)?;
    let slot = current_slot()?;
    let rotation_context = RotationAccountContext {
        program_id,
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
        rotation_info,
        expected: &instruction.expected,
        slot,
    };
    let LoadedRotationContext {
        mut config,
        current_council,
        candidate,
        mut rotation,
    } = load_rotation_context(&rotation_context)?;
    if rotation.state != CouncilRotationStateV1::Timelocked
        || rotation.approval_bitset != instruction.expected_approval_bitset
        || rotation.approval_count != instruction.expected_approval_count
        || slot < rotation.not_before_slot
        || slot >= rotation.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_approval_mask_at(
        &current_council,
        rotation.approval_bitset,
        rotation.approval_count,
        slot,
    )?;
    validate_candidate_seats_at_slot(&candidate, slot)?;
    config.current_council_version = candidate.version;
    config.validate_static()?;
    rotation.state = CouncilRotationStateV1::Activated;
    rotation.activated_slot = slot;
    rotation.terminal_reason_code = COUNCIL_ROTATION_ACTIVATED_TERMINAL_REASON_V1;
    validate_council_rotation_digest_v1(&rotation)?;
    store_config_and_rotation(program_id, config_info, &config, rotation_info, &rotation)
}

pub fn process_cancel_council_rotation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: CancelCouncilRotationV1,
) -> ProgramResult {
    exact_account_count(accounts, 7)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, current_council_info, candidate_info, gate_info, rotation_info, seat_authority] =
        accounts
    else {
        unreachable!("account count checked")
    };
    for readonly in [
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
    ] {
        validate_readonly(readonly)?;
    }
    validate_writable(rotation_info)?;
    validate_signer_readonly(seat_authority)?;
    let slot = current_slot()?;
    let rotation_context = RotationAccountContext {
        program_id,
        config_info,
        policy_info,
        current_council_info,
        candidate_info,
        gate_info,
        rotation_info,
        expected: &instruction.expected,
        slot,
    };
    let LoadedRotationContext {
        current_council: council,
        mut rotation,
        ..
    } = load_rotation_context(&rotation_context)?;
    if !matches!(
        rotation.state,
        CouncilRotationStateV1::Draft
            | CouncilRotationStateV1::CouncilApproved
            | CouncilRotationStateV1::Timelocked
    ) || rotation.cancellation_approval_bitset
        != instruction.expected_cancellation_approval_bitset
        || rotation.cancellation_approval_count != instruction.expected_cancellation_approval_count
        || instruction.cancellation_reason_code == 0
        || (rotation.cancellation_reason_code != 0
            && rotation.cancellation_reason_code != instruction.cancellation_reason_code)
        || slot < rotation.creation_slot
        || slot >= rotation.expiry_slot
    {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    validate_mask_members_active(
        &council,
        rotation.cancellation_approval_bitset,
        rotation.cancellation_approval_count,
        slot,
    )?;
    let (next_bitset, next_count) = record_seat_approval(
        &council,
        rotation.cancellation_approval_bitset,
        rotation.cancellation_approval_count,
        seat_authority.key,
        slot,
    )?;
    rotation.cancellation_reason_code = instruction.cancellation_reason_code;
    rotation.cancellation_approval_bitset = next_bitset;
    rotation.cancellation_approval_count = next_count;
    if next_count == RELEASE1_APPROVAL_THRESHOLD {
        rotation.state = CouncilRotationStateV1::Cancelled;
        rotation.terminal_reason_code = instruction.cancellation_reason_code;
    }
    validate_mask_members_active(&council, next_bitset, next_count, slot)?;
    validate_council_rotation_digest_v1(&rotation)?;
    store_fixed_controller_account(
        program_id,
        rotation_info,
        &*rotation,
        CouncilRotationProposalV1::LEN,
    )
}

pub fn process_expire_council_rotation_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExpireCouncilRotationV1,
) -> ProgramResult {
    exact_account_count(accounts, 3)?;
    all_distinct(accounts)?;
    let [config_info, gate_info, rotation_info] = accounts else {
        unreachable!("account count checked")
    };
    validate_readonly(config_info)?;
    validate_readonly(gate_info)?;
    validate_writable(rotation_info)?;
    let slot = current_slot()?;
    let config = load_config(program_id, config_info)?;
    let gate = load_gate(program_id, gate_info, config_info.key, &config)?;
    let mut rotation = load_rotation(program_id, rotation_info, config_info.key, &config)?;
    validate_rotation_expectation(&instruction.expected, &config, &gate, &rotation)?;
    if !matches!(
        rotation.state,
        CouncilRotationStateV1::Draft
            | CouncilRotationStateV1::CouncilApproved
            | CouncilRotationStateV1::Timelocked
    ) || slot < rotation.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    rotation.state = CouncilRotationStateV1::Expired;
    rotation.terminal_reason_code = COUNCIL_ROTATION_EXPIRED_TERMINAL_REASON_V1;
    validate_council_rotation_digest_v1(&rotation)?;
    store_fixed_controller_account(
        program_id,
        rotation_info,
        &*rotation,
        CouncilRotationProposalV1::LEN,
    )
}

fn validate_emergency_expiry_expectation(
    expected: &crate::instruction::EmergencyResolutionExpectationV1,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    gate: &ProtocolGateV1,
    resolution: &EmergencyFreezeResolutionV1,
) -> GovernanceResult<()> {
    if expected.expected_resolution_digest != resolution.resolution_digest
        || expected.expected_policy_version != config.current_policy_version
        || expected.expected_policy_version != policy.version
        || expected.expected_policy_hash != policy.policy_hash
        || expected.expected_council_version != resolution.approval_council_version
        || expected.expected_council_hash != resolution.approval_council_hash
        || expected.expected_gate_status != gate.status
        || expected.expected_gate_epoch != gate.epoch
        || expected.expected_freeze_slot != gate.freeze_slot
        || expected.expected_freeze_reason_code != gate.freeze_reason_code
        || expected.expected_target_nonce != resolution.target_nonce
        || expected.expected_target_nonce != config.target_nonce
        || expected.expected_state != resolution.state
        || expected.expected_not_before_slot != resolution.not_before_slot
        || expected.expected_expiry_slot != resolution.expiry_slot
    {
        return Err(GovernanceError::CrossAccountMismatch);
    }
    Ok(())
}

pub fn process_expire_emergency_resolution_v1(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: ExpireEmergencyResolutionV1,
) -> ProgramResult {
    exact_account_count(accounts, 4)?;
    all_distinct(accounts)?;
    let [config_info, policy_info, gate_info, resolution_info] = accounts else {
        unreachable!("account count checked")
    };
    validate_readonly(config_info)?;
    validate_readonly(policy_info)?;
    validate_readonly(gate_info)?;
    validate_writable(resolution_info)?;
    let slot = current_slot()?;
    let config = load_config(program_id, config_info)?;
    let policy = load_policy(program_id, policy_info, config_info.key, &config, slot)?;
    let gate = load_gate(program_id, gate_info, config_info.key, &config)?;
    let mut resolution = load_fixed_controller_account::<EmergencyFreezeResolutionV1>(
        program_id,
        resolution_info,
        EmergencyFreezeResolutionV1::LEN,
    )?;
    validate_emergency_resolution_digest_v1(&resolution)?;
    let (expected_pda, bump) = derive_emergency_resolution_pda(
        program_id,
        &config.target_program,
        resolution.frozen_epoch,
    );
    if *resolution_info.key != expected_pda
        || resolution.bump != bump
        || resolution.controller_config != *config_info.key
        || resolution.protocol_gate != *gate_info.key
        || resolution.target_program != config.target_program
        || resolution.target_programdata != config.target_programdata
        || resolution.frozen_epoch != gate.epoch
        || resolution.freeze_slot != gate.freeze_slot
        || resolution.freeze_reason_code != gate.freeze_reason_code
        || gate.status != GateStatusV1::EmergencyFrozen
        || gate.active_proposal != Pubkey::default()
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    validate_emergency_expiry_expectation(
        &instruction.expected,
        &config,
        &policy,
        &gate,
        &resolution,
    )?;
    if !matches!(
        resolution.state,
        EmergencyFreezeResolutionStateV1::Draft
            | EmergencyFreezeResolutionStateV1::CouncilApproved
            | EmergencyFreezeResolutionStateV1::Timelocked
    ) || slot < resolution.expiry_slot
    {
        return Err(GovernanceError::InvalidProposalTiming.into());
    }
    resolution.state = EmergencyFreezeResolutionStateV1::Expired;
    resolution.terminal_reason_code = EMERGENCY_RESOLUTION_EXPIRED_TERMINAL_REASON_V1;
    validate_emergency_resolution_digest_v1(&resolution)?;
    store_fixed_controller_account(
        program_id,
        resolution_info,
        &*resolution,
        EmergencyFreezeResolutionV1::LEN,
    )
}

#[cfg(test)]
mod tests {
    use borsh::BorshSerialize;
    use solana_program::account_info::AccountInfo;

    use super::*;
    use crate::{
        artifact_merkle::{ARTIFACT_MERKLE_SCHEME_ID, RELEASE1_ARTIFACT_CHUNK_SIZE_V1},
        instruction::{CouncilSeatTermV1, EmergencyResolutionExpectationV1},
        policy::compute_policy_hash,
        release1_state::{
            EmergencyFreezeResolutionKindV1, EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
            EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN,
            PROGRAMDATA_FAILURE_OBSERVATION_V1_DISCRIMINATOR,
            PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN,
            PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR, PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN,
            VERIFICATION_BITMAP_BYTES_V1,
        },
        state::{
            OptionalPubkeyV1, CONTROLLER_CONFIG_DISCRIMINATOR, CONTROLLER_CONFIG_RESERVED_LEN,
            GOVERNANCE_POLICY_DISCRIMINATOR, GOVERNANCE_POLICY_RESERVED_LEN,
            PROTOCOL_GATE_DISCRIMINATOR, PROTOCOL_GATE_RESERVED_LEN,
        },
    };

    fn key(byte: u8) -> Pubkey {
        Pubkey::new_from_array([byte; 32])
    }

    fn dummy_candidate(phase: StateCheckpointPhaseV1) -> CheckpointCandidateV1 {
        CheckpointCandidateV1 {
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
            expected_subject_digest: [1; 32],
            expected_gate_status: if phase == StateCheckpointPhaseV1::Emergency {
                GateStatusV1::EmergencyFrozen
            } else {
                GateStatusV1::FrozenForUpgrade
            },
            expected_gate_epoch: 7,
            finalized_observation_slot: 20,
            target_programdata_slot: 9,
            target_payload_commitment: [2; 32],
            target_raw_programdata_commitment: [3; 32],
            target_capacity: 64,
            program_owned_state_root: [4; 32],
            program_owned_state_count: 2,
            logical_compressed_state_root: [5; 32],
            logical_compressed_state_count: 3,
            semantic_custody_accounting_root: [6; 32],
            hard_combined_root: [7; 32],
            external_metadata_observation_root: [8; 32],
            external_raw_balance_observation_root: [9; 32],
            schema_identifier: [10; 32],
            admitted_positive_donation_root: [0; 32],
            admitted_positive_donation_count: 0,
            forbidden_drift_count: 0,
            expected_checkpoint_digest: [11; 32],
        }
    }

    #[derive(Clone)]
    struct RollbackEvidenceFixture {
        program_id: Pubkey,
        config_key: Pubkey,
        config: ControllerConfigV1,
        evidence_key: Pubkey,
        evidence: ProgramDataVerificationV1,
        commitment: RollbackPrestateCommitment,
        candidate: CheckpointCandidateV1,
    }

    impl RollbackEvidenceFixture {
        fn validate(&self) -> Result<u64, ProgramError> {
            let mut config_lamports = 1;
            let mut config_data = [];
            let config_info = AccountInfo::new(
                &self.config_key,
                false,
                false,
                &mut config_lamports,
                &mut config_data,
                &self.program_id,
                false,
                0,
            );
            let mut evidence_lamports = 1;
            let mut evidence_data = self.evidence.try_to_vec().unwrap();
            let evidence_info = AccountInfo::new(
                &self.evidence_key,
                false,
                false,
                &mut evidence_lamports,
                &mut evidence_data,
                &self.program_id,
                false,
                0,
            );
            validate_rollback_prestate_evidence_commitment(
                &self.program_id,
                &evidence_info,
                &config_info,
                &self.config,
                &self.commitment,
                &self.candidate,
            )
        }
    }

    fn sample_rollback_evidence_fixture() -> RollbackEvidenceFixture {
        let program_id = key(120);
        let (config_key, config) = sample_config(&program_id, key(121));
        let primary_proposal = key(122);
        let (evidence_key, bump) = derive_programdata_check_pda(&program_id, &primary_proposal);
        let mut payload_bitmap = [0; VERIFICATION_BITMAP_BYTES_V1];
        payload_bitmap[0] = 1;
        let expected_candidate_full_payload_sha256 = [2; 32];
        let artifact_sha256 = [16; 32];
        let artifact_chunk_merkle_root = [12; 32];
        let artifact_length = 64;
        let capacity = 128;
        let mut tail_bitmap = [0; VERIFICATION_BITMAP_BYTES_V1];
        tail_bitmap[0] = 1;
        let evidence = ProgramDataVerificationV1 {
            discriminator: PROGRAMDATA_VERIFICATION_V1_DISCRIMINATOR,
            account_version: RELEASE1_ACCOUNT_VERSION_V1,
            bump,
            initialized: true,
            status: ProgramDataVerificationStatusV1::Verified,
            controller_config: config_key,
            proposal: primary_proposal,
            target_program: config.target_program,
            target_programdata: config.target_programdata,
            upgradeable_loader: config.upgradeable_loader,
            controller_authority: config.authority_pda,
            artifact_length,
            artifact_sha256,
            artifact_chunk_merkle_root,
            chunk_hash_domain: ARTIFACT_MERKLE_SCHEME_ID,
            chunk_size: RELEASE1_ARTIFACT_CHUNK_SIZE_V1,
            payload_chunk_count: 1,
            verified_payload_chunk_bitmap: payload_bitmap,
            verified_payload_chunk_count: 1,
            deployed_slot: 9,
            capacity,
            tail_length: capacity - artifact_length,
            tail_chunk_count: 1,
            verified_tail_chunk_bitmap: tail_bitmap,
            verified_tail_chunk_count: 1,
            raw_programdata_hash: [3; 32],
            zero_tail_verified: true,
            finalized_slot: 10,
            reserved: [0; PROGRAMDATA_VERIFICATION_V1_RESERVED_LEN],
        };
        let commitment = RollbackPrestateCommitment {
            primary_proposal,
            expected_candidate_full_payload_sha256,
            artifact_chunk_merkle_root,
            chunk_hash_domain: ARTIFACT_MERKLE_SCHEME_ID,
            capacity,
        };
        let mut candidate = dummy_candidate(StateCheckpointPhaseV1::Prestate);
        candidate.target_capacity = capacity;
        RollbackEvidenceFixture {
            program_id,
            config_key,
            config,
            evidence_key,
            evidence,
            commitment,
            candidate,
        }
    }

    #[derive(Clone)]
    struct RollbackFailureEvidenceFixture {
        program_id: Pubkey,
        config_key: Pubkey,
        config: ControllerConfigV1,
        evidence_key: Pubkey,
        evidence: ProgramDataFailureObservationV1,
        commitment: RollbackPrestateCommitment,
        candidate: CheckpointCandidateV1,
    }

    impl RollbackFailureEvidenceFixture {
        fn refresh_digest(&mut self) {
            self.evidence.observation_digest =
                crate::release1_digest::compute_programdata_failure_observation_digest_v1(
                    &self.evidence,
                )
                .unwrap();
        }

        fn validate(&self) -> Result<u64, ProgramError> {
            let mut config_lamports = 1;
            let mut config_data = [];
            let config_info = AccountInfo::new(
                &self.config_key,
                false,
                false,
                &mut config_lamports,
                &mut config_data,
                &self.program_id,
                false,
                0,
            );
            let mut evidence_lamports = 1;
            let mut evidence_data = self.evidence.try_to_vec().unwrap();
            let evidence_info = AccountInfo::new(
                &self.evidence_key,
                false,
                false,
                &mut evidence_lamports,
                &mut evidence_data,
                &self.program_id,
                false,
                0,
            );
            validate_rollback_prestate_evidence_commitment(
                &self.program_id,
                &evidence_info,
                &config_info,
                &self.config,
                &self.commitment,
                &self.candidate,
            )
        }
    }

    fn sample_rollback_failure_evidence_fixture() -> RollbackFailureEvidenceFixture {
        let program_id = key(130);
        let (config_key, config) = sample_config(&program_id, key(131));
        let primary_proposal = key(132);
        let frozen_epoch = 6;
        let (evidence_key, bump) = derive_programdata_failure_observation_pda(
            &program_id,
            &primary_proposal,
            frozen_epoch,
        );
        let capacity = 128;
        let mut evidence = ProgramDataFailureObservationV1 {
            discriminator: PROGRAMDATA_FAILURE_OBSERVATION_V1_DISCRIMINATOR,
            account_version: RELEASE1_ACCOUNT_VERSION_V1,
            bump,
            initialized: true,
            finalized: true,
            controller_config: config_key,
            protocol_gate: config.gate_pda,
            primary_proposal,
            target_program: config.target_program,
            target_programdata: config.target_programdata,
            frozen_epoch,
            actual_program_owner: config.upgradeable_loader,
            actual_program_executable: true,
            actual_program_data_length: LOADER_V3_PROGRAM_ACCOUNT_LEN_V1,
            program_header_present: true,
            actual_linked_programdata: OptionalPubkeyV1::some(config.target_programdata).unwrap(),
            raw_hash_complete: true,
            actual_raw_programdata_sha256: [3; 32],
            actual_owner: config.upgradeable_loader,
            actual_executable: false,
            actual_data_length: capacity + LOADER_V3_PROGRAMDATA_METADATA_LEN_V1,
            programdata_header_present: true,
            actual_programdata_slot: 9,
            actual_capacity: capacity,
            actual_authority: OptionalPubkeyV1::some(config.authority_pda).unwrap(),
            mismatch_class: ProgramDataMismatchClassV1::PayloadLeaf,
            failing_chunk_index: 0,
            expected_leaf_hash: [40; 32],
            actual_leaf_hash: [41; 32],
            finalized_slot: 10,
            observation_digest: [0; 32],
            reserved: [0; PROGRAMDATA_FAILURE_OBSERVATION_V1_RESERVED_LEN],
        };
        evidence.observation_digest =
            crate::release1_digest::compute_programdata_failure_observation_digest_v1(&evidence)
                .unwrap();
        let commitment = RollbackPrestateCommitment {
            primary_proposal,
            expected_candidate_full_payload_sha256: [2; 32],
            artifact_chunk_merkle_root: [12; 32],
            chunk_hash_domain: ARTIFACT_MERKLE_SCHEME_ID,
            capacity,
        };
        let mut candidate = dummy_candidate(StateCheckpointPhaseV1::Prestate);
        candidate.target_capacity = capacity;
        RollbackFailureEvidenceFixture {
            program_id,
            config_key,
            config,
            evidence_key,
            evidence,
            commitment,
            candidate,
        }
    }

    #[derive(Clone)]
    struct RollbackBaselineFixture {
        program_id: Pubkey,
        config_key: Pubkey,
        config: ControllerConfigV1,
        baseline_key: Pubkey,
        baseline: StateCheckpointV1,
        rollback_key: Pubkey,
        rollback: UpgradeProposalV2,
        candidate: CheckpointCandidateV1,
    }

    impl RollbackBaselineFixture {
        fn validate(&self) -> Result<u64, ProgramError> {
            let mut config_lamports = 1;
            let mut config_data = [];
            let config_info = AccountInfo::new(
                &self.config_key,
                false,
                false,
                &mut config_lamports,
                &mut config_data,
                &self.program_id,
                false,
                0,
            );
            let mut baseline_lamports = 1;
            let mut baseline_data = self.baseline.try_to_vec().unwrap();
            let baseline_info = AccountInfo::new(
                &self.baseline_key,
                false,
                false,
                &mut baseline_lamports,
                &mut baseline_data,
                &self.program_id,
                false,
                0,
            );
            let binding = CheckpointBinding {
                subject: CheckpointSubject::Proposal(Box::new(self.rollback.clone())),
                subject_key: self.rollback_key,
                subject_digest: self.rollback.proposal_digest,
                checkpoint: self.rollback.prestate_checkpoint,
                checkpoint_bump: 1,
            };
            validate_rollback_prestate_baseline(
                &self.program_id,
                &baseline_info,
                &config_info,
                &self.config,
                &binding,
                &self.candidate,
            )
        }
    }

    fn sample_rollback_baseline_fixture() -> RollbackBaselineFixture {
        let program_id = key(140);
        let (config_key, config) = sample_config(&program_id, key(141));
        let primary_proposal = key(142);
        let (baseline_key, baseline_bump) =
            derive_checkpoint_pda(&program_id, &primary_proposal, CheckpointPhaseV1::Prestate);
        let mut baseline = baseline_checkpoint();
        baseline.bump = baseline_bump;
        baseline.controller_config = config_key;
        baseline.proposal = primary_proposal;
        baseline.target_program = config.target_program;
        baseline.target_programdata = config.target_programdata;
        baseline.gate_epoch = 6;
        baseline.hard_combined_root =
            compute_state_checkpoint_hard_combined_root_v1(&baseline).unwrap();
        baseline.checkpoint_digest = compute_state_checkpoint_digest_v1(&baseline).unwrap();

        let rollback_key = key(143);
        let rollback = UpgradeProposalV2 {
            proposal_class: ProposalClassV1::EmergencyRollback,
            primary_proposal: OptionalPubkeyV1::some(primary_proposal).unwrap(),
            checkpoint_schema_id: baseline.schema_identifier,
            proposal_digest: [44; 32],
            prestate_checkpoint: derive_checkpoint_pda(
                &program_id,
                &rollback_key,
                CheckpointPhaseV1::Prestate,
            )
            .0,
            ..UpgradeProposalV2::default()
        };

        let mut candidate = candidate_from_baseline(&baseline);
        candidate.phase = StateCheckpointPhaseV1::Prestate;
        candidate.expected_subject_state = CheckpointSubjectStateV1::ProposalFrozen;
        candidate.expected_gate_epoch = 7;
        candidate.finalized_observation_slot = baseline.finalized_slot;
        RollbackBaselineFixture {
            program_id,
            config_key,
            config,
            baseline_key,
            baseline,
            rollback_key,
            rollback,
            candidate,
        }
    }

    fn rotation_expectation() -> CouncilRotationExpectationV1 {
        CouncilRotationExpectationV1 {
            expected_rotation_digest: [1; 32],
            expected_current_council_version: 1,
            expected_current_council_hash: [2; 32],
            expected_candidate_council_version: 2,
            expected_candidate_council_hash: [3; 32],
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 5,
            expected_target_nonce: 7,
            expected_state: CouncilRotationStateV1::Draft,
            expected_not_before_slot: 30,
            expected_expiry_slot: 100,
        }
    }

    fn emergency_expectation() -> EmergencyResolutionExpectationV1 {
        EmergencyResolutionExpectationV1 {
            expected_resolution_digest: [1; 32],
            expected_policy_version: 1,
            expected_policy_hash: [2; 32],
            expected_council_version: 1,
            expected_council_hash: [3; 32],
            expected_gate_status: GateStatusV1::EmergencyFrozen,
            expected_gate_epoch: 5,
            expected_freeze_slot: 10,
            expected_freeze_reason_code: 2,
            expected_target_nonce: 7,
            expected_state: EmergencyFreezeResolutionStateV1::Draft,
            expected_not_before_slot: 30,
            expected_expiry_slot: 100,
        }
    }

    fn invalid_account_count() -> ProgramError {
        GovernanceError::InvalidAccountCount.into()
    }

    #[test]
    fn every_export_rejects_the_wrong_account_count_before_clock_or_data_access() {
        let program_id = key(99);
        let candidate = dummy_candidate(StateCheckpointPhaseV1::Prestate);
        let rotation = rotation_expectation();
        let emergency = emergency_expectation();
        let cases = [
            process_create_checkpoint_attestation_v1(
                &program_id,
                &[],
                CreateCheckpointAttestationV1 {
                    candidate,
                    expected_council_version: 1,
                    expected_council_hash: [1; 32],
                    seat_index: 0,
                },
            ),
            process_recast_checkpoint_attestation_v1(
                &program_id,
                &[],
                RecastCheckpointAttestationV1 {
                    candidate,
                    expected_council_version: 1,
                    expected_council_hash: [1; 32],
                    seat_index: 0,
                    expected_previous_attestation_digest: [2; 32],
                },
            ),
            process_finalize_checkpoint_v1(
                &program_id,
                &[],
                FinalizeCheckpointV1 {
                    candidate,
                    expected_council_version: 1,
                    expected_council_hash: [1; 32],
                },
            ),
            process_create_candidate_council_set_v1(
                &program_id,
                &[],
                CreateCandidateCouncilSetV1 {
                    expected_current_council_version: 1,
                    expected_current_council_hash: [1; 32],
                    candidate_council_version: 2,
                    activation_slot: 30,
                    expected_target_nonce: 7,
                    expected_gate_status: GateStatusV1::Active,
                    expected_gate_epoch: 5,
                    expected_candidate_council_hash: [2; 32],
                    seat_terms: [CouncilSeatTermV1::default(); 5],
                },
            ),
            process_create_council_rotation_v1(
                &program_id,
                &[],
                CreateCouncilRotationV1 {
                    creation_slot: 10,
                    not_before_slot: 30,
                    expiry_slot: 100,
                    expected_current_council_version: 1,
                    expected_current_council_hash: [1; 32],
                    expected_candidate_council_version: 2,
                    expected_candidate_council_hash: [2; 32],
                    expected_gate_status: GateStatusV1::Active,
                    expected_gate_epoch: 5,
                    expected_target_nonce: 7,
                    expected_rotation_digest: [3; 32],
                },
            ),
            process_approve_council_rotation_v1(
                &program_id,
                &[],
                ApproveCouncilRotationV1 {
                    expected: rotation,
                    expected_approval_bitset: 0,
                    expected_approval_count: 0,
                },
            ),
            process_activate_council_rotation_v1(
                &program_id,
                &[],
                ActivateCouncilRotationV1 {
                    expected: rotation,
                    expected_approval_bitset: 7,
                    expected_approval_count: 3,
                },
            ),
            process_queue_council_rotation_v1(
                &program_id,
                &[],
                QueueCouncilRotationV1 {
                    expected: rotation,
                    expected_approval_bitset: 7,
                    expected_approval_count: 3,
                },
            ),
            process_expire_emergency_resolution_v1(
                &program_id,
                &[],
                ExpireEmergencyResolutionV1 {
                    expected: emergency,
                },
            ),
            process_cancel_council_rotation_v1(
                &program_id,
                &[],
                CancelCouncilRotationV1 {
                    expected: rotation,
                    expected_cancellation_approval_bitset: 0,
                    expected_cancellation_approval_count: 0,
                    cancellation_reason_code: 9,
                },
            ),
            process_expire_council_rotation_v1(
                &program_id,
                &[],
                ExpireCouncilRotationV1 { expected: rotation },
            ),
        ];
        for result in cases {
            assert_eq!(result, Err(invalid_account_count()));
        }
    }

    #[test]
    fn duplicate_account_aliases_fail_before_privilege_or_clock_checks() {
        let program_id = key(90);
        let account_key = key(91);
        let owner = key(92);
        let mut lamports = 1;
        let mut data = [];
        let account = AccountInfo::new(
            &account_key,
            false,
            false,
            &mut lamports,
            &mut data,
            &owner,
            false,
            0,
        );
        let aliases = vec![account; 13];
        let instruction = CreateCandidateCouncilSetV1 {
            expected_current_council_version: 1,
            expected_current_council_hash: [1; 32],
            candidate_council_version: 2,
            activation_slot: 30,
            expected_target_nonce: 7,
            expected_gate_status: GateStatusV1::Active,
            expected_gate_epoch: 5,
            expected_candidate_council_hash: [2; 32],
            seat_terms: [CouncilSeatTermV1::default(); 5],
        };
        assert_eq!(
            process_create_candidate_council_set_v1(&program_id, &aliases, instruction),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    fn sample_config(program_id: &Pubkey, target_program: Pubkey) -> (Pubkey, ControllerConfigV1) {
        let (config_key, bump) = derive_controller_config_pda(program_id, &target_program);
        let target_programdata = derive_upgradeable_programdata_address(&target_program).0;
        let authority_pda = derive_authority_pda(program_id, &target_program).0;
        let gate_pda = derive_gate_pda(program_id, &target_program).0;
        (
            config_key,
            ControllerConfigV1 {
                discriminator: CONTROLLER_CONFIG_DISCRIMINATOR,
                version: ACCOUNT_VERSION_V1,
                bump,
                initialized: true,
                cluster_domain: [1; 32],
                target_program,
                target_programdata,
                upgradeable_loader: UPGRADEABLE_LOADER_ID,
                authority_pda,
                gate_pda,
                canonical_spill_treasury: key(10),
                current_council_version: 1,
                current_policy_version: 1,
                next_proposal_id: 2,
                target_nonce: 7,
                guardian: key(11),
                vote_program: Pubkey::default(),
                vote_programdata: Pubkey::default(),
                vote_config: Pubkey::default(),
                vote_mint: Pubkey::default(),
                token_governance_enabled: false,
                routine_delay_slots: 10,
                major_delay_slots: 20,
                rollback_delay_slots: 5,
                terminal_delay_slots: 30,
                vote_review_slots: 7,
                proposal_expiry_slots: 100,
                policy_flags: 0,
                reserved: [0; CONTROLLER_CONFIG_RESERVED_LEN],
            },
        )
    }

    fn sample_policy(
        program_id: &Pubkey,
        config_key: Pubkey,
        config: &ControllerConfigV1,
    ) -> (Pubkey, GovernancePolicyV1) {
        let (policy_key, bump) = derive_policy_pda(
            program_id,
            &config.target_program,
            config.current_policy_version,
        );
        let mut policy = GovernancePolicyV1 {
            discriminator: GOVERNANCE_POLICY_DISCRIMINATOR,
            account_version: ACCOUNT_VERSION_V1,
            bump,
            initialized: true,
            controller_config: config_key,
            version: config.current_policy_version,
            target_program: config.target_program,
            activation_slot: 1,
            council_size: 5,
            routine_threshold: 3,
            terminal_threshold: 4,
            governance_mode: crate::state::GovernanceModeV1::BootstrapCouncilOnly,
            policy_flags: 0,
            veto_quorum_bps: 0,
            affirmative_quorum_bps: 0,
            affirmative_approval_bps: 0,
            routine_requires_vote: false,
            economic_requires_vote: false,
            constitutional_requires_vote: false,
            rotation_requires_vote: false,
            immutability_requires_vote: false,
            policy_hash: [0; 32],
            reserved: [0; GOVERNANCE_POLICY_RESERVED_LEN],
        };
        policy.policy_hash = compute_policy_hash(&policy);
        (policy_key, policy)
    }

    #[test]
    fn config_loader_rejects_owner_size_discriminator_version_and_bump_drift() {
        let program_id = key(50);
        let target = key(51);
        let (config_key, config) = sample_config(&program_id, target);
        let mut lamports = 1;
        let mut bytes = config.try_to_vec().unwrap();
        let account = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut lamports,
            &mut bytes,
            &program_id,
            false,
            0,
        );
        assert_eq!(*load_config(&program_id, &account).unwrap(), config);

        let wrong_owner = key(52);
        let mut lamports = 1;
        let mut bytes = config.try_to_vec().unwrap();
        let account = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut lamports,
            &mut bytes,
            &wrong_owner,
            false,
            0,
        );
        assert_eq!(
            load_config(&program_id, &account),
            Err(GovernanceError::IncorrectAccountOwner.into())
        );

        let mut lamports = 1;
        let mut bytes = config.try_to_vec().unwrap();
        bytes.pop();
        let account = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut lamports,
            &mut bytes,
            &program_id,
            false,
            0,
        );
        assert_eq!(
            load_config(&program_id, &account),
            Err(GovernanceError::InvalidAccountSize.into())
        );

        let mut wrong_discriminator = config.clone();
        wrong_discriminator.discriminator = [0; 8];
        let mut lamports = 1;
        let mut bytes = wrong_discriminator.try_to_vec().unwrap();
        let account = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut lamports,
            &mut bytes,
            &program_id,
            false,
            0,
        );
        assert_eq!(
            load_config(&program_id, &account),
            Err(GovernanceError::InvalidDiscriminator.into())
        );

        let mut wrong_version = config.clone();
        wrong_version.version = ACCOUNT_VERSION_V1 + 1;
        let mut lamports = 1;
        let mut bytes = wrong_version.try_to_vec().unwrap();
        let account = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut lamports,
            &mut bytes,
            &program_id,
            false,
            0,
        );
        assert_eq!(
            load_config(&program_id, &account),
            Err(GovernanceError::UnsupportedVersion.into())
        );

        let mut wrong_bump = config;
        wrong_bump.bump ^= 1;
        let mut lamports = 1;
        let mut bytes = wrong_bump.try_to_vec().unwrap();
        let account = AccountInfo::new(
            &config_key,
            false,
            false,
            &mut lamports,
            &mut bytes,
            &program_id,
            false,
            0,
        );
        assert_eq!(
            load_config(&program_id, &account),
            Err(GovernanceError::InvalidPda.into())
        );
    }

    #[test]
    fn policy_loader_and_emergency_expiry_guard_reject_missing_wrong_and_stale_policy() {
        let program_id = key(53);
        let (config_key, config) = sample_config(&program_id, key(54));
        let (policy_key, policy) = sample_policy(&program_id, config_key, &config);
        let mut policy_lamports = 1;
        let mut policy_bytes = policy.try_to_vec().unwrap();
        let policy_info = AccountInfo::new(
            &policy_key,
            false,
            false,
            &mut policy_lamports,
            &mut policy_bytes,
            &program_id,
            false,
            0,
        );
        assert_eq!(
            *load_policy(&program_id, &policy_info, &config_key, &config, 50).unwrap(),
            policy
        );

        let mut wrong_policy = policy.clone();
        wrong_policy.policy_hash = [99; 32];
        let mut wrong_lamports = 1;
        let mut wrong_bytes = wrong_policy.try_to_vec().unwrap();
        let wrong_info = AccountInfo::new(
            &policy_key,
            false,
            false,
            &mut wrong_lamports,
            &mut wrong_bytes,
            &program_id,
            false,
            0,
        );
        assert_eq!(
            load_policy(&program_id, &wrong_info, &config_key, &config, 50),
            Err(GovernanceError::PolicyHashMismatch.into())
        );

        let gate = ProtocolGateV1 {
            discriminator: PROTOCOL_GATE_DISCRIMINATOR,
            version: ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            status: GateStatusV1::EmergencyFrozen,
            controller_config: config_key,
            target_program: config.target_program,
            target_programdata: config.target_programdata,
            epoch: 5,
            active_proposal: Pubkey::default(),
            freeze_slot: 10,
            freeze_reason_code: 2,
            last_completed_proposal: Pubkey::default(),
            reserved: [0; PROTOCOL_GATE_RESERVED_LEN],
        };
        let resolution = EmergencyFreezeResolutionV1 {
            discriminator: EMERGENCY_FREEZE_RESOLUTION_V1_DISCRIMINATOR,
            account_version: RELEASE1_ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            state: EmergencyFreezeResolutionStateV1::Draft,
            controller_config: config_key,
            protocol_gate: config.gate_pda,
            target_program: config.target_program,
            target_programdata: config.target_programdata,
            emergency_freeze_observation: key(60),
            frozen_epoch: 5,
            freeze_slot: 10,
            freeze_reason_code: 2,
            resolution_kind: EmergencyFreezeResolutionKindV1::ResumeWithoutUpgrade,
            creation_slot: 11,
            not_before_slot: 30,
            expiry_slot: 100,
            target_nonce: 7,
            observed_program_owner: UPGRADEABLE_LOADER_ID,
            observed_program_executable: true,
            observed_program_data_length: 36,
            observed_program_header_present: true,
            observed_linked_programdata: crate::state::OptionalPubkeyV1::some(
                config.target_programdata,
            )
            .unwrap(),
            observed_programdata_owner: UPGRADEABLE_LOADER_ID,
            observed_programdata_executable: false,
            observed_programdata_data_length: 109,
            observed_programdata_header_present: true,
            observed_programdata_slot: 9,
            observed_raw_hash_complete: true,
            observed_raw_programdata_hash: [4; 32],
            observed_capacity: 64,
            observed_authority: crate::state::OptionalPubkeyV1::some(config.authority_pda).unwrap(),
            emergency_checkpoint: key(61),
            approval_council_version: 1,
            approval_council_hash: [3; 32],
            approval_bitset: 0,
            approval_count: 0,
            resolution_digest: [1; 32],
            executed_slot: 0,
            cancellation_reason_code: 0,
            terminal_reason_code: 0,
            reserved: [0; EMERGENCY_FREEZE_RESOLUTION_V1_RESERVED_LEN],
        };
        let mut expected = emergency_expectation();
        expected.expected_policy_hash = policy.policy_hash;
        assert_eq!(
            validate_emergency_expiry_expectation(&expected, &config, &policy, &gate, &resolution,),
            Ok(())
        );
        expected.expected_policy_hash = [0; 32];
        assert_eq!(
            validate_emergency_expiry_expectation(&expected, &config, &policy, &gate, &resolution,),
            Err(GovernanceError::CrossAccountMismatch)
        );

        let resolution_before = vec![0x3c; EmergencyFreezeResolutionV1::LEN];
        let missing_policy_accounts = vec![
            leaked_account(80, false, false, false, vec![]),
            leaked_account(81, false, false, false, vec![]),
            leaked_account(82, false, true, false, resolution_before.clone()),
        ];
        assert_eq!(
            process_expire_emergency_resolution_v1(
                &program_id,
                &missing_policy_accounts,
                ExpireEmergencyResolutionV1 { expected },
            ),
            Err(invalid_account_count())
        );
        assert_eq!(
            &**missing_policy_accounts[2].try_borrow_data().unwrap(),
            resolution_before.as_slice()
        );
        expected.expected_policy_hash = policy.policy_hash;
        expected.expected_policy_version += 1;
        assert_eq!(
            validate_emergency_expiry_expectation(&expected, &config, &policy, &gate, &resolution,),
            Err(GovernanceError::CrossAccountMismatch)
        );
    }

    fn leaked_account(
        byte: u8,
        signer: bool,
        writable: bool,
        executable: bool,
        data: Vec<u8>,
    ) -> AccountInfo<'static> {
        let account_key = Box::leak(Box::new(key(byte)));
        let owner = Box::leak(Box::new(key(byte.wrapping_add(100))));
        let lamports = Box::leak(Box::new(1u64));
        let data = Box::leak(data.into_boxed_slice());
        AccountInfo::new(
            account_key,
            signer,
            writable,
            lamports,
            data,
            owner,
            executable,
            0,
        )
    }

    fn account_data_snapshot(accounts: &[AccountInfo<'_>]) -> Vec<Vec<u8>> {
        accounts
            .iter()
            .map(|account| account.try_borrow_data().unwrap().to_vec())
            .collect()
    }

    #[test]
    fn candidate_creation_allows_only_the_creator_candidate_role_alias() {
        let intentional_creator_alias = vec![
            leaked_account(1, true, true, false, vec![]),
            leaked_account(2, true, false, false, vec![]),
            leaked_account(3, false, false, false, vec![]),
            leaked_account(4, false, false, false, vec![]),
            leaked_account(5, false, false, false, vec![]),
            leaked_account(6, false, false, false, vec![]),
            leaked_account(7, false, true, false, vec![]),
            leaked_account(2, true, false, false, vec![]),
            leaked_account(8, false, false, false, vec![]),
            leaked_account(9, false, false, false, vec![]),
            leaked_account(10, false, false, false, vec![]),
            leaked_account(11, false, false, false, vec![]),
            leaked_account(12, false, false, true, vec![]),
        ];
        let before = account_data_snapshot(&intentional_creator_alias);
        assert_eq!(
            validate_candidate_creation_authority_contract(
                &intentional_creator_alias[0],
                &intentional_creator_alias[1],
                &intentional_creator_alias[2],
                &intentional_creator_alias[3],
                &intentional_creator_alias[4],
                &intentional_creator_alias[5],
                &intentional_creator_alias[6],
                &intentional_creator_alias[7..12],
                &intentional_creator_alias[12],
            ),
            Ok(())
        );
        assert_eq!(account_data_snapshot(&intentional_creator_alias), before);

        let mut illegal_fixed_role_alias = intentional_creator_alias;
        illegal_fixed_role_alias[8] = illegal_fixed_role_alias[2].clone();
        let before = account_data_snapshot(&illegal_fixed_role_alias);
        assert_eq!(
            validate_candidate_creation_authority_contract(
                &illegal_fixed_role_alias[0],
                &illegal_fixed_role_alias[1],
                &illegal_fixed_role_alias[2],
                &illegal_fixed_role_alias[3],
                &illegal_fixed_role_alias[4],
                &illegal_fixed_role_alias[5],
                &illegal_fixed_role_alias[6],
                &illegal_fixed_role_alias[7..12],
                &illegal_fixed_role_alias[12],
            ),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
        assert_eq!(account_data_snapshot(&illegal_fixed_role_alias), before);
    }

    #[test]
    fn unit_privilege_failures_leave_checkpoint_and_rotation_bytes_identical() {
        let program_id = key(70);
        let rotation_before = vec![0x5a; CouncilRotationProposalV1::LEN];
        let rotation_accounts = vec![
            leaked_account(1, false, true, false, vec![]), // config must be read-only
            leaked_account(2, false, false, false, vec![]),
            leaked_account(3, false, false, false, vec![]),
            leaked_account(4, false, false, false, vec![]),
            leaked_account(5, false, false, false, vec![]),
            leaked_account(6, false, true, false, rotation_before.clone()),
        ];
        let result = process_queue_council_rotation_v1(
            &program_id,
            &rotation_accounts,
            QueueCouncilRotationV1 {
                expected: rotation_expectation(),
                expected_approval_bitset: 7,
                expected_approval_count: 3,
            },
        );
        assert_eq!(
            result,
            Err(GovernanceError::InvalidAccountPrivileges.into())
        );
        assert_eq!(
            &**rotation_accounts[5].try_borrow_data().unwrap(),
            rotation_before.as_slice()
        );

        let attestation_before = vec![0xa5; CheckpointAttestationV1::LEN];
        let checkpoint_accounts = vec![
            leaked_account(10, false, true, false, vec![]), // payer must sign
            leaked_account(11, false, false, false, vec![]),
            leaked_account(12, false, false, false, vec![]),
            leaked_account(13, false, false, false, vec![]),
            leaked_account(14, false, false, false, vec![]),
            leaked_account(15, false, false, false, vec![]),
            leaked_account(16, false, false, false, vec![]),
            leaked_account(17, false, true, false, attestation_before.clone()),
            leaked_account(18, true, false, false, vec![]),
            leaked_account(19, false, false, true, vec![]),
        ];
        let result = process_create_checkpoint_attestation_v1(
            &program_id,
            &checkpoint_accounts,
            CreateCheckpointAttestationV1 {
                candidate: dummy_candidate(StateCheckpointPhaseV1::Prestate),
                expected_council_version: 1,
                expected_council_hash: [1; 32],
                seat_index: 0,
            },
        );
        assert_eq!(
            result,
            Err(GovernanceError::InvalidAccountPrivileges.into())
        );
        assert_eq!(
            &**checkpoint_accounts[7].try_borrow_data().unwrap(),
            attestation_before.as_slice()
        );
    }

    fn baseline_checkpoint() -> StateCheckpointV1 {
        StateCheckpointV1 {
            discriminator: STATE_CHECKPOINT_V1_DISCRIMINATOR,
            account_version: RELEASE1_ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            phase: StateCheckpointPhaseV1::Prestate,
            controller_config: key(1),
            proposal: key(2),
            emergency_resolution: Pubkey::default(),
            subject_digest: [1; 32],
            target_program: key(3),
            target_programdata: key(4),
            finalized_observation_slot: 10,
            gate_epoch: 7,
            target_programdata_slot: 9,
            target_payload_commitment: [2; 32],
            target_raw_programdata_commitment: [3; 32],
            target_capacity: 64,
            program_owned_state_root: [4; 32],
            program_owned_state_count: 2,
            logical_compressed_state_root: [5; 32],
            logical_compressed_state_count: 3,
            semantic_custody_accounting_root: [6; 32],
            hard_combined_root: [7; 32],
            external_metadata_observation_root: [8; 32],
            external_raw_balance_observation_root: [9; 32],
            schema_identifier: [10; 32],
            admitted_positive_donation_root: [0; 32],
            admitted_positive_donation_count: 0,
            forbidden_drift_count: 0,
            approval_council_version: 1,
            approval_council_hash: [11; 32],
            checkpoint_digest: [12; 32],
            approval_bitset: 7,
            approval_count: 3,
            accepted: true,
            finalized_slot: 20,
            reserved: [0; STATE_CHECKPOINT_V1_RESERVED_LEN],
        }
    }

    fn candidate_from_baseline(baseline: &StateCheckpointV1) -> CheckpointCandidateV1 {
        let mut candidate = dummy_candidate(StateCheckpointPhaseV1::Poststate);
        candidate.program_owned_state_root = baseline.program_owned_state_root;
        candidate.program_owned_state_count = baseline.program_owned_state_count;
        candidate.logical_compressed_state_root = baseline.logical_compressed_state_root;
        candidate.logical_compressed_state_count = baseline.logical_compressed_state_count;
        candidate.semantic_custody_accounting_root = baseline.semantic_custody_accounting_root;
        candidate.hard_combined_root = baseline.hard_combined_root;
        candidate.external_metadata_observation_root = baseline.external_metadata_observation_root;
        candidate.external_raw_balance_observation_root =
            baseline.external_raw_balance_observation_root;
        candidate.schema_identifier = baseline.schema_identifier;
        candidate
    }

    #[test]
    fn poststate_hard_roots_block_while_only_explicit_positive_donation_drift_is_admitted() {
        let baseline = baseline_checkpoint();
        let mut candidate = candidate_from_baseline(&baseline);
        assert_eq!(validate_poststate_outcome(&baseline, &candidate), Ok(()));

        candidate.external_raw_balance_observation_root = [90; 32];
        assert_eq!(
            validate_poststate_hard_invariants(&baseline, &candidate),
            Err(GovernanceError::InvalidRelease1Account)
        );
        candidate.admitted_positive_donation_root = [91; 32];
        candidate.admitted_positive_donation_count = 1;
        assert_eq!(validate_poststate_outcome(&baseline, &candidate), Ok(()));

        candidate.program_owned_state_root = [92; 32];
        assert_eq!(
            validate_poststate_outcome(&baseline, &candidate),
            Err(GovernanceError::InvalidRelease1Account)
        );
        candidate.forbidden_drift_count = 1;
        assert_eq!(
            validate_poststate_hard_invariants(&baseline, &candidate),
            Err(GovernanceError::InvalidRelease1Account)
        );
    }

    #[test]
    fn rejected_poststate_requires_forbidden_drift_and_a_concrete_prestate_mismatch() {
        let baseline = baseline_checkpoint();
        let mut candidate = candidate_from_baseline(&baseline);

        // An explicit non-donation external-balance failure is immutable
        // rejected evidence usable by the rollback path.
        candidate.forbidden_drift_count = 1;
        candidate.external_raw_balance_observation_root = [93; 32];
        assert_eq!(validate_checkpoint_acceptance_shape(&candidate), Ok(()));
        assert_eq!(validate_poststate_outcome(&baseline, &candidate), Ok(()));

        // A forbidden count alone cannot fabricate a rejected checkpoint when
        // every observed protected-state field still matches Prestate.
        candidate.external_raw_balance_observation_root =
            baseline.external_raw_balance_observation_root;
        assert_eq!(
            validate_poststate_outcome(&baseline, &candidate),
            Err(GovernanceError::InvalidRelease1Account)
        );

        // Identity drift is also a concrete rejected outcome when attested as
        // forbidden; it is never normalized as a donation.
        candidate.external_metadata_observation_root = [95; 32];
        candidate.hard_combined_root = [96; 32];
        assert_eq!(validate_poststate_outcome(&baseline, &candidate), Ok(()));

        // Without forbidden evidence the same identity drift cannot enter the
        // accepted lane.
        candidate.forbidden_drift_count = 0;
        assert_eq!(
            validate_poststate_outcome(&baseline, &candidate),
            Err(GovernanceError::InvalidRelease1Account)
        );

        // Prestate and Emergency never have a rejected form.
        let mut prestate = dummy_candidate(StateCheckpointPhaseV1::Prestate);
        prestate.forbidden_drift_count = 1;
        assert_eq!(
            validate_checkpoint_acceptance_shape(&prestate),
            Err(GovernanceError::InvalidRelease1Account)
        );
        let mut emergency = dummy_candidate(StateCheckpointPhaseV1::Emergency);
        emergency.forbidden_drift_count = 1;
        assert_eq!(
            validate_checkpoint_acceptance_shape(&emergency),
            Err(GovernanceError::InvalidRelease1Account)
        );

        // The persisted schema independently prevents accepted=true from being
        // paired with any forbidden drift.
        let mut impossible = baseline;
        impossible.forbidden_drift_count = 1;
        assert_eq!(
            impossible.validate_schema(),
            Err(GovernanceError::InvalidRelease1Account)
        );
    }

    #[test]
    fn target_snapshot_is_raw_hash_and_authority_hard_without_a_second_payload_hash() {
        let program_id = key(100);
        let target_program = key(101);
        let (_config_key, config) = sample_config(&program_id, target_program);
        let target_programdata = config.target_programdata;
        let wrong_authority = key(102);

        let mut program_bytes = vec![0u8; 36];
        program_bytes[..4].copy_from_slice(&2u32.to_le_bytes());
        program_bytes[4..36].copy_from_slice(target_programdata.as_ref());
        let mut programdata_bytes = vec![0u8; 45 + 64];
        programdata_bytes[..4].copy_from_slice(&3u32.to_le_bytes());
        programdata_bytes[4..12].copy_from_slice(&9u64.to_le_bytes());
        programdata_bytes[12] = 1;
        programdata_bytes[13..45].copy_from_slice(config.authority_pda.as_ref());
        programdata_bytes[45..].fill(7);

        let mut candidate = dummy_candidate(StateCheckpointPhaseV1::Poststate);
        candidate.target_programdata_slot = 9;
        candidate.target_capacity = 64;
        candidate.target_raw_programdata_commitment = loader_account_data_hash(&programdata_bytes);
        candidate.target_payload_commitment = [17; 32];

        let mut program_lamports = 1;
        let mut programdata_lamports = 1;
        let program_info = AccountInfo::new(
            &target_program,
            false,
            false,
            &mut program_lamports,
            &mut program_bytes,
            &UPGRADEABLE_LOADER_ID,
            true,
            0,
        );
        let programdata_info = AccountInfo::new(
            &target_programdata,
            false,
            false,
            &mut programdata_lamports,
            &mut programdata_bytes,
            &UPGRADEABLE_LOADER_ID,
            false,
            0,
        );
        assert_eq!(
            validate_target_snapshot(&program_info, &programdata_info, &config, &candidate),
            Ok(())
        );

        {
            let mut data = programdata_info.try_borrow_mut_data().unwrap();
            data[13..45].copy_from_slice(wrong_authority.as_ref());
            candidate.target_raw_programdata_commitment = loader_account_data_hash(&data);
        }
        assert_eq!(
            validate_target_snapshot(&program_info, &programdata_info, &config, &candidate),
            Err(GovernanceError::Release1DigestMismatch.into())
        );

        {
            let mut data = programdata_info.try_borrow_mut_data().unwrap();
            data[13..45].copy_from_slice(config.authority_pda.as_ref());
        }
        candidate.target_raw_programdata_commitment = [99; 32];
        assert_eq!(
            validate_target_snapshot(&program_info, &programdata_info, &config, &candidate),
            Err(GovernanceError::Release1DigestMismatch.into())
        );
    }

    #[test]
    fn rollback_prestate_requires_the_linked_primary_programdata_verification() {
        let fixture = sample_rollback_evidence_fixture();
        assert!(fixture.evidence.capacity > fixture.evidence.artifact_length);
        assert_ne!(
            fixture.evidence.artifact_sha256,
            fixture.commitment.expected_candidate_full_payload_sha256
        );
        assert_eq!(fixture.validate(), Ok(10));

        let mut wrong_primary = fixture.clone();
        wrong_primary.commitment.primary_proposal = key(123);
        assert_eq!(
            wrong_primary.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut wrong_full_hash = fixture.clone();
        wrong_full_hash
            .commitment
            .expected_candidate_full_payload_sha256 = [13; 32];
        assert_eq!(
            wrong_full_hash.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut wrong_root = fixture.clone();
        wrong_root.evidence.artifact_chunk_merkle_root = [14; 32];
        assert_eq!(
            wrong_root.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut wrong_authority = fixture.clone();
        wrong_authority.evidence.controller_authority = key(124);
        assert_eq!(
            wrong_authority.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn rollback_failure_prestate_separates_expected_payload_from_actual_raw_programdata() {
        let fixture = sample_rollback_failure_evidence_fixture();
        assert_eq!(
            fixture.candidate.target_payload_commitment,
            fixture.commitment.expected_candidate_full_payload_sha256
        );
        assert_eq!(
            fixture.candidate.target_raw_programdata_commitment,
            fixture.evidence.actual_raw_programdata_sha256
        );
        assert_ne!(
            fixture.candidate.target_payload_commitment,
            fixture.candidate.target_raw_programdata_commitment
        );
        assert_eq!(fixture.validate(), Ok(10));

        let mut stale_epoch = fixture.clone();
        stale_epoch.evidence.frozen_epoch -= 1;
        stale_epoch.evidence_key = derive_programdata_failure_observation_pda(
            &stale_epoch.program_id,
            &stale_epoch.commitment.primary_proposal,
            stale_epoch.evidence.frozen_epoch,
        )
        .0;
        stale_epoch.evidence.bump = derive_programdata_failure_observation_pda(
            &stale_epoch.program_id,
            &stale_epoch.commitment.primary_proposal,
            stale_epoch.evidence.frozen_epoch,
        )
        .1;
        stale_epoch.refresh_digest();
        assert_eq!(
            stale_epoch.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut wrong_live_hash = fixture.clone();
        wrong_live_hash.evidence.actual_raw_programdata_sha256 = [42; 32];
        wrong_live_hash.refresh_digest();
        assert_eq!(
            wrong_live_hash.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut wrong_authority = fixture.clone();
        wrong_authority.evidence.actual_authority = OptionalPubkeyV1::some(key(133)).unwrap();
        wrong_authority.refresh_digest();
        assert_eq!(
            wrong_authority.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut structural_failure = fixture;
        structural_failure.evidence.mismatch_class = ProgramDataMismatchClassV1::Header;
        structural_failure.evidence.failing_chunk_index =
            crate::release1_state::NO_FAILING_CHUNK_INDEX_V1;
        structural_failure.evidence.expected_leaf_hash = [0; 32];
        structural_failure.evidence.actual_leaf_hash = [0; 32];
        structural_failure.refresh_digest();
        assert_eq!(
            structural_failure.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn rollback_prestate_inherits_the_primary_accepted_prestate_roots() {
        let fixture = sample_rollback_baseline_fixture();
        assert_eq!(fixture.validate(), Ok(fixture.baseline.finalized_slot));

        let mut changed_program_state = fixture.clone();
        changed_program_state.candidate.program_owned_state_root = [50; 32];
        assert_eq!(
            changed_program_state.validate(),
            Err(GovernanceError::InvalidRelease1Account.into())
        );

        let mut changed_schema = fixture.clone();
        changed_schema.candidate.schema_identifier = [51; 32];
        assert_eq!(
            changed_schema.validate(),
            Err(GovernanceError::InvalidRelease1Account.into())
        );

        let mut stale_primary_epoch = fixture.clone();
        stale_primary_epoch.baseline.gate_epoch -= 1;
        stale_primary_epoch.baseline.checkpoint_digest =
            compute_state_checkpoint_digest_v1(&stale_primary_epoch.baseline).unwrap();
        assert_eq!(
            stale_primary_epoch.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut donation = fixture;
        donation.candidate.external_raw_balance_observation_root = [52; 32];
        donation.candidate.admitted_positive_donation_root = [53; 32];
        donation.candidate.admitted_positive_donation_count = 1;
        assert_eq!(donation.validate(), Ok(donation.baseline.finalized_slot));
    }

    #[test]
    fn rollback_zero_creation_observations_cannot_bypass_live_prestate_evidence() {
        let fixture = sample_rollback_evidence_fixture();

        let mut zero_observation = fixture.clone();
        zero_observation.candidate.target_programdata_slot = 0;
        zero_observation.candidate.target_raw_programdata_commitment = [0; 32];
        assert_eq!(
            zero_observation.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut wrong_live_payload = fixture.clone();
        wrong_live_payload.candidate.target_payload_commitment = [15; 32];
        assert_eq!(
            wrong_live_payload.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut wrong_capacity = fixture.clone();
        wrong_capacity.candidate.target_capacity += 1;
        assert_eq!(
            wrong_capacity.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );

        let mut late_evidence = fixture;
        late_evidence.evidence.finalized_slot =
            late_evidence.candidate.finalized_observation_slot + 1;
        assert_eq!(
            late_evidence.validate(),
            Err(GovernanceError::CrossAccountMismatch.into())
        );
    }

    #[test]
    fn candidate_seat_terms_are_rechecked_at_the_actual_activation_slot() {
        let seats = std::array::from_fn(|index| CouncilSeatV1 {
            seat_authority: key(index as u8 + 20),
            term_start_slot: 5,
            term_end_slot: 100,
            active: true,
            reserved: [0; COUNCIL_SEAT_RESERVED_LEN],
        });
        let mut candidate = GovernanceCouncilSetV1 {
            discriminator: GOVERNANCE_COUNCIL_DISCRIMINATOR,
            account_version: ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            controller_config: key(30),
            version: 2,
            target_program: key(31),
            activation_slot: 10,
            deactivation_slot: 0,
            seats,
            routine_threshold: 3,
            terminal_threshold: 4,
            policy_flags: 0,
            set_hash: [1; 32],
            reserved: [0; GOVERNANCE_COUNCIL_RESERVED_LEN],
        };
        assert_eq!(validate_candidate_seats_at_slot(&candidate, 50), Ok(()));
        candidate.seats[4].term_end_slot = 50;
        assert_eq!(
            validate_candidate_seats_at_slot(&candidate, 50),
            Err(GovernanceError::InactiveCouncilSeat)
        );
    }

    #[test]
    fn candidate_council_cannot_turn_the_guardian_into_a_voting_seat() {
        let guardian = key(90);
        let seats = std::array::from_fn(|index| CouncilSeatV1 {
            seat_authority: key(index as u8 + 40),
            term_start_slot: 5,
            term_end_slot: 100,
            active: true,
            reserved: [0; COUNCIL_SEAT_RESERVED_LEN],
        });
        let mut candidate = GovernanceCouncilSetV1 {
            discriminator: GOVERNANCE_COUNCIL_DISCRIMINATOR,
            account_version: ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            controller_config: key(50),
            version: 2,
            target_program: key(51),
            activation_slot: 10,
            deactivation_slot: 0,
            seats,
            routine_threshold: 3,
            terminal_threshold: 4,
            policy_flags: 0,
            set_hash: [1; 32],
            reserved: [0; GOVERNANCE_COUNCIL_RESERVED_LEN],
        };
        assert_eq!(
            validate_council_guardian_separation(&candidate, &guardian),
            Ok(())
        );
        candidate.seats[2].seat_authority = guardian;
        assert_eq!(
            validate_council_guardian_separation(&candidate, &guardian),
            Err(GovernanceError::InvalidCouncilComposition)
        );
    }

    #[test]
    fn rotation_guards_bind_nonce_gate_state_timing_and_both_council_hashes() {
        let program_id = key(40);
        let (_config_key, config) = sample_config(&program_id, key(41));
        let gate = ProtocolGateV1 {
            discriminator: PROTOCOL_GATE_DISCRIMINATOR,
            version: ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            status: GateStatusV1::Active,
            controller_config: key(42),
            target_program: config.target_program,
            target_programdata: config.target_programdata,
            epoch: 5,
            active_proposal: Pubkey::default(),
            freeze_slot: 0,
            freeze_reason_code: 0,
            last_completed_proposal: Pubkey::default(),
            reserved: [0; PROTOCOL_GATE_RESERVED_LEN],
        };
        let rotation = CouncilRotationProposalV1 {
            discriminator: COUNCIL_ROTATION_PROPOSAL_V1_DISCRIMINATOR,
            account_version: RELEASE1_ACCOUNT_VERSION_V1,
            bump: 1,
            initialized: true,
            state: CouncilRotationStateV1::Draft,
            controller_config: key(42),
            target_program: config.target_program,
            current_council: key(43),
            current_council_version: 1,
            current_council_hash: [2; 32],
            candidate_council: key(44),
            candidate_council_version: 2,
            candidate_council_hash: [3; 32],
            creation_slot: 10,
            not_before_slot: 30,
            expiry_slot: 100,
            target_nonce: 7,
            approval_bitset: 0,
            approval_count: 0,
            cancellation_approval_bitset: 0,
            cancellation_approval_count: 0,
            rotation_digest: [1; 32],
            activated_slot: 0,
            cancellation_reason_code: 0,
            terminal_reason_code: 0,
            reserved: [0; COUNCIL_ROTATION_PROPOSAL_V1_RESERVED_LEN],
        };
        let expected = rotation_expectation();
        assert_eq!(
            validate_rotation_expectation(&expected, &config, &gate, &rotation),
            Ok(())
        );
        let mut stale = expected;
        stale.expected_target_nonce += 1;
        assert_eq!(
            validate_rotation_expectation(&stale, &config, &gate, &rotation),
            Err(GovernanceError::CrossAccountMismatch)
        );
        let mut stale = expected;
        stale.expected_candidate_council_hash = [99; 32];
        assert_eq!(
            validate_rotation_expectation(&stale, &config, &gate, &rotation),
            Err(GovernanceError::CrossAccountMismatch)
        );
    }
}
