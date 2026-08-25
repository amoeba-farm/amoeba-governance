use std::str::FromStr;

use serde_json::Value;
use solana_program::pubkey::Pubkey;

use crate::{
    digest::{
        canonical_proposal_digest_material, compute_proposal_digest, PROPOSAL_DIGEST_DOMAIN_V1,
    },
    pda::{
        derive_authority_pda, derive_buffer_check_pda, derive_checkpoint_pda,
        derive_controller_config_pda, derive_council_pda, derive_gate_pda, derive_policy_pda,
        derive_proposal_pda,
    },
    state::CheckpointPhaseV1,
};

use super::support::proposal;

fn fixture() -> Value {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/upgrade_governance_v1.json"
    )))
    .expect("valid frozen fixture")
}

fn assert_pda(actual: (Pubkey, u8), expected: &Value) {
    assert_eq!(actual.0.to_string(), expected["address"].as_str().unwrap());
    assert_eq!(u64::from(actual.1), expected["bump"].as_u64().unwrap());
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(DIGITS[(byte >> 4) as usize] as char);
        out.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    out
}

#[test]
fn all_phase1_pdas_match_frozen_addresses_and_bumps() {
    let fixture = fixture();
    let inputs = &fixture["pdaInputs"];
    let expected = &fixture["pdas"];
    let controller = Pubkey::from_str(inputs["controllerProgram"].as_str().unwrap()).unwrap();
    let target = Pubkey::from_str(inputs["targetProgram"].as_str().unwrap()).unwrap();
    let policy_version = inputs["policyVersion"].as_str().unwrap().parse().unwrap();
    let council_version = inputs["councilVersion"].as_str().unwrap().parse().unwrap();
    let proposal_id = inputs["proposalId"].as_str().unwrap().parse().unwrap();
    let proposal_pda = derive_proposal_pda(&controller, &target, proposal_id).0;

    assert_pda(
        derive_controller_config_pda(&controller, &target),
        &expected["controllerConfig"],
    );
    assert_pda(
        derive_authority_pda(&controller, &target),
        &expected["authority"],
    );
    assert_pda(derive_gate_pda(&controller, &target), &expected["gate"]);
    assert_pda(
        derive_policy_pda(&controller, &target, policy_version),
        &expected["policy"],
    );
    assert_pda(
        derive_council_pda(&controller, &target, council_version),
        &expected["council"],
    );
    assert_pda(
        derive_proposal_pda(&controller, &target, proposal_id),
        &expected["proposal"],
    );
    assert_pda(
        derive_checkpoint_pda(&controller, &proposal_pda, CheckpointPhaseV1::Prestate),
        &expected["prestateCheckpoint"],
    );
    assert_pda(
        derive_checkpoint_pda(&controller, &proposal_pda, CheckpointPhaseV1::Poststate),
        &expected["poststateCheckpoint"],
    );
    assert_pda(
        derive_buffer_check_pda(&controller, &proposal_pda),
        &expected["bufferCheck"],
    );
}

#[test]
fn proposal_material_preimage_and_digest_match_frozen_bytes() {
    let fixture = fixture();
    let expected = &fixture["proposalDigest"];
    let proposal = proposal();
    let material = canonical_proposal_digest_material(&proposal).unwrap();
    let mut preimage = Vec::with_capacity(PROPOSAL_DIGEST_DOMAIN_V1.len() + material.len());
    preimage.extend_from_slice(PROPOSAL_DIGEST_DOMAIN_V1);
    preimage.extend_from_slice(&material);

    assert_eq!(
        hex(&proposal.policy_hash),
        fixture["proposalInputs"]["policyHashHex"].as_str().unwrap()
    );
    assert_eq!(
        PROPOSAL_DIGEST_DOMAIN_V1,
        expected["domainAscii"].as_str().unwrap().as_bytes()
    );
    assert_eq!(
        material.len() as u64,
        expected["materialLength"].as_u64().unwrap()
    );
    assert_eq!(
        preimage.len() as u64,
        expected["preimageLength"].as_u64().unwrap()
    );
    assert_eq!(hex(&material), expected["materialHex"].as_str().unwrap());
    assert_eq!(hex(&preimage), expected["preimageHex"].as_str().unwrap());
    assert_eq!(
        hex(&compute_proposal_digest(&proposal).unwrap()),
        expected["sha256Hex"].as_str().unwrap()
    );
}
