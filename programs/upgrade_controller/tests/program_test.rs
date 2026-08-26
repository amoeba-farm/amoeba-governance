use borsh::{BorshDeserialize, BorshSerialize};
use solana_program::{
    account_info::AccountInfo,
    entrypoint::ProgramResult,
    instruction::{AccountMeta, Instruction, InstructionError},
    program::invoke_signed,
    pubkey::Pubkey,
    rent::Rent,
};
use solana_program_test::{processor, BanksClientError, ProgramTest, ProgramTestContext};
use solana_sdk::{
    account::{Account, AccountSharedData},
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};
use upgrade_controller::{
    council::{compute_council_set_hash, COUNCIL_SEAT_COUNT},
    digest::compute_proposal_digest,
    instruction::{record_proposal_approval_instruction, RecordProposalApprovalV1},
    pda::{
        derive_authority_pda, derive_checkpoint_pda, derive_controller_config_pda,
        derive_council_pda, derive_gate_pda, derive_policy_pda, derive_proposal_pda,
    },
    policy::compute_policy_hash,
    processor::{process_instruction, UPGRADEABLE_LOADER_ID},
    state::{
        CheckpointPhaseV1, ControllerConfigV1, CouncilSeatV1, GovernanceCouncilSetV1,
        GovernanceModeV1, GovernancePolicyV1, OptionalPubkeyV1, ProposalClassV1, ProposalStateV1,
        UpgradeProposalV1, VoteRequirementV1, ACCOUNT_VERSION_V1, CONTROLLER_CONFIG_DISCRIMINATOR,
        CONTROLLER_CONFIG_RESERVED_LEN, COUNCIL_SEAT_RESERVED_LEN,
        GOVERNANCE_COUNCIL_DISCRIMINATOR, GOVERNANCE_COUNCIL_RESERVED_LEN,
        GOVERNANCE_POLICY_DISCRIMINATOR, GOVERNANCE_POLICY_RESERVED_LEN,
        UPGRADE_PROPOSAL_DISCRIMINATOR, UPGRADE_PROPOSAL_RESERVED_LEN,
    },
    GovernanceError,
};

const TEST_SLOT: u64 = 500;
const PROXY_SEAT_SEED: &[u8] = b"seat-authority";
const SYSTEM_PROGRAM_ID: Pubkey = solana_pubkey::pubkey!("11111111111111111111111111111111");

#[derive(Clone)]
struct Fixture {
    controller_program: Pubkey,
    config_key: Pubkey,
    policy_key: Pubkey,
    council_key: Pubkey,
    proposal_key: Pubkey,
    config: ControllerConfigV1,
    policy: GovernancePolicyV1,
    council: GovernanceCouncilSetV1,
    proposal: UpgradeProposalV1,
}

impl Fixture {
    fn new(controller_program: Pubkey, seat_authorities: [Pubkey; COUNCIL_SEAT_COUNT]) -> Self {
        let target_program = Pubkey::new_unique();
        let target_programdata =
            Pubkey::find_program_address(&[target_program.as_ref()], &UPGRADEABLE_LOADER_ID).0;
        let (config_key, config_bump) =
            derive_controller_config_pda(&controller_program, &target_program);
        let (policy_key, policy_bump) = derive_policy_pda(&controller_program, &target_program, 7);
        let (council_key, council_bump) =
            derive_council_pda(&controller_program, &target_program, 11);
        let (proposal_key, proposal_bump) =
            derive_proposal_pda(&controller_program, &target_program, 42);
        let authority_pda = derive_authority_pda(&controller_program, &target_program).0;
        let gate_pda = derive_gate_pda(&controller_program, &target_program).0;
        let prestate_checkpoint = derive_checkpoint_pda(
            &controller_program,
            &proposal_key,
            CheckpointPhaseV1::Prestate,
        )
        .0;
        let required_poststate_checkpoint = derive_checkpoint_pda(
            &controller_program,
            &proposal_key,
            CheckpointPhaseV1::Poststate,
        )
        .0;

        let config = ControllerConfigV1 {
            discriminator: CONTROLLER_CONFIG_DISCRIMINATOR,
            version: ACCOUNT_VERSION_V1,
            bump: config_bump,
            initialized: true,
            cluster_domain: [1; 32],
            target_program,
            target_programdata,
            upgradeable_loader: UPGRADEABLE_LOADER_ID,
            authority_pda,
            gate_pda,
            canonical_spill_treasury: Pubkey::new_unique(),
            current_council_version: 11,
            current_policy_version: 7,
            next_proposal_id: 43,
            target_nonce: 99,
            guardian: Pubkey::new_unique(),
            vote_program: Pubkey::default(),
            vote_programdata: Pubkey::default(),
            vote_config: Pubkey::default(),
            vote_mint: Pubkey::default(),
            token_governance_enabled: false,
            routine_delay_slots: 100,
            major_delay_slots: 200,
            rollback_delay_slots: 50,
            terminal_delay_slots: 400,
            vote_review_slots: 300,
            proposal_expiry_slots: 2_000,
            policy_flags: 0,
            reserved: [0; CONTROLLER_CONFIG_RESERVED_LEN],
        };

        let mut policy = GovernancePolicyV1 {
            discriminator: GOVERNANCE_POLICY_DISCRIMINATOR,
            account_version: ACCOUNT_VERSION_V1,
            bump: policy_bump,
            initialized: true,
            controller_config: config_key,
            version: 7,
            target_program,
            activation_slot: 1,
            council_size: 5,
            routine_threshold: 3,
            terminal_threshold: 4,
            governance_mode: GovernanceModeV1::BootstrapCouncilOnly,
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

        let seats = seat_authorities.map(|seat_authority| CouncilSeatV1 {
            seat_authority,
            term_start_slot: 1,
            term_end_slot: 10_000,
            active: true,
            reserved: [0; COUNCIL_SEAT_RESERVED_LEN],
        });
        let mut council = GovernanceCouncilSetV1 {
            discriminator: GOVERNANCE_COUNCIL_DISCRIMINATOR,
            account_version: ACCOUNT_VERSION_V1,
            bump: council_bump,
            initialized: true,
            controller_config: config_key,
            version: 11,
            target_program,
            activation_slot: 1,
            deactivation_slot: 0,
            seats,
            routine_threshold: 3,
            terminal_threshold: 4,
            policy_flags: 0,
            set_hash: [0; 32],
            reserved: [0; GOVERNANCE_COUNCIL_RESERVED_LEN],
        };
        council.set_hash = compute_council_set_hash(&council);

        let mut proposal = UpgradeProposalV1 {
            discriminator: UPGRADE_PROPOSAL_DISCRIMINATOR,
            account_version: ACCOUNT_VERSION_V1,
            bump: proposal_bump,
            initialized: true,
            proposal_id: 42,
            target_nonce: config.target_nonce,
            proposal_class: ProposalClassV1::RoutineUpgrade,
            state: ProposalStateV1::BufferVerified,
            cluster_domain: config.cluster_domain,
            controller_program,
            controller_config: config_key,
            protocol_gate: gate_pda,
            policy_version: policy.version,
            policy_hash: policy.policy_hash,
            council_version: council.version,
            council_hash: council.set_hash,
            creation_gate_epoch: 10,
            freeze_gate_epoch: 11,
            target_program,
            target_programdata,
            upgradeable_loader: UPGRADEABLE_LOADER_ID,
            authority_pda,
            canonical_spill_treasury: config.canonical_spill_treasury,
            buffer_pubkey: Pubkey::new_unique(),
            buffer_loader_owner: UPGRADEABLE_LOADER_ID,
            buffer_authority: authority_pda,
            artifact_length: 1_024,
            artifact_sha256: [2; 32],
            source_commit_hash: [3; 32],
            source_tree_hash: [4; 32],
            build_input_inventory_hash: [5; 32],
            reproducible_build_receipt_hash: [6; 32],
            package_receipt_hash: [7; 32],
            release_intent_hash: [8; 32],
            current_deployed_payload_hash: [9; 32],
            current_raw_programdata_hash: [10; 32],
            deployed_slot: 100,
            current_capacity: 2_048,
            extension_delta: 0,
            expected_post_capacity: 2_048,
            prestate_checkpoint,
            required_poststate_checkpoint,
            rollback_proposal: OptionalPubkeyV1::none(),
            rollback_buffer: OptionalPubkeyV1::none(),
            rollback_artifact_hash: [0; 32],
            vote_requirement: VoteRequirementV1::None,
            vote_program: Pubkey::default(),
            vote_result_pda: Pubkey::default(),
            review_start_slot: 1,
            review_end_slot: 1_000,
            not_before_slot: 1_100,
            expiry_slot: 2_000,
            council_approval_bitset: 0,
            council_approval_count: 0,
            poststate_approval_bitset: 0,
            poststate_approval_count: 0,
            unfreeze_approval_bitset: 0,
            unfreeze_approval_count: 0,
            proposal_digest: [0; 32],
            cancellation_reason_code: 0,
            terminal_reason_code: 0,
            reserved: [0; UPGRADE_PROPOSAL_RESERVED_LEN],
        };
        proposal.proposal_digest = compute_proposal_digest(&proposal).unwrap();

        Self {
            controller_program,
            config_key,
            policy_key,
            council_key,
            proposal_key,
            config,
            policy,
            council,
            proposal,
        }
    }

    fn approval_instruction(&self, seat_authority: Pubkey) -> Instruction {
        record_proposal_approval_instruction(
            self.controller_program,
            self.config_key,
            self.policy_key,
            self.council_key,
            self.proposal_key,
            seat_authority,
            self.proposal.proposal_digest,
            self.config.current_council_version,
        )
    }

    fn refresh_council_commitments(&mut self) {
        self.council.set_hash = compute_council_set_hash(&self.council);
        self.proposal.council_hash = self.council.set_hash;
        self.proposal.proposal_digest = compute_proposal_digest(&self.proposal).unwrap();
    }
}

fn state_account<T: BorshSerialize>(owner: Pubkey, value: &T) -> Account {
    let data = value.try_to_vec().unwrap();
    Account {
        lamports: Rent::default().minimum_balance(data.len()),
        data,
        owner,
        executable: false,
        rent_epoch: 0,
    }
}

fn authority_account(owner: Pubkey, executable: bool) -> Account {
    Account {
        lamports: Rent::default().minimum_balance(0),
        data: Vec::new(),
        owner,
        executable,
        rent_epoch: 0,
    }
}

fn add_fixture(program_test: &mut ProgramTest, fixture: &Fixture) {
    program_test.add_account(
        fixture.config_key,
        state_account(fixture.controller_program, &fixture.config),
    );
    program_test.add_account(
        fixture.policy_key,
        state_account(fixture.controller_program, &fixture.policy),
    );
    program_test.add_account(
        fixture.council_key,
        state_account(fixture.controller_program, &fixture.council),
    );
    program_test.add_account(
        fixture.proposal_key,
        state_account(fixture.controller_program, &fixture.proposal),
    );
}

fn set_account(context: &mut ProgramTestContext, key: Pubkey, account: Account) {
    context.set_account(&key, &AccountSharedData::from(account));
}

fn reset_fixture(context: &mut ProgramTestContext, fixture: &Fixture) {
    set_account(
        context,
        fixture.config_key,
        state_account(fixture.controller_program, &fixture.config),
    );
    set_account(
        context,
        fixture.policy_key,
        state_account(fixture.controller_program, &fixture.policy),
    );
    set_account(
        context,
        fixture.council_key,
        state_account(fixture.controller_program, &fixture.council),
    );
    set_account(
        context,
        fixture.proposal_key,
        state_account(fixture.controller_program, &fixture.proposal),
    );
}

async fn submit(
    context: &mut ProgramTestContext,
    instructions: &[Instruction],
    extra_signers: &[&Keypair],
) -> Result<(), BanksClientError> {
    context.get_new_latest_blockhash().await.unwrap();
    let payer = &context.payer;
    let mut signers: Vec<&dyn Signer> = vec![payer];
    signers.extend(extra_signers.iter().map(|signer| *signer as &dyn Signer));
    let transaction = Transaction::new_signed_with_payer(
        instructions,
        Some(&payer.pubkey()),
        &signers,
        context.last_blockhash,
    );
    context.banks_client.process_transaction(transaction).await
}

fn assert_instruction_error(error: BanksClientError, expected: InstructionError) {
    let transaction_error = error.unwrap();
    assert_eq!(
        transaction_error,
        TransactionError::InstructionError(0, expected)
    );
}

fn assert_custom(error: BanksClientError, expected: GovernanceError) {
    assert_instruction_error(error, InstructionError::Custom(expected as u32));
}

async fn proposal_bytes(context: &mut ProgramTestContext, key: Pubkey) -> Vec<u8> {
    context
        .banks_client
        .get_account(key)
        .await
        .unwrap()
        .unwrap()
        .data
}

async fn proposal_state(context: &mut ProgramTestContext, key: Pubkey) -> UpgradeProposalV1 {
    UpgradeProposalV1::try_from_slice(&proposal_bytes(context, key).await).unwrap()
}

async fn expect_custom_unchanged(
    context: &mut ProgramTestContext,
    proposal_key: Pubkey,
    instruction: Instruction,
    signers: &[&Keypair],
    expected: GovernanceError,
) {
    let before = proposal_bytes(context, proposal_key).await;
    let error = submit(context, &[instruction], signers).await.unwrap_err();
    assert_custom(error, expected);
    assert_eq!(proposal_bytes(context, proposal_key).await, before);
}

fn native_program_test(controller_program: Pubkey) -> ProgramTest {
    let mut program_test = ProgramTest::default();
    program_test.prefer_bpf(false);
    program_test.add_program(
        "upgrade_controller",
        controller_program,
        processor!(process_instruction),
    );
    program_test
}

#[tokio::test]
async fn direct_signers_quorum_and_executable_fail_closed_matrix() {
    let seat_keys = std::array::from_fn::<_, COUNCIL_SEAT_COUNT, _>(|_| Keypair::new());
    let seat_authorities = seat_keys.each_ref().map(Signer::pubkey);
    let controller_program = Pubkey::new_unique();
    let fixture = Fixture::new(controller_program, seat_authorities);
    let mut program_test = native_program_test(controller_program);
    add_fixture(&mut program_test, &fixture);
    for authority in seat_authorities {
        program_test.add_account(authority, authority_account(SYSTEM_PROGRAM_ID, false));
    }
    let outsider = Keypair::new();
    program_test.add_account(
        outsider.pubkey(),
        authority_account(SYSTEM_PROGRAM_ID, false),
    );
    let mut context = program_test.start_with_context().await;
    context.warp_to_slot(TEST_SLOT).unwrap();

    for (index, signer) in seat_keys.iter().take(3).enumerate() {
        submit(
            &mut context,
            &[fixture.approval_instruction(signer.pubkey())],
            &[signer],
        )
        .await
        .unwrap();
        let proposal = proposal_state(&mut context, fixture.proposal_key).await;
        assert_eq!(proposal.council_approval_count, (index + 1) as u8);
        assert_eq!(proposal.council_approval_bitset, (1u8 << (index + 1)) - 1);
        assert_eq!(
            proposal.state,
            if index == 2 {
                ProposalStateV1::CouncilApproved
            } else {
                ProposalStateV1::BufferVerified
            }
        );
    }

    reset_fixture(&mut context, &fixture);
    let mut unconfigured = fixture.approval_instruction(outsider.pubkey());
    unconfigured.accounts[4] = AccountMeta::new_readonly(outsider.pubkey(), true);
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        unconfigured,
        &[&outsider],
        GovernanceError::UnknownSeatAuthority,
    )
    .await;

    reset_fixture(&mut context, &fixture);
    let mut missing = fixture.approval_instruction(seat_keys[0].pubkey());
    missing.accounts[4].is_signer = false;
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        missing,
        &[],
        GovernanceError::MissingSeatAuthoritySignature,
    )
    .await;

    reset_fixture(&mut context, &fixture);
    let mut writable = fixture.approval_instruction(seat_keys[0].pubkey());
    writable.accounts[4].is_writable = true;
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        writable,
        &[&seat_keys[0]],
        GovernanceError::WritableSeatAuthority,
    )
    .await;

    reset_fixture(&mut context, &fixture);
    set_account(
        &mut context,
        seat_keys[0].pubkey(),
        authority_account(SYSTEM_PROGRAM_ID, true),
    );
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        fixture.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::ExecutableSeatAuthority,
    )
    .await;
    set_account(
        &mut context,
        seat_keys[0].pubkey(),
        authority_account(SYSTEM_PROGRAM_ID, false),
    );

    reset_fixture(&mut context, &fixture);
    submit(
        &mut context,
        &[fixture.approval_instruction(seat_keys[0].pubkey())],
        &[&seat_keys[0]],
    )
    .await
    .unwrap();
    let before_duplicate = proposal_bytes(&mut context, fixture.proposal_key).await;
    // submit() refreshes the blockhash, ensuring this reaches the program
    // instead of being rejected as a replayed transaction.
    let duplicate_error = submit(
        &mut context,
        &[fixture.approval_instruction(seat_keys[0].pubkey())],
        &[&seat_keys[0]],
    )
    .await
    .unwrap_err();
    assert_custom(duplicate_error, GovernanceError::DuplicateApproval);
    assert_eq!(
        proposal_bytes(&mut context, fixture.proposal_key).await,
        before_duplicate
    );

    let mut expired = fixture.clone();
    expired.council.seats[0].term_end_slot = TEST_SLOT;
    expired.refresh_council_commitments();
    reset_fixture(&mut context, &expired);
    expect_custom_unchanged(
        &mut context,
        expired.proposal_key,
        expired.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::InactiveCouncilSeat,
    )
    .await;

    let mut inactive = fixture.clone();
    inactive.council.deactivation_slot = TEST_SLOT;
    inactive.refresh_council_commitments();
    reset_fixture(&mut context, &inactive);
    expect_custom_unchanged(
        &mut context,
        inactive.proposal_key,
        inactive.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::InactiveCouncilSeat,
    )
    .await;

    let mut stale = fixture.clone();
    stale.config.current_council_version += 1;
    reset_fixture(&mut context, &stale);
    expect_custom_unchanged(
        &mut context,
        stale.proposal_key,
        stale.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::StaleCouncilVersion,
    )
    .await;

    let mut wrong_hash = fixture.clone();
    wrong_hash.proposal.council_hash[0] ^= 1;
    wrong_hash.proposal.proposal_digest = compute_proposal_digest(&wrong_hash.proposal).unwrap();
    reset_fixture(&mut context, &wrong_hash);
    expect_custom_unchanged(
        &mut context,
        wrong_hash.proposal_key,
        wrong_hash.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::ProposalCouncilHashMismatch,
    )
    .await;

    reset_fixture(&mut context, &fixture);
    let mut wrong_digest = fixture.approval_instruction(seat_keys[0].pubkey());
    wrong_digest.data[1] ^= 1;
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        wrong_digest,
        &[&seat_keys[0]],
        GovernanceError::ProposalDigestMismatch,
    )
    .await;

    reset_fixture(&mut context, &fixture);
    let mut wrong_version = fixture.approval_instruction(seat_keys[0].pubkey());
    wrong_version.data[33..41].copy_from_slice(&12u64.to_le_bytes());
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        wrong_version,
        &[&seat_keys[0]],
        GovernanceError::StaleCouncilVersion,
    )
    .await;

    let mut wrong_state = fixture.clone();
    wrong_state.proposal.state = ProposalStateV1::Draft;
    reset_fixture(&mut context, &wrong_state);
    expect_custom_unchanged(
        &mut context,
        wrong_state.proposal_key,
        wrong_state.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::InvalidStateTransition,
    )
    .await;

    for mutate in [
        |proposal: &mut UpgradeProposalV1| proposal.prestate_checkpoint = Pubkey::new_unique(),
        |proposal: &mut UpgradeProposalV1| {
            proposal.required_poststate_checkpoint = Pubkey::new_unique();
        },
    ] {
        let mut wrong_checkpoint = fixture.clone();
        mutate(&mut wrong_checkpoint.proposal);
        wrong_checkpoint.proposal.proposal_digest =
            compute_proposal_digest(&wrong_checkpoint.proposal).unwrap();
        reset_fixture(&mut context, &wrong_checkpoint);
        expect_custom_unchanged(
            &mut context,
            wrong_checkpoint.proposal_key,
            wrong_checkpoint.approval_instruction(seat_keys[0].pubkey()),
            &[&seat_keys[0]],
            GovernanceError::CrossAccountMismatch,
        )
        .await;
    }

    reset_fixture(&mut context, &fixture);
    set_account(
        &mut context,
        fixture.policy_key,
        state_account(SYSTEM_PROGRAM_ID, &fixture.policy),
    );
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        fixture.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::IncorrectAccountOwner,
    )
    .await;

    reset_fixture(&mut context, &fixture);
    let wrong_proposal_key = Pubkey::new_unique();
    set_account(
        &mut context,
        wrong_proposal_key,
        state_account(controller_program, &fixture.proposal),
    );
    let mut wrong_pda = fixture.approval_instruction(seat_keys[0].pubkey());
    wrong_pda.accounts[3].pubkey = wrong_proposal_key;
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        wrong_pda,
        &[&seat_keys[0]],
        GovernanceError::InvalidPda,
    )
    .await;

    let sized_accounts = [
        (
            fixture.config_key,
            state_account(controller_program, &fixture.config),
        ),
        (
            fixture.policy_key,
            state_account(controller_program, &fixture.policy),
        ),
        (
            fixture.council_key,
            state_account(controller_program, &fixture.council),
        ),
        (
            fixture.proposal_key,
            state_account(controller_program, &fixture.proposal),
        ),
    ];
    for (account_key, canonical_account) in sized_accounts {
        for delta in [-1isize, 1] {
            reset_fixture(&mut context, &fixture);
            let mut account = canonical_account.clone();
            if delta < 0 {
                account.data.pop();
            } else {
                account.data.push(0);
            }
            set_account(&mut context, account_key, account);
            let before = proposal_bytes(&mut context, fixture.proposal_key).await;
            let error = submit(
                &mut context,
                &[fixture.approval_instruction(seat_keys[0].pubkey())],
                &[&seat_keys[0]],
            )
            .await
            .unwrap_err();
            assert_custom(error, GovernanceError::InvalidAccountSize);
            assert_eq!(
                proposal_bytes(&mut context, fixture.proposal_key).await,
                before
            );
        }
    }

    reset_fixture(&mut context, &fixture);
    let mut extra_account = fixture.approval_instruction(seat_keys[0].pubkey());
    extra_account
        .accounts
        .push(AccountMeta::new_readonly(outsider.pubkey(), false));
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        extra_account,
        &[&seat_keys[0]],
        GovernanceError::InvalidAccountCount,
    )
    .await;

    reset_fixture(&mut context, &fixture);
    let mut writable_config = fixture.approval_instruction(seat_keys[0].pubkey());
    writable_config.accounts[0].is_writable = true;
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        writable_config,
        &[&seat_keys[0]],
        GovernanceError::InvalidAccountPrivileges,
    )
    .await;

    let mut future_policy = fixture.clone();
    future_policy.policy.activation_slot = TEST_SLOT + 1;
    future_policy.policy.policy_hash = compute_policy_hash(&future_policy.policy);
    future_policy.proposal.policy_hash = future_policy.policy.policy_hash;
    future_policy.proposal.proposal_digest =
        compute_proposal_digest(&future_policy.proposal).unwrap();
    reset_fixture(&mut context, &future_policy);
    expect_custom_unchanged(
        &mut context,
        future_policy.proposal_key,
        future_policy.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::InactivePolicy,
    )
    .await;

    let mut wrong_programdata = fixture.clone();
    wrong_programdata.config.target_programdata = Pubkey::new_unique();
    wrong_programdata.proposal.target_programdata = wrong_programdata.config.target_programdata;
    wrong_programdata.proposal.proposal_digest =
        compute_proposal_digest(&wrong_programdata.proposal).unwrap();
    reset_fixture(&mut context, &wrong_programdata);
    expect_custom_unchanged(
        &mut context,
        wrong_programdata.proposal_key,
        wrong_programdata.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::CrossAccountMismatch,
    )
    .await;

    let mut unallocated = fixture.clone();
    unallocated.config.next_proposal_id = unallocated.proposal.proposal_id;
    reset_fixture(&mut context, &unallocated);
    expect_custom_unchanged(
        &mut context,
        unallocated.proposal_key,
        unallocated.approval_instruction(seat_keys[0].pubkey()),
        &[&seat_keys[0]],
        GovernanceError::CrossAccountMismatch,
    )
    .await;

    let mut prequorum_corrupt = fixture.clone();
    prequorum_corrupt.proposal.council_approval_bitset = 0b00111;
    prequorum_corrupt.proposal.council_approval_count = 3;
    reset_fixture(&mut context, &prequorum_corrupt);
    expect_custom_unchanged(
        &mut context,
        prequorum_corrupt.proposal_key,
        prequorum_corrupt.approval_instruction(seat_keys[3].pubkey()),
        &[&seat_keys[3]],
        GovernanceError::InvalidStateTransition,
    )
    .await;

    for malformed in [
        fixture.approval_instruction(seat_keys[0].pubkey()).data[..40].to_vec(),
        {
            let mut data = fixture.approval_instruction(seat_keys[0].pubkey()).data;
            data.push(0);
            data
        },
        {
            let mut data = fixture.approval_instruction(seat_keys[0].pubkey()).data;
            data[0] = 255;
            data
        },
    ] {
        reset_fixture(&mut context, &fixture);
        let mut instruction = fixture.approval_instruction(seat_keys[0].pubkey());
        instruction.data = malformed;
        let before = proposal_bytes(&mut context, fixture.proposal_key).await;
        let error = submit(&mut context, &[instruction], &[&seat_keys[0]])
            .await
            .unwrap_err();
        assert_instruction_error(error, InstructionError::InvalidInstructionData);
        assert_eq!(
            proposal_bytes(&mut context, fixture.proposal_key).await,
            before
        );
    }

    let malformed_state_cases = [
        (fixture.config_key, 10usize),
        (fixture.policy_key, 10usize),
        (fixture.policy_key, 102usize),
        (fixture.council_key, 10usize),
        (fixture.council_key, 147usize),
        (fixture.proposal_key, 10usize),
        (fixture.proposal_key, 901usize),
    ];
    for (account_key, offset) in malformed_state_cases {
        reset_fixture(&mut context, &fixture);
        let mut account = context
            .banks_client
            .get_account(account_key)
            .await
            .unwrap()
            .unwrap();
        account.data[offset] = 2;
        set_account(&mut context, account_key, account);
        let before = proposal_bytes(&mut context, fixture.proposal_key).await;
        let error = submit(
            &mut context,
            &[fixture.approval_instruction(seat_keys[0].pubkey())],
            &[&seat_keys[0]],
        )
        .await
        .unwrap_err();
        assert_instruction_error(error, InstructionError::InvalidAccountData);
        assert_eq!(
            proposal_bytes(&mut context, fixture.proposal_key).await,
            before
        );
    }

    let mut terminal = fixture.clone();
    terminal.proposal.proposal_class = ProposalClassV1::TargetImmutability;
    terminal.proposal.proposal_digest = compute_proposal_digest(&terminal.proposal).unwrap();
    reset_fixture(&mut context, &terminal);
    for (index, signer) in seat_keys.iter().take(4).enumerate() {
        submit(
            &mut context,
            &[terminal.approval_instruction(signer.pubkey())],
            &[signer],
        )
        .await
        .unwrap();
        let proposal = proposal_state(&mut context, terminal.proposal_key).await;
        assert_eq!(proposal.council_approval_count, (index + 1) as u8);
        assert_eq!(
            proposal.state,
            if index == 3 {
                ProposalStateV1::CouncilApproved
            } else {
                ProposalStateV1::BufferVerified
            }
        );
    }
}

fn proxy_process_instruction(
    proxy_program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction_data: &[u8],
) -> ProgramResult {
    let [config, policy, council, proposal, seat_authority, controller_program] = accounts else {
        return Err(solana_program::program_error::ProgramError::NotEnoughAccountKeys);
    };
    let parsed = RecordProposalApprovalV1::unpack(instruction_data)?;
    let (expected_seat, bump) = Pubkey::find_program_address(&[PROXY_SEAT_SEED], proxy_program);
    if *seat_authority.key != expected_seat {
        return Err(solana_program::program_error::ProgramError::InvalidSeeds);
    }
    let inner = record_proposal_approval_instruction(
        *controller_program.key,
        *config.key,
        *policy.key,
        *council.key,
        *proposal.key,
        *seat_authority.key,
        parsed.expected_proposal_digest,
        parsed.expected_council_version,
    );
    let bump_seed = [bump];
    invoke_signed(
        &inner,
        &[
            config.clone(),
            policy.clone(),
            council.clone(),
            proposal.clone(),
            seat_authority.clone(),
            controller_program.clone(),
        ],
        &[&[PROXY_SEAT_SEED, &bump_seed]],
    )
}

#[tokio::test]
async fn pda_seat_authority_requires_invoke_signed() {
    let controller_program = Pubkey::new_unique();
    let proxy_program = Pubkey::new_unique();
    let (proxy_seat, _) = Pubkey::find_program_address(&[PROXY_SEAT_SEED], &proxy_program);
    let direct_keys = std::array::from_fn::<_, 4, _>(|_| Keypair::new());
    let fixture = Fixture::new(
        controller_program,
        [
            proxy_seat,
            direct_keys[0].pubkey(),
            direct_keys[1].pubkey(),
            direct_keys[2].pubkey(),
            direct_keys[3].pubkey(),
        ],
    );

    let mut program_test = ProgramTest::default();
    program_test.prefer_bpf(false);
    program_test.add_program(
        "upgrade_controller",
        controller_program,
        processor!(process_instruction),
    );
    program_test.add_program(
        "smart_account_proxy",
        proxy_program,
        processor!(proxy_process_instruction),
    );
    add_fixture(&mut program_test, &fixture);
    program_test.add_account(proxy_seat, authority_account(proxy_program, false));
    let mut context = program_test.start_with_context().await;
    context.warp_to_slot(TEST_SLOT).unwrap();

    let outer = Instruction {
        program_id: proxy_program,
        accounts: vec![
            AccountMeta::new_readonly(fixture.config_key, false),
            AccountMeta::new_readonly(fixture.policy_key, false),
            AccountMeta::new_readonly(fixture.council_key, false),
            AccountMeta::new(fixture.proposal_key, false),
            AccountMeta::new_readonly(proxy_seat, false),
            AccountMeta::new_readonly(controller_program, false),
        ],
        data: RecordProposalApprovalV1 {
            expected_proposal_digest: fixture.proposal.proposal_digest,
            expected_council_version: fixture.config.current_council_version,
        }
        .pack()
        .to_vec(),
    };
    submit(&mut context, &[outer], &[]).await.unwrap();
    let proposal = proposal_state(&mut context, fixture.proposal_key).await;
    assert_eq!(proposal.council_approval_bitset, 1);
    assert_eq!(proposal.council_approval_count, 1);
    assert_eq!(proposal.state, ProposalStateV1::BufferVerified);

    let mut direct = fixture.approval_instruction(proxy_seat);
    direct.accounts[4].is_signer = false;
    expect_custom_unchanged(
        &mut context,
        fixture.proposal_key,
        direct,
        &[],
        GovernanceError::MissingSeatAuthoritySignature,
    )
    .await;
}
