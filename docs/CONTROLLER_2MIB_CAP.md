# V3 controller: 2 MiB artifact ceiling and growth-proof upgrade proposals

Status: prepared source candidate exported from source commit
`5ece06e2570b8667e3edc33ec1fd49348ca2c90e` on 2026-10-04. Mainnet deployment
and updated hosted verification are pending. The closed Docker recipe now
reproduces the candidate bytes, as recorded below.

## Why

Amoeba Spread (`2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw`) needs room for
the Earn Fund, but its governing controller rejects any artifact above
1,572,864 B.

An earlier revision of this branch also added council-approved
`ExtendProgramChecked` growth (instructions 10/13) for the time after the
runtime feature `enable_extend_program_checked`
(`2oMRZEDWT2tqtYMofhmmfQ8SsjqUFzT6sYXppQDavxwz`) activated. That feature is
cancelled (checked 2026-10-04): current Agave master replaced its key with the
dead placeholder `ExtendProgCheckedWi11BeDe1eted11111111111111`, and it is not
on the Feature Gate Tracker. The legacy permissionless top-level
`ExtendProgram` stays the way to grow ProgramData. The checked instructions could
never succeed on any cluster, so they were removed. That removal also brings
the controller back under its deployed allocation.

## Live controller identification

- Mainnet controller `8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx`, ProgramData
  `7eW9UXcCDrpEAQ93fP7o2zgGMKhAKi3zJLihELjR8xYd`. The Spread profile
  provenance (`ameba_spread/release/profiles/mainnet-v3-20261003.provenance.json`)
  records the deployed binary as 219,584 B, SHA-256 `e06bf76a…51a8eb`, in a
  223,096 B allocation. Its source is commit `7b5930d`.
- The deployed program is `programs/governance_controller_v3`.
  `programs/upgrade_controller` is the historical Release 1/V2 controller. V3
  only imports its helpers.
- Public `main` currently identifies `7b5930d`. In the private workspace,
  its program tree is identical to `daf85cc`
  (`codex/mainnet-verification-metadata-20260916`), which is `origin/main`
  (`82011c1`) plus the council-gated `PublishVerification` (instruction 16).
  Building `daf85cc` with `cargo-build-sbf` 4.0.0, platform-tools v1.53 and
  `--arch v1 --locked` reproduces `e06bf76a` byte for byte. A build from
  `main` would silently remove instruction 16 from the live controller. This
  branch therefore fast-forwards to `daf85cc` before making its changes.

## Where the old ceiling lived

| Location (at `daf85cc`) | Role |
|---|---|
| `upgrade_controller/src/artifact_merkle.rs:32` `MAX_ARTIFACT_BYTES_V1 = 1_572_864` | The bound; 96 selected chunks (`:38-39`), 128-leaf padding, depth 7 (`:42-43`) |
| `artifact_merkle.rs:56-73,76` | Chunk count and leaf index reject anything past 96 chunks |
| `governance_controller_v3/src/state.rs:349,351` | `Action::validate`: `artifact_length` and `capacity` ≤ bound |
| `state.rs:396,401` | `Proposal.verified_chunks: [u8; 12]` (96 bits), `reserved: [u8; 7]` |
| `processor.rs:99-105` | `complete()` loops `0..96` |
| `processor.rs:706-731` | `VerifyChunk` uses the shared 96-chunk verifier |
| `processor.rs:586-591` | `Create` requires capacity ≥ artifact length |
| `processor.rs:475-477`, `instruction.rs:63` | Tags 10/13 (extension) rejected |
| `clients/ts/upgradeGovernance/governanceV3.ts` | `1_572_864n` action bounds, 12-byte bitmap and 7 reserved bytes in the decoder |
| `clients/ts/tools/devnet-v3-spread-stage.mjs` | Uses the 1.5 MiB Release 1 Merkle helpers |

These consumers are outside this repository and were not changed:

- `ameba_spread/scripts/check_mainnet_release_preparation.py:18`
  (`MAINTAINED_CAPACITY = 1_572_864`) and `release/MAINNET_PREPARATION_CHECK.md`.
- The `ameba_spread/scripts/*-mainnet-ceremony.mjs` loops over 96 bitmap bits.
- `maxArtifactBytes` and `controllerArtifactSha256` in the Spread Mainnet
  profile and provenance.

The 1.5 MiB figure comes from Release 1, which hashed the whole ProgramData in
one transaction. V3 never does that.

## What changed

1. **Bound** (`governance_controller_v3/src/artifact.rs`). This is a new
   V3-local bound: `MAX_ARTIFACT_BYTES = 2_097_152`, which is 128 chunks of
   16 KiB.
   - The Merkle scheme is unchanged: same domains, index-separated canonical
     padding, and a next-power-of-two tree.
   - 128 chunks still pad to 128 leaves, so every proof is still at most seven
     siblings. The `VerifyChunk` wire format is unchanged.
   - Every root that was valid under 1.5 MiB is computed identically. This is
     tested against both the Release 1 code and pinned vectors from an
     independent implementation.
   - `upgrade_controller` and its Release 1 vectors are untouched.
2. **Bitmap** (`state.rs`, `Proposal`). Chunks 96..128 are stored in a new
   field, `verified_chunks_high: [u8; 4]`. It takes the first four of the
   former seven reserved bytes, at offsets 393..397. `reserved` is now
   `[u8; 3]`. `verified_bitmap()`, `mark_chunk_verified()` and validation cover
   all 128 bits. `complete()` loops `0..128`.
3. **No checked extension.** Instructions 10 (`ExtendController`) and 13
   (`ExtendTarget`) stay rejected exactly as in the deployed binary:
   - `Instruction::unpack` rejects tags 10 and 13 with
     `InvalidInstructionData` before Borsh decoding or any account access,
     exactly like the unknown tags 17..=255.
   - The enum variants remain only as positional placeholders, so every later
     tag keeps its Borsh position. The dispatcher arm for them is unreachable
     and also returns `InvalidInstructionData`.
   - History: checked extension was introduced in `f3b7b27`, retired in
     `4e9ae8b` because Devnet rejected the CPI, restored in `fb5f72f`, and is
     now removed again. The controller has no ProgramData growth instruction
     and no `ExtendProgramChecked` CPI.
4. **Create** accepts a capacity snapshot below the artifact length, because
   the snapshot is informational (change 5). Installation still requires the
   live capacity to be at least the artifact length. The TypeScript `createV3`
   still refuses a snapshot below the artifact length, so operators grow
   ProgramData first.
5. **Third-party growth cannot stale or brick proposals.** Anyone can grow
   ProgramData at any time with the legacy top-level `ExtendProgram`, which
   changes its slot and length.
   - **No upper bound on capacity.** The action's capacity is now an
     informational snapshot, so growth past 1.5 MiB or 2 MiB, up to the
     loader's 10 MiB, cannot invalidate any proposal.
   - **Execution ignores ProgramData slot and length.** It does not compare
     them with the snapshot. Ordering comes from:
     - the target gate epoch, which every target install increments;
     - for self-upgrades, `CONTROLLER_RELEASE` (`state.rs`, currently 1). The
       proposal stores it in the eight formerly zero action bytes, and Create
       and execution require it to match the running binary. Installing any
       other release therefore retires every older self-upgrade proposal.
       This includes proposals the deployed controller created, which carry
       release 0.
     - **Release rule:** every future controller release must bump
       `CONTROLLER_RELEASE`.
   - **The installed bytes are exactly the artifact.** Loader-v3 `Upgrade`
     copies the sealed, fully verified buffer and zero-fills every byte after
     it. Whatever length was added, the installed payload is the artifact
     followed by zeros. Scanning those zeros on-chain could itself be griefed
     up to 10 MiB, so the controller relies on the loader for this and tests
     check it.
   - **Residual risk.** Loader-v3 rejects an install in the same slot as an
     extension. A third party can therefore delay execution only by landing an
     extension in every slot, paying each time; this is not a stale proposal.
6. **Execution prologue.** `execute_upgrade` checks the approval, the
   authority and the live capacity inline. One `require` covers both
   "authority is still the expected PDA" and "capacity ≥ artifact length". The
   shared `approved()` helper existed only for the extension instructions and
   was removed.
7. **Client and tools.** `governanceV3.ts` adds:
   - `MAX_ARTIFACT_BYTES_V3`;
   - `CONTROLLER_RELEASE_V3` and `controllerRelease` on `upgradeController`
     actions;
   - a 16-byte logical `verifiedChunks`;
   - `artifactMerkleRootV3` and `artifactMerkleProofV3`.

   `extendControllerV3` and `extendTargetV3` are again the throwing stubs
   they are on `main`. They now point to top-level extension and say that the
   feature was cancelled. `checkedExtensionsRemainingV3`,
   `MAX_CHECKED_EXTENSION_BYTES_V3` and the `checkedExtension` option of
   `createV3` are gone.

   The Devnet V3 stage tool uses the V3 Merkle helpers. Before
   `execute-controller`, it asserts that the live controller capacity covers
   the artifact (growth is its separate `extend-top-level` stage). CI rebuilds
   the deployed controller from `daf85cc`, checks its hash, and runs the
   upgrade rehearsal against it.

## Layout compatibility verdict

**No migration is needed. Existing on-chain state stays readable.**

- The proposal is still 400 B, and every existing field keeps its offset. The
  deployed controller required all seven reserved bytes to be zero, so every
  existing proposal decodes with an empty high bitmap and validates unchanged.
- `extension_slot` and `extended_capacity` keep their offsets and validation.
  Nothing writes them, so they stay zero on new proposals.
- `Config` (384 B) and the gate (192 B) are untouched.
- The controller-upgrade action's last eight bytes (always zero before) now
  hold the release, so deployed-binary proposals read as release 0.
- The proposal digest covers the action, not the bitmap. It is unchanged, and
  the pinned vector `f41ce0bf…` still matches.
- This was rehearsed as actual SBF:
  1. The deployed `e06bf76a` controller creates and half-verifies a target
     proposal, approves a rival self-upgrade, then installs this controller
     into its existing 223,096 B allocation without any extension.
  2. Restarted on the installed bytes, this controller rejects the rival
     self-upgrade (release 0).
  3. After a third party grows the target by one byte, it finishes the old
     target proposal and installs it.
- **ProgramTest caveat.** After a CPI upgrade, a later warp makes ProgramTest
  keep running the genesis ELF, so the rehearsal reloads the bank to run the
  installed binary.
- **Rollback.** If the old binary is reinstalled, it rejects any proposal that
  set a bit at or above 96. This fails closed.
- **Off-chain decoders.** An old decoder (the old `governanceV3.js`, Spread
  copies or ceremony scripts) also rejects such proposals. Update these before
  creating any proposal above 1,572,864 B.

## ProgramData growth

- `enable_extend_program_checked` is cancelled (placeholder key above). Legacy
  `ExtendProgram` therefore keeps working:
  - it is permissionless, so anyone can pay for it and no signature is needed;
  - it is top-level only, because a program can never call it through CPI.
- The controller therefore needs no growth instruction. Spread and the
  controller both grow with a top-level `solana program extend <program>
  <bytes>`.
- **Test note.** The pinned ProgramTest 2.3.13 still knows the old feature id
  and activates every feature by default, so each `two_mib_sbf` bank
  deactivates it to match real clusters.

## Size and compute

The artifact is **219,928 B**, SHA-256
`1442c507f6f40f666e4191d767f8a892d61ddf73c82ab80da593c611c7312780`.

- Build: v1, `cargo-build-sbf` 4.0.0, platform-tools v1.53, rustc 1.89.0,
  `--locked`.
- Reproduced byte for byte by two clean builds from `git archive` of the
  committed tree, each with its own `CARGO_TARGET_DIR`.
- It is 344 B larger than the deployed binary.
- It fits the deployed **223,096 B allocation with 3,168 B to spare**, so the
  controller's ProgramData needs no extension.

Size history:

| Variant | Size |
|---|---|
| Deployed `e06bf76a` (`daf85cc`) | 219,584 B |
| With checked extension (`db74d0b`) | 224,776 B |
| Extension instructions removed, shared prologue kept | 220,288 B |
| This change (prologue inlined) | **219,928 B** |

Measured compute at 2 MiB (ProgramTest, real Loader-v3):

| Instruction | Compute units |
|---|---|
| `Create` | 43.7k |
| `VerifyChunk` | ≤ 47.9k per chunk |
| `Approve` (128-bit `complete()`) | ≤ 37.2k |
| `ExecuteTargetUpgrade` | 112k |

The 1.4M budget leaves ample margin. The verifier borrows each chunk from the
buffer. The largest heap use is a 2 KiB padding subtree, and no new large stack
frames were added.

## Deployment (controller self-upgrade through its 3-of-5 council)

1. Rebuild the commit reproducibly and confirm the size and hash above. The
   controller's ProgramData is not extended.
2. Write the ELF to a new buffer with the uploader as its authority, then
   confirm the buffer bytes.
3. A seat creates an `UPGRADE_CONTROLLER` action. It contains:
   - `controllerRelease: 0n`, because the deployed binary requires those bytes
     to be zero;
   - the buffer, the length (219,928) and the SHA-256;
   - `artifactMerkleRootV3`;
   - the finalized deployed slot and capacity (223,096);
   - source and build commitments.

   The deployed controller validates this against its own 1.5 MiB bound and
   requires capacity ≥ length.
4. The uploader seals the buffer (tag 2). Anyone verifies its 14 chunks
   (tag 3).
5. Three seats approve (tag 4) within the live approval window. Read
   `Config.timing`.
6. After `not_before`, anyone runs `ExecuteControllerUpgrade` (tag 8). The
   transaction holds only this instruction, plus at most two ComputeBudget
   prefixes.
   - The deployed binary still compares ProgramData slot and capacity with
     the snapshot. A third-party extension of the controller before this step
     stales the proposal. Recreate it with a fresh snapshot.
7. Check the result:
   - the ProgramData hash and payload;
   - the authority is still the authority PDA;
   - pending proposals still decode;
   - instruction 16 still works.

   Then update the Spread profile's `controllerArtifactSha256`, `maxArtifactBytes`,
   checker and ceremony scripts through the Spread review. Optionally publish
   verification metadata (action 6).

## Ordering relative to the Spread upgrade

1. Upgrade the controller (above), then update the off-chain decoders and
   ceremony scripts.
2. Grow Spread's ProgramData to at least the new artifact length with a
   top-level `solana program extend 2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw
   <bytes>`.
   - The call is permissionless. Rent is about 6,960 lamports per byte.
   - The new controller only needs this before installation. `createV3`
     requires the snapshot to cover the artifact, so do it before creating the
     proposal.
3. Run the existing freeze, upgrade and activate ceremony.

Do not extend Spread past 1,572,864 B before the controller upgrade lands. The
deployed controller still has the old bound and would refuse every Spread
upgrade proposal; this controller has no such bound.

## Risks

- **Griefing under the deployed controller, until this controller lands.**
  Anyone can call legacy `ExtendProgram` on Spread or the controller.
  - One byte stales every pending upgrade proposal for that program.
  - Growth past 1,572,864 B blocks every future proposal for that program.
    That costs about 0.8 SOL for Spread and about 9.4 SOL for the controller,
    and for the controller it is unrecoverable.

  This controller removes both risks (change 5). Only a per-slot delay of
  execution remains.
- **Release discipline.** Two controller binaries with the same
  `CONTROLLER_RELEASE` would not retire each other's self-upgrade proposals.
- **Stale off-chain consumers.** These fail closed on proposals with chunks at
  or above 96, or miss those chunks.
- **Tests run for this change (minimal set).** All of these ran against the
  219,928 B artifact and passed:
  - host tests for the crate (`core`, `artifact_cap`, including the
    retired-tag checks) and clippy with `-D warnings`;
  - actual SBF in a private network namespace:
    - `two_mib_sbf`, all five tests: 128 chunks at 2 MiB; install after legacy
      growth while tags 10/13 fail; controller self-upgrade after legacy
      growth; third-party growth; the deployed-to-new rehearsal;
    - `self_upgrade` and `target_upgrade`;
  - TypeScript `typecheck`, `governanceV3`, `governanceV3Cap` and
    `verificationMetadataV3`.

  Not run in this pass:
  - `spread_gate` and `spread_light_config`, which need the Spread integration
    fixture (`amoeba-program@bed4551`);
  - the Otter `verification_metadata` SBF test.

  None of them touches the changed paths.
- **Build hash.** On 2026-10-04, the closed verification recipe reproduced
  the 219,928 B candidate exactly: SHA-256
  `1442c507f6f40f666e4191d767f8a892d61ddf73c82ab80da593c611c7312780`.
  The build used solana-verify 0.5.1, the image pinned in `verification.rs`,
  library `governance_controller_v3`, and `--arch v1`; no additional Cargo
  arguments or tool overrides were supplied. Its normalized executable hash
  is `d94509fe0c18d32d4eab18c49942dee769984c78a5688ae8d8db75555bccb0cd`.
  This establishes candidate reproducibility. Deployment and a subsequent
  hosted verification of the published commit remain separate operations.
