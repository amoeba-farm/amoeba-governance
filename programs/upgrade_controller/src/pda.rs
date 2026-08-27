use solana_program::{pubkey, pubkey::Pubkey};

use crate::state::CheckpointPhaseV1;

pub const UPGRADE_SEED_DOMAIN_V1: &[u8] = b"ameba-upgrade-v1";
pub const TARGET_SEED: &[u8] = b"target";
pub const AUTHORITY_SEED: &[u8] = b"authority";
pub const GATE_SEED: &[u8] = b"gate";
pub const POLICY_SEED: &[u8] = b"policy";
pub const COUNCIL_SEED: &[u8] = b"council";
pub const PROPOSAL_SEED: &[u8] = b"proposal";
pub const CHECKPOINT_SEED: &[u8] = b"checkpoint";
pub const BUFFER_CHECK_SEED: &[u8] = b"buffer-check";
pub const UPGRADEABLE_LOADER_ID: Pubkey = pubkey!("BPFLoaderUpgradeab1e11111111111111111111111");

pub fn derive_upgradeable_programdata_address(target_program: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[target_program.as_ref()], &UPGRADEABLE_LOADER_ID)
}

pub fn derive_controller_config_pda(
    controller_program: &Pubkey,
    target_program: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[UPGRADE_SEED_DOMAIN_V1, TARGET_SEED, target_program.as_ref()],
        controller_program,
    )
}

pub fn derive_authority_pda(controller_program: &Pubkey, target_program: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[
            UPGRADE_SEED_DOMAIN_V1,
            AUTHORITY_SEED,
            target_program.as_ref(),
        ],
        controller_program,
    )
}

pub fn derive_gate_pda(controller_program: &Pubkey, target_program: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[UPGRADE_SEED_DOMAIN_V1, GATE_SEED, target_program.as_ref()],
        controller_program,
    )
}

pub fn derive_policy_pda(
    controller_program: &Pubkey,
    target_program: &Pubkey,
    policy_version: u64,
) -> (Pubkey, u8) {
    let version = policy_version.to_le_bytes();
    Pubkey::find_program_address(
        &[
            UPGRADE_SEED_DOMAIN_V1,
            POLICY_SEED,
            target_program.as_ref(),
            &version,
        ],
        controller_program,
    )
}

pub fn derive_council_pda(
    controller_program: &Pubkey,
    target_program: &Pubkey,
    council_version: u64,
) -> (Pubkey, u8) {
    let version = council_version.to_le_bytes();
    Pubkey::find_program_address(
        &[
            UPGRADE_SEED_DOMAIN_V1,
            COUNCIL_SEED,
            target_program.as_ref(),
            &version,
        ],
        controller_program,
    )
}

pub fn derive_proposal_pda(
    controller_program: &Pubkey,
    target_program: &Pubkey,
    proposal_id: u64,
) -> (Pubkey, u8) {
    let id = proposal_id.to_le_bytes();
    Pubkey::find_program_address(
        &[
            UPGRADE_SEED_DOMAIN_V1,
            PROPOSAL_SEED,
            target_program.as_ref(),
            &id,
        ],
        controller_program,
    )
}

pub fn derive_checkpoint_pda(
    controller_program: &Pubkey,
    proposal: &Pubkey,
    phase: CheckpointPhaseV1,
) -> (Pubkey, u8) {
    let phase = [phase as u8];
    Pubkey::find_program_address(
        &[
            UPGRADE_SEED_DOMAIN_V1,
            CHECKPOINT_SEED,
            proposal.as_ref(),
            &phase,
        ],
        controller_program,
    )
}

pub fn derive_buffer_check_pda(controller_program: &Pubkey, proposal: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[UPGRADE_SEED_DOMAIN_V1, BUFFER_CHECK_SEED, proposal.as_ref()],
        controller_program,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn domains_are_pairwise_separated() {
        let controller = Pubkey::new_from_array([17; 32]);
        let target = Pubkey::new_from_array([29; 32]);
        let proposal = derive_proposal_pda(&controller, &target, 7).0;
        let addresses = [
            derive_upgradeable_programdata_address(&target).0,
            derive_controller_config_pda(&controller, &target).0,
            derive_authority_pda(&controller, &target).0,
            derive_gate_pda(&controller, &target).0,
            derive_policy_pda(&controller, &target, 7).0,
            derive_council_pda(&controller, &target, 7).0,
            proposal,
            derive_checkpoint_pda(&controller, &proposal, CheckpointPhaseV1::Prestate).0,
            derive_checkpoint_pda(&controller, &proposal, CheckpointPhaseV1::Poststate).0,
            derive_buffer_check_pda(&controller, &proposal).0,
        ];
        for (index, address) in addresses.iter().enumerate() {
            assert!(
                addresses[..index].iter().all(|prior| prior != address),
                "PDA domain collision at index {index}"
            );
        }
    }

    #[test]
    fn numeric_seeds_are_little_endian_and_order_sensitive() {
        let controller = Pubkey::new_from_array([31; 32]);
        let target = Pubkey::new_from_array([37; 32]);
        let version = 0x0102_0304_0506_0708u64;
        let (actual, bump) = derive_policy_pda(&controller, &target, version);
        let bump_seed = [bump];
        let expected = Pubkey::create_program_address(
            &[
                UPGRADE_SEED_DOMAIN_V1,
                POLICY_SEED,
                target.as_ref(),
                &version.to_le_bytes(),
                &bump_seed,
            ],
            &controller,
        )
        .unwrap();
        assert_eq!(actual, expected);
        assert_ne!(
            actual,
            derive_policy_pda(&controller, &target, version.swap_bytes()).0
        );
    }
}
