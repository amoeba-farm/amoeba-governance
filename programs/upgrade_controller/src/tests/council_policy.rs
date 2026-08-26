use crate::{
    council::{
        evaluate_proposal_quorum, evaluate_quorum, record_approval, record_proposal_approval,
        validate_council_set, ApprovalRequirementV1, VALID_APPROVAL_MASK,
    },
    policy::{compute_policy_hash, validate_policy},
    state::{AppointingBodyV1, SeatClassV1},
    GovernanceError,
};

use super::support::{council, key, policy};

#[test]
fn canonical_policy_and_council_are_valid() {
    let policy = policy();
    assert_eq!(validate_policy(&policy), Ok(()));
    assert_eq!(validate_council_set(&council(), &policy), Ok(()));
}

#[test]
fn required_routine_and_terminal_coalitions_are_enforced() {
    let policy = policy();
    let council = council();
    let evaluate = |mask, requirement| {
        evaluate_quorum(
            &council,
            &policy,
            council.version,
            council.version,
            &council.set_hash,
            mask,
            mask.count_ones() as u8,
            500,
            requirement,
        )
    };

    assert_eq!(
        evaluate(0b00011, ApprovalRequirementV1::Routine),
        Err(GovernanceError::QuorumNotSatisfied)
    );
    assert!(evaluate(0b00111, ApprovalRequirementV1::Routine).is_ok());
    assert!(evaluate(0b00111, ApprovalRequirementV1::Major).is_ok());
    assert!(evaluate(0b01101, ApprovalRequirementV1::Routine).is_ok());
    assert!(evaluate(0b11100, ApprovalRequirementV1::Routine).is_ok());
    // Any four equal seats satisfy terminal quorum.
    assert!(evaluate(0b01111, ApprovalRequirementV1::Terminal).is_ok());
    assert!(evaluate(0b11101, ApprovalRequirementV1::Terminal).is_ok());
}

#[test]
fn all_approval_masks_match_the_independent_routine_predicate() {
    let policy = policy();
    let council = council();
    for mask in 0u8..=VALID_APPROVAL_MASK {
        let total = mask.count_ones() as u8;
        let expected = total >= 3;
        let actual = evaluate_quorum(
            &council,
            &policy,
            council.version,
            council.version,
            &council.set_hash,
            mask,
            total,
            500,
            ApprovalRequirementV1::Routine,
        )
        .is_ok();
        assert_eq!(actual, expected, "mask {mask:05b}");
    }
}

#[test]
fn invalid_council_shapes_signers_terms_and_affiliations_fail() {
    let policy = policy();

    let mut value = council();
    value.seats[2].seat_class = SeatClassV1::CoreProtocol;
    value.seats[2].appointing_body = AppointingBodyV1::Company;
    value.seats[2].company_affiliated = true;
    value.set_hash = crate::council::compute_council_set_hash(&value);
    assert_eq!(
        validate_council_set(&value, &policy),
        Err(GovernanceError::InvalidCouncilComposition)
    );

    let mut value = council();
    value.seats[1].signer = value.seats[0].signer;
    value.set_hash = crate::council::compute_council_set_hash(&value);
    assert_eq!(
        validate_council_set(&value, &policy),
        Err(GovernanceError::DuplicateCouncilSigner)
    );

    let mut value = council();
    value.seats[4].signer = Default::default();
    value.set_hash = crate::council::compute_council_set_hash(&value);
    assert_eq!(
        validate_council_set(&value, &policy),
        Err(GovernanceError::DefaultPubkey)
    );

    let mut value = council();
    value.seats[4].term_end_slot = value.activation_slot;
    value.set_hash = crate::council::compute_council_set_hash(&value);
    assert_eq!(
        validate_council_set(&value, &policy),
        Err(GovernanceError::InactiveCouncilSeat)
    );

    let mut value = council();
    value.seats[2].affiliation_group = value.seats[0].affiliation_group;
    value.set_hash = crate::council::compute_council_set_hash(&value);
    assert_eq!(
        validate_council_set(&value, &policy),
        Err(GovernanceError::InvalidAffiliation)
    );
}

#[test]
fn stale_versions_hashes_and_approval_encoding_fail_closed() {
    let policy = policy();
    let council = council();
    let args = |current_version, proposal_version, hash, bitset, count| {
        evaluate_quorum(
            &council,
            &policy,
            current_version,
            proposal_version,
            hash,
            bitset,
            count,
            500,
            ApprovalRequirementV1::Routine,
        )
    };
    assert_eq!(
        args(
            council.version + 1,
            council.version,
            &council.set_hash,
            0b11100,
            3
        ),
        Err(GovernanceError::StaleCouncilVersion)
    );
    assert_eq!(
        args(
            council.version,
            council.version + 1,
            &council.set_hash,
            0b11100,
            3
        ),
        Err(GovernanceError::StaleCouncilVersion)
    );
    assert_eq!(
        args(council.version, council.version, &[99; 32], 0b11100, 3),
        Err(GovernanceError::ProposalCouncilHashMismatch)
    );
    assert_eq!(
        args(
            council.version,
            council.version,
            &council.set_hash,
            0b1000_0111,
            4
        ),
        Err(GovernanceError::InvalidApprovalBitset)
    );
    assert_eq!(
        args(
            council.version,
            council.version,
            &council.set_hash,
            0b11100,
            2
        ),
        Err(GovernanceError::ApprovalCountMismatch)
    );
}

#[test]
fn duplicate_and_unknown_approvals_do_not_change_state() {
    let council = council();
    let (bits, count) = record_approval(&council, 0, 0, &council.seats[2].signer, 500).unwrap();
    assert_eq!((bits, count), (0b00100, 1));
    assert_eq!(
        record_approval(&council, bits, count, &council.seats[2].signer, 500),
        Err(GovernanceError::DuplicateApproval)
    );
    assert_eq!(
        record_approval(&council, bits, count, &key(99), 500),
        Err(GovernanceError::UnknownCouncilSigner)
    );
}

#[test]
fn proposal_approval_is_bound_to_state_digest_policy_and_current_council() {
    let policy = policy();
    let council = council();
    let mut proposal = super::support::proposal();
    proposal.state = crate::state::ProposalStateV1::BufferVerified;
    proposal.council_version = council.version;
    proposal.council_hash = council.set_hash;
    proposal.proposal_digest = crate::digest::compute_proposal_digest(&proposal).unwrap();
    assert_eq!(
        record_proposal_approval(
            &council,
            &policy,
            council.version,
            &proposal,
            &council.seats[2].signer,
            &proposal.proposal_digest,
            500,
        ),
        Ok((0b00100, 1))
    );
    assert_eq!(
        record_proposal_approval(
            &council,
            &policy,
            council.version,
            &proposal,
            &council.seats[2].signer,
            &[99; 32],
            500,
        ),
        Err(GovernanceError::ProposalDigestMismatch)
    );
    assert_eq!(
        record_proposal_approval(
            &council,
            &policy,
            council.version + 1,
            &proposal,
            &council.seats[2].signer,
            &proposal.proposal_digest,
            500,
        ),
        Err(GovernanceError::StaleCouncilVersion)
    );
    proposal.state = crate::state::ProposalStateV1::Draft;
    assert_eq!(
        record_proposal_approval(
            &council,
            &policy,
            council.version,
            &proposal,
            &council.seats[2].signer,
            &proposal.proposal_digest,
            500,
        ),
        Err(GovernanceError::InvalidStateTransition)
    );
}

#[test]
fn policy_hash_and_thresholds_are_mechanical() {
    let mut value = policy();
    value.routine_threshold = 2;
    value.policy_hash = compute_policy_hash(&value);
    assert_eq!(validate_policy(&value), Err(GovernanceError::InvalidPolicy));

    let mut value = policy();
    value.policy_hash[0] ^= 1;
    assert_eq!(
        validate_policy(&value),
        Err(GovernanceError::PolicyHashMismatch)
    );
}

#[test]
fn proposal_class_mechanically_selects_routine_or_terminal_quorum() {
    let policy = policy();
    let council = council();
    let mut proposal = super::support::proposal();
    proposal.council_version = council.version;
    proposal.council_hash = council.set_hash;
    proposal.council_approval_bitset = 0b11101;
    proposal.council_approval_count = 4;
    proposal.proposal_digest = crate::digest::compute_proposal_digest(&proposal).unwrap();
    assert!(evaluate_proposal_quorum(&council, &policy, council.version, &proposal, 500).is_ok());

    proposal.proposal_class = crate::state::ProposalClassV1::TargetImmutability;
    proposal.vote_requirement = crate::state::VoteRequirementV1::Affirmative;
    proposal.proposal_digest = crate::digest::compute_proposal_digest(&proposal).unwrap();
    assert!(evaluate_proposal_quorum(&council, &policy, council.version, &proposal, 500).is_ok());
    proposal.council_approval_bitset = 0b01111;
    proposal.council_approval_count = 4;
    proposal.proposal_digest = crate::digest::compute_proposal_digest(&proposal).unwrap();
    assert!(evaluate_proposal_quorum(&council, &policy, council.version, &proposal, 500).is_ok());
}
