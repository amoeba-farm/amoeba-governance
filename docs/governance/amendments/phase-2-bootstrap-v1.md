# Amoeba Governance Phase 2 — Bootstrap V1 Council and Seat-Authority Execution

**Repository:** `SPACE999978/ameba_gov`  
**Baseline branch:** `main`  
**Expected baseline commit:** `c4468ded3791b2861d0a2dd769c0120b7a4b5a4f`  
**Target repository remains read-only:** `SPACE999978/ameba_spread` at audited commit `1b2230d96e51f6582155d8284900fbfc11ff1f18`

## 1. Status and precedence

This document is a user-authorized amendment to
`docs/governance/upgrade-governance-spec.md` and to the Phase 1 interpretations
currently implemented in `ameba_gov`.

The original architecture remains authoritative for the separate controller,
canonical gate, exact artifact commitments, loader isolation, freeze behavior,
and eventual authority handoff. This amendment supersedes only the following
prior decisions:

1. The fixed two-company / three-non-company council composition.
2. Minimum non-company approval requirements.
3. Affiliation-based approval limits.
4. Mandatory token voting in the first release.
5. The earlier plan to make the universal Spread gate the immediate Phase 2.
6. The field concept `CouncilSeatV1.signer`.

Do not overwrite or alter the byte-preserved base specification. Add this
amendment under `docs/governance/amendments/` and update `AGENTS.md` so that the
base specification is read first and this amendment wins wherever they conflict.

## 2. Phase 2 mission

Phase 2 must correct the pre-entrypoint governance model and then add the
smallest executable authorization kernel needed to prove the new seat model.

The phase has four goals:

1. Replace the current differentiated council with five equal authorization
   seats and a plain threshold vote.
2. Preserve company control during bootstrap by operationally assigning three
   of the five seat authorities to Amoeba Farm, without encoding company or
   non-company status into consensus rules.
3. Replace the keypair-oriented `signer` concept with a capability-oriented
   `seat_authority` contract that accepts either a normal Solana signer or a PDA
   signer supplied by a smart-account or multisig program through CPI.
4. Add a minimal executable `RecordProposalApprovalV1` path and ProgramTest
   coverage. Stop before the Spread gate, full proposal lifecycle, token voting,
   loader CPI, deployment, or authority transfer.

This is a bootstrap V1. It is intentionally company-led and must be described
honestly as such.

## 3. Normative V1 governance decisions

### 3.1 Council shape

The active council contains exactly five unique seats.

The intended initial operational custody is:

- three seat authorities controlled by Amoeba Farm;
- two seat authorities controlled by external advisers, reviewers, or future
  community representatives.

This custody split is deployment and governance-manifest policy, not an on-chain
classification. Consensus code must not know which seat is company-controlled.

### 3.2 Equal vote rule

Every active seat has exactly one vote.

For ordinary governed actions:

```text
quorum = number_of_distinct_active_approving_seats >= 3
```

No approval may receive different weight because of seat index, owner, signer
kind, organization, appointment source, or affiliation.

Remove all authorization dependence on:

- `SeatClassV1`;
- `AppointingBodyV1`;
- `company_affiliated`;
- `affiliation_group`;
- `routine_min_noncompany`;
- `terminal_min_noncompany`;
- `max_same_affiliation`;
- any equivalent coalition rule.

Routine quorum must be satisfied by **any** three of the five active seat
authorities.

### 3.3 Terminal threshold

Keep a separate terminal threshold of four of five only for irreversible target
immutability. Every seat still counts equally.

Economic changes, constitutional changes, council rotation, routine upgrades,
rollback authorization, poststate acceptance, and unfreeze are ordinary
three-of-five decisions in bootstrap V1 unless a later phase explicitly changes
them.

### 3.4 Company control

Because Amoeba Farm will control three distinct seat authorities, it can approve
ordinary actions without an external vote during the bootstrap period.

The program must not special-case those three seats. Company control is a
property of custody, not a property of the quorum algorithm.

### 3.5 Token governance

Token governance is disabled in bootstrap V1.

The current account layouts may retain fixed-width future vote fields, but V1
validation must require:

```text
token_governance_enabled == false
vote_program == Pubkey::default()
vote_programdata == Pubkey::default()
vote_config == Pubkey::default()
vote_mint == Pubkey::default()
all vote-policy flags == false
all vote quorum/approval basis points == 0
proposal.vote_requirement == None
proposal.vote_program == Pubkey::default()
proposal.vote_result_pda == Pubkey::default()
```

A caller must not be able to activate token governance by toggling an account
field. Any future token chamber requires an explicitly reviewed controller
release or account-version upgrade with real result validation.

### 3.6 Future maturation

The controller must preserve versioned council-set rotation. A later council may
contain two company authorities and three token-selected authorities, or another
ratified composition, without changing the equal-vote quorum algorithm.

Do not build automatic decentralization, token elections, excluded-balance
logic, or token escrow in this phase.

## 4. Seat authority contract

Rename the field and all related source concepts:

```rust
CouncilSeatV1.signer
```

becomes:

```rust
CouncilSeatV1.seat_authority
```

The invariant is:

> A seat is an authorization capability, not a keypair. The controller requires
> the configured seat-authority account to be a Solana signer. The authority may
> be a direct cryptographic signer or a PDA signer controlled by a smart-account
> or multisig program. Governance never accepts, generates, imports, stores, or
> handles private keys.

### 4.1 Runtime authorization rule

For an approval instruction, the supplied seat-authority account must satisfy
all of the following:

```text
account.key == one configured active CouncilSeatV1.seat_authority
account.is_signer == true
account.is_writable == false
account.executable == false
seat term covers Clock::get()?.slot
that seat has not already approved this approval accumulator
```

Do not require the seat-authority account to be System Program-owned. Do not
infer whether it is a wallet, KMS key, multisig, or PDA. The exact configured
public key plus the Solana signer privilege is the authorization proof.

### 4.2 Direct signer path

A normal wallet, hardware signer, or KMS-backed key may appear directly as the
read-only signer account.

### 4.3 PDA/smart-account path

A smart-account or multisig program may CPI into `ameba_gov` and use
`invoke_signed` so its configured PDA appears to the controller as a signer.

The controller must accept this path without a private-key assumption and
without trusting arbitrary signature bytes supplied in instruction data.

A direct call that merely supplies the PDA public key without valid PDA signer
privilege must fail.

### 4.4 Duplicate capability rule

One public key may not occupy more than one seat in the same council set. Five
seat slots must correspond to five distinct authorization capabilities.

## 5. Fixed account-model changes

The repository is pre-entrypoint and has no assigned production program ID. No
migration or backward compatibility is required unless the repository audit
finds evidence to the contrary. If any deployed controller account or external
consumer is discovered, stop and report before changing the ABI.

### 5.1 `CouncilSeatV1`

Retain the exact 96-byte serialized length while simplifying the consensus
fields:

```rust
pub struct CouncilSeatV1 {
    pub seat_authority: Pubkey,  // 32
    pub term_start_slot: u64,    // 8
    pub term_end_slot: u64,      // 8
    pub active: bool,            // 1
    pub reserved: [u8; 47],      // 47
}
```

Requirements:

- `seat_authority` is non-default;
- `term_start_slot < term_end_slot`;
- the seat covers the council activation slot;
- reserved bytes are zero;
- the authority is unique within the set.

Do not persist company, community, appointment, affiliation, or signer-kind
metadata in this consensus-critical struct.

### 5.2 `GovernanceCouncilSetV1`

Retain the exact 640-byte serialized length and replace the three old quorum
fields with:

```rust
pub routine_threshold: u8,  // exactly 3
pub terminal_threshold: u8, // exactly 4
pub policy_flags: u8,       // exactly 0 in V1
```

Keep:

- five fixed seat indexes for deterministic approval bit positions;
- immutable set version;
- activation and optional deactivation slots;
- canonical set hash;
- zero reserved bytes.

Seat indexes have no governance class. They are only stable bit positions.

### 5.3 `GovernancePolicyV1`

Retain the exact 160-byte serialized length and the existing 96-byte canonical
policy hash material.

Replace the five old one-byte council-policy values with:

```rust
pub council_size: u8,        // exactly 5
pub routine_threshold: u8,   // exactly 3
pub terminal_threshold: u8,  // exactly 4
pub governance_mode: GovernanceModeV1, // BootstrapCouncilOnly
pub policy_flags: u8,        // exactly 0
```

Add the stable enum:

```rust
#[repr(u8)]
pub enum GovernanceModeV1 {
    BootstrapCouncilOnly = 0,
}
```

For V1, all vote basis-point values and vote-required booleans must be zero or
false.

### 5.4 `ControllerConfigV1`

Retain its current fixed length. V1 static validation must reject
`token_governance_enabled == true` and require all four vote identities to be
default.

Do not add an instruction that toggles token governance.

### 5.5 `UpgradeProposalV1`

Retain its current fixed length and future vote fields, but V1 validation must
require the vote fields to be canonical defaults and `VoteRequirementV1::None`.

The existing token-review state may remain in the enum for future compatibility,
but it must be unreachable under `BootstrapCouncilOnly`.

## 6. Canonical hashing changes

### 6.1 Council-set hash

Update the council-set hash material to cover only consensus-relevant fields:

```text
controller_config
version
target_program
activation_slot
deactivation_slot
for each of five seats, in index order:
    seat_authority
    term_start_slot
    term_end_slot
    active
routine_threshold
terminal_threshold
policy_flags
```

Reserved bytes are excluded but must validate as zero.

With the fixed fields above, the canonical council-set material is exactly 336
bytes. Update the constant, Rust implementation, TypeScript implementation,
fixtures, documentation, and mutation-sensitivity tests.

### 6.2 Policy hash

Keep the policy material at exactly 96 bytes by hashing the five replacement
one-byte fields in the same position previously occupied by the old council
policy values.

### 6.3 Proposal digest

The proposal digest continues to bind the exact policy hash and council-set
hash. Vote fields remain committed but are canonical defaults in bootstrap V1.

## 7. Quorum implementation

Simplify quorum evaluation to a popcount predicate.

```rust
pub enum ApprovalRequirementV1 {
    Routine,
    Terminal,
}

pub struct QuorumEvaluationV1 {
    pub total_approvals: u8,
    pub required_approvals: u8,
}
```

For a valid approval bitset:

```text
Routine  => popcount(bitset) >= 3
Terminal => popcount(bitset) >= 4
```

`TargetImmutability` selects `Terminal`. Every other currently scaffolded
proposal class selects `Routine`.

Remove affiliation maps and non-company counting from quorum code and tests.

Rename related functions and errors so they use `seat_authority`, not `signer`.
Preserve numeric error codes where practical, but source names may be corrected
because no executable ABI has been deployed.

Suggested names:

```text
DuplicateSeatAuthority
UnknownSeatAuthority
MissingSeatAuthoritySignature
WritableSeatAuthority
ExecutableSeatAuthority
InactiveCouncilSeat
DuplicateApproval
```

## 8. Minimal executable controller kernel

Add a real Solana entrypoint and instruction processor, but implement only the
approval path authorized in this phase.

### 8.1 Crate shape

Update the controller crate to build as both a library and a Solana program:

```toml
[lib]
crate-type = ["cdylib", "lib"]
```

Add modules similar to:

```text
src/entrypoint.rs
src/instruction.rs
src/processor.rs
src/authorization.rs
```

Do not add loader CPI, arbitrary CPI, gate mutation, proposal creation,
initialization, deployment, or authority-transfer instructions.

### 8.2 Instruction

Implement exactly one executable governance instruction:

```text
RecordProposalApprovalV1
```

Instruction data must contain at least:

```rust
pub expected_proposal_digest: [u8; 32],
pub expected_council_version: u64,
```

Use a stable, explicitly encoded instruction tag and fixed-width decoding.
Reject unknown tags, truncation, trailing bytes, and malformed data.

### 8.3 Accounts

Use this exact logical account order:

```text
0. ControllerConfigV1       read-only, controller-owned
1. GovernancePolicyV1       read-only, controller-owned
2. GovernanceCouncilSetV1   read-only, controller-owned
3. UpgradeProposalV1        writable, controller-owned
4. seat_authority           read-only signer, owner unrestricted
```

The processor must:

1. Validate exact account count and privileges.
2. Validate owners and exact fixed account lengths for controller state.
3. Validate canonical PDAs, discriminators, versions, bumps, target identities,
   current policy/council versions, and hashes.
4. Require the proposal to be in `BufferVerified`.
5. Require the expected digest and council version in instruction data to match
   the proposal and current config.
6. Apply the seat-authority runtime contract from Section 4.
7. Record exactly one approval bit.
8. Reject duplicate approval.
9. Recompute quorum using the proposal-selected requirement.
10. If quorum is newly satisfied, set proposal state to `CouncilApproved`.
11. Serialize the proposal back with its exact fixed length.

The instruction must be callable either directly or by CPI. Do not require it to
be the top-level transaction instruction and do not inspect the Instructions
sysvar in this phase.

### 8.4 No private-key or signature-byte interface

Do not accept:

- secret keys;
- keypair files;
- seed phrases;
- raw Ed25519 signatures in instruction data;
- arbitrary signer-provider callbacks inside the on-chain program;
- a web service as an authorization oracle.

The Solana runtime signer bit on the exact configured account is the only V1
seat-authorization proof.

## 9. Required tests

### 9.1 Pure council tests

Enumerate all 32 five-bit approval masks.

For every mask, independently assert:

```text
routine succeeds iff popcount(mask) >= 3
terminal succeeds iff popcount(mask) >= 4
```

Additionally test:

- every one of the ten possible three-seat coalitions satisfies routine quorum;
- no two-seat coalition satisfies routine quorum;
- every one of the five possible four-seat coalitions satisfies terminal quorum;
- no three-seat coalition satisfies terminal quorum;
- seat index does not alter vote weight;
- duplicate authority fails council validation;
- default authority fails;
- invalid or expired term fails;
- stale council version/hash fails;
- invalid bitsets and stored counts fail closed.

### 9.2 ABI and vector tests

Update Rust and TypeScript parity tests for:

- the simplified 96-byte seat;
- unchanged 160-byte policy account;
- unchanged 640-byte council account;
- 336-byte council hash material;
- policy hash material;
- proposal digest;
- all PDA vectors;
- exact serialized lengths;
- truncation, trailing bytes, unknown enums, noncanonical booleans, and nonzero
  reserved bytes.

Regenerate the checked-in synthetic fixture only after both implementations are
updated. Review the full diff.

### 9.3 ProgramTest: direct signer

Seed valid controller, policy, council, and proposal accounts under the
controller program.

Prove that a configured direct cryptographic signer can record an approval and
that three distinct configured authorities advance a routine proposal to
`CouncilApproved`.

### 9.4 ProgramTest: PDA signer through CPI

Add a tiny test-only smart-account proxy program.

The proxy must:

1. Derive a PDA configured as one council `seat_authority`.
2. Receive a top-level test instruction.
3. CPI into `RecordProposalApprovalV1`.
4. Use `invoke_signed` so the configured PDA is a read-only signer in the inner
   controller instruction.

Prove that the controller accepts the PDA authority exactly as it accepts a
direct signer.

Then prove that supplying the same PDA directly without valid `invoke_signed`
privilege fails with `MissingSeatAuthoritySignature`.

### 9.5 Negative executable tests

Test at minimum:

- unconfigured signer;
- configured authority not marked signer;
- configured authority marked writable;
- executable authority account;
- duplicate approval;
- expired seat term;
- inactive council set;
- stale current council version;
- wrong council hash;
- wrong expected proposal digest;
- wrong expected council version;
- wrong proposal state;
- wrong account owner;
- wrong PDA;
- wrong account size;
- truncated or trailing instruction data;
- unknown instruction tag;
- terminal proposal stopping at three approvals and advancing at four.

## 10. Documentation changes

Add:

```text
docs/governance/amendments/phase-2-bootstrap-v1.md
```

containing this amendment.

Update:

```text
AGENTS.md
README.md
docs/governance/serialization-decisions.md
```

The documentation must state plainly:

- bootstrap V1 is company-led;
- Amoeba Farm operationally controls three of five equal seats;
- the program itself does not classify company and non-company seats;
- token governance is disabled and deferred;
- a seat authority may be a direct signer or a PDA signer;
- no private key is accepted by governance;
- the controller remains predeployment and is not yet the Spread trust root;
- the universal Spread gate is now Phase 3.

Do not rewrite the historical Phase 0/1 report as though it had implemented this
new policy. Add a new report instead.

## 11. Required Phase 2 report

Create:

```text
docs/governance/phase-2-report.md
```

It must include:

1. Baseline commit and clean-worktree result.
2. Exact files changed.
3. Old governance semantics removed.
4. New account and hash lengths.
5. The equal-vote quorum truth table result.
6. Direct-signer ProgramTest result.
7. PDA-signer-through-CPI ProgramTest result.
8. Rust, Clippy, release build, TypeScript, and fixture-check commands and exact
   outcomes.
9. Confirmation that `ameba_spread` was not modified.
10. Confirmation that no deployment, signing, key access, authority transfer,
    RPC mutation, loader invocation, or live-state mutation occurred.
11. Remaining blockers before Phase 3.

## 12. Verification commands

Use the repository-native pinned toolchain and add the commands required by the
new ProgramTest suite. At minimum, the final report must cover:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release

cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

If Solana ProgramTest requires additional feature flags or commands, document
and run them explicitly.

## 13. Non-goals and hard stop

Do not perform any of the following in Phase 2:

- modify `ameba_spread`;
- implement or append the universal target gate;
- implement signed epoch tails;
- create the mutating-tag manifest;
- implement proposal creation, queueing, timelock, freeze, checkpoint, unfreeze,
  cancellation, expiry, or recovery instructions;
- implement token governance, token escrow, token voting, delegation, excluded
  balances, or vote-result PDAs;
- implement buffer adoption, buffer sealing, hashing, loader CPI, extension,
  upgrade, close, or target immutability;
- assign a production program ID;
- deploy to localnet, Devnet, or Mainnet;
- request, create, import, or use production keys;
- sign or submit live transactions;
- transfer ProgramData or buffer authority;
- push to a remote repository unless separately authorized;
- claim production readiness or decentralization.

Stop after the Phase 2 report and present the results for review.

## 14. Phase 2 exit gate

Phase 2 is complete only when all of the following are true:

1. Consensus code contains no company/non-company vote distinction.
2. The initial governance policy is five equal seats with routine three-of-five
   and terminal four-of-five.
3. Token governance is mechanically disabled and cannot be enabled by data
   mutation alone.
4. `CouncilSeatV1.seat_authority` replaces the keypair-oriented signer concept
   in Rust, TypeScript, fixtures, tests, errors, and documentation.
5. A configured direct signer can approve.
6. A configured PDA authority can approve through CPI with `invoke_signed`.
7. The same PDA without signer privilege fails.
8. Every three-seat coalition passes routine quorum and no two-seat coalition
   does.
9. Every four-seat coalition passes terminal quorum and no three-seat coalition
   does.
10. All fixed layouts, hashes, PDAs, and Rust/TypeScript vectors agree.
11. The executable controller exposes only `RecordProposalApprovalV1`.
12. No target gate, loader, deployment, or authority work has occurred.

## 15. Roadmap after this phase

After review, the revised sequence is:

```text
Phase 2 — Bootstrap V1 council correction and executable seat-authority approval
Phase 3 — Universal ameba_spread gate, epoch binding, clients, and exhaustive tag tests
Phase 4 — Full proposal, timelock, freeze, checkpoints, unfreeze, cancellation, and recovery
Phase 5 — Sealed buffer custody and typed Loader-v3 execution on sacrificial targets
Phase 6 — Optional token-governance release and council-election path after maturity
Phase 7 — Evidence, bridge release, controller policy decision, and authority handoff
```

The future token-governance phase may change how seat authorities are selected,
but it should not change the core rule that every configured seat casts one
equal vote.
