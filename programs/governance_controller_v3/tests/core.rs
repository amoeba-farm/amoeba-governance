use borsh::{BorshDeserialize, BorshSerialize};
use governance_controller_v3::{instruction::Instruction, state::*};
use solana_program::pubkey::Pubkey;

fn sample() -> (Pubkey, Config, Proposal) {
    let program = Pubkey::new_from_array([31; 32]);
    let (config_key, config_bump) = config_pda(&program);
    let config = Config {
        discriminator: *b"AG3CFG01",
        version: 1,
        bump: config_bump,
        initialized: true,
        controller: program,
        programdata: Pubkey::find_program_address(
            &[program.as_ref()],
            &solana_sdk_ids::bpf_loader_upgradeable::ID,
        )
        .0,
        authority: authority_pda(&program).0,
        treasury: Pubkey::new_from_array([32; 32]),
        seats: std::array::from_fn(|i| Pubkey::new_from_array([40 + i as u8; 32])),
        council_epoch: 1,
        timing_version: 1,
        timing: Timing::default(),
        next_id: 2,
        reserved: [0; 37],
    };
    let mut data = [0; 192];
    data[..24].copy_from_slice(&Timing::default().try_to_vec().unwrap());
    let (review_end, not_before, expires) = config.timing.boundaries(100).unwrap();
    let mut p = Proposal {
        discriminator: *b"AG3PRP01",
        version: 1,
        bump: proposal_pda(&program, 1).1,
        initialized: true,
        config: config_key,
        id: 1,
        council_epoch: 1,
        timing_version: 1,
        timing: config.timing,
        created: 100,
        review_end,
        not_before,
        expires,
        action: Action {
            kind: SET_TIMING,
            data,
        },
        digest: [0; 32],
        approvals: 0,
        approval_count: 0,
        cancellations: 0,
        cancellation_count: 0,
        state: PENDING,
        verified_chunks: [0; 12],
        verified_count: 0,
        extension_slot: 0,
        extended_capacity: 0,
        executed_slot: 0,
        reserved: [0; 7],
    };
    p.digest = p.compute_digest(&program).unwrap();
    (program, config, p)
}

#[test]
fn one_week_approval_is_independent_from_execution_delay_and_cannot_be_shortened() {
    let (_, mut config, mut p) = sample();
    assert_eq!(p.review_end - p.created, 1_512_000);
    assert_eq!(p.not_before - p.created, 4_500);
    for i in 0..3 {
        p.approve(i, 100 + 900, false).unwrap();
    }
    assert!(p.executable(&config, 4_599).is_err());
    p.executable(&config, 4_600).unwrap();
    p.approve(3, 100 + 1_512_000, false).unwrap();
    assert!(p.approve(4, 100 + 1_512_001, false).is_err());
    let frozen = p.timing;
    config.timing.review_slots = 2 * WEEK_SLOTS;
    config.timing.expiry_slots = 5_184_000;
    config.timing_version = 2;
    assert_eq!(p.timing, frozen);
    p.executable(&config, p.not_before).unwrap();
    let mut weak = Timing {
        review_slots: 450,
        ..Timing::default()
    };
    assert!(weak.validate().is_err());
    weak.review_slots = WEEK_SLOTS;
    weak.expiry_slots = WEEK_SLOTS + EXECUTION_MARGIN_SLOTS;
    assert!(weak.validate().is_err());
    assert!(Timing::default().boundaries(u64::MAX - 5).is_err());
}

#[test]
fn every_three_seat_coalition_and_no_two_can_execute_and_stale_council_fails() {
    let (_, config, base) = sample();
    for mask in 0u8..32 {
        let mut p = base.clone();
        for i in 0..5 {
            if mask & (1 << i) != 0 {
                p.approve(i, p.created, false).unwrap();
            }
        }
        assert_eq!(
            p.executable(&config, p.not_before).is_ok(),
            mask.count_ones() >= 3
        );
    }
    let mut p = base;
    p.approve(0, p.created, false).unwrap();
    assert!(p.approve(0, p.created, false).is_err());
    p.approve(1, p.created, false).unwrap();
    p.approve(2, p.created, false).unwrap();
    let mut rotated = config.clone();
    rotated.council_epoch += 1;
    assert!(p.executable(&rotated, p.not_before).is_err());
    for i in 0..3 {
        p.approve(i, p.not_before, true).unwrap();
    }
    assert_eq!(p.state, CANCELLED);
    assert!(p.executable(&config, p.not_before).is_err());
}

#[test]
fn fixed_accounts_and_digest_reject_timing_action_padding_and_trailing_drift() {
    let (program, config, p) = sample();
    assert_eq!(
        p.digest
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
        "f41ce0bf8ebdcb6cf394653f7f0b3252925d4bd1ca80d8ccd16298f2d756ad6b"
    );
    config.validate(&program, &config_pda(&program).0).unwrap();
    p.validate(&program, &proposal_pda(&program, 1).0).unwrap();
    assert_eq!(config.try_to_vec().unwrap().len(), 384);
    assert_eq!(p.try_to_vec().unwrap().len(), 400);
    let mut altered = p.clone();
    altered.review_end += 1;
    assert!(altered
        .validate(&program, &proposal_pda(&program, 1).0)
        .is_err());
    altered = p.clone();
    altered.action.data[191] = 1;
    assert!(altered.action.validate().is_err());
    let mut encoded = p.try_to_vec().unwrap();
    encoded.push(0);
    assert!(Proposal::try_from_slice(&encoded).is_err());
    let mut duplicate = config;
    duplicate.seats[4] = duplicate.seats[0];
    assert!(duplicate
        .validate(&program, &config_pda(&program).0)
        .is_err());
}

#[test]
fn closed_dispatch_rejects_every_unknown_tag_before_accounts() {
    let program = Pubkey::new_unique();
    for tag in 15..=255u8 {
        assert_eq!(
            governance_controller_v3::process_instruction(&program, &[], &[tag]),
            Err(solana_program::program_error::ProgramError::InvalidInstructionData)
        );
    }
    assert!(Instruction::unpack(&vec![0; MAX_DATA + 1]).is_err());
    assert!(Instruction::unpack(&[6, 0]).is_err());
    assert!(Instruction::unpack(&[]).is_err());
}
