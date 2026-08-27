#![deny(unsafe_code)]
#![allow(unexpected_cfgs)]

use solana_program::{
    account_info::AccountInfo, entrypoint::ProgramResult, hash::hashv, program_error::ProgramError,
    pubkey::Pubkey,
};

#[cfg(target_os = "solana")]
solana_program::entrypoint!(process_instruction);

pub const BENCHMARK_PROGRAM_ID: Pubkey = Pubkey::new_from_array([0xA5; 32]);
pub const BENCHMARK_DATA_ACCOUNT_ID: Pubkey = Pubkey::new_from_array([0x5A; 32]);
pub const MAX_ARTIFACT_BYTES: usize = 2 * 1024 * 1024;
pub const PROGRAMDATA_METADATA_BYTES: usize = 45;
pub const MAX_RAW_PROGRAMDATA_BYTES: usize = PROGRAMDATA_METADATA_BYTES + MAX_ARTIFACT_BYTES;
pub const LEAF_DOMAIN: &[u8] = b"AMOEBA_ARTIFACT_CHUNK_V1";
pub const NODE_DOMAIN: &[u8] = b"AMOEBA_ARTIFACT_NODE_V1";

const MAGIC: &[u8; 8] = b"AMCHSBF1";
const RAW_HASH_MAGIC: &[u8; 8] = b"AMRAWSF1";
const FIXED_INSTRUCTION_BYTES: usize = 8 + 4 + 4 + 4 + 4 + 32 + 1;
const RAW_HASH_INSTRUCTION_BYTES: usize = 8 + 32;

#[repr(u32)]
enum BenchmarkError {
    WrongProgram = 1,
    WrongAccountContract = 2,
    MalformedInstruction = 3,
    UnsupportedChunkSize = 4,
    ArithmeticOverflow = 5,
    WrongProofDepth = 6,
    RootMismatch = 7,
    RawHashMismatch = 8,
}

impl From<BenchmarkError> for ProgramError {
    fn from(value: BenchmarkError) -> Self {
        Self::Custom(value as u32)
    }
}

/// Actual-SBF-only benchmark entrypoint. This is a standalone benchmark crate,
/// not a production controller instruction or dispatcher branch.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction_data: &[u8],
) -> ProgramResult {
    if program_id != &BENCHMARK_PROGRAM_ID {
        return Err(BenchmarkError::WrongProgram.into());
    }
    let [artifact] = accounts else {
        return Err(BenchmarkError::WrongAccountContract.into());
    };
    if artifact.key != &BENCHMARK_DATA_ACCOUNT_ID
        || artifact.owner != program_id
        || artifact.is_signer
        || artifact.is_writable
        || artifact.executable
        || artifact.data_len() != MAX_RAW_PROGRAMDATA_BYTES
    {
        return Err(BenchmarkError::WrongAccountContract.into());
    }

    if instruction_data.len() == RAW_HASH_INSTRUCTION_BYTES
        && &instruction_data[..RAW_HASH_MAGIC.len()] == RAW_HASH_MAGIC
    {
        let expected_hash = instruction_data
            .get(RAW_HASH_MAGIC.len()..RAW_HASH_INSTRUCTION_BYTES)
            .ok_or(BenchmarkError::MalformedInstruction)?;
        let artifact_data = artifact.try_borrow_data()?;
        let actual_hash = hashv(&[&artifact_data]);
        if actual_hash.as_ref() != expected_hash {
            return Err(BenchmarkError::RawHashMismatch.into());
        }
        return Ok(());
    }

    if instruction_data.len() < FIXED_INSTRUCTION_BYTES || &instruction_data[..MAGIC.len()] != MAGIC
    {
        return Err(BenchmarkError::MalformedInstruction.into());
    }

    let chunk_size = read_u32(instruction_data, 8)? as usize;
    let chunk_index = read_u32(instruction_data, 12)?;
    let actual_len = read_u32(instruction_data, 16)? as usize;
    let chunk_count = read_u32(instruction_data, 20)?;
    let expected_root = instruction_data
        .get(24..56)
        .ok_or(BenchmarkError::MalformedInstruction)?;
    let proof_depth = *instruction_data
        .get(56)
        .ok_or(BenchmarkError::MalformedInstruction)? as usize;
    let proof_bytes = instruction_data
        .get(FIXED_INSTRUCTION_BYTES..)
        .ok_or(BenchmarkError::MalformedInstruction)?;

    if !matches!(chunk_size, 4096 | 8192 | 16384)
        || MAX_ARTIFACT_BYTES % chunk_size != 0
        || actual_len != chunk_size
    {
        return Err(BenchmarkError::UnsupportedChunkSize.into());
    }
    let expected_chunk_count = MAX_ARTIFACT_BYTES / chunk_size;
    if chunk_count as usize != expected_chunk_count || chunk_index >= chunk_count {
        return Err(BenchmarkError::MalformedInstruction.into());
    }
    let expected_depth = chunk_count.trailing_zeros() as usize;
    if !chunk_count.is_power_of_two()
        || proof_depth != expected_depth
        || proof_bytes.len() != proof_depth.saturating_mul(32)
    {
        return Err(BenchmarkError::WrongProofDepth.into());
    }

    let chunk_offset = (chunk_index as usize)
        .checked_mul(chunk_size)
        .and_then(|offset| offset.checked_add(PROGRAMDATA_METADATA_BYTES))
        .ok_or(BenchmarkError::ArithmeticOverflow)?;
    let chunk_end = chunk_offset
        .checked_add(actual_len)
        .ok_or(BenchmarkError::ArithmeticOverflow)?;
    if chunk_end > MAX_RAW_PROGRAMDATA_BYTES {
        return Err(BenchmarkError::MalformedInstruction.into());
    }

    let index_le = chunk_index.to_le_bytes();
    let actual_len_le = (actual_len as u32).to_le_bytes();
    let artifact_data = artifact.try_borrow_data()?;
    let exact_chunk = artifact_data
        .get(chunk_offset..chunk_end)
        .ok_or(BenchmarkError::MalformedInstruction)?;

    // The account data remains borrowed. No chunk-sized copy or allocation is
    // made; the SHA-256 syscall receives the exact borrowed byte slice.
    let mut node = hashv(&[LEAF_DOMAIN, &index_le, &actual_len_le, exact_chunk]);
    let mut tree_index = chunk_index;
    for sibling in proof_bytes.chunks_exact(32) {
        node = if tree_index & 1 == 0 {
            hashv(&[NODE_DOMAIN, node.as_ref(), sibling])
        } else {
            hashv(&[NODE_DOMAIN, sibling, node.as_ref()])
        };
        tree_index >>= 1;
    }

    if tree_index != 0 || node.as_ref() != expected_root {
        return Err(BenchmarkError::RootMismatch.into());
    }
    Ok(())
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, ProgramError> {
    let bytes: [u8; 4] = data
        .get(offset..offset + 4)
        .ok_or(BenchmarkError::MalformedInstruction)?
        .try_into()
        .map_err(|_| BenchmarkError::MalformedInstruction)?;
    Ok(u32::from_le_bytes(bytes))
}
