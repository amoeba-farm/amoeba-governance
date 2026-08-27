use ameba_artifact_chunk_sbf_benchmark::{
    BENCHMARK_DATA_ACCOUNT_ID, BENCHMARK_PROGRAM_ID, LEAF_DOMAIN, MAX_ARTIFACT_BYTES,
    MAX_RAW_PROGRAMDATA_BYTES, NODE_DOMAIN, PROGRAMDATA_METADATA_BYTES,
};
use serde_json::json;
use solana_program::hash::{hashv, Hash};
use solana_program_test::ProgramTest;
use solana_sdk::{
    account::Account,
    bpf_loader,
    compute_budget::ComputeBudgetInstruction,
    instruction::{AccountMeta, Instruction},
    rent::Rent,
    signature::Signer,
    transaction::Transaction,
};

const MAGIC: &[u8; 8] = b"AMCHSBF1";
const RAW_HASH_MAGIC: &[u8; 8] = b"AMRAWSF1";
const DEFAULT_TRANSACTION_COMPUTE_LIMIT: u64 = 200_000;
const MAX_TRANSACTION_COMPUTE_LIMIT: u64 = 1_400_000;

fn benchmark_account_bytes() -> Vec<u8> {
    (0..MAX_RAW_PROGRAMDATA_BYTES)
        .map(|index| {
            let index = index as u64;
            ((index.wrapping_mul(131) + (index >> 8).wrapping_mul(17) + 23) & 0xff) as u8
        })
        .collect()
}

fn merkle_root_and_proof(data: &[u8], chunk_size: usize, leaf_index: usize) -> (Hash, Vec<Hash>) {
    let mut level = data
        .chunks(chunk_size)
        .enumerate()
        .map(|(index, chunk)| {
            hashv(&[
                LEAF_DOMAIN,
                &(index as u32).to_le_bytes(),
                &(chunk.len() as u32).to_le_bytes(),
                chunk,
            ])
        })
        .collect::<Vec<_>>();
    assert!(level.len().is_power_of_two());

    let mut proof = Vec::with_capacity(level.len().trailing_zeros() as usize);
    let mut cursor = leaf_index;
    while level.len() > 1 {
        proof.push(level[cursor ^ 1]);
        level = level
            .chunks_exact(2)
            .map(|pair| hashv(&[NODE_DOMAIN, pair[0].as_ref(), pair[1].as_ref()]))
            .collect();
        cursor >>= 1;
    }
    (level[0], proof)
}

fn benchmark_instruction(chunk_size: usize, root: Hash, proof: &[Hash]) -> Instruction {
    let chunk_count = MAX_ARTIFACT_BYTES / chunk_size;
    let chunk_index = chunk_count - 1;
    let mut data = Vec::with_capacity(57 + proof.len() * 32);
    data.extend_from_slice(MAGIC);
    data.extend_from_slice(&(chunk_size as u32).to_le_bytes());
    data.extend_from_slice(&(chunk_index as u32).to_le_bytes());
    data.extend_from_slice(&(chunk_size as u32).to_le_bytes());
    data.extend_from_slice(&(chunk_count as u32).to_le_bytes());
    data.extend_from_slice(root.as_ref());
    data.push(proof.len() as u8);
    for sibling in proof {
        data.extend_from_slice(sibling.as_ref());
    }
    Instruction::new_with_bytes(
        BENCHMARK_PROGRAM_ID,
        &data,
        vec![AccountMeta::new_readonly(BENCHMARK_DATA_ACCOUNT_ID, false)],
    )
}

fn raw_hash_benchmark_instruction(expected_hash: Hash) -> Instruction {
    let mut data = Vec::with_capacity(40);
    data.extend_from_slice(RAW_HASH_MAGIC);
    data.extend_from_slice(expected_hash.as_ref());
    Instruction::new_with_bytes(
        BENCHMARK_PROGRAM_ID,
        &data,
        vec![AccountMeta::new_readonly(BENCHMARK_DATA_ACCOUNT_ID, false)],
    )
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
async fn measures_leaf_plus_max_depth_proof_in_actual_sbf() {
    let account_data = benchmark_account_bytes();
    let artifact = &account_data[PROGRAMDATA_METADATA_BYTES..];
    let mut program_test = ProgramTest::default();
    program_test.prefer_bpf(true);
    program_test.add_program(
        "ameba_artifact_chunk_sbf_benchmark",
        BENCHMARK_PROGRAM_ID,
        None,
    );
    program_test.add_account(
        BENCHMARK_DATA_ACCOUNT_ID,
        Account {
            lamports: Rent::default().minimum_balance(MAX_RAW_PROGRAMDATA_BYTES),
            data: account_data.clone(),
            owner: BENCHMARK_PROGRAM_ID,
            executable: false,
            rent_epoch: 0,
        },
    );
    let context = program_test.start_with_context().await;
    let program_account = context
        .banks_client
        .get_account(BENCHMARK_PROGRAM_ID)
        .await
        .expect("program account read")
        .expect("actual SBF program account");
    assert_eq!(program_account.owner, bpf_loader::id());

    let architecture = std::env::var("AMOEBA_BENCH_ARCH").expect("AMOEBA_BENCH_ARCH");
    for chunk_size in [4096usize, 8192, 16384] {
        let chunk_count = MAX_ARTIFACT_BYTES / chunk_size;
        let leaf_index = chunk_count - 1;
        let (root, proof) = merkle_root_and_proof(artifact, chunk_size, leaf_index);
        assert_eq!(proof.len(), chunk_count.trailing_zeros() as usize);
        let instruction = benchmark_instruction(chunk_size, root, &proof);
        let instruction_bytes = instruction.data.len();
        let transaction = Transaction::new_signed_with_payer(
            &[instruction],
            Some(&context.payer.pubkey()),
            &[&context.payer],
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
        assert!(consumed < DEFAULT_TRANSACTION_COMPUTE_LIMIT);
        println!(
            "AMOEBA_BENCH_RESULT {}",
            json!({
                "architecture": architecture,
                "artifact_bytes": MAX_ARTIFACT_BYTES,
                "chunk_bytes": chunk_size,
                "chunk_count": chunk_count,
                "leaf_index": leaf_index,
                "proof_depth": proof.len(),
                "instruction_bytes": instruction_bytes,
                "compute_units": consumed,
                "compute_limit": DEFAULT_TRANSACTION_COMPUTE_LIMIT,
                "compute_margin": DEFAULT_TRANSACTION_COMPUTE_LIMIT - consumed,
                "merkle_root": hex(root.as_ref()),
                "program_owner": program_account.owner.to_string(),
                "execution": "actual_sbf_programtest"
            })
        );
    }

    let expected_raw_hash = hashv(&[&account_data]);
    let raw_instruction = raw_hash_benchmark_instruction(expected_raw_hash);
    let transaction = Transaction::new_signed_with_payer(
        &[
            ComputeBudgetInstruction::set_compute_unit_limit(MAX_TRANSACTION_COMPUTE_LIMIT as u32),
            raw_instruction,
        ],
        Some(&context.payer.pubkey()),
        &[&context.payer],
        context.last_blockhash,
    );
    let outcome = context
        .banks_client
        .process_transaction_with_metadata(transaction)
        .await
        .expect("raw-hash banks transport");
    assert_eq!(outcome.result, Ok(()));
    let metadata = outcome.metadata.expect("raw-hash transaction metadata");
    let consumed = metadata.compute_units_consumed;
    assert!(consumed < MAX_TRANSACTION_COMPUTE_LIMIT);
    println!(
        "AMOEBA_RAW_HASH_BENCH_RESULT {}",
        json!({
            "architecture": architecture,
            "account_bytes": MAX_RAW_PROGRAMDATA_BYTES,
            "payload_capacity_bytes": MAX_ARTIFACT_BYTES,
            "programdata_metadata_bytes": PROGRAMDATA_METADATA_BYTES,
            "compute_units": consumed,
            "compute_limit": MAX_TRANSACTION_COMPUTE_LIMIT,
            "compute_margin": MAX_TRANSACTION_COMPUTE_LIMIT - consumed,
            "raw_sha256": hex(expected_raw_hash.as_ref()),
            "program_owner": program_account.owner.to_string(),
            "execution": "actual_sbf_programtest"
        })
    );
}
