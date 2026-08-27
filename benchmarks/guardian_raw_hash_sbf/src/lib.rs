#![deny(unsafe_code)]
#![allow(unexpected_cfgs)]

//! Standalone actual-SBF benchmark for the composed guardian-freeze raw
//! ProgramData observation path. This crate is intentionally outside the
//! production controller workspace and exposes no production instruction tag.

use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    entrypoint::ProgramResult,
    hash::{hashv, Hash},
    program_error::ProgramError,
    pubkey::Pubkey,
    sysvar::Sysvar,
};
use solana_sdk_ids::{bpf_loader_upgradeable, sysvar::clock as clock_sysvar};

#[cfg(target_os = "solana")]
solana_program::entrypoint!(process_instruction);

pub const BENCHMARK_PROGRAM_ID: Pubkey = Pubkey::new_from_array([0xA6; 32]);
pub const CONTROLLER_AUTHORITY: Pubkey = Pubkey::new_from_array([0xC7; 32]);
pub const PROGRAMDATA_METADATA_BYTES: usize = 45;
pub const CONFIG_BYTES: usize = 256;
pub const GATE_BYTES: usize = 192;
pub const OBSERVATION_BYTES: usize = 256;
pub const PROGRAM_ACCOUNT_BYTES: usize = 36;
pub const CANDIDATE_PAYLOAD_BYTES: [usize; 4] = [
    5 * 1024 * 1024 / 4,
    3 * 1024 * 1024 / 2,
    7 * 1024 * 1024 / 4,
    2 * 1024 * 1024,
];

pub const CONFIG_DISCRIMINATOR: &[u8; 8] = b"AMGRHCF1";
pub const GATE_DISCRIMINATOR: &[u8; 8] = b"AGVGAT01";
pub const OBSERVATION_DISCRIMINATOR: &[u8; 8] = b"AMGRHOB1";
pub const OBSERVATION_DIGEST_DOMAIN: &[u8] = b"AMOEBA_GUARDIAN_RAW_HASH_BENCH_V1";
pub const OBSERVATION_SEED: &[u8] = b"guardian-raw-hash-observation";

const INSTRUCTION_MAGIC: &[u8; 8] = b"AMGRHSB1";
const INSTRUCTION_BYTES: usize = 56;
const INSTRUCTION_VERSION: u8 = 1;
const ACCOUNT_VERSION: u8 = 1;
const ACTIVE_GATE_STATUS: u8 = 0;
const EMERGENCY_FROZEN_GATE_STATUS: u8 = 2;

#[repr(u32)]
enum BenchmarkError {
    WrongProgram = 1,
    WrongAccountContract = 2,
    DuplicateAccount = 3,
    MalformedInstruction = 4,
    UnsupportedCandidate = 5,
    InvalidConfig = 6,
    InvalidProgramLink = 7,
    InvalidProgramData = 8,
    InvalidGate = 9,
    RawHashMismatch = 10,
    ArithmeticOverflow = 11,
    ObservationWriteFailed = 12,
}

impl From<BenchmarkError> for ProgramError {
    fn from(value: BenchmarkError) -> Self {
        Self::Custom(value as u32)
    }
}

struct BenchmarkInstruction {
    case_index: u8,
    freeze_reason: u16,
    expected_epoch: u64,
    payload_bytes: usize,
    expected_raw_hash: [u8; 32],
}

/// Actual-SBF-only composed benchmark entrypoint. It validates an exact
/// Program/ProgramData graph and loader header, hashes the complete raw
/// ProgramData account, serializes a preallocated observation PDA, computes a
/// domain-separated observation digest, and mutates a canonical gate from
/// Active to EmergencyFrozen.
pub fn process_instruction(
    program_id: &Pubkey,
    accounts: &[AccountInfo<'_>],
    instruction_data: &[u8],
) -> ProgramResult {
    if program_id != &BENCHMARK_PROGRAM_ID {
        return Err(BenchmarkError::WrongProgram.into());
    }
    let [config, target_program, target_programdata, gate, observation, guardian, clock_info] =
        accounts
    else {
        return Err(BenchmarkError::WrongAccountContract.into());
    };
    require_distinct(accounts)?;
    validate_privileges_and_owners(
        program_id,
        config,
        target_program,
        target_programdata,
        gate,
        observation,
        guardian,
        clock_info,
    )?;

    let instruction = decode_instruction(instruction_data)?;
    validate_config(
        program_id,
        config,
        target_program,
        target_programdata,
        gate,
        observation,
        guardian,
    )?;
    validate_program_link(target_program, target_programdata)?;
    let (programdata_slot, programdata_authority, raw_hash) = validate_and_hash_programdata(
        target_programdata,
        instruction.payload_bytes,
        &instruction.expected_raw_hash,
    )?;
    if programdata_authority != CONTROLLER_AUTHORITY {
        return Err(BenchmarkError::InvalidProgramData.into());
    }

    let clock = Clock::from_account_info(clock_info)?;
    if clock.slot == 0 || instruction.freeze_reason == 0 {
        return Err(BenchmarkError::MalformedInstruction.into());
    }
    let frozen_epoch = instruction
        .expected_epoch
        .checked_add(1)
        .ok_or(BenchmarkError::ArithmeticOverflow)?;

    validate_active_gate(
        config,
        target_program,
        target_programdata,
        gate,
        instruction.expected_epoch,
    )?;

    let (expected_observation, observation_bump) =
        Pubkey::find_program_address(&[OBSERVATION_SEED, &[instruction.case_index]], program_id);
    if expected_observation != *observation.key {
        return Err(BenchmarkError::WrongAccountContract.into());
    }

    let payload_bytes_le = (instruction.payload_bytes as u64).to_le_bytes();
    let raw_account_bytes = instruction
        .payload_bytes
        .checked_add(PROGRAMDATA_METADATA_BYTES)
        .ok_or(BenchmarkError::ArithmeticOverflow)?;
    let raw_account_bytes_le = (raw_account_bytes as u64).to_le_bytes();
    let programdata_slot_le = programdata_slot.to_le_bytes();
    let frozen_epoch_le = frozen_epoch.to_le_bytes();
    let freeze_slot_le = clock.slot.to_le_bytes();
    let freeze_reason_le = instruction.freeze_reason.to_le_bytes();
    let observation_digest = hashv(&[
        OBSERVATION_DIGEST_DOMAIN,
        config.key.as_ref(),
        target_program.key.as_ref(),
        target_programdata.key.as_ref(),
        &raw_account_bytes_le,
        &payload_bytes_le,
        &programdata_slot_le,
        programdata_authority.as_ref(),
        raw_hash.as_ref(),
        &frozen_epoch_le,
        &freeze_slot_le,
        &freeze_reason_le,
    ]);

    write_observation(
        observation,
        observation_bump,
        config,
        target_program,
        target_programdata,
        raw_account_bytes,
        instruction.payload_bytes,
        programdata_slot,
        &programdata_authority,
        &raw_hash,
        &observation_digest,
        frozen_epoch,
        clock.slot,
        instruction.freeze_reason,
    )?;
    freeze_gate(
        config,
        target_program,
        target_programdata,
        gate,
        frozen_epoch,
        clock.slot,
        instruction.freeze_reason,
    )
}

fn decode_instruction(data: &[u8]) -> Result<BenchmarkInstruction, ProgramError> {
    if data.len() != INSTRUCTION_BYTES
        || data.get(..8) != Some(INSTRUCTION_MAGIC)
        || data[8] != INSTRUCTION_VERSION
    {
        return Err(BenchmarkError::MalformedInstruction.into());
    }
    let case_index = data[9];
    let payload_bytes = read_u32(data, 20)? as usize;
    if CANDIDATE_PAYLOAD_BYTES.get(case_index as usize).copied() != Some(payload_bytes) {
        return Err(BenchmarkError::UnsupportedCandidate.into());
    }
    let expected_raw_hash = data
        .get(24..56)
        .ok_or(BenchmarkError::MalformedInstruction)?
        .try_into()
        .map_err(|_| BenchmarkError::MalformedInstruction)?;
    Ok(BenchmarkInstruction {
        case_index,
        freeze_reason: read_u16(data, 10)?,
        expected_epoch: read_u64(data, 12)?,
        payload_bytes,
        expected_raw_hash,
    })
}

#[allow(clippy::too_many_arguments)]
fn validate_privileges_and_owners(
    program_id: &Pubkey,
    config: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    gate: &AccountInfo<'_>,
    observation: &AccountInfo<'_>,
    guardian: &AccountInfo<'_>,
    clock_info: &AccountInfo<'_>,
) -> ProgramResult {
    let loader = bpf_loader_upgradeable::id();
    if config.owner != program_id
        || config.is_signer
        || config.is_writable
        || config.executable
        || config.data_len() != CONFIG_BYTES
        // ProgramTest attempts to install a synthetic Loader-v3 Program record
        // in its deploy cache even when the account is nonexecutable, then
        // rejects the replacement before this SBF entrypoint runs. Keep this
        // one account benchmark-owned so the composed benchmark can exercise
        // an equal-cost exact-owner comparison plus the exact Program ->
        // ProgramData bytes. Production must compare the owner to Loader-v3
        // and require the executable bit.
        || target_program.owner != program_id
        || target_program.is_signer
        || target_program.is_writable
        || target_program.executable
        || target_program.data_len() != PROGRAM_ACCOUNT_BYTES
        || target_programdata.owner != &loader
        || target_programdata.is_signer
        || target_programdata.is_writable
        || target_programdata.executable
        || gate.owner != program_id
        || gate.is_signer
        || !gate.is_writable
        || gate.executable
        || gate.data_len() != GATE_BYTES
        || observation.owner != program_id
        || observation.is_signer
        || !observation.is_writable
        || observation.executable
        || observation.data_len() != OBSERVATION_BYTES
        || !guardian.is_signer
        || guardian.is_writable
        || guardian.executable
        || clock_info.key != &clock_sysvar::ID
        || clock_info.is_signer
        || clock_info.is_writable
        || clock_info.executable
    {
        return Err(BenchmarkError::WrongAccountContract.into());
    }
    if observation.try_borrow_data()?.iter().any(|byte| *byte != 0) {
        return Err(BenchmarkError::WrongAccountContract.into());
    }
    Ok(())
}

fn require_distinct(accounts: &[AccountInfo<'_>]) -> ProgramResult {
    for (index, account) in accounts.iter().enumerate() {
        if accounts[..index]
            .iter()
            .any(|prior| prior.key == account.key)
        {
            return Err(BenchmarkError::DuplicateAccount.into());
        }
    }
    Ok(())
}

fn validate_config(
    program_id: &Pubkey,
    config: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    gate: &AccountInfo<'_>,
    observation: &AccountInfo<'_>,
    guardian: &AccountInfo<'_>,
) -> ProgramResult {
    let data = config.try_borrow_data()?;
    if data.get(..8) != Some(CONFIG_DISCRIMINATOR)
        || data[8] != ACCOUNT_VERSION
        || data[9] != 1
        || pubkey_at(&data, 12)? != *target_program.key
        || pubkey_at(&data, 44)? != *target_programdata.key
        || pubkey_at(&data, 76)? != *guardian.key
        || pubkey_at(&data, 108)? != *gate.key
        || pubkey_at(&data, 140)? != *observation.key
        || pubkey_at(&data, 172)? != CONTROLLER_AUTHORITY
        || pubkey_at(&data, 204)? != bpf_loader_upgradeable::id()
        || data[236..].iter().any(|byte| *byte != 0)
        || config.owner != program_id
    {
        return Err(BenchmarkError::InvalidConfig.into());
    }
    Ok(())
}

fn validate_program_link(
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
) -> ProgramResult {
    let data = target_program.try_borrow_data()?;
    if read_u32(&data, 0)? != 2 || pubkey_at(&data, 4)? != *target_programdata.key {
        return Err(BenchmarkError::InvalidProgramLink.into());
    }
    Ok(())
}

fn validate_and_hash_programdata(
    target_programdata: &AccountInfo<'_>,
    payload_bytes: usize,
    expected_raw_hash: &[u8; 32],
) -> Result<(u64, Pubkey, Hash), ProgramError> {
    let expected_len = payload_bytes
        .checked_add(PROGRAMDATA_METADATA_BYTES)
        .ok_or(BenchmarkError::ArithmeticOverflow)?;
    if target_programdata.data_len() != expected_len {
        return Err(BenchmarkError::InvalidProgramData.into());
    }
    let data = target_programdata.try_borrow_data()?;
    if read_u32(&data, 0)? != 3 || data[12] != 1 {
        return Err(BenchmarkError::InvalidProgramData.into());
    }
    let slot = read_u64(&data, 4)?;
    if slot == 0 {
        return Err(BenchmarkError::InvalidProgramData.into());
    }
    let authority = pubkey_at(&data, 13)?;
    let raw_hash = hashv(&[&data]);
    if raw_hash.as_ref() != expected_raw_hash {
        return Err(BenchmarkError::RawHashMismatch.into());
    }
    Ok((slot, authority, raw_hash))
}

fn validate_active_gate(
    config: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    gate: &AccountInfo<'_>,
    expected_epoch: u64,
) -> ProgramResult {
    let data = gate.try_borrow_data()?;
    if data.get(..8) != Some(GATE_DISCRIMINATOR)
        || data[8] != ACCOUNT_VERSION
        || data[10] != 1
        || data[11] != ACTIVE_GATE_STATUS
        || pubkey_at(&data, 12)? != *config.key
        || pubkey_at(&data, 44)? != *target_program.key
        || pubkey_at(&data, 76)? != *target_programdata.key
        || read_u64(&data, 108)? != expected_epoch
        || data[116..148].iter().any(|byte| *byte != 0)
        || read_u64(&data, 148)? != 0
        || read_u16(&data, 156)? != 0
        || data[190..192].iter().any(|byte| *byte != 0)
    {
        return Err(BenchmarkError::InvalidGate.into());
    }
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn write_observation(
    observation: &AccountInfo<'_>,
    observation_bump: u8,
    config: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    raw_account_bytes: usize,
    payload_bytes: usize,
    programdata_slot: u64,
    programdata_authority: &Pubkey,
    raw_hash: &Hash,
    observation_digest: &Hash,
    frozen_epoch: u64,
    freeze_slot: u64,
    freeze_reason: u16,
) -> ProgramResult {
    let mut data = observation.try_borrow_mut_data()?;
    if data.len() != OBSERVATION_BYTES {
        return Err(BenchmarkError::ObservationWriteFailed.into());
    }
    data.fill(0);
    data[..8].copy_from_slice(OBSERVATION_DISCRIMINATOR);
    data[8] = ACCOUNT_VERSION;
    data[9] = observation_bump;
    data[10] = 1;
    data[11] = 1; // raw_hash_complete
    data[12..44].copy_from_slice(config.key.as_ref());
    data[44..76].copy_from_slice(target_program.key.as_ref());
    data[76..108].copy_from_slice(target_programdata.key.as_ref());
    data[108..140].copy_from_slice(raw_hash.as_ref());
    data[140..172].copy_from_slice(observation_digest.as_ref());
    data[172..180].copy_from_slice(&(raw_account_bytes as u64).to_le_bytes());
    data[180..188].copy_from_slice(&(payload_bytes as u64).to_le_bytes());
    data[188..196].copy_from_slice(&programdata_slot.to_le_bytes());
    data[196..228].copy_from_slice(programdata_authority.as_ref());
    data[228..236].copy_from_slice(&frozen_epoch.to_le_bytes());
    data[236..244].copy_from_slice(&freeze_slot.to_le_bytes());
    data[244..246].copy_from_slice(&freeze_reason.to_le_bytes());
    Ok(())
}

fn freeze_gate(
    config: &AccountInfo<'_>,
    target_program: &AccountInfo<'_>,
    target_programdata: &AccountInfo<'_>,
    gate: &AccountInfo<'_>,
    frozen_epoch: u64,
    freeze_slot: u64,
    freeze_reason: u16,
) -> ProgramResult {
    let mut data = gate.try_borrow_mut_data()?;
    if data.get(..8) != Some(GATE_DISCRIMINATOR)
        || pubkey_at(&data, 12)? != *config.key
        || pubkey_at(&data, 44)? != *target_program.key
        || pubkey_at(&data, 76)? != *target_programdata.key
    {
        return Err(BenchmarkError::InvalidGate.into());
    }
    data[11] = EMERGENCY_FROZEN_GATE_STATUS;
    data[108..116].copy_from_slice(&frozen_epoch.to_le_bytes());
    data[116..148].fill(0);
    data[148..156].copy_from_slice(&freeze_slot.to_le_bytes());
    data[156..158].copy_from_slice(&freeze_reason.to_le_bytes());
    Ok(())
}

fn pubkey_at(data: &[u8], offset: usize) -> Result<Pubkey, ProgramError> {
    let bytes: [u8; 32] = data
        .get(offset..offset + 32)
        .ok_or(BenchmarkError::MalformedInstruction)?
        .try_into()
        .map_err(|_| BenchmarkError::MalformedInstruction)?;
    Ok(Pubkey::new_from_array(bytes))
}

fn read_u16(data: &[u8], offset: usize) -> Result<u16, ProgramError> {
    let bytes: [u8; 2] = data
        .get(offset..offset + 2)
        .ok_or(BenchmarkError::MalformedInstruction)?
        .try_into()
        .map_err(|_| BenchmarkError::MalformedInstruction)?;
    Ok(u16::from_le_bytes(bytes))
}

fn read_u32(data: &[u8], offset: usize) -> Result<u32, ProgramError> {
    let bytes: [u8; 4] = data
        .get(offset..offset + 4)
        .ok_or(BenchmarkError::MalformedInstruction)?
        .try_into()
        .map_err(|_| BenchmarkError::MalformedInstruction)?;
    Ok(u32::from_le_bytes(bytes))
}

fn read_u64(data: &[u8], offset: usize) -> Result<u64, ProgramError> {
    let bytes: [u8; 8] = data
        .get(offset..offset + 8)
        .ok_or(BenchmarkError::MalformedInstruction)?
        .try_into()
        .map_err(|_| BenchmarkError::MalformedInstruction)?;
    Ok(u64::from_le_bytes(bytes))
}
