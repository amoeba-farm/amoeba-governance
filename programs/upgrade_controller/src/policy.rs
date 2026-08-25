use solana_program::{hash::hashv, pubkey::Pubkey};

use crate::{
    state::{
        validate_reserved, GovernancePolicyV1, ProposalClassV1, VoteRequirementV1,
        ACCOUNT_VERSION_V1, GOVERNANCE_POLICY_DISCRIMINATOR,
    },
    GovernanceError, GovernanceResult,
};

pub const POLICY_HASH_DOMAIN_V1: &[u8] = b"AMOEBA_GOVERNANCE_POLICY_V1";
pub const POLICY_HASH_MATERIAL_LEN: usize = 96;

pub fn canonical_policy_hash_material(
    policy: &GovernancePolicyV1,
) -> [u8; POLICY_HASH_MATERIAL_LEN] {
    let mut out = [0u8; POLICY_HASH_MATERIAL_LEN];
    let mut offset = 0usize;
    put_pubkey(&mut out, &mut offset, &policy.controller_config);
    put_pubkey(&mut out, &mut offset, &policy.target_program);
    put_u64(&mut out, &mut offset, policy.version);
    put_u64(&mut out, &mut offset, policy.activation_slot);
    for value in [
        policy.routine_threshold,
        policy.routine_min_noncompany,
        policy.terminal_threshold,
        policy.terminal_min_noncompany,
        policy.max_same_affiliation,
    ] {
        put_u8(&mut out, &mut offset, value);
    }
    for value in [
        policy.veto_quorum_bps,
        policy.affirmative_quorum_bps,
        policy.affirmative_approval_bps,
    ] {
        put_u16(&mut out, &mut offset, value);
    }
    for value in [
        policy.routine_requires_vote,
        policy.economic_requires_vote,
        policy.constitutional_requires_vote,
        policy.rotation_requires_vote,
        policy.immutability_requires_vote,
    ] {
        put_u8(&mut out, &mut offset, u8::from(value));
    }
    assert_eq!(offset, POLICY_HASH_MATERIAL_LEN);
    out
}

/// Derives the token-chamber rule from the immutable proposal class and pinned
/// policy. Callers never supply a free-standing vote mode.
pub fn vote_requirement_for_class(
    policy: &GovernancePolicyV1,
    class: ProposalClassV1,
) -> GovernanceResult<VoteRequirementV1> {
    validate_policy(policy)?;
    let requirement = match class {
        ProposalClassV1::RoutineUpgrade => {
            if policy.routine_requires_vote {
                VoteRequirementV1::Veto
            } else {
                VoteRequirementV1::None
            }
        }
        ProposalClassV1::EmergencyRollback => VoteRequirementV1::None,
        ProposalClassV1::EconomicChange => {
            if policy.economic_requires_vote {
                VoteRequirementV1::Affirmative
            } else {
                VoteRequirementV1::None
            }
        }
        ProposalClassV1::ConstitutionalChange => {
            if policy.constitutional_requires_vote {
                VoteRequirementV1::Affirmative
            } else {
                VoteRequirementV1::None
            }
        }
        ProposalClassV1::CouncilSetRotation => {
            if policy.rotation_requires_vote {
                VoteRequirementV1::Affirmative
            } else {
                VoteRequirementV1::None
            }
        }
        ProposalClassV1::TargetImmutability => {
            if policy.immutability_requires_vote {
                VoteRequirementV1::Affirmative
            } else {
                VoteRequirementV1::None
            }
        }
    };
    Ok(requirement)
}

pub fn compute_policy_hash(policy: &GovernancePolicyV1) -> [u8; 32] {
    let material = canonical_policy_hash_material(policy);
    hashv(&[POLICY_HASH_DOMAIN_V1, &material]).to_bytes()
}

pub fn validate_policy(policy: &GovernancePolicyV1) -> GovernanceResult<()> {
    if policy.discriminator != GOVERNANCE_POLICY_DISCRIMINATOR {
        return Err(GovernanceError::InvalidDiscriminator);
    }
    if policy.account_version != ACCOUNT_VERSION_V1 {
        return Err(GovernanceError::UnsupportedVersion);
    }
    if !policy.initialized {
        return Err(GovernanceError::Uninitialized);
    }
    validate_reserved(&policy.reserved)?;
    require_pubkey(&policy.controller_config)?;
    require_pubkey(&policy.target_program)?;
    if policy.version == 0
        || policy.routine_threshold != 3
        || policy.routine_min_noncompany != 2
        || policy.terminal_threshold != 4
        || policy.terminal_min_noncompany != 3
        || policy.max_same_affiliation != 2
        || policy.veto_quorum_bps == 0
        || policy.veto_quorum_bps > 10_000
        || policy.affirmative_quorum_bps == 0
        || policy.affirmative_quorum_bps > 10_000
        || policy.affirmative_approval_bps <= 5_000
        || policy.affirmative_approval_bps > 10_000
        || !policy.routine_requires_vote
        || !policy.economic_requires_vote
        || !policy.constitutional_requires_vote
        || !policy.rotation_requires_vote
        || !policy.immutability_requires_vote
    {
        return Err(GovernanceError::InvalidPolicy);
    }
    if compute_policy_hash(policy) != policy.policy_hash {
        return Err(GovernanceError::PolicyHashMismatch);
    }
    Ok(())
}

fn require_pubkey(value: &Pubkey) -> GovernanceResult<()> {
    if *value == Pubkey::default() {
        Err(GovernanceError::DefaultPubkey)
    } else {
        Ok(())
    }
}

fn put_u8<const N: usize>(out: &mut [u8; N], offset: &mut usize, value: u8) {
    out[*offset] = value;
    *offset += 1;
}

fn put_u16<const N: usize>(out: &mut [u8; N], offset: &mut usize, value: u16) {
    out[*offset..*offset + 2].copy_from_slice(&value.to_le_bytes());
    *offset += 2;
}

fn put_u64<const N: usize>(out: &mut [u8; N], offset: &mut usize, value: u64) {
    out[*offset..*offset + 8].copy_from_slice(&value.to_le_bytes());
    *offset += 8;
}

fn put_pubkey<const N: usize>(out: &mut [u8; N], offset: &mut usize, value: &Pubkey) {
    out[*offset..*offset + 32].copy_from_slice(value.as_ref());
    *offset += 32;
}
