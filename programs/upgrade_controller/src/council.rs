use std::collections::{BTreeMap, BTreeSet};

use solana_program::{hash::hashv, pubkey::Pubkey};

use crate::{
    policy::validate_policy,
    proposal::validate_proposal_against_policy,
    state::{
        validate_reserved, AppointingBodyV1, CouncilSeatV1, GovernanceCouncilSetV1,
        GovernancePolicyV1, ProposalClassV1, SeatClassV1, UpgradeProposalV1, ACCOUNT_VERSION_V1,
        GOVERNANCE_COUNCIL_DISCRIMINATOR,
    },
    GovernanceError, GovernanceResult,
};

pub const COUNCIL_SET_HASH_DOMAIN_V1: &[u8] = b"AMOEBA_GOVERNANCE_COUNCIL_V1";
pub const COUNCIL_SET_HASH_MATERIAL_LEN: usize = 511;
pub const COUNCIL_SEAT_COUNT: usize = 5;
pub const VALID_APPROVAL_MASK: u8 = 0b0001_1111;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ApprovalRequirementV1 {
    Routine,
    Major,
    Terminal,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QuorumEvaluationV1 {
    pub total_approvals: u8,
}

pub fn canonical_council_hash_material(
    council: &GovernanceCouncilSetV1,
) -> [u8; COUNCIL_SET_HASH_MATERIAL_LEN] {
    let mut out = [0u8; COUNCIL_SET_HASH_MATERIAL_LEN];
    let mut offset = 0usize;
    put_pubkey(&mut out, &mut offset, &council.controller_config);
    put_u64(&mut out, &mut offset, council.version);
    put_pubkey(&mut out, &mut offset, &council.target_program);
    put_u64(&mut out, &mut offset, council.activation_slot);
    put_u64(&mut out, &mut offset, council.deactivation_slot);
    for seat in &council.seats {
        put_pubkey(&mut out, &mut offset, &seat.signer);
        put_u8(&mut out, &mut offset, seat.seat_class as u8);
        put_u8(&mut out, &mut offset, seat.appointing_body as u8);
        put_u8(&mut out, &mut offset, u8::from(seat.company_affiliated));
        put_bytes(&mut out, &mut offset, &seat.affiliation_group);
        put_u64(&mut out, &mut offset, seat.term_start_slot);
        put_u64(&mut out, &mut offset, seat.term_end_slot);
        put_u8(&mut out, &mut offset, u8::from(seat.active));
    }
    put_u8(&mut out, &mut offset, council.threshold);
    put_u8(&mut out, &mut offset, council.min_noncompany_approvals);
    put_u8(&mut out, &mut offset, council.max_same_affiliation);
    assert_eq!(offset, COUNCIL_SET_HASH_MATERIAL_LEN);
    out
}

pub fn compute_council_set_hash(council: &GovernanceCouncilSetV1) -> [u8; 32] {
    let material = canonical_council_hash_material(council);
    hashv(&[COUNCIL_SET_HASH_DOMAIN_V1, &material]).to_bytes()
}

pub fn validate_council_set(
    council: &GovernanceCouncilSetV1,
    policy: &GovernancePolicyV1,
) -> GovernanceResult<()> {
    validate_policy(policy)?;
    if council.discriminator != GOVERNANCE_COUNCIL_DISCRIMINATOR {
        return Err(GovernanceError::InvalidDiscriminator);
    }
    if council.account_version != ACCOUNT_VERSION_V1 {
        return Err(GovernanceError::UnsupportedVersion);
    }
    if !council.initialized {
        return Err(GovernanceError::Uninitialized);
    }
    validate_reserved(&council.reserved)?;
    if council.controller_config == Pubkey::default()
        || council.target_program == Pubkey::default()
        || council.controller_config != policy.controller_config
        || council.target_program != policy.target_program
    {
        return Err(GovernanceError::DefaultPubkey);
    }
    if council.version == 0
        || (council.deactivation_slot != 0 && council.deactivation_slot <= council.activation_slot)
    {
        return Err(GovernanceError::InvalidCouncilActivation);
    }
    if council.threshold != policy.routine_threshold
        || council.min_noncompany_approvals != policy.routine_min_noncompany
        || council.max_same_affiliation != policy.max_same_affiliation
    {
        return Err(GovernanceError::InvalidCouncilThreshold);
    }

    let mut signers = BTreeSet::new();
    let mut affiliations = BTreeMap::<[u8; 32], u8>::new();
    for (index, seat) in council.seats.iter().enumerate() {
        validate_seat(index, seat, council.activation_slot)?;
        if !signers.insert(seat.signer.to_bytes()) {
            return Err(GovernanceError::DuplicateCouncilSigner);
        }
        let entry = affiliations.entry(seat.affiliation_group).or_default();
        *entry = entry
            .checked_add(1)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
        if *entry > council.max_same_affiliation {
            return Err(GovernanceError::InvalidAffiliation);
        }
    }
    if compute_council_set_hash(council) != council.set_hash {
        return Err(GovernanceError::CouncilHashMismatch);
    }
    Ok(())
}

pub(crate) fn record_approval(
    council: &GovernanceCouncilSetV1,
    current_bitset: u8,
    current_count: u8,
    signer: &Pubkey,
    slot: u64,
) -> GovernanceResult<(u8, u8)> {
    validate_approval_encoding(current_bitset, current_count)?;
    let index = council
        .seats
        .iter()
        .position(|seat| &seat.signer == signer)
        .ok_or(GovernanceError::UnknownCouncilSigner)?;
    if !council.active_at(slot) || !council.seats[index].term_covers(slot) {
        return Err(GovernanceError::InactiveCouncilSeat);
    }
    let bit = 1u8 << index;
    if current_bitset & bit != 0 {
        return Err(GovernanceError::DuplicateApproval);
    }
    let next = current_bitset | bit;
    Ok((next, next.count_ones() as u8))
}

/// Records an initial proposal approval only after binding the signer to the
/// exact policy, proposal digest, current council set, and BufferVerified
/// state. This is still a pure helper; Phase 3 owns account mutation and the
/// state transition after quorum.
#[allow(clippy::too_many_arguments)]
pub fn record_proposal_approval(
    council: &GovernanceCouncilSetV1,
    policy: &GovernancePolicyV1,
    config_current_council_version: u64,
    proposal: &UpgradeProposalV1,
    signer: &Pubkey,
    expected_digest: &[u8; 32],
    slot: u64,
) -> GovernanceResult<(u8, u8)> {
    validate_proposal_against_policy(proposal, policy)?;
    validate_council_set(council, policy)?;
    if proposal.state != crate::state::ProposalStateV1::BufferVerified {
        return Err(GovernanceError::InvalidStateTransition);
    }
    if expected_digest != &proposal.proposal_digest {
        return Err(GovernanceError::ProposalDigestMismatch);
    }
    if council.version != config_current_council_version
        || council.version != proposal.council_version
    {
        return Err(GovernanceError::StaleCouncilVersion);
    }
    if council.set_hash != proposal.council_hash {
        return Err(GovernanceError::ProposalCouncilHashMismatch);
    }
    record_approval(
        council,
        proposal.council_approval_bitset,
        proposal.council_approval_count,
        signer,
        slot,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn evaluate_quorum(
    council: &GovernanceCouncilSetV1,
    policy: &GovernancePolicyV1,
    config_current_council_version: u64,
    proposal_council_version: u64,
    proposal_council_hash: &[u8; 32],
    bitset: u8,
    stored_count: u8,
    slot: u64,
    requirement: ApprovalRequirementV1,
) -> GovernanceResult<QuorumEvaluationV1> {
    validate_council_set(council, policy)?;
    if council.version != config_current_council_version
        || council.version != proposal_council_version
    {
        return Err(GovernanceError::StaleCouncilVersion);
    }
    if council.set_hash != *proposal_council_hash {
        return Err(GovernanceError::ProposalCouncilHashMismatch);
    }
    if !council.active_at(slot) {
        return Err(GovernanceError::InactiveCouncilSeat);
    }
    validate_approval_encoding(bitset, stored_count)?;

    let mut total = 0u8;
    for (index, seat) in council.seats.iter().enumerate() {
        if bitset & (1u8 << index) == 0 {
            continue;
        }
        if !seat.term_covers(slot) {
            return Err(GovernanceError::InactiveCouncilSeat);
        }
        total = total
            .checked_add(1)
            .ok_or(GovernanceError::ArithmeticOverflow)?;
    }
    let threshold = match requirement {
        ApprovalRequirementV1::Routine | ApprovalRequirementV1::Major => policy.routine_threshold,
        ApprovalRequirementV1::Terminal => policy.terminal_threshold,
    };
    if total < threshold {
        return Err(GovernanceError::QuorumNotSatisfied);
    }
    Ok(QuorumEvaluationV1 {
        total_approvals: total,
    })
}

/// Evaluates the pinned proposal without accepting a caller-selected quorum
/// class. Every active seat has exactly one vote; seat metadata never changes
/// pass/fail. Target immutability uses Terminal, constitutional and rotation
/// proposals use Major, and every other proposal class uses Routine.
pub fn evaluate_proposal_quorum(
    council: &GovernanceCouncilSetV1,
    policy: &GovernancePolicyV1,
    config_current_council_version: u64,
    proposal: &UpgradeProposalV1,
    slot: u64,
) -> GovernanceResult<QuorumEvaluationV1> {
    validate_proposal_against_policy(proposal, policy)?;
    let requirement = match proposal.proposal_class {
        ProposalClassV1::RoutineUpgrade
        | ProposalClassV1::EmergencyRollback
        | ProposalClassV1::EconomicChange => ApprovalRequirementV1::Routine,
        ProposalClassV1::ConstitutionalChange | ProposalClassV1::CouncilSetRotation => {
            ApprovalRequirementV1::Major
        }
        ProposalClassV1::TargetImmutability => ApprovalRequirementV1::Terminal,
    };
    evaluate_quorum(
        council,
        policy,
        config_current_council_version,
        proposal.council_version,
        &proposal.council_hash,
        proposal.council_approval_bitset,
        proposal.council_approval_count,
        slot,
        requirement,
    )
}

fn validate_seat(index: usize, seat: &CouncilSeatV1, activation_slot: u64) -> GovernanceResult<()> {
    validate_reserved(&seat.reserved)?;
    if seat.signer == Pubkey::default() {
        return Err(GovernanceError::DefaultPubkey);
    }
    if seat.affiliation_group == [0; 32] {
        return Err(GovernanceError::InvalidAffiliation);
    }
    let expected = match index {
        0 | 1 => (SeatClassV1::CoreProtocol, AppointingBodyV1::Company, true),
        2 | 3 => (
            SeatClassV1::CommunityDelegate,
            AppointingBodyV1::TokenGovernance,
            false,
        ),
        4 => (
            SeatClassV1::SecuritySteward,
            AppointingBodyV1::TokenGovernance,
            false,
        ),
        _ => return Err(GovernanceError::InvalidCouncilComposition),
    };
    if (
        seat.seat_class,
        seat.appointing_body,
        seat.company_affiliated,
    ) != expected
    {
        return Err(GovernanceError::InvalidCouncilComposition);
    }
    if !seat.term_covers(activation_slot) || seat.term_start_slot >= seat.term_end_slot {
        return Err(GovernanceError::InactiveCouncilSeat);
    }
    Ok(())
}

fn validate_approval_encoding(bitset: u8, stored_count: u8) -> GovernanceResult<()> {
    if bitset & !VALID_APPROVAL_MASK != 0 {
        return Err(GovernanceError::InvalidApprovalBitset);
    }
    if bitset.count_ones() as u8 != stored_count {
        return Err(GovernanceError::ApprovalCountMismatch);
    }
    Ok(())
}

fn put_u8<const N: usize>(out: &mut [u8; N], offset: &mut usize, value: u8) {
    out[*offset] = value;
    *offset += 1;
}

fn put_u64<const N: usize>(out: &mut [u8; N], offset: &mut usize, value: u64) {
    out[*offset..*offset + 8].copy_from_slice(&value.to_le_bytes());
    *offset += 8;
}

fn put_pubkey<const N: usize>(out: &mut [u8; N], offset: &mut usize, value: &Pubkey) {
    put_bytes(out, offset, &value.to_bytes());
}

fn put_bytes<const N: usize, const M: usize>(
    out: &mut [u8; N],
    offset: &mut usize,
    value: &[u8; M],
) {
    out[*offset..*offset + M].copy_from_slice(value);
    *offset += M;
}
