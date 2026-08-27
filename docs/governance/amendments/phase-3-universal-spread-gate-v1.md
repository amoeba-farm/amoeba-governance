# Amoeba Governance Phase 3
## Universal `ameba_spread` Gate, Signed Epoch Binding, Client Migration, and Exhaustive Tag Proof

**Status:** Agent implementation specification  
**Date:** 2026-08-26  
**Governance repository:** `SPACE999978/ameba_gov`  
**Governance baseline:** `main` at `da12ead467426afb7fe06c3048e0687094ab5da5`  
**Target repository:** `SPACE999978/ameba_spread`  
**Target baseline:** `main` at `1b2230d96e51f6582155d8284900fbfc11ff1f18`  
**Target program:** `9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH`  
**Deployment authority:** None. This phase does not authorize deployment, live signing, production keys, ProgramData authority transfer, gate initialization on a live cluster, or service mutation.

---

# 1. Authority and document precedence

Read the following documents completely before changing either repository:

1. `ameba_gov/docs/governance/upgrade-governance-spec.md`
2. `ameba_gov/docs/governance/amendments/phase-2-bootstrap-v1.md`
3. This Phase 3 specification

Create byte-identical copies of this specification at:

```text
ameba_gov/docs/governance/amendments/phase-3-universal-spread-gate-v1.md
ameba_spread/docs/governance/phase-3-universal-spread-gate-v1.md
```

Record the exact byte length and SHA-256 in both Phase 3 reports.

This Phase 3 specification supersedes earlier phase numbering and any earlier instruction that prohibited modifying `ameba_spread`. It does **not** supersede the Bootstrap V1 council model:

- five equal, unclassified seat authorities;
- ordinary quorum 3-of-5;
- terminal target-immutability quorum 4-of-5;
- token governance mechanically disabled.

The original architecture remains authoritative for:

- the separate controller trust root;
- the canonical controller-owned target gate;
- exact artifact commitments;
- Loader-v3 isolation;
- freeze and epoch behavior;
- compressed-state account preservation;
- eventual authority handoff.

---

# 2. Phase 3 objective

Phase 3 must make this target-side invariant mechanically true in a non-production bridge candidate:

> Every recognized state-changing top-level `ameba_spread` instruction is admitted only when the signed instruction data binds the current gate epoch and the absolute final account is the one canonical active `ProtocolGateV1` owned by the pinned controller program.

Equivalent admission predicate:

\[
\operatorname{Admit}(I,A,G)
=
\operatorname{KnownMutator}(I_0)
\land
\operatorname{CanonicalTail}(I)
\land
\operatorname{CanonicalGate}(A_{last})
\land
G.status=\mathrm{Active}
\land
I.expected\_epoch=G.epoch
\]

After the governance envelope is validated, the existing business handler must receive exactly the instruction payload and business-account slice that it received before governance integration.

Phase 3 includes:

1. a mechanically complete target instruction manifest;
2. the fixed 16-byte signed epoch tail;
3. a fixed target-side `ProtocolGateV1` decoder;
4. central dispatcher enforcement;
5. a private unforgeable `GateValidated` execution capability;
6. compressed outer-tail integration;
7. TypeScript client and builder migration;
8. exhaustive tag, gate, concurrency, stale-epoch, SBF, and packet tests;
9. CI and release-safety updates;
10. a documented future bridge cutover plan.

Phase 3 does **not** implement the full controller lifecycle. Proposal creation, buffer adoption, timelock, freeze instructions, checkpoints, unfreeze, cancellation, recovery, loader CPI, deployment, and authority handoff remain later phases.

---

# 3. Required repository preflight

## 3.1 Verify exact remote baselines

Fetch both remotes and prove:

```text
SPACE999978/ameba_gov main
= da12ead467426afb7fe06c3048e0687094ab5da5

SPACE999978/ameba_spread main
= 1b2230d96e51f6582155d8284900fbfc11ff1f18
```

Verify each starting worktree and index is clean.

Stop and report if either baseline differs materially. Do not silently rebase the specification onto a later target.

## 3.2 Isolated branches

Use separate reviewable branches or worktrees:

```text
ameba_gov:
  codex/phase3-gate-abi

ameba_spread:
  codex/phase3-universal-gate
```

Do not work directly on `main`.

## 3.3 Repository-protection preflight

The implementation agent may add workflow files but must not mutate repository settings unless separately authorized.

Add CI to `ameba_gov` before later trust-root work. At minimum it must run:

```text
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release
TypeScript typecheck and tests
SBPF-v0 build and diagnostic scan
SBPF-v2 build and diagnostic scan
fixture drift checks
```

Extend the existing `ameba_spread` CI with a separate governance-bridge job.

The final report must recommend enabling branch protection on both `main` branches with:

- pull requests required;
- required CI checks;
- force pushes disabled;
- branch deletion disabled;
- at least one review before merge.

Do not make commit signing a consensus rule. Recommend signed release tags and artifact attestations before deployment.

---

# 4. Hard safety boundary

Do not:

- deploy either program;
- initialize a gate on Mainnet, Devnet, or a shared validator;
- create, import, request, or use production keypairs;
- assign or claim a final production controller program ID;
- transfer ProgramData or buffer authority;
- implement a live freeze or unfreeze instruction;
- add Loader-v3 CPI;
- mutate release intent, live configuration, services, Edge, automation, or frontend;
- add a legacy ungated fallback;
- make a network RPC write;
- use a synthetic controller identity in a production release artifact;
- claim Phase 3 is production-ready governance.

Only local, isolated test-validator or ProgramTest activity using synthetic identities is authorized.

---

# 5. Current source facts that Phase 3 must preserve

At the target baseline:

- the program reads the first instruction byte before routing;
- unknown bytes fail with the existing generic invalid-instruction error;
- the ordinary target has 115 `VaultInstructionTag` values;
- it has 14 `AmoebaDlmmInstructionTag` values;
- feature `devnet-solo-backfill-2026` adds 12 assigned mutating bytes;
- bytes 249–251 are deliberately reserved;
- the writer-math benchmark is a separate feature-only, accountless, non-state prefix;
- compressed execution has exact core-account counts and Light proof-account indexes;
- TypeScript contains many direct `TransactionInstruction` construction surfaces.

The default assigned one-byte count is therefore:

```text
115 Vault + 14 DLMM = 129 assigned tags
```

The Devnet backfill build count is:

```text
129 + 12 feature-only tags = 141 assigned tags
```

Do not hardcode these counts as the source of truth. Generate and verify them from the compiled registries. The counts above are mandatory baseline assertions and drift alarms.

---

# 6. Phase 3 controller-side scope in `ameba_gov`

Phase 3 must not add another executable controller instruction.

Permitted `ameba_gov` changes are limited to:

1. the normative Phase 3 amendment;
2. a canonical gate/tail codec and bridge fixture;
3. Rust/TypeScript parity tests for that fixture;
4. CI;
5. documentation and a Phase 3 ABI report.

No proposal, gate-mutation, initialization, freeze, unfreeze, loader, or deployment processor may be added.

## 6.1 Canonical bridge fixture

Create:

```text
fixtures/spread_gate_bridge_v1.json
```

Generate it from `ameba_gov` code, but consume it independently in `ameba_spread`.

Use:

```text
synthetic controller program:
4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi

real target program:
9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH

sample active gate epoch:
41
```

The fixture must contain:

- explicit non-production warning;
- controller program;
- target program;
- canonical target ProgramData;
- controller-config PDA and bump;
- gate PDA and bump;
- exact 192-byte active gate account;
- every field decoded independently;
- exact 16-byte governance tail;
- exact tail hex;
- a sample legacy instruction;
- the enveloped instruction;
- the stripped legacy instruction;
- fixture SHA-256.

The canonical sample tail for epoch 41 is:

```text
ASCII magic: AGV1
version:     1
reserved:    00 00 00
epoch LE:    29 00 00 00 00 00 00 00

hex:
41475631010000002900000000000000
```

## 6.2 Gate account codec

Add a fixed `ProtocolGateV1` TypeScript codec if one does not already exist.

The codec must:

- require exactly 192 bytes;
- reject truncation and trailing bytes;
- reject noncanonical booleans and enum values;
- expose field offsets;
- require zero reserved bytes;
- support canonical re-encoding;
- match Rust exactly.

Do not add a variable-width account representation.

---

# 7. Governance instruction tail ABI

Every recognized mutating top-level target instruction carries this exact suffix:

```rust
pub const GOVERNANCE_TAIL_MAGIC: [u8; 4] = *b"AGV1";
pub const GOVERNANCE_TAIL_VERSION_V1: u8 = 1;
pub const GOVERNANCE_TAIL_LEN: usize = 16;

pub struct GovernanceInstructionTailV1 {
    pub magic: [u8; 4],
    pub version: u8,
    pub reserved: [u8; 3],
    pub expected_epoch: u64,
}
```

Wire encoding:

```text
offset  size  field
0       4     ASCII "AGV1"
4       1     version = 1
5       3     zero reserved bytes
8       8     expected_epoch, little-endian u64
```

The tail is part of the signed transaction message. It is not a detached signature.

## 7.1 Canonical parser

The parser must:

- require exactly the final 16 bytes;
- require exact magic;
- require version 1;
- require all three reserved bytes to be zero;
- parse epoch as little-endian `u64`;
- never search backward for magic;
- never accept multiple versions;
- never infer an epoch from an account.

## 7.2 Existing data cap

The current outer instruction-data cap remains unchanged.

The cap applies to:

```text
legacy instruction bytes + 16-byte governance tail
```

Clients must reject any enveloped instruction exceeding the existing maximum.

The compressed inner-instruction cap remains unchanged because the inner instruction does not carry the governance tail.

---

# 8. Target-side `ProtocolGateV1` decoder

Create a small fixed decoder in `ameba_spread`, for example:

```text
programs/light_token_minter/src/governance_gate.rs
```

Do not add a Rust path dependency from `ameba_spread` to `ameba_gov`.

The target decoder must independently implement the wire contract and pass the shared golden fixture.

## 8.1 Exact 192-byte layout

Decode these exact offsets:

```text
offset   size  field
0        8     discriminator = "AGVGAT01"
8        1     account version = 1
9        1     PDA bump
10       1     initialized bool = 1
11       1     GateStatusV1
12       32    controller_config
44       32    target_program
76       32    target_programdata
108      8     epoch, little-endian u64
116      32    active_proposal
148      8     freeze_slot, little-endian u64
156      2     freeze_reason_code, little-endian u16
158      32    last_completed_proposal
190      2     zero reserved bytes
```

The target decoder must not deserialize unknown future account versions as V1.

## 8.2 Required gate account properties

For every top-level mutator, require the absolute final account to satisfy:

```text
key == canonical gate PDA
owner == pinned controller program
is_signer == false
is_writable == false
executable == false
data length == 192
discriminator == AGVGAT01
version == 1
initialized == true
bump == canonical bump
controller_config == canonical controller-config PDA
target_program == current ameba_spread program ID
target_programdata == canonical ProgramData PDA
status == Active
active_proposal == default pubkey
freeze_slot == 0
freeze_reason_code == 0
reserved == zero
tail.expected_epoch == gate.epoch
```

`last_completed_proposal` may be default or nondefault and does not affect active admission.

## 8.3 Exactly one gate

After the tag is recognized, derive the expected gate key and require:

- the final account key equals it;
- no earlier account in the same top-level instruction has that key.

Reject duplicate gate appearances even if the final gate is otherwise valid.

Do not scan account data before unknown-tag rejection.

---

# 9. Controller identity strategy

A production controller program ID is intentionally not assigned in Phase 3.

The bridge code must therefore be impossible to mistake for a production-ready binary.

## 9.1 Synthetic bridge feature

Add explicit features similar to:

```text
governance-gate-v1
phase3-synthetic-governance-controller
```

The synthetic feature pins:

```text
4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi
```

It exists only for local Phase 3 tests and SBF builds.

## 9.2 Fail-closed production guard

A build that enables `governance-gate-v1` without an explicitly supplied reviewed controller identity must fail at compile time or release-policy validation.

The repository release scripts must reject:

```text
phase3-synthetic-governance-controller
```

for any release candidate, deployment manifest, or public statement of production readiness.

The Phase 3 SBF artifact is a test bridge candidate, not a deployable release.

Do not solve the identity problem by trusting the gate account’s owner dynamically. An attacker-selected controller owner would make the gate forgeable.

---

# 10. Mechanically complete instruction manifest

Create a canonical classification for all 256 first-byte values.

Suggested enum:

```rust
pub enum InstructionGovernanceClass {
    Unknown,
    Reserved,
    RecognizedReadOnly,
    RecognizedMutating,
    FeatureGatedMutating,
}
```

## 10.1 Source of truth

The manifest must derive from:

- `VaultInstructionTag::from_byte`;
- `AmoebaDlmmInstructionTag::from_byte`;
- `devnet_solo_backfill_2026::is_instruction_tag` or its canonical tag set;
- explicit reserved bytes 249–251.

Do not maintain a separate handwritten list that can silently diverge.

## 10.2 Conservative V1 classification

For Phase 3:

- every assigned Vault tag is `RecognizedMutating`;
- every assigned DLMM tag is `RecognizedMutating`;
- every assigned Devnet backfill tag is `FeatureGatedMutating`;
- bytes 249–251 are `Reserved`;
- every other byte is `Unknown`;
- there are no ordinary recognized read-only one-byte instructions unless the agent proves one through complete handler analysis and records that decision.

Do not downgrade a tag to read-only merely because it often fails or only updates configuration.

## 10.3 Expected generated counts

Default build:

```text
RecognizedMutating = 129
Reserved           = 3
Unknown            = 124
```

Devnet backfill build:

```text
RecognizedMutating + FeatureGatedMutating = 141
Reserved                                    = 3
Unknown                                     = 112
```

The generator must print names, bytes, registry source, feature condition, and classification.

## 10.4 Checked-in manifest

Create a generated artifact such as:

```text
docs/governance/generated/phase-3-instruction-manifest-v1.json
```

CI must fail if regeneration changes it.

## 10.5 Writer-math benchmark

The `writer-math-benchmark` feature path is not part of the one-byte transaction registry.

Preserve it only if all of the following remain true:

- feature-only;
- exact benchmark domain;
- account list empty;
- pure bounded arithmetic;
- no account, clock, token, CPI, or transport state access.

Classify it separately as:

```text
BenchmarkOnlyNonState
```

It does not require the gate.

Add a test proving that the benchmark path cannot accept accounts and cannot reach target mutation dispatch.

---

# 11. Exact dispatcher architecture

The current shared dispatcher is used by both top-level execution and compressed inner execution. Phase 3 must separate authorization from business routing without duplicating the handler table.

## 11.1 Private capability

Add a private, unforgeable type:

```rust
pub(crate) struct GateValidated {
    expected_epoch: u64,
    _private: (),
}
```

Its constructor must be private to the gate-validation module.

Do not expose:

- `Default`;
- public fields;
- public constructors;
- a deserializer;
- an unsafe constructor.

## 11.2 Execution context

Replace the authorization-relevant boolean-only model with an explicit internal context, for example:

```rust
pub(crate) enum DispatchTransport {
    TopLevel,
    CompressedInner,
}

pub(crate) struct ExecutionContext<'a> {
    gate: &'a GateValidated,
    transport: DispatchTransport,
}
```

The exact type names may differ, but a mutating handler-routing path must not be callable without a valid capability.

## 11.3 Top-level order

For every top-level target instruction:

1. Apply the existing outer instruction-data size limit.
2. Read only the first byte.
3. Classify it against the active feature-build manifest.
4. If `Unknown` or `Reserved`, return the existing generic invalid-instruction error before:
   - reading account data;
   - validating the gate;
   - parsing the governance tail;
   - decoding the business payload.
5. If `RecognizedReadOnly`, preserve existing behavior.
6. If mutating:
   - require a complete 16-byte tail;
   - parse and validate it;
   - require exactly one canonical final gate account;
   - validate gate privileges, identity, owner, layout, fields, status, and epoch;
   - create `GateValidated`;
   - strip the final 16 data bytes;
   - strip the final gate account;
   - pass the unchanged legacy instruction bytes and legacy account slice into the existing routing table.

Known malformed payloads may now fail at the governance envelope before business decoding. That is intentional.

Unknown-byte error precedence must remain unchanged.

## 11.4 Existing handler equivalence

For every assigned tag, add an equivalence harness proving:

```text
legacy_data_before_envelope
==
data_seen_by_existing_handler_after_strip

legacy_accounts_before_gate
==
accounts_seen_by_existing_handler_after_strip
```

Do not change the business payload codecs during Phase 3.

Do not add gate parameters to individual business handlers.

## 11.5 Error codes

Append new `VaultError` variants after the current final code. Never reorder existing numeric values.

Cover at least:

```text
MissingGovernanceTail
InvalidGovernanceTail
MissingGovernanceGate
DuplicateGovernanceGate
InvalidGovernanceGatePrivileges
InvalidGovernanceGateOwner
InvalidGovernanceGatePda
InvalidGovernanceGateData
GovernanceGateFrozen
GovernanceGateEpochMismatch
GovernanceBridgeIdentityUnavailable
```

Unknown tags must still return the existing `InvalidInstructionData`.

---

# 12. Compressed-state integration

`ExecuteCompressedStateV1` is a top-level mutator and must carry:

- the 16-byte governance tail on the outer instruction data;
- the canonical gate as the absolute final outer account, after all Light and proof accounts.

The top-level dispatcher validates and strips both before calling the compressed wrapper.

## 12.1 Preserve exact inner ABI

The logical inner instruction must not contain:

- a governance tail;
- a physical gate account;
- a gate account index;
- a controller program ID.

Preserve:

- `core_account_count`;
- every core account index;
- `rent_payer_index`;
- every access index;
- System Program position;
- every Light account and packed proof-account index;
- inner instruction bytes.

## 12.2 Capability propagation

Change the compressed path so it receives `&GateValidated` from the top-level dispatcher.

When it invokes the existing inner routing function, it must pass the same private capability.

The inner routing path must not re-read a physical gate.

## 12.3 No nested envelope

Reject or make impossible:

- an inner instruction carrying `AGV1` tail bytes as a governance envelope;
- a gate inserted into the core accounts;
- a gate inserted into the Light suffix;
- recursive `ExecuteCompressedStateV1`.

## 12.4 Test-only adapters

Any native test adapter that reaches compressed inner handlers must require a `cfg(test)` or non-Solana-only test capability.

Production SBF must expose no bypass constructor.

---

# 13. TypeScript client ABI

Create a public execution-free package subpath:

```text
./governance-gate
```

Suggested files:

```text
clients/ts/amoebaGovernanceGate.ts
clients/ts/amoebaGovernanceGate.test.ts
```

Export at least:

```ts
export interface GovernanceGateContextV1 {
  readonly controllerProgram: PublicKey;
  readonly controllerConfig: PublicKey;
  readonly gate: PublicKey;
  readonly targetProgram: PublicKey;
  readonly targetProgramdata: PublicKey;
  readonly epoch: bigint;
}

export function encodeGovernanceTailV1(epoch: bigint): Buffer;
export function decodeGovernanceTailV1(data: Uint8Array): GovernanceInstructionTailV1;
export function decodeProtocolGateV1(data: Uint8Array): ProtocolGateV1;
export function deriveControllerConfigPdaV1(...): [PublicKey, number];
export function deriveProtocolGatePdaV1(...): [PublicKey, number];
export function withAmoebaGovernanceGateV1(
  instruction: TransactionInstruction,
  context: GovernanceGateContextV1,
): TransactionInstruction;
```

## 13.1 Wrapper invariants

The canonical wrapper must:

- require the instruction program ID to equal the intended Spread target;
- reject data already ending in a valid governance tail;
- reject an existing gate key anywhere in the account list;
- enforce `legacy data length + 16 <= MAX_AMOEBA_INSTRUCTION_DATA_BYTES`;
- append the exact 16-byte tail;
- append the gate as the final read-only, non-signer account;
- preserve every original key in order and with unchanged privileges;
- preserve all original data bytes;
- return a fresh instruction rather than mutating shared input.

## 13.2 Finalized gate observation

Add a pure decoder and an injectable observation helper that:

- fetches the gate at finalized commitment;
- validates owner, key, layout, target, ProgramData, status, and epoch;
- returns a complete `GovernanceGateContextV1`;
- does not hold a signer;
- performs no transaction submission.

Operators must reobserve the gate immediately before signing in a later operational phase.

## 13.3 Builder migration

Migrate every official target-mutating construction surface, including:

- vault and market builders;
- oracle source, opening, update, emergency, reward, weight, and finalization builders;
- staking builders;
- DLMM builders and planners;
- writer-sleeve builders;
- compressed-state proof builder;
- Devnet backfill builders;
- reference client;
- bootstrap planning;
- operator and automation plans;
- test helpers that model official clients.

Do not merely migrate one high-level executor while leaving exported raw builders as the supported path.

## 13.4 Raw constructor policy

Use one of these safe patterns:

1. make raw Spread `TransactionInstruction` constructors internal; or
2. return an opaque unsubmitted inner-instruction type and expose only the governed finalizer; or
3. retain legacy raw builders only under an explicitly named internal/test subpath that public package exports do not expose.

Old published clients are expected to fail closed after bridge activation. Do not add runtime fallback to omit the envelope.

## 13.5 Static coverage checker

Add a TypeScript-compiler-based or syntax-aware checker that finds direct `TransactionInstruction` construction targeting the Spread program.

Maintain a very small reviewed allowlist for:

- the canonical governance wrapper;
- pure inner compressed instruction construction that cannot be submitted directly;
- tests;
- non-Spread programs.

A naïve text grep is insufficient because the repository also constructs System, token, Light, and other program instructions.

CI must fail on a new unreviewed Spread constructor.

---

# 14. Address lookup tables and packet limits

The governance envelope adds:

- 16 instruction-data bytes;
- one account meta;
- potentially one full 32-byte key if the gate is not in an address lookup table.

Update static ALT planning so the future canonical gate can be included.

Do not mutate a live ALT in Phase 3.

Rerun every:

- legacy transaction packet test;
- versioned transaction packet test;
- 1,232-byte network packet boundary;
- compressed proof packet maximum;
- writer, DLMM, and oracle worst-case plan.

Record before/after serialized sizes for the largest known transactions.

A transaction that no longer fits must fail planning explicitly; do not silently remove required accounts or proofs.

---

# 15. Required Rust tests

## 15.1 Tail codec

Test:

- exact 16-byte length;
- magic;
- version;
- zero reserved bytes;
- little-endian epoch;
- zero epoch if policy permits it;
- max `u64`;
- truncation;
- trailing bytes;
- bad magic;
- bad version;
- nonzero reserved.

## 15.2 Gate decoder

Test:

- exact 192-byte active fixture;
- wrong length, both `LEN - 1` and `LEN + 1`;
- wrong discriminator;
- wrong account version;
- noncanonical initialized bool;
- unknown status;
- wrong bump;
- wrong controller config;
- wrong target;
- wrong ProgramData;
- nonzero reserved;
- noncanonical Active fields;
- valid `FrozenForUpgrade`;
- valid `EmergencyFrozen`;
- active gate success;
- frozen gates rejected by target admission;
- stale and future epoch mismatch.

## 15.3 Account-meta failures

Test:

- missing gate;
- gate not final;
- duplicate gate;
- writable gate;
- signer gate;
- executable gate;
- foreign owner;
- wrong PDA;
- wrong embedded target;
- wrong embedded ProgramData.

## 15.4 Exhaustive tag matrix

For every byte 0–255 under every supported feature build:

- compare compiled registry assignment with generated manifest;
- prove assigned mutators require the envelope;
- prove unknown and reserved bytes fail with the existing generic error before account-data borrowing;
- prove no byte is claimed by two registries;
- prove default assigned count 129;
- prove Devnet assigned count 141;
- prove reserved bytes 249–251 remain unassigned;
- prove feature tags are not accepted when feature is absent.

Instrument tests with poison or intentionally malformed account data to prove unknown tags do not read the final account.

## 15.5 Handler-input equivalence

For every dispatch family and representative tag:

- capture the payload/account slice at the existing handler boundary;
- wrap with tail and gate;
- validate and strip;
- prove byte and account-meta equality with the legacy boundary.

At minimum cover:

- ordinary Vault;
- DLMM;
- DLMM Light lifecycle;
- writer sleeve;
- feature backfill;
- `ExecuteCompressedStateV1`;
- compressed inner Vault instruction.

## 15.6 Private-capability tests

Use compile-fail tests, privacy tests, or module-boundary tests to prove ordinary code cannot construct `GateValidated`.

Prove production compressed inner dispatch has no path without the capability.

---

# 16. ProgramTest and SBF integration

Host unit tests are not enough.

## 16.1 Synthetic controller test program

Use a local test-only controller program with the synthetic controller ID.

It may expose test-harness-only instructions to:

- create or seed the gate;
- set Active/Frozen state;
- increment the epoch.

This test program must not be part of the production controller crate or release artifact.

## 16.2 Actual Spread SBF execution

Build the Spread bridge candidate as SBF with:

```text
governance-gate-v1
phase3-synthetic-governance-controller
```

Run at least one integration path by loading the actual `.so`, not only a native processor.

Prove for an existing real mutator:

1. valid Active gate and matching epoch reaches and completes the existing mutation;
2. missing tail fails;
3. missing gate fails;
4. frozen gate fails;
5. stale epoch fails;
6. wrong owner fails;
7. after stripping, the existing handler behavior remains unchanged.

Choose an existing mutation with a tractable seeded account graph. Do not create a new production instruction solely for the test.

## 16.3 Native exhaustive harness

A native processor harness may supplement SBF testing for the full negative matrix and all 256 bytes, but it cannot replace the actual SBF smoke path.

## 16.4 SBPF stack diagnostics

Build clean, separate artifacts for:

```text
SBPF v0
SBPF v2
```

Do not assume exit code 0 means stack safety.

Capture and inspect all:

- stack-frame overflow diagnostics;
- caller-frame overlap diagnostics;
- reachable program-symbol diagnostics.

For any dependency-only diagnostic, prove the offending symbols are absent from the final linked ELF.

Treat a reachable target-frame overflow as a blocker.

---

# 17. Concurrency and stale-transaction proofs

## 17.1 Freeze-versus-mutation race

The test setup must model:

```text
mutation transaction: reads the gate
freeze transaction:   writes the same gate
```

Submit them concurrently or in a bank batch that exercises account locking.

The only valid outcomes are:

```text
A. mutation commits before freeze, then freeze commits; or
B. freeze commits first, then mutation fails on status/epoch; or
C. one transaction is retried/conflicts and later resolves according to A or B.
```

No outcome may show a mutation committing against a gate state that was concurrently frozen first.

Record transaction signatures, slots, logs, and final gate epoch in the test report.

## 17.2 Durable-nonce stale transaction

Create and sign a local durable-nonce mutation at epoch `e` without submitting it.

Then move the gate through:

```text
Active(e)
-> Frozen(e + 1)
-> Active(e + 2)
```

Submit the old transaction while its durable nonce remains otherwise valid.

It must fail with epoch mismatch. It must not become valid merely because the gate returned to Active.

## 17.3 Ordinary blockhash stale plan

Also test a non-durable transaction plan created at epoch `e`, refreshed to a new blockhash without changing the signed expected epoch. It must fail after the epoch advances.

---

# 18. TypeScript tests

Test:

- exact tail bytes and golden vector;
- gate account decode/encode parity;
- PDA parity with Rust;
- wrapper preservation of original keys/data;
- final gate position and privileges;
- duplicate wrapping rejection;
- wrong target rejection;
- oversize rejection;
- stale observation rejection in planning;
- compressed outer gate after the full Light/proof suffix;
- inner compressed instruction unchanged;
- package export and consumer-install tests;
- static constructor coverage checker;
- all official exported mutating builders produce governed instructions.

The generated fixture must be consumed independently, not regenerated inside the assertion under test.

---

# 19. CI requirements

## 19.1 `ameba_gov`

Add a pinned workflow with:

- immutable action SHAs;
- fixed Rust/Node/npm versions;
- formatting;
- Clippy;
- unit and ProgramTest;
- release build;
- TS checks;
- fixture drift;
- SBPF v0/v2 build and diagnostic analysis.

## 19.2 `ameba_spread`

Extend existing CI with a governance-bridge job that runs:

```text
manifest generation and drift check
Rust formatting
Clippy
host tests
feature backfill tests
TypeScript type/test/build/package checks
constructor coverage checker
packet and ALT tests
SBPF v0 bridge build
SBPF v2 bridge build
stack diagnostic analysis
actual SBF ProgramTest/local-validator gate smoke
```

Do not weaken or remove existing release-intent, public-source, ABI, or client checks.

---

# 20. Commit sequence

Use small commits approximately in this order.

## `ameba_gov`

```text
docs: authorize Phase 3 universal Spread gate
feat: add canonical Spread gate bridge fixture
test: freeze Rust and TypeScript gate vectors
ci: add governance trust-root checks
docs: record Phase 3 gate ABI report
```

## `ameba_spread`

```text
docs: record Phase 3 universal gate specification
test: generate exhaustive instruction governance manifest
feat: add fixed governance tail codec
feat: add fixed ProtocolGateV1 decoder
feat: enforce canonical gate at top-level dispatch
refactor: carry private GateValidated execution context
feat: preserve compressed outer-tail gate contract
feat: add canonical TypeScript governance wrapper
refactor: migrate official Spread instruction builders
test: enforce raw-constructor coverage
test: add exhaustive gate and tag matrix
test: add SBF, race, stale-epoch, and durable-nonce coverage
test: rerun ALT and packet boundaries
ci: add governance bridge checks
docs: record Phase 3 verification report
```

Do not combine the dispatcher change, compressed refactor, and entire client migration into one commit.

---

# 21. Required reports

Create:

```text
ameba_gov/docs/governance/phase-3-gate-abi-report.md
ameba_spread/docs/governance/phase-3-report.md
```

The reports must include:

1. exact starting and ending commits;
2. clean-worktree status;
3. every changed file;
4. normative specification byte length and SHA-256;
5. synthetic controller identity warning;
6. target, ProgramData, config PDA, gate PDA, and bumps;
7. exact gate and tail bytes;
8. manifest counts and all assigned tag names;
9. proof that unknown tags retain early generic failure;
10. proof all assigned mutators require one final gate;
11. exact handler-input equivalence results;
12. compressed core/proof index parity;
13. TypeScript builder migration coverage;
14. raw-constructor checker result;
15. before/after packet sizes;
16. host test counts;
17. actual SBF integration results;
18. SBPF v0/v2 artifact lengths and SHA-256 hashes;
19. stack diagnostic analysis;
20. race-test result;
21. durable-nonce stale-epoch result;
22. all warnings and dependency advisories;
23. confirmation that no live deployment, signing, key access, authority transfer, loader invocation, RPC mutation, service change, or live-state mutation occurred;
24. remaining blockers before Phase 4.

---

# 22. Exit criteria

Phase 3 is complete only when:

- [ ] `ameba_gov` remains Bootstrap V1 with no new executable instruction.
- [ ] The bridge fixture is deterministic and Rust/TS/target decoders agree.
- [ ] The tail is exactly 16 bytes: `AGV1`, version 1, zero reserved, LE epoch.
- [ ] The gate decoder accepts only the exact 192-byte V1 layout.
- [ ] Default assigned tag count is mechanically proven as 129.
- [ ] Devnet-backfill assigned tag count is mechanically proven as 141.
- [ ] Every assigned one-byte instruction is gated.
- [ ] Bytes 249–251 remain reserved.
- [ ] Unknown bytes preserve generic early rejection before account-data access.
- [ ] The benchmark-only path remains accountless and non-state.
- [ ] Every mutator requires exactly one absolute-final read-only gate.
- [ ] Gate owner, PDA, bump, target, ProgramData, status, and epoch are pinned.
- [ ] The synthetic controller identity cannot pass release checks.
- [ ] Existing business handlers receive their original data and account slices.
- [ ] Compressed core and proof indexes are unchanged.
- [ ] The physical gate and signed tail appear only on the compressed outer instruction.
- [ ] `GateValidated` cannot be forged through production code.
- [ ] Official TypeScript builders all produce governed instructions.
- [ ] New unreviewed direct Spread constructors fail CI.
- [ ] Old ungated clients fail closed.
- [ ] Packet and ALT boundaries pass or fail explicitly without semantic weakening.
- [ ] At least one real existing mutation succeeds through the actual Spread SBF artifact with a valid active gate.
- [ ] Frozen, stale, malformed, duplicate, missing, foreign, and writable gates fail.
- [ ] The mutation/freeze race is serialized correctly.
- [ ] A durable-nonce transaction signed at epoch `e` fails after `e -> e+1 -> e+2`.
- [ ] SBPF-v0 and v2 builds have no reachable target stack violation.
- [ ] No deployment or authority work occurred.

---

# 23. Stop conditions

Stop and report rather than improvising if:

- either repository baseline differs materially;
- a final production controller ID appears necessary to continue;
- an assigned tag cannot be safely classified;
- a tag appears genuinely read-only but the proof is incomplete;
- the target-side decoder cannot preserve the exact existing handler ABI;
- the compressed wrapper cannot preserve every current account index;
- an official builder cannot be migrated without an unreviewed transaction-shape change;
- any worst-case transaction exceeds the network packet limit;
- an actual SBF test reveals a reachable stack violation;
- the concurrency test cannot model a gate read/write lock faithfully;
- a test requires production keys or a live cluster;
- release tooling cannot reliably reject the synthetic controller identity;
- implementing the gate would require proposal lifecycle, live freeze, loader CPI, or authority transfer.

Do not “solve” a stop condition by omitting a tag, weakening gate validation, moving the gate away from the absolute tail, accepting an arbitrary owner, or adding a legacy path.

---

# 24. Roadmap after Phase 3

```text
Phase 4 — Full proposal lifecycle:
          proposal creation, buffer commitments, timelock, guardian/governed
          freeze, checkpoints, poststate acceptance, unfreeze, cancellation,
          expiry, council rotation, and frozen-only recovery

Phase 5 — Sealed buffer custody and typed Loader-v3 execution:
          local validator and sacrificial target only

Phase 6 — Optional token-governance and council-election release after maturity

Phase 7 — Evidence v3, controller policy/immutability decision, staged bridge
          release, production identity, and ProgramData authority handoff
```

The Phase 3 bridge is the hard execution constraint. The later controller lifecycle decides when the gate changes state. Keeping these phases separate reduces the number of simultaneously moving security assumptions.

---

# 25. Final implementation principle

Treat the gate like a type-level capability at runtime:

```text
Raw top-level mutation
  -> classify known tag
  -> validate signed epoch tail
  -> validate canonical gate
  -> construct GateValidated
  -> strip governance envelope
  -> execute unchanged legacy transition
```

No `GateValidated`, no mutation.

This is the target-program equivalent of moving an invariant from documentation into the admissible state space: invalid execution paths should be unrepresentable rather than merely discouraged.
