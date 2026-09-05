use crate::{instruction::Instruction, state::*};
use solana_loader_v3_interface::instruction::{
    close, extend_program_checked, set_buffer_authority_checked, set_upgrade_authority_checked,
    upgrade,
};
use solana_program::{
    account_info::AccountInfo,
    clock::Clock,
    program::invoke_signed,
    program_error::ProgramError,
    pubkey::Pubkey,
    rent::Rent,
    sysvar::{instructions, Sysvar},
};
use solana_sdk_ids::{
    bpf_loader_upgradeable::ID as LOADER, compute_budget, system_program, sysvar,
};
use upgrade_controller::{
    artifact_merkle::{
        artifact_chunk_count, verify_artifact_chunk_proof, RELEASE1_ARTIFACT_CHUNK_SIZE_V1 as CHUNK,
    },
    release1_account_io::{
        create_fixed_pda_account, load_fixed_controller_account, require_distinct_accounts,
        store_fixed_controller_account, validate_exact_privileges,
    },
    release1_loader_accounts::{validate_buffer_account, validate_program_programdata_linkage},
};

fn privileges(account: &AccountInfo<'_>, write: bool, sign: bool, executable: bool) -> Result<()> {
    validate_exact_privileges(account, write, sign, executable)
}
fn readonly(account: &AccountInfo<'_>) -> Result<()> {
    privileges(account, false, false, false)
}
fn writable(account: &AccountInfo<'_>) -> Result<()> {
    privileges(account, true, false, false)
}
fn signer(account: &AccountInfo<'_>) -> Result<()> {
    privileges(account, false, true, false)
}
fn executable(account: &AccountInfo<'_>, key: &Pubkey) -> Result<()> {
    privileges(account, false, false, true)?;
    require(account.key == key, Error::InvalidAccount)
}
fn config(program: &Pubkey, info: &AccountInfo<'_>) -> Result<Box<Config>> {
    let value: Box<Config> = load_fixed_controller_account(program, info, CONFIG_LEN)?;
    value.validate(program, info.key)?;
    Ok(value)
}
fn proposal(
    program: &Pubkey,
    info: &AccountInfo<'_>,
    digest: Option<[u8; 32]>,
) -> Result<Box<Proposal>> {
    let value: Box<Proposal> = load_fixed_controller_account(program, info, PROPOSAL_LEN)?;
    value.validate(program, info.key)?;
    require(
        digest.is_none_or(|hash| hash == value.digest),
        Error::StaleProposal,
    )?;
    Ok(value)
}
fn seat(config: &Config, info: &AccountInfo<'_>) -> Result<usize> {
    signer(info)?;
    config
        .seats
        .iter()
        .position(|key| key == info.key)
        .ok_or(Error::Unauthorized.into())
}
fn save_proposal(program: &Pubkey, info: &AccountInfo<'_>, value: &Proposal) -> Result<()> {
    value.validate(program, info.key)?;
    store_fixed_controller_account(program, info, value, PROPOSAL_LEN)
}
fn clock() -> Result<u64> {
    let slot = Clock::get()?.slot;
    require(slot > 0, Error::InvalidTiming)?;
    Ok(slot)
}
fn sealed(
    program: &Pubkey,
    proposal_key: &Pubkey,
    buffer: &AccountInfo<'_>,
    action: &Upgrade,
) -> Result<()> {
    let header = validate_buffer_account(buffer, &LOADER)?;
    require(
        *buffer.key == action.buffer
            && header.payload_length as u64 == action.artifact_length
            && header.authority == Some(buffer_authority_pda(program, proposal_key).0),
        Error::InvalidArtifact,
    )
}
fn complete(proposal: &Proposal) -> Result<()> {
    let action = proposal.action.upgrade()?;
    let chunks = artifact_chunk_count(action.artifact_length, CHUNK)?;
    require(proposal.verified_count == chunks, Error::InvalidArtifact)?;
    for index in 0..96 {
        let set = proposal.verified_chunks[index / 8] & (1 << (index % 8)) != 0;
        require(set == (index < chunks as usize), Error::InvalidArtifact)?;
    }
    Ok(())
}

pub fn process(program: &Pubkey, accounts: &[AccountInfo<'_>], data: &[u8]) -> Result<()> {
    let instruction = Instruction::unpack(data)?;
    require_distinct_accounts(&accounts.iter().collect::<Vec<_>>())?;
    match instruction {
        Instruction::Initialize { seats, treasury } => {
            initialize(program, accounts, seats, treasury)
        }
        Instruction::Create {
            expected_id,
            action,
        } => create(program, accounts, expected_id, action),
        Instruction::SealBuffer { digest } => seal(program, accounts, digest),
        Instruction::VerifyChunk {
            digest,
            index,
            proof_len,
            proof,
        } => verify(program, accounts, digest, index, proof_len, proof),
        Instruction::Approve { digest } => approve(program, accounts, digest, false),
        Instruction::Cancel { digest } => approve(program, accounts, digest, true),
        Instruction::Expire => expire(program, accounts),
        Instruction::ExecutePolicy { digest } => execute_policy(program, accounts, digest),
        Instruction::ExecuteControllerUpgrade { digest } => {
            execute_upgrade(program, accounts, digest, data)
        }
        Instruction::CloseBuffer { digest } => close_buffer(program, accounts, digest),
        Instruction::ExtendController { digest } => {
            extend_controller(program, accounts, digest, data)
        }
    }
}

/// Initial deployment authority and any three chosen seats consent atomically.
/// The bootstrap transaction leaves ProgramData controlled by this council's PDA.
fn initialize(
    program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    seats: [Pubkey; 5],
    treasury: Pubkey,
) -> Result<()> {
    let [payer, deployer, controller, programdata, config_info, authority, loader, system, a, b, c] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    privileges(payer, true, true, false)?;
    signer(deployer)?;
    executable(controller, program)?;
    writable(programdata)?;
    writable(config_info)?;
    readonly(authority)?;
    executable(loader, &LOADER)?;
    executable(system, &system_program::ID)?;
    let (config_key, bump) = config_pda(program);
    let (authority_key, authority_bump) = authority_pda(program);
    require(
        *config_info.key == config_key
            && *authority.key == authority_key
            && *programdata.key == Pubkey::find_program_address(&[program.as_ref()], &LOADER).0,
        Error::InvalidAccount,
    )?;
    let header = validate_program_programdata_linkage(controller, programdata, &LOADER)?;
    require(
        header.upgrade_authority == Some(*deployer.key),
        Error::Unauthorized,
    )?;
    let value = Config {
        discriminator: *b"AG3CFG01",
        version: 1,
        bump,
        initialized: true,
        controller: *program,
        programdata: *programdata.key,
        authority: authority_key,
        treasury,
        seats,
        council_epoch: 1,
        timing_version: 1,
        timing: Timing::default(),
        next_id: 1,
        reserved: [0; 37],
    };
    value.validate(program, config_info.key)?;
    require(
        treasury != *config_info.key && treasury != *programdata.key && treasury != *controller.key,
        Error::InvalidAccount,
    )?;
    for signer_info in [a, b, c] {
        seat(&value, signer_info)?;
    }
    create_fixed_pda_account(
        program,
        payer,
        config_info,
        system,
        &Rent::get()?,
        CONFIG_LEN,
        &[DOMAIN, b"council", &[bump]],
    )?;
    store_fixed_controller_account(program, config_info, &value, CONFIG_LEN)?;
    invoke_signed(
        &set_upgrade_authority_checked(program, deployer.key, authority.key),
        &[
            programdata.clone(),
            deployer.clone(),
            authority.clone(),
            loader.clone(),
        ],
        &[&[DOMAIN, b"authority", &[authority_bump]]],
    )?;
    let after = validate_program_programdata_linkage(controller, programdata, &LOADER)?;
    require(
        after.upgrade_authority == Some(authority_key)
            && after.capacity == header.capacity
            && after.deployed_slot == header.deployed_slot,
        Error::InvalidAccount,
    )
}

fn create(
    program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    expected_id: u64,
    action: Action,
) -> Result<()> {
    let [payer, creator, config_info, proposal_info, system] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    privileges(payer, true, true, false)?;
    writable(config_info)?;
    writable(proposal_info)?;
    executable(system, &system_program::ID)?;
    let mut config = config(program, config_info)?;
    seat(&config, creator)?;
    action.validate()?;
    if action.kind == ROTATE_COUNCIL {
        require(
            !action.seats()?.contains(&config.authority),
            Error::InvalidCouncil,
        )?;
    }
    require(config.next_id == expected_id, Error::StaleProposal)?;
    let (key, bump) = proposal_pda(program, expected_id);
    require(*proposal_info.key == key, Error::InvalidAccount)?;
    let next = add(expected_id, 1)?;
    let created = clock()?;
    let (review_end, not_before, expires) = config.timing.boundaries(created)?;
    let mut value = Proposal {
        discriminator: *b"AG3PRP01",
        version: 1,
        bump,
        initialized: true,
        config: *config_info.key,
        id: expected_id,
        council_epoch: config.council_epoch,
        timing_version: config.timing_version,
        timing: config.timing,
        created,
        review_end,
        not_before,
        expires,
        action,
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
    value.digest = value.compute_digest(program)?;
    value.validate(program, proposal_info.key)?;
    create_fixed_pda_account(
        program,
        payer,
        proposal_info,
        system,
        &Rent::get()?,
        PROPOSAL_LEN,
        &[DOMAIN, b"proposal", &expected_id.to_le_bytes(), &[bump]],
    )?;
    save_proposal(program, proposal_info, &value)?;
    config.next_id = next;
    store_fixed_controller_account(program, config_info, &*config, CONFIG_LEN)
}

fn seal(program: &Pubkey, accounts: &[AccountInfo<'_>], digest: [u8; 32]) -> Result<()> {
    let [config_info, proposal_info, buffer, uploader, buffer_authority, loader] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    readonly(config_info)?;
    readonly(proposal_info)?;
    writable(buffer)?;
    signer(uploader)?;
    readonly(buffer_authority)?;
    executable(loader, &LOADER)?;
    let config = config(program, config_info)?;
    let p = proposal(program, proposal_info, Some(digest))?;
    p.current(&config, clock()?)?;
    let action = p.action.upgrade()?;
    let (authority, bump) = buffer_authority_pda(program, proposal_info.key);
    let header = validate_buffer_account(buffer, &LOADER)?;
    require(
        *buffer_authority.key == authority
            && *buffer.key == action.buffer
            && header.authority == Some(*uploader.key)
            && header.payload_length as u64 == action.artifact_length
            && p.approvals == 0
            && p.verified_count == 0,
        Error::InvalidArtifact,
    )?;
    invoke_signed(
        &set_buffer_authority_checked(buffer.key, uploader.key, buffer_authority.key),
        &[
            buffer.clone(),
            uploader.clone(),
            buffer_authority.clone(),
            loader.clone(),
        ],
        &[&[DOMAIN, b"buffer", proposal_info.key.as_ref(), &[bump]]],
    )?;
    sealed(program, proposal_info.key, buffer, &action)
}

fn verify(
    program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    digest: [u8; 32],
    index: u32,
    proof_len: u8,
    proof: [[u8; 32]; 7],
) -> Result<()> {
    let [config_info, proposal_info, buffer] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    readonly(config_info)?;
    writable(proposal_info)?;
    readonly(buffer)?;
    let config = config(program, config_info)?;
    let mut p = proposal(program, proposal_info, Some(digest))?;
    p.current(&config, clock()?)?;
    let action = p.action.upgrade()?;
    sealed(program, proposal_info.key, buffer, &action)?;
    let count = artifact_chunk_count(action.artifact_length, CHUNK)?;
    require(
        index < count
            && proof_len <= 7
            && proof[usize::from(proof_len)..]
                .iter()
                .all(|v| *v == [0; 32]),
        Error::InvalidArtifact,
    )?;
    let byte = index as usize / 8;
    let bit = 1 << (index % 8);
    require(p.verified_chunks[byte] & bit == 0, Error::DuplicateApproval)?;
    let start = 37 + index as usize * CHUNK as usize;
    let end = (start + CHUNK as usize).min(37 + action.artifact_length as usize);
    {
        let bytes = buffer.try_borrow_data()?;
        verify_artifact_chunk_proof(
            &action.merkle_root,
            action.artifact_length,
            CHUNK,
            index,
            &bytes[start..end],
            &proof[..usize::from(proof_len)],
        )?;
    }
    p.verified_chunks[byte] |= bit;
    p.verified_count += 1;
    save_proposal(program, proposal_info, &p)
}

fn approve(
    program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    digest: [u8; 32],
    cancel: bool,
) -> Result<()> {
    let [config_info, proposal_info, seat_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    readonly(config_info)?;
    writable(proposal_info)?;
    let config = config(program, config_info)?;
    let mut p = proposal(program, proposal_info, Some(digest))?;
    let slot = clock()?;
    p.current(&config, slot)?;
    let index = seat(&config, seat_info)?;
    if !cancel && p.action.kind == UPGRADE_CONTROLLER {
        complete(&p)?;
    }
    p.approve(index, slot, cancel)?;
    save_proposal(program, proposal_info, &p)
}

fn expire(program: &Pubkey, accounts: &[AccountInfo<'_>]) -> Result<()> {
    let [proposal_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    writable(proposal_info)?;
    let mut p = proposal(program, proposal_info, None)?;
    require(
        p.state == PENDING && clock()? >= p.expires,
        Error::WrongState,
    )?;
    p.state = EXPIRED;
    save_proposal(program, proposal_info, &p)
}

fn execute_policy(program: &Pubkey, accounts: &[AccountInfo<'_>], digest: [u8; 32]) -> Result<()> {
    let [config_info, proposal_info] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    writable(config_info)?;
    writable(proposal_info)?;
    let mut config = config(program, config_info)?;
    let mut p = proposal(program, proposal_info, Some(digest))?;
    let slot = clock()?;
    p.executable(&config, slot)?;
    match p.action.kind {
        SET_TIMING => {
            // Concurrent proposals cannot silently overwrite a policy selected later.
            require(
                p.timing_version == config.timing_version,
                Error::StaleProposal,
            )?;
            config.timing = p.action.timing()?;
            config.timing_version = add(config.timing_version, 1)?;
        }
        ROTATE_COUNCIL => {
            config.seats = p.action.seats()?;
            config.council_epoch = add(config.council_epoch, 1)?;
        }
        _ => return Err(ProgramError::InvalidInstructionData),
    }
    config.validate(program, config_info.key)?;
    p.state = EXECUTED;
    p.executed_slot = slot;
    save_proposal(program, proposal_info, &p)?;
    store_fixed_controller_account(program, config_info, &*config, CONFIG_LEN)
}

/// Only bounded ComputeBudget prefixes and this exact top-level instruction.
fn envelope(
    program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    info: &AccountInfo<'_>,
    data: &[u8],
) -> Result<()> {
    readonly(info)?;
    require(*info.key == instructions::ID, Error::InvalidEnvelope)?;
    let index = usize::from(instructions::load_current_index_checked(info)?);
    let count = {
        let bytes = info.try_borrow_data()?;
        let first: [u8; 2] = bytes
            .get(..2)
            .ok_or(Error::InvalidEnvelope)?
            .try_into()
            .map_err(|_| Error::InvalidEnvelope)?;
        usize::from(u16::from_le_bytes(first))
    };
    require(count == index + 1 && index <= 2, Error::InvalidEnvelope)?;
    let current = instructions::load_instruction_at_checked(index, info)?;
    require(
        current.program_id == *program
            && current.data == data
            && current.accounts.len() == accounts.len(),
        Error::InvalidEnvelope,
    )?;
    for (meta, account) in current.accounts.iter().zip(accounts) {
        require(
            meta.pubkey == *account.key
                && meta.is_signer == account.is_signer
                && meta.is_writable == account.is_writable,
            Error::InvalidEnvelope,
        )?;
    }
    let mut seen = 0u8;
    for n in 0..index {
        let ix = instructions::load_instruction_at_checked(n, info)?;
        require(
            ix.program_id == compute_budget::ID && ix.accounts.is_empty(),
            Error::InvalidEnvelope,
        )?;
        let bit = match ix.data.as_slice() {
            [2, a, b, c, d] if u32::from_le_bytes([*a, *b, *c, *d]) <= 1_400_000 => 1,
            [3, a, b, c, d, e, f, g, h]
                if u64::from_le_bytes([*a, *b, *c, *d, *e, *f, *g, *h]) <= 100_000 =>
            {
                2
            }
            _ => return Err(Error::InvalidEnvelope.into()),
        };
        require(seen & bit == 0, Error::InvalidEnvelope)?;
        seen |= bit;
    }
    Ok(())
}

fn execute_upgrade(
    program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    digest: [u8; 32],
    data: &[u8],
) -> Result<()> {
    let [config_info, proposal_info, controller, programdata, buffer, treasury, authority, buffer_authority, loader, rent, clock_info, ixs] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    readonly(config_info)?;
    writable(proposal_info)?;
    privileges(controller, true, false, true)?;
    for info in [programdata, buffer, treasury] {
        writable(info)?;
    }
    for info in [authority, buffer_authority, rent, clock_info] {
        readonly(info)?;
    }
    executable(loader, &LOADER)?;
    envelope(program, accounts, ixs, data)?;
    let config = config(program, config_info)?;
    let mut p = proposal(program, proposal_info, Some(digest))?;
    let slot = clock()?;
    p.executable(&config, slot)?;
    complete(&p)?;
    let action = p.action.upgrade()?;
    let (authority_key, authority_bump) = authority_pda(program);
    let (buffer_key, buffer_bump) = buffer_authority_pda(program, proposal_info.key);
    require(
        *controller.key == *program
            && *programdata.key == config.programdata
            && *treasury.key == config.treasury
            && *authority.key == authority_key
            && *buffer_authority.key == buffer_key
            && *rent.key == sysvar::rent::ID
            && *clock_info.key == sysvar::clock::ID,
        Error::InvalidAccount,
    )?;
    let before = validate_program_programdata_linkage(controller, programdata, &LOADER)?;
    require(
        before.upgrade_authority == Some(authority_key)
            && before.deployed_slot
                == if p.extension_slot == 0 {
                    action.deployed_slot
                } else {
                    p.extension_slot
                }
            && before.capacity as u64
                == if p.extension_slot == 0 {
                    action.capacity
                } else {
                    p.extended_capacity
                }
            && before.capacity as u64 >= action.artifact_length
            && slot > before.deployed_slot,
        Error::StaleProposal,
    )?;
    sealed(program, proposal_info.key, buffer, &action)?;
    let authority_seeds: &[&[u8]] = &[DOMAIN, b"authority", &[authority_bump]];
    let buffer_seeds: &[&[u8]] = &[
        DOMAIN,
        b"buffer",
        proposal_info.key.as_ref(),
        &[buffer_bump],
    ];
    // Both CPIs are fixed Loader-v3 instructions. The buffer-authority change
    // and code installation roll back together if either fails.
    invoke_signed(
        &set_buffer_authority_checked(buffer.key, buffer_authority.key, authority.key),
        &[
            buffer.clone(),
            buffer_authority.clone(),
            authority.clone(),
            loader.clone(),
        ],
        &[buffer_seeds, authority_seeds],
    )?;
    invoke_signed(
        &upgrade(program, buffer.key, authority.key, treasury.key),
        &[
            programdata.clone(),
            controller.clone(),
            buffer.clone(),
            treasury.clone(),
            rent.clone(),
            clock_info.clone(),
            authority.clone(),
            loader.clone(),
        ],
        &[authority_seeds],
    )?;
    let after = validate_program_programdata_linkage(controller, programdata, &LOADER)?;
    require(
        after.upgrade_authority == Some(authority_key)
            && after.deployed_slot == slot
            && after.capacity == before.capacity,
        Error::InvalidArtifact,
    )?;
    p.state = EXECUTED;
    p.executed_slot = slot;
    save_proposal(program, proposal_info, &p)
}

/// Grow only toward the approved artifact, in CPI-safe increments. Loader-v3
/// changes the deployment slot on extension, so installation is a later transaction.
fn extend_controller(
    program: &Pubkey,
    accounts: &[AccountInfo<'_>],
    digest: [u8; 32],
    data: &[u8],
) -> Result<()> {
    let [config_info, proposal_info, controller, programdata, authority, loader, system, payer, ixs] =
        accounts
    else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    readonly(config_info)?;
    writable(proposal_info)?;
    privileges(controller, true, false, true)?;
    writable(programdata)?;
    writable(authority)?;
    executable(loader, &LOADER)?;
    executable(system, &system_program::ID)?;
    privileges(payer, true, true, false)?;
    envelope(program, accounts, ixs, data)?;
    let config = config(program, config_info)?;
    let mut p = proposal(program, proposal_info, Some(digest))?;
    let slot = clock()?;
    p.executable(&config, slot)?;
    complete(&p)?;
    let action = p.action.upgrade()?;
    let (key, bump) = authority_pda(program);
    require(
        *controller.key == *program
            && *programdata.key == config.programdata
            && *authority.key == key,
        Error::InvalidAccount,
    )?;
    let before = validate_program_programdata_linkage(controller, programdata, &LOADER)?;
    let expected_slot = if p.extension_slot == 0 {
        action.deployed_slot
    } else {
        p.extension_slot
    };
    let expected_capacity = if p.extension_slot == 0 {
        action.capacity
    } else {
        p.extended_capacity
    };
    require(
        before.upgrade_authority == Some(key)
            && before.deployed_slot == expected_slot
            && before.capacity as u64 == expected_capacity
            && slot > expected_slot
            && expected_capacity < action.artifact_length,
        Error::StaleProposal,
    )?;
    let delta = (action.artifact_length - expected_capacity).min(10_240) as u32;
    invoke_signed(
        &extend_program_checked(program, authority.key, Some(payer.key), delta),
        &[
            programdata.clone(),
            controller.clone(),
            authority.clone(),
            system.clone(),
            payer.clone(),
            loader.clone(),
        ],
        &[&[DOMAIN, b"authority", &[bump]]],
    )?;
    let after = validate_program_programdata_linkage(controller, programdata, &LOADER)?;
    require(
        after.upgrade_authority == Some(key)
            && after.deployed_slot == slot
            && after.capacity as u64 == expected_capacity + u64::from(delta),
        Error::InvalidArtifact,
    )?;
    p.extension_slot = slot;
    p.extended_capacity = after.capacity as u64;
    save_proposal(program, proposal_info, &p)
}

fn close_buffer(program: &Pubkey, accounts: &[AccountInfo<'_>], digest: [u8; 32]) -> Result<()> {
    let [config_info, proposal_info, buffer, treasury, buffer_authority, loader] = accounts else {
        return Err(ProgramError::NotEnoughAccountKeys);
    };
    readonly(config_info)?;
    readonly(proposal_info)?;
    writable(buffer)?;
    writable(treasury)?;
    readonly(buffer_authority)?;
    executable(loader, &LOADER)?;
    let config = config(program, config_info)?;
    let p = proposal(program, proposal_info, Some(digest))?;
    require(matches!(p.state, CANCELLED | EXPIRED), Error::WrongState)?;
    let action = p.action.upgrade()?;
    sealed(program, proposal_info.key, buffer, &action)?;
    let (key, bump) = buffer_authority_pda(program, proposal_info.key);
    require(
        *buffer_authority.key == key && *treasury.key == config.treasury,
        Error::InvalidAccount,
    )?;
    invoke_signed(
        &close(buffer.key, treasury.key, buffer_authority.key),
        &[
            buffer.clone(),
            treasury.clone(),
            buffer_authority.clone(),
            loader.clone(),
        ],
        &[&[DOMAIN, b"buffer", proposal_info.key.as_ref(), &[bump]]],
    )?;
    require(buffer.lamports() == 0, Error::InvalidArtifact)
}
