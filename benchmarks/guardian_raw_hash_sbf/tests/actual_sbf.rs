use ameba_guardian_raw_hash_sbf_benchmark::{
    BENCHMARK_PROGRAM_ID, CANDIDATE_PAYLOAD_BYTES, CONFIG_BYTES, CONFIG_DISCRIMINATOR,
    CONTROLLER_AUTHORITY, GATE_BYTES, GATE_DISCRIMINATOR, OBSERVATION_BYTES,
    OBSERVATION_DISCRIMINATOR, OBSERVATION_SEED, PROGRAMDATA_METADATA_BYTES, PROGRAM_ACCOUNT_BYTES,
};
use serde_json::json;
use solana_program::{hash::hashv, pubkey::Pubkey};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account,
    bpf_loader,
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction},
    rent::Rent,
    signature::{Keypair, Signer},
    transaction::Transaction,
};
use solana_sdk_ids::{bpf_loader_upgradeable, system_program, sysvar::clock as clock_sysvar};

const INSTRUCTION_MAGIC: &[u8; 8] = b"AMGRHSB1";
const MAX_TRANSACTION_COMPUTE_LIMIT: u64 = 1_400_000;
const FREEZE_REASON: u16 = 0x4701;

#[derive(Clone)]
struct Case {
    index: u8,
    payload_bytes: usize,
    config: Pubkey,
    target_program: Pubkey,
    target_programdata: Pubkey,
    gate: Pubkey,
    observation: Pubkey,
    programdata_slot: u64,
    gate_epoch: u64,
    raw_hash: [u8; 32],
}

fn key(byte: u8) -> Pubkey {
    Pubkey::new_from_array([byte; 32])
}

fn loader_program_bytes(programdata: &Pubkey) -> Vec<u8> {
    let mut data = vec![0u8; PROGRAM_ACCOUNT_BYTES];
    data[..4].copy_from_slice(&2u32.to_le_bytes());
    data[4..36].copy_from_slice(programdata.as_ref());
    data
}

fn programdata_bytes(payload_bytes: usize, case_index: u8, slot: u64) -> Vec<u8> {
    let mut data = vec![0u8; PROGRAMDATA_METADATA_BYTES + payload_bytes];
    data[..4].copy_from_slice(&3u32.to_le_bytes());
    data[4..12].copy_from_slice(&slot.to_le_bytes());
    data[12] = 1;
    data[13..45].copy_from_slice(CONTROLLER_AUTHORITY.as_ref());
    for (index, byte) in data[PROGRAMDATA_METADATA_BYTES..].iter_mut().enumerate() {
        let index = index as u64;
        *byte = ((index.wrapping_mul(131)
            + (index >> 8).wrapping_mul(17)
            + u64::from(case_index).wrapping_mul(29)
            + 23)
            & 0xff) as u8;
    }
    data
}

fn config_bytes(case: &Case, guardian: &Pubkey) -> Vec<u8> {
    let mut data = vec![0u8; CONFIG_BYTES];
    data[..8].copy_from_slice(CONFIG_DISCRIMINATOR);
    data[8] = 1;
    data[9] = 1;
    data[10] = case.index;
    data[12..44].copy_from_slice(case.target_program.as_ref());
    data[44..76].copy_from_slice(case.target_programdata.as_ref());
    data[76..108].copy_from_slice(guardian.as_ref());
    data[108..140].copy_from_slice(case.gate.as_ref());
    data[140..172].copy_from_slice(case.observation.as_ref());
    data[172..204].copy_from_slice(CONTROLLER_AUTHORITY.as_ref());
    data[204..236].copy_from_slice(bpf_loader_upgradeable::id().as_ref());
    data
}

fn active_gate_bytes(case: &Case) -> Vec<u8> {
    let mut data = vec![0u8; GATE_BYTES];
    data[..8].copy_from_slice(GATE_DISCRIMINATOR);
    data[8] = 1;
    data[9] = 200u8.saturating_add(case.index);
    data[10] = 1;
    data[11] = 0;
    data[12..44].copy_from_slice(case.config.as_ref());
    data[44..76].copy_from_slice(case.target_program.as_ref());
    data[76..108].copy_from_slice(case.target_programdata.as_ref());
    data[108..116].copy_from_slice(&case.gate_epoch.to_le_bytes());
    data
}

fn benchmark_instruction(case: &Case, guardian: Pubkey) -> Instruction {
    let mut data = Vec::with_capacity(56);
    data.extend_from_slice(INSTRUCTION_MAGIC);
    data.push(1);
    data.push(case.index);
    data.extend_from_slice(&FREEZE_REASON.to_le_bytes());
    data.extend_from_slice(&case.gate_epoch.to_le_bytes());
    data.extend_from_slice(&(case.payload_bytes as u32).to_le_bytes());
    data.extend_from_slice(&case.raw_hash);
    assert_eq!(data.len(), 56);
    Instruction::new_with_bytes(
        BENCHMARK_PROGRAM_ID,
        &data,
        vec![
            AccountMeta::new_readonly(case.config, false),
            AccountMeta::new_readonly(case.target_program, false),
            AccountMeta::new_readonly(case.target_programdata, false),
            AccountMeta::new(case.gate, false),
            AccountMeta::new(case.observation, false),
            AccountMeta::new_readonly(guardian, true),
            AccountMeta::new_readonly(clock_sysvar::ID, false),
        ],
    )
}

fn read_u16(data: &[u8], offset: usize) -> u16 {
    u16::from_le_bytes(data[offset..offset + 2].try_into().expect("u16 bytes"))
}

fn read_u64(data: &[u8], offset: usize) -> u64 {
    u64::from_le_bytes(data[offset..offset + 8].try_into().expect("u64 bytes"))
}

fn hex(bytes: &[u8]) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut encoded = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        encoded.push(DIGITS[(byte >> 4) as usize] as char);
        encoded.push(DIGITS[(byte & 0x0f) as usize] as char);
    }
    encoded
}

#[tokio::test]
async fn measures_composed_guardian_raw_hash_path_in_actual_sbf() {
    let guardian = Keypair::new();
    let rent = Rent::default();
    let mut program_test = ProgramTest::default();
    program_test.prefer_bpf(true);
    program_test.add_program(
        "ameba_guardian_raw_hash_sbf_benchmark",
        BENCHMARK_PROGRAM_ID,
        None,
    );
    program_test.add_account(
        guardian.pubkey(),
        Account {
            lamports: 1_000_000,
            data: Vec::new(),
            owner: system_program::ID,
            executable: false,
            rent_epoch: 0,
        },
    );

    let mut cases = Vec::with_capacity(CANDIDATE_PAYLOAD_BYTES.len());
    for (position, payload_bytes) in CANDIDATE_PAYLOAD_BYTES.iter().copied().enumerate() {
        let index = position as u8;
        let config = key(0x10 + index);
        let target_program = key(0x20 + index);
        let target_programdata = key(0x30 + index);
        let gate = key(0x40 + index);
        let (observation, _) =
            Pubkey::find_program_address(&[OBSERVATION_SEED, &[index]], &BENCHMARK_PROGRAM_ID);
        let programdata_slot = 1_000 + u64::from(index);
        let gate_epoch = 41 + u64::from(index);
        let programdata = programdata_bytes(payload_bytes, index, programdata_slot);
        let raw_hash: [u8; 32] = hashv(&[&programdata]).to_bytes();
        let case = Case {
            index,
            payload_bytes,
            config,
            target_program,
            target_programdata,
            gate,
            observation,
            programdata_slot,
            gate_epoch,
            raw_hash,
        };
        program_test.add_account(
            case.config,
            Account {
                lamports: rent.minimum_balance(CONFIG_BYTES),
                data: config_bytes(&case, &guardian.pubkey()),
                owner: BENCHMARK_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        );
        program_test.add_account(
            case.target_program,
            Account {
                lamports: rent.minimum_balance(PROGRAM_ACCOUNT_BYTES),
                data: loader_program_bytes(&case.target_programdata),
                owner: BENCHMARK_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        );
        program_test.add_account(
            case.target_programdata,
            Account {
                lamports: rent.minimum_balance(programdata.len()),
                data: programdata,
                owner: bpf_loader_upgradeable::id(),
                executable: false,
                rent_epoch: 0,
            },
        );
        program_test.add_account(
            case.gate,
            Account {
                lamports: rent.minimum_balance(GATE_BYTES),
                data: active_gate_bytes(&case),
                owner: BENCHMARK_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        );
        program_test.add_account(
            case.observation,
            Account {
                lamports: rent.minimum_balance(OBSERVATION_BYTES),
                data: vec![0; OBSERVATION_BYTES],
                owner: BENCHMARK_PROGRAM_ID,
                executable: false,
                rent_epoch: 0,
            },
        );
        cases.push(case);
    }

    let context = program_test.start_with_context().await;
    let benchmark_program = context
        .banks_client
        .get_account(BENCHMARK_PROGRAM_ID)
        .await
        .expect("program account read")
        .expect("actual SBF program account");
    assert_eq!(benchmark_program.owner, bpf_loader::id());
    let architecture = std::env::var("AMOEBA_BENCH_ARCH").expect("AMOEBA_BENCH_ARCH");

    for case in cases {
        let instruction = benchmark_instruction(&case, guardian.pubkey());
        let transaction = Transaction::new_signed_with_payer(
            &[
                ComputeBudgetInstruction::set_compute_unit_limit(
                    MAX_TRANSACTION_COMPUTE_LIMIT as u32,
                ),
                instruction,
            ],
            Some(&context.payer.pubkey()),
            &[&context.payer, &guardian],
            context.last_blockhash,
        );
        let outcome = context
            .banks_client
            .process_transaction_with_metadata(transaction)
            .await
            .expect("banks transport");
        assert_eq!(outcome.result, Ok(()));
        let metadata = outcome.metadata.expect("transaction metadata");
        assert!(
            metadata
                .log_messages
                .iter()
                .any(|line| line.contains("Program") && line.contains("invoke")),
            "actual SBF invocation log missing"
        );
        let consumed = metadata.compute_units_consumed;
        assert!(consumed < MAX_TRANSACTION_COMPUTE_LIMIT);

        let observation = context
            .banks_client
            .get_account(case.observation)
            .await
            .expect("observation read")
            .expect("created observation");
        assert_eq!(observation.owner, BENCHMARK_PROGRAM_ID);
        assert_eq!(observation.data.len(), OBSERVATION_BYTES);
        assert_eq!(&observation.data[..8], OBSERVATION_DISCRIMINATOR);
        assert_eq!(observation.data[10], 1);
        assert_eq!(observation.data[11], 1);
        assert_eq!(&observation.data[108..140], &case.raw_hash);
        assert_eq!(
            read_u64(&observation.data, 172),
            (case.payload_bytes + PROGRAMDATA_METADATA_BYTES) as u64
        );
        assert_eq!(read_u64(&observation.data, 180), case.payload_bytes as u64);
        assert_eq!(read_u64(&observation.data, 188), case.programdata_slot);
        assert_eq!(read_u64(&observation.data, 228), case.gate_epoch + 1);
        assert_ne!(read_u64(&observation.data, 236), 0);
        assert_eq!(read_u16(&observation.data, 244), FREEZE_REASON);

        let frozen_gate = context
            .banks_client
            .get_account(case.gate)
            .await
            .expect("gate read")
            .expect("frozen gate");
        assert_eq!(frozen_gate.data[11], 2);
        assert_eq!(read_u64(&frozen_gate.data, 108), case.gate_epoch + 1);
        assert_ne!(read_u64(&frozen_gate.data, 148), 0);
        assert_eq!(read_u16(&frozen_gate.data, 156), FREEZE_REASON);

        println!(
            "AMOEBA_GUARDIAN_HASH_BENCH_RESULT {}",
            json!({
                "architecture": architecture,
                "payload_capacity_bytes": case.payload_bytes,
                "raw_programdata_account_bytes": case.payload_bytes + PROGRAMDATA_METADATA_BYTES,
                "programdata_metadata_bytes": PROGRAMDATA_METADATA_BYTES,
                "compute_units": consumed,
                "compute_limit": MAX_TRANSACTION_COMPUTE_LIMIT,
                "compute_margin": MAX_TRANSACTION_COMPUTE_LIMIT - consumed,
                "raw_sha256": hex(&case.raw_hash),
                "observation_digest": hex(&observation.data[140..172]),
                "benchmark_program_loader_owner": benchmark_program.owner.to_string(),
                "synthetic_target_program_owner": BENCHMARK_PROGRAM_ID.to_string(),
                "synthetic_target_program_executable": false,
                "programdata_owner": bpf_loader_upgradeable::id().to_string(),
                "observation_preallocated_and_serialized": true,
                "gate_transition": "Active -> EmergencyFrozen",
                "execution": "actual_sbf_programtest"
            })
        );
    }
}
