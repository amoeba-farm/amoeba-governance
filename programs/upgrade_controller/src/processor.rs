use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo, clock::Clock, entrypoint::ProgramResult,
    program_error::ProgramError, pubkey::Pubkey, sysvar::Sysvar,
};

use crate::{
    authorization::validate_seat_authority,
    council::{evaluate_proposal_quorum, record_proposal_approval},
    instruction::RecordProposalApprovalV1,
    pda::{
        derive_authority_pda, derive_checkpoint_pda, derive_controller_config_pda,
        derive_council_pda, derive_gate_pda, derive_policy_pda, derive_proposal_pda,
    },
    policy::validate_policy_against_config,
    proposal::validate_proposal_against_policy,
    state::{
        CheckpointPhaseV1, ControllerConfigV1, GovernanceCouncilSetV1, GovernancePolicyV1,
        ProposalStateV1, UpgradeProposalV1,
    },
    GovernanceError,
};

pub const UPGRADEABLE_LOADER_ID: Pubkey =
    solana_pubkey::pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction_data: &[u8],
) -> ProgramResult {
    let instruction = RecordProposalApprovalV1::unpack(instruction_data)?;
    process_record_proposal_approval(program_id, accounts, instruction)
}

fn process_record_proposal_approval(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction: RecordProposalApprovalV1,
) -> ProgramResult {
    let [config_info, policy_info, council_info, proposal_info, seat_authority_info] = accounts
    else {
        return Err(GovernanceError::InvalidAccountCount.into());
    };

    validate_state_privileges(config_info, false)?;
    validate_state_privileges(policy_info, false)?;
    validate_state_privileges(council_info, false)?;
    validate_state_privileges(proposal_info, true)?;
    validate_seat_authority(seat_authority_info)?;

    let config = load_controller_account::<ControllerConfigV1>(
        program_id,
        config_info,
        ControllerConfigV1::LEN,
    )?;
    let policy = load_controller_account::<GovernancePolicyV1>(
        program_id,
        policy_info,
        GovernancePolicyV1::LEN,
    )?;
    let council = load_controller_account::<GovernanceCouncilSetV1>(
        program_id,
        council_info,
        GovernanceCouncilSetV1::LEN,
    )?;
    let proposal = load_controller_account::<UpgradeProposalV1>(
        program_id,
        proposal_info,
        UpgradeProposalV1::LEN,
    )?;

    config.validate_static()?;
    validate_policy_against_config(&policy, &config)?;
    validate_proposal_against_policy(&proposal, &policy)?;

    let slot = Clock::get()?.slot;
    if slot < policy.activation_slot {
        return Err(GovernanceError::InactivePolicy.into());
    }

    validate_canonical_graph(
        program_id,
        config_info,
        policy_info,
        council_info,
        proposal_info,
        &config,
        &policy,
        &council,
        &proposal,
        &instruction,
    )?;

    if proposal.state != ProposalStateV1::BufferVerified {
        return Err(GovernanceError::InvalidStateTransition.into());
    }
    if instruction.expected_proposal_digest != proposal.proposal_digest {
        return Err(GovernanceError::ProposalDigestMismatch.into());
    }

    // A BufferVerified proposal must begin below quorum. This rejects seeded or
    // corrupted state that already carries enough active approvals, and makes
    // the later transition provably a false-to-true threshold crossing.
    match evaluate_proposal_quorum(
        &council,
        &policy,
        config.current_council_version,
        &proposal,
        slot,
    ) {
        Ok(_) => return Err(GovernanceError::InvalidStateTransition.into()),
        Err(GovernanceError::QuorumNotSatisfied) => {}
        Err(error) => return Err(error.into()),
    }

    let (next_bitset, next_count) = record_proposal_approval(
        &council,
        &policy,
        config.current_council_version,
        &proposal,
        seat_authority_info.key,
        &instruction.expected_proposal_digest,
        slot,
    )?;

    let mut next_proposal = proposal.clone();
    next_proposal.council_approval_bitset = next_bitset;
    next_proposal.council_approval_count = next_count;
    match evaluate_proposal_quorum(
        &council,
        &policy,
        config.current_council_version,
        &next_proposal,
        slot,
    ) {
        Ok(_) => next_proposal.state = ProposalStateV1::CouncilApproved,
        Err(GovernanceError::QuorumNotSatisfied) => {}
        Err(error) => return Err(error.into()),
    }

    // Serialize off-borrow and validate the exact final representation before
    // taking a mutable account-data borrow. No failed check can partially
    // mutate the proposal.
    validate_proposal_against_policy(&next_proposal, &policy)?;
    let encoded = next_proposal
        .try_to_vec()
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if encoded.len() != UpgradeProposalV1::LEN {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    let mut proposal_data = proposal_info.try_borrow_mut_data()?;
    if proposal_data.len() != UpgradeProposalV1::LEN {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    proposal_data.copy_from_slice(&encoded);
    Ok(())
}

fn validate_state_privileges(account: &AccountInfo<'_>, writable: bool) -> ProgramResult {
    if account.is_signer || account.executable || account.is_writable != writable {
        return Err(GovernanceError::InvalidAccountPrivileges.into());
    }
    Ok(())
}

fn load_controller_account<T: BorshDeserialize>(
    program_id: &Pubkey,
    account: &AccountInfo<'_>,
    expected_len: usize,
) -> Result<T, ProgramError> {
    if account.owner != program_id {
        return Err(GovernanceError::IncorrectAccountOwner.into());
    }
    if account.data_len() != expected_len {
        return Err(GovernanceError::InvalidAccountSize.into());
    }
    T::try_from_slice(&account.try_borrow_data()?).map_err(|_| ProgramError::InvalidAccountData)
}

#[allow(clippy::too_many_arguments)]
fn validate_canonical_graph(
    program_id: &Pubkey,
    config_info: &AccountInfo<'_>,
    policy_info: &AccountInfo<'_>,
    council_info: &AccountInfo<'_>,
    proposal_info: &AccountInfo<'_>,
    config: &ControllerConfigV1,
    policy: &GovernancePolicyV1,
    council: &GovernanceCouncilSetV1,
    proposal: &UpgradeProposalV1,
    instruction: &RecordProposalApprovalV1,
) -> ProgramResult {
    let (expected_config, config_bump) =
        derive_controller_config_pda(program_id, &config.target_program);
    let (expected_policy, policy_bump) =
        derive_policy_pda(program_id, &config.target_program, policy.version);
    let (expected_council, council_bump) =
        derive_council_pda(program_id, &config.target_program, council.version);
    let (expected_proposal, proposal_bump) =
        derive_proposal_pda(program_id, &config.target_program, proposal.proposal_id);
    let expected_authority = derive_authority_pda(program_id, &config.target_program).0;
    let expected_gate = derive_gate_pda(program_id, &config.target_program).0;
    let expected_prestate_checkpoint =
        derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Prestate).0;
    let expected_poststate_checkpoint =
        derive_checkpoint_pda(program_id, proposal_info.key, CheckpointPhaseV1::Poststate).0;
    let expected_programdata =
        Pubkey::find_program_address(&[config.target_program.as_ref()], &UPGRADEABLE_LOADER_ID).0;

    if *config_info.key != expected_config
        || config.bump != config_bump
        || *policy_info.key != expected_policy
        || policy.bump != policy_bump
        || *council_info.key != expected_council
        || council.bump != council_bump
        || *proposal_info.key != expected_proposal
        || proposal.bump != proposal_bump
    {
        return Err(GovernanceError::InvalidPda.into());
    }

    if config.upgradeable_loader != UPGRADEABLE_LOADER_ID
        || config.target_programdata != expected_programdata
        || config.authority_pda != expected_authority
        || config.gate_pda != expected_gate
        || policy.controller_config != *config_info.key
        || council.controller_config != *config_info.key
        || proposal.controller_config != *config_info.key
        || policy.target_program != config.target_program
        || council.target_program != config.target_program
        || proposal.target_program != config.target_program
        || policy.version != config.current_policy_version
        || proposal.policy_version != config.current_policy_version
        || proposal.policy_hash != policy.policy_hash
        || proposal.controller_program != *program_id
        || proposal.cluster_domain != config.cluster_domain
        || proposal.protocol_gate != config.gate_pda
        || proposal.target_programdata != config.target_programdata
        || proposal.upgradeable_loader != config.upgradeable_loader
        || proposal.authority_pda != config.authority_pda
        || proposal.canonical_spill_treasury != config.canonical_spill_treasury
        || proposal.target_nonce != config.target_nonce
        || proposal.proposal_id >= config.next_proposal_id
        || proposal.prestate_checkpoint != expected_prestate_checkpoint
        || proposal.required_poststate_checkpoint != expected_poststate_checkpoint
    {
        return Err(GovernanceError::CrossAccountMismatch.into());
    }
    if council.version != config.current_council_version
        || proposal.council_version != config.current_council_version
        || instruction.expected_council_version != config.current_council_version
    {
        return Err(GovernanceError::StaleCouncilVersion.into());
    }
    if proposal.council_hash != council.set_hash {
        return Err(GovernanceError::ProposalCouncilHashMismatch.into());
    }
    Ok(())
}
