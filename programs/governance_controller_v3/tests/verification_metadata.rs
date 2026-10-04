//! Actual controller SBF -> actual Mainnet Otter Verify SBF, on an isolated test bank.
use borsh::{BorshDeserialize, BorshSerialize};
use governance_controller_v3::{
    instruction::Instruction as GovInstruction, state::*, verification::*,
};
use solana_program::{
    instruction::{AccountMeta, Instruction},
    pubkey::Pubkey,
    rent::Rent,
};
use solana_program_test::{ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::{Account, AccountSharedData},
    signature::Signer,
    transaction::Transaction,
};
use solana_sdk_ids::{bpf_loader_upgradeable::ID as LOADER, system_program, sysvar};
use upgrade_controller::state::{GateStatusV1, ProtocolGateV1};

fn account(owner: Pubkey, data: Vec<u8>, executable: bool) -> Account {
    Account {
        lamports: Rent::default().minimum_balance(data.len()).max(1),
        data,
        owner,
        executable,
        rent_epoch: 0,
    }
}
fn ro(key: Pubkey) -> AccountMeta {
    AccountMeta::new_readonly(key, false)
}
fn unchanged(actual: Account, expected: &Account) {
    // The bank normalizes exempt accounts' rent_epoch; it is not program state.
    assert_eq!(actual.lamports, expected.lamports);
    assert_eq!(actual.data, expected.data);
    assert_eq!(actual.owner, expected.owner);
    assert_eq!(actual.executable, expected.executable);
}
fn rw(key: Pubkey) -> AccountMeta {
    AccountMeta::new(key, false)
}
fn install(test: &mut ProgramTest, program: Pubkey, authority: Pubkey, bytes: &[u8]) {
    let pd = Pubkey::find_program_address(&[program.as_ref()], &LOADER).0;
    let mut p = 2u32.to_le_bytes().to_vec();
    p.extend_from_slice(pd.as_ref());
    let mut d = 3u32.to_le_bytes().to_vec();
    d.extend_from_slice(&0u64.to_le_bytes());
    d.push(1);
    d.extend_from_slice(authority.as_ref());
    d.extend_from_slice(bytes);
    test.add_genesis_account(program, account(LOADER, p, true));
    test.add_genesis_account(pd, account(LOADER, d, false));
}
async fn send(ctx: &mut ProgramTestContext, instructions: &[Instruction]) -> bool {
    let blockhash = ctx.banks_client.get_latest_blockhash().await.unwrap();
    let tx = Transaction::new_signed_with_payer(
        instructions,
        Some(&ctx.payer.pubkey()),
        &[&ctx.payer],
        blockhash,
    );
    let result = ctx.banks_client.process_transaction(tx).await;
    if let Err(e) = &result {
        eprintln!("expected-or-investigate: {e:?}");
    }
    result.is_ok()
}
async fn run(own: bool) {
    let elf =
        std::fs::read(std::env::var("AMOEBA_GOV_V3_SBF").expect("exact controller ELF required"))
            .unwrap();
    let verifier = std::fs::read(
        std::env::var("AMOEBA_OTTER_VERIFY_SBF").expect("actual Otter Verify ELF required"),
    )
    .unwrap();
    let controller = Pubkey::new_unique();
    let target = if own { controller } else { DEVNET_SPREAD };
    let cfg_key = config_pda(&controller).0;
    let auth = if own {
        authority_pda(&controller).0
    } else {
        target_authority_pda(&controller, &target).0
    };
    let pd = Pubkey::find_program_address(&[target.as_ref()], &LOADER).0;
    let config = Config {
        discriminator: *b"AG3CFG01",
        version: 1,
        bump: config_pda(&controller).1,
        initialized: true,
        controller,
        programdata: Pubkey::find_program_address(&[controller.as_ref()], &LOADER).0,
        authority: authority_pda(&controller).0,
        treasury: Pubkey::new_unique(),
        seats: std::array::from_fn(|_| Pubkey::new_unique()),
        council_epoch: 1,
        timing_version: 1,
        timing: Timing::default(),
        next_id: 3,
        reserved: [0; 37],
    };
    let policy = VerificationPolicy {
        target,
        deployed_slot: 0,
        commit: [0xab; 20],
    };
    let mut action = Action {
        kind: PUBLISH_VERIFICATION,
        data: [0; ACTION_LEN],
    };
    action.data[..60].copy_from_slice(&policy.try_to_vec().unwrap());
    let (review_end, not_before, expires) = config.timing.boundaries(100).unwrap();
    let mut proposal = Proposal {
        discriminator: *b"AG3PRP01",
        version: 1,
        bump: proposal_pda(&controller, 1).1,
        initialized: true,
        config: cfg_key,
        id: 1,
        council_epoch: 1,
        timing_version: 1,
        timing: config.timing,
        created: 100,
        review_end,
        not_before,
        expires,
        action,
        digest: [0; 32],
        approvals: 7,
        approval_count: 3,
        cancellations: 0,
        cancellation_count: 0,
        state: PENDING,
        verified_chunks: [0; 12],
        verified_count: 0,
        extension_slot: 0,
        extended_capacity: 0,
        executed_slot: 0,
        verified_chunks_high: [0; 4],
        reserved: [0; 3],
    };
    proposal.digest = proposal.compute_digest(&controller).unwrap();
    let pkey = proposal_pda(&controller, 1).0;
    let (metadata, bump) = metadata_pda(&auth, &target);
    let mut test = ProgramTest::default();
    test.prefer_bpf(true);
    install(&mut test, controller, config.authority, &elf);
    if !own {
        install(&mut test, target, auth, &elf);
    }
    install(&mut test, VERIFY_PROGRAM, Pubkey::new_unique(), &verifier);
    test.add_account(
        cfg_key,
        account(controller, config.try_to_vec().unwrap(), false),
    );
    test.add_account(
        pkey,
        account(controller, proposal.try_to_vec().unwrap(), false),
    );
    let authority_before = account(system_program::ID, vec![], false);
    test.add_account(auth, authority_before.clone());
    let mut prefund = account(system_program::ID, vec![], false);
    prefund.lamports = 123_456;
    test.add_account(metadata, prefund.clone());
    let (gate_key, gate_bump) = gate_pda(&controller, &target);
    let gate = ProtocolGateV1 {
        discriminator: *b"AGVGAT01",
        version: 1,
        bump: gate_bump,
        initialized: true,
        status: GateStatusV1::EmergencyFrozen,
        controller_config: cfg_key,
        target_program: target,
        target_programdata: pd,
        epoch: 1,
        active_proposal: Pubkey::default(),
        freeze_slot: 1,
        freeze_reason_code: 1,
        last_completed_proposal: Pubkey::default(),
        reserved: [0; 2],
    };
    if !own {
        test.add_account(
            gate_key,
            account(controller, gate.try_to_vec().unwrap(), false),
        );
    }
    let mut ctx = test.start_with_context().await;
    ctx.warp_to_slot(100).unwrap();
    let instruction = |payer: Pubkey, p: &Proposal| {
        let mut keys = vec![
            AccountMeta::new(payer, true),
            ro(cfg_key),
            rw(pkey),
            ro(target),
            ro(pd),
            rw(auth),
            rw(metadata),
            ro(VERIFY_PROGRAM),
            ro(system_program::ID),
            ro(sysvar::instructions::ID),
        ];
        if !own {
            keys.push(ro(gate_key));
        }
        Instruction {
            program_id: controller,
            accounts: keys,
            data: GovInstruction::PublishVerification { digest: p.digest }
                .try_to_vec()
                .unwrap(),
        }
    };
    let ix = instruction(ctx.payer.pubkey(), &proposal);
    assert!(
        !send(&mut ctx, std::slice::from_ref(&ix)).await,
        "early execution"
    );
    ctx.warp_to_slot(4600).unwrap();
    let reset = |ctx: &mut ProgramTestContext, p: &Proposal| {
        ctx.set_account(
            &pkey,
            &AccountSharedData::from(account(controller, p.try_to_vec().unwrap(), false)),
        )
    };
    for case in 0..5 {
        let mut bad = proposal.clone();
        match case {
            0 => {
                bad.approvals = 3;
                bad.approval_count = 2;
            }
            1 => {
                bad.council_epoch = 2;
            }
            2 => {
                bad.action.data[32] = 1;
            }
            3 => {
                bad.state = CANCELLED;
                bad.cancellations = 7;
                bad.cancellation_count = 3;
            }
            _ => {
                bad.action.data[..32].copy_from_slice(Pubkey::new_unique().as_ref());
            }
        }
        bad.digest = bad.compute_digest(&controller).unwrap();
        reset(&mut ctx, &bad);
        let bad_ix = instruction(ctx.payer.pubkey(), &bad);
        assert!(!send(&mut ctx, &[bad_ix]).await, "case {case}");
        assert_eq!(
            ctx.banks_client
                .get_account(metadata)
                .await
                .unwrap()
                .unwrap(),
            prefund
        );
        unchanged(
            ctx.banks_client.get_account(auth).await.unwrap().unwrap(),
            &authority_before,
        );
    }
    reset(&mut ctx, &proposal);
    for position in [4, 5, 6, 7] {
        let mut wrong = ix.clone();
        wrong.accounts[position].pubkey = Pubkey::new_unique();
        assert!(
            !send(&mut ctx, &[wrong]).await,
            "substituted account {position}"
        );
    }
    let mut duplicate = ix.clone();
    duplicate.accounts[6] = duplicate.accounts[5].clone();
    assert!(!send(&mut ctx, &[duplicate]).await);
    let sibling = solana_system_interface::instruction::transfer(&ctx.payer.pubkey(), &auth, 1);
    assert!(!send(&mut ctx, &[sibling, ix.clone()]).await);
    // Foreign metadata ownership is rejected without mutation.
    ctx.set_account(
        &metadata,
        &AccountSharedData::from(account(Pubkey::new_unique(), vec![0; 1], false)),
    );
    assert!(!send(&mut ctx, std::slice::from_ref(&ix)).await);
    ctx.set_account(&metadata, &AccountSharedData::from(prefund));
    // Refresh the bank/blockhash so an earlier failed signature is not replayed.
    ctx.warp_to_slot(4700).unwrap();
    assert!(send(&mut ctx, std::slice::from_ref(&ix)).await);
    let result = ctx
        .banks_client
        .get_account(metadata)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(result.owner, VERIFY_PROGRAM);
    assert_eq!(
        result.data,
        record(&target, &auth, &policy.params(&controller).unwrap(), bump)
    );
    unchanged(
        ctx.banks_client.get_account(auth).await.unwrap().unwrap(),
        &authority_before,
    );
    let finished = ctx.banks_client.get_account(pkey).await.unwrap().unwrap();
    assert_eq!(
        Proposal::try_from_slice(&finished.data).unwrap().state,
        EXECUTED
    );
    // A different approved digest exercises Update; it cannot close or redirect the PDA.
    let mut changed = proposal.clone();
    changed.action.data[40..60].fill(0xcd);
    changed.digest = changed.compute_digest(&controller).unwrap();
    reset(&mut ctx, &changed);
    let update = instruction(ctx.payer.pubkey(), &changed);
    assert!(send(&mut ctx, &[update]).await);
    let updated = ctx
        .banks_client
        .get_account(metadata)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(updated.lamports, result.lamports);
    let new_policy = changed.action.verification_policy().unwrap();
    assert_eq!(
        updated.data,
        record(
            &target,
            &auth,
            &new_policy.params(&controller).unwrap(),
            bump
        )
    );
    unchanged(
        ctx.banks_client.get_account(auth).await.unwrap().unwrap(),
        &authority_before,
    );
    if !own {
        assert_eq!(
            ctx.banks_client
                .get_account(gate_key)
                .await
                .unwrap()
                .unwrap()
                .data,
            gate.try_to_vec().unwrap()
        );
    }
}
#[tokio::test]
#[ignore = "requires this worktree controller and finalized Mainnet Otter Verify SBF artifacts"]
async fn actual_sbf_controller_and_frozen_target_metadata() {
    run(true).await;
    run(false).await;
}
