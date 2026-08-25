# Amoeba Spread Upgrade Governance
## Agent Implementation Specification — Early Release

**Status:** Draft implementation specification, v0.1  
**Date:** 25 August 2026  
**Project:** Amoeba Farm / Amoeba Spread  
**Target program:** `9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH`  
**Source-audit commit:** `1b2230d96e51f6582155d8284900fbfc11ff1f18`  
**Primary source:** `Amoeba_Spread_Upgrade_Governance_Architecture.pdf`

---

# 0. Instructions to the implementation agent

This document converts a read-only architecture audit into an implementation plan. It also resolves the previously open governance question by defining a five-seat council with no company majority and a separate tokenholder chamber.

## Safety constraints

During the first implementation pass, you MUST NOT:

- deploy to Mainnet or Devnet;
- transfer any ProgramData authority;
- change any live upgrade authority;
- sign with or request production keys;
- mutate production configuration, services, accounts, or release intent;
- change settlement, oracle, writer-vault, option, DLMM, staking, or custody semantics;
- make the existing target program immutable;
- claim that the controller or token governance is production-ready.

The first pass is code, local tests, deterministic fixtures, and documentation only.

## Required working style

1. Inspect the repository before editing it.
2. Verify whether the repository still matches the audited commit and paths listed in this specification.
3. If it has materially diverged, write a short divergence report before adapting the design.
4. Preserve existing account layouts and handler behavior unless this specification explicitly introduces an outer governance envelope.
5. Make small, reviewable commits.
6. Add tests with every state transition and security check.
7. Fail closed when an identity, epoch, owner, hash, threshold, vote result, or loader account does not match exactly.
8. Stop after the explicitly assigned first implementation slice in Section 22 and report results.

Normative words in this document have their ordinary specification meaning:

- **MUST / MUST NOT**: required for correctness or safety.
- **SHOULD / SHOULD NOT**: expected unless a documented repository constraint prevents it.
- **MAY**: optional.

---

# 1. Objective

Implement an enforceable upgrade-governance layer for Amoeba Spread with the following properties:

1. A separate, narrowly scoped `upgrade_controller` program becomes the only authority capable of replacing the target program binary.
2. A controller PDA owns the target ProgramData upgrade authority and the final authority of any approved loader buffer.
3. Every recognized state-changing target instruction must pass one canonical controller-owned governance gate.
4. A freeze establishes an on-chain account-lock boundary before any loader extension or upgrade.
5. Each upgrade is bound to one exact sealed artifact, one target, one council set, one gate epoch, one capacity plan, one token-vote result when required, and one timelock.
6. Installing code does not automatically resume mutation. Unfreeze is a separate governed action after verification.
7. The company cannot approve an upgrade alone.
8. Tokenholders have a binding veto over routine upgrades and affirmative approval power over economic, constitutional, council-policy, and immutability decisions.
9. Emergency authority can stop the protocol but cannot install code or restore activity.
10. The first release does not migrate existing market, oracle, custody, writer, staking, DLMM, or compressed-state accounts.

---

# 2. Source architecture retained

The implementation MUST retain these core conclusions from the source audit:

- Use a separate upgrade controller rather than letting the target program govern its own authority PDA.
- Keep the controller loader surface closed and typed; never accept arbitrary CPI instructions or arbitrary account vectors.
- Transfer the target ProgramData authority and final approved-buffer authority to a controller PDA only after the bridge release is verified.
- Add one universal controller-owned gate to every recognized mutating target instruction.
- Freeze the gate before extension or upgrade and keep it frozen through post-upgrade verification.
- Bind proposals to exact artifact, buffer, source/build/package evidence, ProgramData prestate, capacity, council set, epoch, timing, checkpoints, and spill treasury.
- Use a separate unfreeze action after exact poststate verification.
- Preserve reproducible build evidence, ProgramData evidence, account census commitments, and bounded history checks.
- Treat a malicious governance-approved target artifact as outside the protection of the first-release gate. Preventing such code from violating state semantics requires a later immutable state kernel.

---

# 3. Decisions introduced by this rewrite

The source audit left council composition, recovery, production timelocks, and token participation unresolved. This rewrite adopts the following design decisions for implementation.

## 3.1 Five-seat council

The production council has exactly five seats:

| Seat count | Seat class | Appointment source | Company affiliation allowed |
|---:|---|---|---|
| 2 | `CoreProtocol` | Amoeba Farm nomination, activated through governed council-set rotation | Yes |
| 2 | `CommunityDelegate` | Elected by eligible locked tokenholders | No current company employment or controlling service relationship |
| 1 | `SecuritySteward` | Elected or ratified by eligible locked tokenholders | No current company employment, controlling equity relationship, or material recurring service contract |

The two `CoreProtocol` seats are the maximum company-affiliated representation. A valid production council set MUST NOT contain more than two seats sharing the company affiliation group.

## 3.2 Council approval rule

A routine governed action requires:

```text
total approvals >= 3
AND non-company approvals >= 2
AND approvals from one affiliation group <= 2
```

Consequences:

- Two company seats cannot approve anything alone.
- Two company seats plus one company-controlled nominal outsider cannot pass the affiliation rule.
- One company seat plus two independent seats can approve.
- Three non-company seats can approve.
- The company does not have unilateral approval or unilateral veto over routine upgrades.

## 3.3 Tokenholder chamber

Tokenholder voting is a separate governance chamber, not a third company-controlled multisig layer.

- Routine code upgrades use a tokenholder **veto window**.
- Economic and constitutional changes require **affirmative tokenholder ratification**.
- Non-company council seats are elected or ratified by tokenholders.
- Known protocol-treasury, unvested team, market-making, liquidity-incentive, and controller-custodied balances are excluded from eligible voting supply.
- Voting power is linear in eligible tokens committed to the vote.
- Per-wallet logarithmic, square-root, or other concave weighting MUST NOT be used because address splitting increases aggregate power.

## 3.4 Separate vote program

Token escrow and tallying SHOULD live in a separate, small `governance_vote` program.

The `upgrade_controller` MUST NOT accept an operator-supplied vote result or arbitrary signature. It reads only a deterministic `VoteResultV1` PDA owned by a pinned vote program and validates that result against the proposal digest and configured vote policy.

The vote program becomes part of the trust root. Token voting MUST remain disabled for production authority handoff until the vote program is independently built, tested, attested, pinned, and made immutable or governed by a documented stronger root.

## 3.5 Signed epoch tail

The source audit requires stale transactions signed before a freeze to remain invalid after a later unfreeze. A gate account alone cannot bind a signed transaction to an expected epoch because the account address remains the same.

Therefore every governed mutating instruction MUST append a fixed governance data tail containing `expected_epoch`. The target dispatcher strips this tail before calling the existing handler.

This is an implementation correction necessary to make epoch binding cryptographically meaningful.

---

# 4. Governance roles and powers

## 4.1 Core protocol seats

Core seats represent implementation knowledge and operational continuity.

They MAY:

- review and approve exact proposals;
- participate in unfreeze approval;
- nominate replacement core seats;
- participate in rollback approval;
- submit proposals.

They MUST NOT:

- approve an action without at least two non-company approvals;
- appoint or remove community delegates or the security steward alone;
- bypass token ratification where required;
- use oracle, settlement, recovery, writer, liquidity, or config keys as council keys.

## 4.2 Community delegates

Community delegates are elected representatives, not automatically the largest tokenholders.

They MAY:

- review exact artifacts and proposal evidence;
- approve or reject proposals;
- initiate review challenges;
- participate in unfreeze and rollback approval;
- stand for reelection after a fixed term.

They MUST use governance keys distinct from trading, oracle, settlement, and service-operation keys.

## 4.3 Security steward

The security steward is an independent technical seat.

The steward SHOULD:

- independently fetch and hash sealed buffers;
- review loader envelope, ProgramData prestate, capacity, and gate state;
- verify that the proposal digest shown by signing tools matches on-chain state;
- review post-upgrade code and state evidence before unfreeze;
- publish a concise technical attestation or objection.

## 4.4 Emergency guardian

A guardian MAY freeze immediately.

The guardian MUST NOT:

- approve a proposal;
- execute an upgrade;
- execute an extension;
- unfreeze;
- rotate the council;
- change governance policy;
- make the target immutable;
- redirect spill or custody.

Guardian freeze is a one-way emergency stop until the ordinary governed recovery path completes.

## 4.5 Tokenholders

Eligible tokenholders MAY:

- veto routine upgrades;
- ratify or reject economic and constitutional proposals;
- elect or ratify non-company council seats;
- recall non-company seats through a constitutional process;
- ratify target immutability.

Tokenholders MUST NOT directly sign Loader-v3 operations or hold the ProgramData authority.

---

# 5. Proposal classes and authorization matrix

Proposal class MUST be explicit in `UpgradeProposalV1` and included in the proposal digest.

| Proposal class | Council requirement | Token requirement | Minimum delay | Notes |
|---|---|---|---|---|
| `RoutineUpgrade` | 3-of-5 and at least 2 non-company | Veto window | Configured routine delay | Exact sealed artifact only |
| `EmergencyRollback` | 3-of-5 and at least 2 non-company | No new vote only when rollback artifact was precommitted in a previously governed proposal | Configured short rollback delay | Protocol remains frozen throughout |
| `EconomicChange` | 3-of-5 and at least 2 non-company | Affirmative supermajority | Configured major delay | Fees, settlement, vault accounting, oracle authority, payout policy, mint policy |
| `ConstitutionalChange` | 3-of-5 and at least 2 non-company | Affirmative supermajority | Configured major delay | Thresholds, seat rules, token-vote policy, governance authority relationships |
| `CouncilSetRotation` | Existing council threshold and at least 2 non-company | Affirmative ratification for the new set | Configured major delay | Immutable, versioned replacement set |
| `TargetImmutability` | 4-of-5 and at least 3 non-company | Affirmative supermajority | Configured terminal delay | Irreversible; rollback becomes impossible |
| `Unfreeze` | 3-of-5 and at least 2 non-company | None | Separate transaction after verification | Cannot be bundled with upgrade |
| `GuardianFreeze` | Guardian signature | None | Immediate | Freeze only |

## 5.1 Routine token veto rule

A routine upgrade is blocked when both are true:

```text
participating_power >= eligible_power * veto_quorum_bps / 10_000
oppose_power > support_power
```

If veto quorum is not reached, the proposal may proceed after the review period and council/timelock requirements are met.

Initial policy recommendation:

- `veto_quorum_bps = 1500` (15%);
- majority of non-abstaining participating power opposes.

These values MUST be configuration, not hard-coded constants.

## 5.2 Affirmative token ratification rule

A major proposal passes when both are true:

```text
participating_power >= eligible_power * affirmative_quorum_bps / 10_000
support_power * 10_000 >= (support_power + oppose_power) * approval_bps
```

Initial policy recommendation:

- `affirmative_quorum_bps = 2000` (20%);
- `approval_bps = 6667` (two-thirds, rounded up).

These values MUST be configuration, not hard-coded constants.

## 5.3 Semantic-classification limitation

The controller can enforce the declared proposal class and the associated vote policy. It cannot prove that arbitrary newly installed code is semantically “routine” rather than economic or constitutional.

Misclassification remains a governance and review risk. The later immutable state kernel is required if economic invariants must remain mechanically unchangeable by approved target code.

---

# 6. High-level architecture

```text
Eligible tokenholders
        |
        | escrow + vote
        v
Immutable governance_vote program
        |
        | finalized VoteResultV1 PDA
        v
Five-seat council --------------------------+
2 CoreProtocol                              |
2 CommunityDelegate                        |
1 SecuritySteward                          |
        | council approvals                 |
        +------------------+----------------+
                           v
                Immutable upgrade_controller
        proposal + policy + gate + authority PDA
                  /             |             \
                 /              |              \
                v               v               v
       Sealed Loader buffer   Spread ProgramData   ProtocolGateV1
       exact artifact         loader-owned         controller-owned
                                    |
                                    v
                          Existing Spread state
                     unchanged by upgrade transaction
```

Trust-root rules:

1. The target program MUST NOT own or derive the controller authority PDA.
2. The controller MUST NOT accept arbitrary CPI.
3. The vote result MUST be owned by the pinned vote program and bind the exact controller proposal digest.
4. The controller and vote program MUST be independently attested before production activation.
5. Production authority handoff MUST NOT occur while either trust-root program remains controlled by an ordinary operator key without a documented stronger governance path.

---

# 7. Program and repository layout

Paths from the source audit are search anchors. The agent MUST confirm current repository structure before editing.

## 7.1 New controller program

```text
programs/upgrade_controller/
  Cargo.toml
  src/
    lib.rs
    entrypoint.rs
    instruction.rs
    processor.rs
    state.rs
    pda.rs
    digest.rs
    policy.rs
    council.rs
    gate.rs
    proposal.rs
    checkpoint.rs
    buffer.rs
    loader.rs
    envelope.rs
    error.rs
    tests/
```

## 7.2 New vote program

```text
programs/governance_vote/
  Cargo.toml
  src/
    lib.rs
    entrypoint.rs
    instruction.rs
    processor.rs
    state.rs
    pda.rs
    electorate.rs
    escrow.rs
    tally.rs
    result.rs
    error.rs
    tests/
```

The vote program MAY be implemented after the controller policy interface, but the controller data model MUST reserve and validate the vote-program identity from the beginning.

## 7.3 Target-program changes

Likely source-audit anchors:

```text
programs/light_token_minter/src/lib.rs
programs/light_token_minter/src/processor/instruction_dispatch.rs
programs/light_token_minter/src/instruction/tags.rs
programs/light_token_minter/src/ameba_dlmm_instruction.rs
programs/light_token_minter/src/processor/devnet_solo_backfill_2026.rs
programs/light_token_minter/src/processor/compressed_state/execute.rs
```

Suggested new modules:

```text
programs/light_token_minter/src/governance_gate.rs
programs/light_token_minter/src/governance_envelope.rs
programs/light_token_minter/src/governance_tag_registry.rs
```

## 7.4 TypeScript client package

```text
clients/ts/upgradeGovernance/constants.ts
clients/ts/upgradeGovernance/types.ts
clients/ts/upgradeGovernance/derivations.ts
clients/ts/upgradeGovernance/codec.ts
clients/ts/upgradeGovernance/builders.ts
clients/ts/upgradeGovernance/observation.ts
clients/ts/upgradeGovernance/planning.ts
clients/ts/upgradeGovernance/verification.ts
clients/ts/upgradeGovernance/voting.ts
clients/ts/upgradeGovernanceCli.ts
```

All existing transaction builders that can construct a mutating target instruction MUST eventually route through one canonical tail-injecting constructor.

---

# 8. PDA domains

Use explicit, versioned, domain-separated seeds.

```text
["ameba-upgrade-v1", "target", target_program]
["ameba-upgrade-v1", "authority", target_program]
["ameba-upgrade-v1", "gate", target_program]
["ameba-upgrade-v1", "policy", target_program, policy_version_le]
["ameba-upgrade-v1", "council", target_program, council_version_le]
["ameba-upgrade-v1", "proposal", target_program, proposal_id_le]
["ameba-upgrade-v1", "checkpoint", proposal, phase]
["ameba-upgrade-v1", "buffer-check", proposal]

["ameba-vote-v1", "config", controller_config]
["ameba-vote-v1", "excluded", controller_config, set_version_le]
["ameba-vote-v1", "proposal", controller_proposal]
["ameba-vote-v1", "escrow", vote_proposal]
["ameba-vote-v1", "receipt", vote_proposal, voter]
["ameba-vote-v1", "result", controller_proposal]
```

PDA derivation parity MUST have golden Rust and TypeScript test vectors.

---

# 9. Controller accounts

All production state accounts MUST use fixed-size fields. Do not use unbounded `Vec`, `String`, or user-controlled dynamic allocation.

## 9.1 `ControllerConfigV1`

Suggested fields:

```rust
struct ControllerConfigV1 {
    discriminator: [u8; 8],
    version: u8,
    bump: u8,
    initialized: bool,
    cluster_domain: [u8; 32],

    target_program: Pubkey,
    target_programdata: Pubkey,
    upgradeable_loader: Pubkey,
    authority_pda: Pubkey,
    gate_pda: Pubkey,
    canonical_spill_treasury: Pubkey,

    current_council_version: u64,
    current_policy_version: u64,
    next_proposal_id: u64,
    target_nonce: u64,

    guardian: Pubkey,

    vote_program: Pubkey,
    vote_programdata: Pubkey,
    vote_config: Pubkey,
    vote_mint: Pubkey,
    token_governance_enabled: bool,

    routine_delay_slots: u64,
    major_delay_slots: u64,
    rollback_delay_slots: u64,
    terminal_delay_slots: u64,
    vote_review_slots: u64,
    proposal_expiry_slots: u64,

    policy_flags: u64,
    reserved: [u8; N],
}
```

Notes:

- `cluster_domain` is initialized from an independently verified cluster genesis identifier because the program cannot directly query arbitrary RPC genesis data on chain.
- Client and operator tools MUST compare the configured `cluster_domain` to the connected RPC cluster before planning or signing.
- Production initialization MUST pin the exact target ProgramData and loader.

## 9.2 `GovernancePolicyV1`

Suggested fields:

```rust
struct GovernancePolicyV1 {
    version: u64,
    activation_slot: u64,

    routine_threshold: u8,
    routine_min_noncompany: u8,
    terminal_threshold: u8,
    terminal_min_noncompany: u8,
    max_same_affiliation: u8,

    veto_quorum_bps: u16,
    affirmative_quorum_bps: u16,
    affirmative_approval_bps: u16,

    routine_requires_vote: bool,
    economic_requires_vote: bool,
    constitutional_requires_vote: bool,
    rotation_requires_vote: bool,
    immutability_requires_vote: bool,

    set_hash: [u8; 32],
    reserved: [u8; N],
}
```

Policy changes are constitutional actions and MUST require token ratification.

## 9.3 `CouncilSeatV1`

```rust
enum SeatClassV1 {
    CoreProtocol = 0,
    CommunityDelegate = 1,
    SecuritySteward = 2,
}

enum AppointingBodyV1 {
    Company = 0,
    TokenGovernance = 1,
}

struct CouncilSeatV1 {
    signer: Pubkey,
    seat_class: SeatClassV1,
    appointing_body: AppointingBodyV1,
    affiliation_group: [u8; 32],
    term_start_slot: u64,
    term_end_slot: u64,
    active: bool,
    reserved: [u8; N],
}
```

`affiliation_group` is a governance-declared identity grouping. On-chain code cannot discover hidden beneficial ownership; it can only enforce the declared and ratified set.

## 9.4 `GovernanceCouncilSetV1`

```rust
struct GovernanceCouncilSetV1 {
    discriminator: [u8; 8],
    version: u64,
    target_program: Pubkey,
    activation_slot: u64,
    deactivation_slot: u64,
    seats: [CouncilSeatV1; 5],
    threshold: u8,
    min_noncompany_approvals: u8,
    max_same_affiliation: u8,
    set_hash: [u8; 32],
    reserved: [u8; N],
}
```

Validation MUST reject:

- duplicate signer keys;
- default pubkeys;
- more than two `CoreProtocol` seats;
- fewer than two `CommunityDelegate` seats;
- missing `SecuritySteward` seat;
- more than two seats in one affiliation group;
- weak threshold values;
- term ranges that are already expired at activation;
- a non-company seat appointed by the company;
- a core seat marked as token-appointed unless explicitly supported by a future policy version.

## 9.5 `ProtocolGateV1`

```rust
enum GateStatusV1 {
    Active = 0,
    FrozenForUpgrade = 1,
    EmergencyFrozen = 2,
}

struct ProtocolGateV1 {
    discriminator: [u8; 8],
    version: u8,
    bump: u8,
    status: GateStatusV1,

    target_program: Pubkey,
    target_programdata: Pubkey,

    epoch: u64,
    active_proposal: Pubkey,
    freeze_slot: u64,
    freeze_reason_code: u16,
    last_completed_proposal: Pubkey,

    reserved: [u8; N],
}
```

Rules:

- The target program reads but never writes this account.
- Mutating target instructions require it as the final account meta and read-only.
- Freeze and unfreeze are the only controller actions that write it.
- Freeze increments `epoch`.
- Governed unfreeze increments `epoch` again.
- A failure after freeze MUST leave the gate frozen.

## 9.6 `UpgradeProposalV1`

Use fixed-size fields and an approval bitset. Suggested content:

```rust
enum ProposalClassV1 {
    RoutineUpgrade = 0,
    EmergencyRollback = 1,
    EconomicChange = 2,
    ConstitutionalChange = 3,
    CouncilSetRotation = 4,
    TargetImmutability = 5,
}

enum ProposalStateV1 {
    Draft = 0,
    BufferAdopted = 1,
    BufferVerified = 2,
    CouncilApproved = 3,
    TokenReviewOpen = 4,
    GovernanceSatisfied = 5,
    Timelocked = 6,
    Frozen = 7,
    Extended = 8,
    UpgradeExecuted = 9,
    ProgramDataVerified = 10,
    PoststateAccepted = 11,
    UnfreezeApproved = 12,
    Completed = 13,
    Cancelled = 14,
    Expired = 15,
}
```

Required proposal fields:

- proposal ID and target nonce;
- proposal class and state;
- controller config and policy version/hash;
- council version/hash;
- gate epoch expected at creation and freeze epoch expected for execution;
- exact target Program, ProgramData, loader, authority PDA, and spill treasury;
- exact buffer address, loader owner, authority, artifact length, and artifact SHA-256;
- source commit/tree hash;
- build-input inventory hash;
- reproducible-build receipt hash;
- package receipt hash;
- release-intent hash;
- current deployed payload and raw ProgramData hashes;
- deployed slot and current capacity;
- exact extension delta and expected post-capacity;
- prestate checkpoint;
- required poststate checkpoint;
- optional precommitted rollback proposal/buffer/artifact;
- required vote mode and deterministic `VoteResultV1` account;
- review start/end, not-before slot, and expiry slot;
- council approval bitset and approval count;
- proposal digest;
- cancellation and terminal reason codes.

The exact serialized `LEN` MUST be derived and tested. Do not guess account size in production code.

## 9.7 `StateCheckpointV1`

```rust
enum CheckpointPhaseV1 {
    Prestate = 0,
    Poststate = 1,
}

struct StateCheckpointV1 {
    proposal: Pubkey,
    phase: CheckpointPhaseV1,
    finalized_slot: u64,
    freeze_epoch: u64,

    program_owned_root: [u8; 32],
    derived_reference_root: [u8; 32],
    external_custody_root: [u8; 32],
    combined_root: [u8; 32],

    program_owned_count: u64,
    derived_reference_count: u64,

    programdata_payload_hash: [u8; 32],
    programdata_raw_hash: [u8; 32],
    programdata_capacity: u64,

    approval_bitset: u8,
    accepted: bool,
    reserved: [u8; N],
}
```

First release checkpoints are governance-attested audit anchors, not a trustless on-chain inventory proof.

## 9.8 Upgrade authority PDA

The authority PDA has minimal state or no separate data account.

It MAY sign only these typed operations:

- `SetAuthorityChecked` for approved buffer adoption;
- `Upgrade` for the pinned target ProgramData and exact sealed buffer;
- `ExtendProgramChecked` if feature availability is proven and policy permits it;
- `Close` for an abandoned approved/cancelled buffer to the canonical treasury;
- `SetAuthority(None)` only for a terminal immutability proposal.

No instruction may expose arbitrary loader instruction bytes.

---

# 10. Governance instruction data tail

Every recognized mutating target instruction MUST carry a fixed signed data suffix.

```rust
const GOVERNANCE_TAIL_MAGIC: [u8; 4] = *b"AGV1";

struct GovernanceInstructionTailV1 {
    magic: [u8; 4],
    version: u8,
    reserved: [u8; 3],
    expected_epoch: u64,
}
```

Serialized size: 16 bytes.

The existing instruction tag remains the first byte. The governance tail is appended to the existing instruction data.

## 10.1 Exact target dispatcher order

For each outer target instruction:

1. Reject instruction data larger than the existing maximum.
2. Read only the first byte.
3. Classify that byte against mechanically generated tag registries for the active feature build.
4. If unknown, return the existing generic invalid-instruction error before reading governance accounts or decoding payload.
5. If known and read-only, dispatch under existing behavior.
6. If known and state-changing:
   - require at least 16 bytes of governance tail;
   - parse the final 16 bytes as `GovernanceInstructionTailV1`;
   - require exact magic and version;
   - require the final account meta to be the canonical `ProtocolGateV1` PDA;
   - require that account to be read-only;
   - validate owner, exact size, discriminator, version, bump, target Program, and ProgramData;
   - require `gate.status == Active`;
   - require `tail.expected_epoch == gate.epoch`;
   - strip the 16-byte data tail;
   - strip the final gate account;
   - pass the original instruction bytes and original business-account slice to the existing handler.

This preserves the original handler ABI while making stale-epoch rejection part of the signed transaction message.

## 10.2 Private execution marker

Internal code SHOULD use a private unforgeable marker such as:

```rust
struct GateValidated(());
```

or a private `ExecutionContext` field so nested helpers cannot accidentally execute a mutating path without dispatcher validation.

## 10.3 Compressed-state rule

For compressed execution:

- preserve exact existing core account counts and proof-account indexes;
- append the gate only after the full outer Light/proof suffix;
- append the governance data tail to the outer instruction data;
- validate and strip both exactly once at the top-level dispatcher;
- never insert the gate into the logical inner compressed account layout;
- pass a private `GateValidated` marker internally.

## 10.4 Client compatibility

Old clients MUST fail closed after bridge activation.

Do not add a legacy fallback that executes a mutator without the gate and expected epoch.

---

# 11. Proposal digest

All council approvals, token votes, operator plans, and receipts MUST bind the same deterministic proposal digest.

Recommended digest:

```text
SHA256(
  "AMOEBA_UPGRADE_PROPOSAL_V1" ||
  cluster_domain ||
  controller_program ||
  controller_config ||
  policy_version || policy_hash ||
  target_program || target_programdata || loader || authority_pda || spill_treasury ||
  proposal_id_le || target_nonce_le || proposal_class ||
  council_version_le || council_hash ||
  gate_epoch_le ||
  buffer_pubkey || artifact_length_le || artifact_sha256 ||
  source_commit_hash || build_input_hash || build_receipt_hash ||
  package_receipt_hash || release_intent_hash ||
  current_payload_hash || current_raw_hash || deployed_slot_le ||
  current_capacity_le || extension_delta_le || expected_post_capacity_le ||
  prestate_checkpoint || required_poststate_checkpoint ||
  rollback_buffer || rollback_artifact_hash ||
  vote_program || vote_result_pda || vote_mode ||
  review_start_slot_le || review_end_slot_le ||
  not_before_slot_le || expiry_slot_le
)
```

Rules:

- All numeric encoding MUST be fixed-width little-endian.
- Optional pubkeys MUST have an explicit presence byte and a 32-byte value.
- Rust and TypeScript MUST share golden digest vectors.
- Approval instructions MUST include the expected digest and fail if it does not equal the proposal account digest.
- Duplicate approval by the same seat MUST fail or be idempotent without increasing count.
- An approval from a stale council set MUST fail.
- A vote result for a different digest MUST fail.

---

# 12. Council approval implementation

Each council member approves through a normal signed controller instruction.

`ApproveProposal` MUST:

1. verify proposal state permits approval;
2. verify the proposal has a sealed and verified buffer where required;
3. verify the signer occupies an active seat in the exact pinned council set;
4. verify the seat term covers the current slot;
5. verify the supplied digest equals the stored proposal digest;
6. reject duplicate approval;
7. set the seat bit in the approval bitset;
8. recompute total approvals, non-company approvals, and affiliation distribution;
9. transition to `CouncilApproved` only when the policy for the proposal class is satisfied.

Council signatures MUST be over fully decoded proposal information in operator tooling. A web service MUST NOT store governance secrets.

---

# 13. Token-governance design

## 13.1 Scope of the first vote program

The first vote program SHOULD be deliberately narrow:

- one pinned SPL or Token-2022 governance mint;
- proposal-specific escrow;
- one active token-governed proposal at a time per controller electorate;
- linear voting power;
- support, oppose, and abstain choices;
- fixed review period;
- explicit excluded-balance set;
- deterministic result PDA;
- no delegation in v1;
- no per-wallet nonlinear weighting;
- no arbitrary external attestation.

Limiting one active token-governed proposal avoids the complexity of allowing one token balance to vote concurrently in multiple proposal-specific escrows.

## 13.2 `VoteConfigV1`

Suggested fields:

```rust
struct VoteConfigV1 {
    controller_program: Pubkey,
    controller_config: Pubkey,
    vote_mint: Pubkey,
    token_program: Pubkey,
    excluded_set_version: u64,
    active_vote_proposal: Pubkey,
    authority: Pubkey, // controller authority or dedicated typed PDA
    bump: u8,
    reserved: [u8; N],
}
```

Before production activation:

- mint identity MUST be pinned;
- mint authority and freeze authority MUST be `None` or controlled by a documented governance root;
- the vote program identity and ProgramData authority MUST be pinned in `ControllerConfigV1`;
- the vote program MUST be immutable or governed by a separately documented stronger mechanism.

## 13.3 Excluded voting balances

`ExcludedVotingSetV1` identifies known balances that do not count toward eligible voting supply.

At minimum exclude:

- protocol treasury;
- controller-owned vaults;
- unvested team allocations;
- liquidity-mining distributors;
- market-maker operational inventories under company control;
- burn or sink accounts if represented in mint supply;
- vote escrows from completed but not yet withdrawn proposals where necessary to prevent double accounting.

The first implementation MAY support a fixed maximum such as 16 excluded token accounts. If the set grows beyond the transaction/account limit, replace it through a separately reviewed design rather than silently accepting a partial denominator.

Beneficial ownership and hidden affiliations cannot be perfectly proven on chain. This limitation MUST be documented.

## 13.4 Vote opening

`OpenVote` MUST:

1. be invoked for a controller proposal in `CouncilApproved` state;
2. verify no other active vote exists for the electorate;
3. bind the exact controller proposal and digest;
4. record vote mode: `Veto` or `Affirmative`;
5. read finalized mint supply;
6. subtract exact balances of every configured excluded token account;
7. store `eligible_power` as the immutable denominator;
8. store start and end slots;
9. initialize support, oppose, and abstain totals to zero;
10. create the proposal escrow token account under a vote-program PDA.

## 13.5 Casting votes

`CastVote` MUST:

- require a voter signer;
- transfer the selected token amount into the proposal escrow;
- create one deterministic `VoteReceiptV1` per voter and proposal;
- record the vote side and amount;
- prevent receipt reuse or double counting;
- disallow changing sides in v1 unless implemented as an atomic withdraw-and-recast before the deadline;
- lock voting tokens until result finalization and any configured post-vote hold period.

Voting weight is exactly the escrowed eligible token amount.

## 13.6 `VoteResultV1`

```rust
enum VoteModeV1 {
    Veto = 0,
    Affirmative = 1,
}

struct VoteResultV1 {
    controller_program: Pubkey,
    controller_config: Pubkey,
    controller_proposal: Pubkey,
    proposal_digest: [u8; 32],

    vote_mint: Pubkey,
    mode: VoteModeV1,
    start_slot: u64,
    end_slot: u64,
    finalized_slot: u64,

    eligible_power: u64,
    support_power: u64,
    oppose_power: u64,
    abstain_power: u64,

    finalized: bool,
    bump: u8,
    reserved: [u8; N],
}
```

The controller MUST recompute the policy outcome from the raw totals. It MUST NOT trust a stored `passed` boolean by itself.

## 13.7 Token result validation in controller

`AcceptVoteResult` MUST verify:

- exact owner equals pinned vote program;
- exact deterministic result PDA;
- controller config and proposal match;
- proposal digest matches exactly;
- mint matches;
- vote mode matches proposal policy;
- vote ended and result is finalized;
- totals do not overflow and do not exceed escrowed power according to vote-program invariants;
- quorum and approval/veto math matches current pinned policy version;
- vote program identity and ProgramData pin match configuration.

Routine proposal behavior:

- if veto succeeds, transition to `Cancelled` with `TokenVeto` reason;
- otherwise transition to `GovernanceSatisfied`.

Affirmative proposal behavior:

- if ratification succeeds, transition to `GovernanceSatisfied`;
- otherwise transition to `Cancelled` or `Expired` according to policy.

---

# 14. Upgrade state machine

Recommended lifecycle:

```text
Draft
  -> BufferAdopted
  -> BufferVerified
  -> CouncilApproved
  -> TokenReviewOpen            [when vote required]
  -> GovernanceSatisfied
  -> Timelocked
  -> Frozen
  -> Extended                   [optional, separate slot]
  -> UpgradeExecuted
  -> ProgramDataVerified
  -> PoststateAccepted
  -> UnfreezeApproved
  -> Completed / Active
```

Terminal alternatives:

```text
Cancelled
Expired
```

Any failure after `Frozen` MUST leave the target frozen.

## 14.1 Create proposal

`CreateProposal` MUST bind all static fields and establish a unique proposal ID and target nonce.

After any council approval is recorded, fields included in the digest MUST be immutable.

## 14.2 Adopt buffer

`AdoptBuffer` MUST verify:

- exact Upgradeable Loader owner;
- exact loader buffer layout;
- temporary uploader authority;
- exact artifact payload length;
- exact buffer address in proposal;
- authority transfer through `SetAuthorityChecked` to the controller authority PDA;
- final authority equals the controller PDA.

After adoption, the controller MUST expose no instruction capable of writing buffer bytes.

## 14.3 Verify buffer

The controller MUST NOT treat an operator-supplied hash as sufficient.

Implementation sequence:

1. Add a benchmark harness for one-shot SHA-256 over realistic 1.1–1.3 MB loader buffers under the pinned SBF/runtime.
2. If one-shot hashing fits with a safe compute margin, implement exact on-chain buffer payload hashing.
3. If it does not fit, stop and design an ordered resumable or chunk/Merkle protocol over the already authority-locked buffer.
4. Do not enable `ExecuteUpgrade` until the buffer bytes are mechanically bound to the proposal commitment.

The initial scaffold MAY represent `BufferVerified` in tests, but production code MUST NOT permit an unchecked operator transition.

## 14.4 Council approval and token review

Council approval occurs only after buffer verification for code upgrades.

Token review begins only after council threshold is reached and the proposal digest is final.

No timing field may be shortened after the first approval.

## 14.5 Queue and timelock

`QueueProposal` MUST:

- require governance satisfaction;
- fix `not_before_slot` and `expiry_slot`;
- reject delay shortening;
- use proposal-class policy;
- prevent execution before the not-before slot;
- expire safely after the expiry slot.

## 14.6 Freeze

`FreezeForUpgrade` MUST:

- require matching proposal, policy, gate, and current epoch;
- require proposal state `Timelocked` and current slot at or after `not_before_slot`;
- increment gate epoch;
- set status `FrozenForUpgrade`;
- bind the active proposal;
- record freeze slot;
- transition proposal to `Frozen`.

`GuardianFreeze` MUST:

- require the configured guardian signer;
- increment gate epoch;
- set `EmergencyFrozen`;
- not create any loader authority or execution right.

## 14.7 Extend target

`ExtendTarget` MUST be a separate transaction and slot before `ExecuteUpgrade`.

It MUST:

- use `ExtendProgramChecked` only;
- verify checked-extension feature availability before production handoff;
- verify exact target, ProgramData, authority PDA, payer, rent, pre-capacity, delta, and expected post-capacity;
- abort on any capacity drift;
- keep the target frozen.

Unchecked top-level third-party capacity extension remains a Loader-v3 limitation. Treat drift as an auditable safe abort, not an overrideable warning.

## 14.8 Execute upgrade

`ExecuteUpgrade` MUST:

- require the gate frozen for the exact proposal and epoch;
- verify exact ProgramData prestate and capacity;
- verify exact sealed buffer, authority, length, and artifact commitment;
- verify canonical spill treasury;
- inspect the Instructions sysvar;
- permit only canonical ComputeBudget instructions, optionally one exact durable-nonce advance, and one controller `ExecuteUpgrade`;
- reject sibling target, System, token, loader, or arbitrary instructions;
- perform exactly one inner Upgradeable Loader `Upgrade` CPI;
- supply only loader-required accounts plus controller state required for validation;
- transition to `UpgradeExecuted` only on success;
- never unfreeze automatically.

## 14.9 Confirm upgrade

`ConfirmUpgrade` MUST verify:

- exact deployed payload bytes or exact approved hashing protocol;
- exact payload hash;
- full raw ProgramData hash;
- ProgramData raw size and capacity;
- zero trailing bytes beyond payload;
- ProgramData authority remains controller authority PDA;
- deployed slot and proposal transition;
- poststate checkpoint expectations.

## 14.10 Accept poststate

`AcceptPoststate` requires the configured council threshold and at least two non-company approvals over the exact poststate checkpoint.

External lamport or token donation drift MUST cause an explicit mismatch and safe abort. The first release has no silent override path.

## 14.11 Approve and execute unfreeze

Unfreeze is two logical steps or one separately governed action after all verification:

1. record `UnfreezeApproved` under 3-of-5 with at least two non-company approvals;
2. execute `Unfreeze` in a separate transaction.

`Unfreeze` MUST:

- re-read proposal, gate, ProgramData authority, and poststate;
- require proposal state `UnfreezeApproved`;
- require gate frozen for the exact proposal;
- increment gate epoch;
- set status `Active`;
- clear active proposal;
- set last completed proposal;
- transition proposal to `Completed`.

No guardian or single seat can unfreeze.

---

# 15. Exact loader execution contract

The controller loader interface is closed and typed.

Allowed typed operations:

| Instruction | Allowed behavior |
|---|---|
| `AdoptBuffer` | Validate buffer and transfer authority to controller PDA |
| `ExtendTarget` | Exact checked extension, separate slot, exact capacity plan |
| `ExecuteUpgrade` | One exact inner loader `Upgrade` only |
| `ConfirmUpgrade` | Exact ProgramData verification and proposal transition |
| `CloseAbandonedBuffer` | Cancelled/expired proposal only; canonical treasury only |
| `MakeTargetImmutable` | Dedicated terminal proposal; exact `SetAuthority(None)` |

The controller MUST NOT accept:

- arbitrary program IDs;
- arbitrary instruction data;
- arbitrary account vectors;
- alternate target ProgramData;
- alternate spill destination;
- alternate buffer;
- loader operations not explicitly represented by a typed controller instruction.

---

# 16. State evidence and inventory

## 16.1 Release 1: retain and anchor the existing census

Keep the existing finalized compatibility census as the first-release state guarantee.

Controller checkpoints SHOULD store:

- program-owned account root and count;
- derived external-reference root and count;
- external-custody root;
- combined root;
- compatibility schema identifier;
- finalized slot;
- freeze epoch;
- ProgramData hashes and capacity.

Council approval attests the frozen prestate. Post-upgrade acceptance requires identical protected roots and only expected controller/ProgramData transitions.

This is not a trustless on-chain proof of complete account membership.

## 16.2 Release 2: maintained membership registry

Deferred work:

- assigned-index sidecars;
- closure tombstones;
- domain shards;
- membership and non-membership proofs;
- proof-service durable node database;
- frozen aggregate checkpoint.

This touches every mutator and has transaction-size and contention consequences. Do not include it in the first implementation slice.

## 16.3 Release 3: immutable state kernel

Deferred work:

- migrate ownership of protected state and custody to a small immutable kernel;
- allow upgradeable logic to propose only typed transitions;
- have the kernel validate authorization, invariants, gate, and root updates.

This is the only design in this plan that constrains a malicious governance-approved target artifact from violating protected state semantics.

---

# 17. Client, operator, and UI behavior

## 17.1 TypeScript package

Add a public, execution-free `./upgrade-governance` package surface containing:

- constants;
- types;
- PDA derivations;
- codecs;
- instruction builders;
- finalized observations;
- proposal planning;
- digest generation;
- vote planning;
- redaction;
- independent verification.

Wallet or KMS execution remains local and injected.

## 17.2 Operator commands

Planned CLI command set:

```text
schema
observe
plan-proposal
adopt-buffer
verify-buffer
approve
open-token-review
cast-vote
finalize-vote
accept-vote-result
queue
freeze
bind-prestate
execute-extension
execute-upgrade
verify-poststate
approve-unfreeze
unfreeze
cancel
close-buffer
rotate-council
finalize-immutable
```

## 17.3 Mandatory operator behavior

Operator tooling MUST:

- use finalized reads;
- verify exact cluster domain/genesis;
- require explicit arming for mutating plans;
- write durable JSONL journals;
- use exclusive execution locks;
- redact secrets;
- persist and back off on the first HTTP 429 rather than continuing blindly;
- bind every plan to controller, ProgramData authority, gate epoch, proposal digest, council version, vote result, and locked buffer;
- re-read gate, proposal, ProgramData authority, buffer authority, council set, and vote result immediately before signing and again before submission;
- expose the full decoded action to the signer;
- provide no private-key fallback.

## 17.4 Public read experience

While frozen:

- markets, charts, identity, and other read paths remain available;
- mutation endpoints return a governance-specific frozen error such as `protocol_governance_frozen`;
- the frontend displays proposal, quorum, token review, timelock, artifact commitment, verification, and gate epoch;
- the frontend never holds governance secrets;
- timer-driven writers remain stopped until governed unfreeze.

---

# 18. Release evidence and receipt v3

The governed release receipt MUST model one controller top-level instruction with one exact inner loader Upgrade.

Required evidence:

| Receipt element | Required evidence |
|---|---|
| Top-level envelope | One controller `ExecuteUpgrade`; bounded ComputeBudget; optional exact nonce; no sibling arbitrary instruction |
| Inner CPI | One exact Upgradeable Loader `Upgrade` with exact ProgramData, Program, Buffer, spill, Rent, Clock, authority PDA |
| Governance | Controller/config/gate/proposal/policy/council identities and hashes, seat approvals, token result, timelock, epoch, state transitions |
| Buffer | Pre-execution owner, header, authority PDA, exact payload length/hash, sealed interval, consumption/close result |
| ProgramData | Exact artifact, padded/full raw hashes, authority PDA, slot, capacity, zero tail |
| State | Identical protected commitments; only expected controller and ProgramData transitions |
| History | No target traffic across freeze/census/upgrade/verification; only admitted controller and loader activity |
| Trust root | Controller and vote-program source/build/deployment/ProgramData/immutability receipts and public ABIs |

The old direct-loader verifier remains valid only for the bridge/handoff release. After authority handoff, any external-key direct loader upgrade MUST be rejected by policy and verification tooling.

---

# 19. Mandatory test matrix

## 19.1 Dispatch and gate

- enumerate all 256 instruction tags in default and every feature build;
- every assigned state-changing tag requires exactly one final canonical gate;
- every unknown tag fails generically before account access;
- read-only tags preserve prior behavior;
- missing governance data tail fails;
- wrong magic/version fails;
- missing gate fails;
- writable gate fails;
- duplicate gate fails where detectable;
- foreign owner fails;
- wrong size/discriminator/version/bump fails;
- wrong target or ProgramData fails;
- frozen gate fails;
- stale `expected_epoch` fails;
- valid current epoch succeeds and passes original payload/account slice unchanged.

## 19.2 Concurrency

- a mutation/freeze race proves mutation either commits before freeze or conflicts/fails afterward;
- a durable-nonce transaction signed at epoch `n` fails after freeze and unfreeze move the gate to epoch `n + 2`;
- a transaction cannot become valid merely because the gate returns to `Active`.

## 19.3 Council structure

- five-seat exact shape enforced;
- more than two core/company seats rejected;
- duplicate/default members rejected;
- missing security steward rejected;
- expired seat rejected;
- more than two seats sharing affiliation rejected;
- two company approvals alone fail;
- two company plus one non-company approval fail because non-company minimum is not met;
- one company plus two non-company approvals pass routine threshold;
- three non-company approvals pass routine threshold;
- stale council-set approval fails;
- duplicate approval does not increase quorum;
- council rotation requires the correct token result.

## 19.4 Token voting

- wrong mint fails;
- wrong token program fails;
- wrong vote-program owner fails;
- wrong result PDA fails;
- result for another proposal digest fails;
- excluded balances are removed exactly from eligible supply;
- escrow transfer amount equals recorded vote power;
- double voting fails;
- vote after end slot fails;
- withdrawal before finalization fails;
- routine vote without veto quorum permits governance satisfaction;
- routine vote with veto quorum and majority opposition cancels proposal;
- affirmative vote below quorum fails;
- affirmative vote at quorum but below approval threshold fails;
- affirmative vote at or above threshold passes;
- arithmetic overflow and malformed totals fail;
- company treasury and unvested configured accounts cannot contribute eligible power.

## 19.5 Proposal state machine

- no approval before buffer is sealed and verified for code upgrades;
- no field mutation after first approval;
- no delay shortening;
- wrong proposal class policy fails;
- expired proposal cannot execute;
- cancelled proposal cannot execute;
- any execution failure after freeze leaves gate frozen;
- unfreeze cannot occur before ProgramData and poststate acceptance;
- guardian cannot approve, execute, or unfreeze.

## 19.6 Buffer and artifact

- wrong loader owner/header/authority/length/hash fails;
- tampering before authority transfer is detected;
- controller exposes no write path after sealing;
- close allowed only after cancellation or expiry;
- close destination must be canonical treasury;
- maximum-size hash benchmark exists;
- selected hash mechanism has deterministic Rust/client vectors;
- exact post-upgrade payload hash and zero tail verified.

## 19.7 Loader and envelope

- real local-validator or ProgramTest `Upgrade` rehearsal;
- `SetAuthority` and `SetAuthorityChecked` exact-path tests;
- wrong target, ProgramData, authority, spill, capacity, or delta fails;
- same-slot extension/upgrade policy fails when prohibited;
- atomic loader failure leaves proposal and gate safely frozen;
- sibling target instruction rejected;
- sibling System/token/loader/arbitrary instruction rejected;
- only canonical ComputeBudget and optional exact nonce instructions accepted.

## 19.8 Compressed state and packet limits

- core account counts and indexes remain byte-identical;
- gate remains absolute outer tail;
- proof suffix preserved;
- private validation marker cannot be forged;
- all v0/ALT and 1,232-byte packet boundary tests rerun;
- adding 16 data bytes and a gate account does not silently exceed packet limits.

## 19.9 Evidence and operations

- authority handoff receipt proves old key rejection;
- governed receipt v3 independently recomputes proposal digest and inner loader CPI;
- full frozen pre/post census comparison passes;
- external donation causes explicit mismatch and abort;
- Edge/tunnel/read paths remain available while frozen;
- audit-only automation passes while writers are stopped;
- writer timers resume only after governed unfreeze.

---

# 20. Hard limits and explicit non-goals

The implementation and documentation MUST remain honest about these boundaries:

1. **Approved malicious code:** A governance-approved target binary can ignore the target-side gate after installation. Only a later immutable state kernel can constrain arbitrary newly installed code.
2. **Full account enumeration:** Solana does not provide a syscall to enumerate every account owned by a program. First-release inventory completeness is an off-chain maintained and governance-attested property.
3. **External donation drift:** Anyone can donate lamports or tokens to some accounts. Exact external balances may change without target execution. First release treats mismatch as a safe abort.
4. **Loader capacity drift:** Under Loader-v3, unchecked third-party capacity extension may remain possible depending on active features. Governance controls code replacement, not necessarily zero-headroom capacity.
5. **Affiliation identity:** On-chain code cannot prove hidden beneficial ownership or undisclosed business relationships. It can enforce only declared, ratified seat metadata and known excluded balances.
6. **Token borrowing:** Proposal-specific escrow prevents transfer after voting but does not prevent a voter from acquiring or borrowing tokens before depositing them. More advanced vote-age or global-lock designs are deferred.
7. **Target immutability:** Making the target immutable is terminal and removes rollback. It is not part of the first production release.
8. **No decentralization theater:** A temporary Devnet bootstrap council may be operationally centralized, but it MUST be labeled as such and MUST NOT be presented as production decentralized governance.

---

# 21. Phased implementation plan

## Phase 0 — Repository survey and design freeze

Deliverables:

- verify audited paths and current commit;
- enumerate current program workspaces and build commands;
- enumerate all tag registries and feature-gated mutators;
- identify existing serialization conventions;
- identify current loader interface crates and pinned runtime versions;
- produce `docs/governance/repository-divergence.md` only if needed;
- add this specification to `docs/governance/upgrade-governance-spec.md`.

Exit gate:

- no code mutation beyond documentation;
- baseline tests and build results recorded.

## Phase 1 — Controller state and policy scaffold

Implement:

- new `upgrade_controller` crate;
- account discriminators and fixed-size state types;
- PDA derivations;
- proposal classes and state enum;
- council seat and affiliation policy;
- proposal digest;
- pure transition validation;
- errors;
- Rust unit tests;
- TypeScript golden vectors for PDA and digest parity if the client workspace is straightforward.

Do not yet implement:

- target gate;
- loader CPI;
- token escrow;
- authority transfer;
- deployment.

Exit gate:

- company-only approval paths provably fail in tests;
- all account layouts have deterministic lengths;
- digest vectors match Rust and TypeScript;
- crate builds under repository-native checks.

## Phase 2 — Universal target gate and signed epoch tail

Implement:

- mechanically generated mutating-tag registry;
- 16-byte governance data tail;
- canonical final gate account;
- exact dispatcher ordering;
- compressed outer-tail integration;
- private `GateValidated` marker;
- canonical client constructor;
- exhaustive 256-tag and packet tests.

Exit gate:

- no recognized mutator bypasses the gate;
- unknown tags retain existing early failure behavior;
- stale epoch transactions fail after freeze/unfreeze simulation;
- existing handler inputs remain unchanged after stripping.

## Phase 3 — Proposal, council, freeze, and unfreeze

Implement:

- proposal creation and immutable commitments;
- council approval bitset and class-specific policy;
- guardian freeze;
- governed freeze;
- checkpoints;
- unfreeze approval and execution;
- cancellation and expiry;
- local state-machine integration tests.

Exit gate:

- any failure after freeze stays frozen;
- guardian has no upgrade or unfreeze path;
- company seats cannot approve alone.

## Phase 4 — Token-governance program

Implement:

- vote config;
- excluded balance set;
- proposal-specific escrow;
- vote receipts;
- tally and final result;
- controller result validation;
- routine veto and affirmative ratification tests;
- council-set ratification path.

Exit gate:

- controller accepts no arbitrary result;
- result binds exact proposal digest;
- excluded company/protocol balances do not contribute;
- vote program is ready for independent audit and immutability rehearsal.

## Phase 5 — Buffer sealing and loader operations

Implement:

- real loader buffer adoption;
- authority transfer to controller PDA;
- artifact hashing benchmark;
- selected exact buffer-verification scheme;
- checked extension;
- execution-envelope inspection;
- one exact inner Upgrade CPI;
- ProgramData post-verification;
- abandoned-buffer close;
- local validator and sacrificial Devnet rehearsals only after explicit approval.

Exit gate:

- exact artifact is mechanically bound to sealed bytes;
- old or alternate buffers fail;
- arbitrary CPI is impossible;
- failure remains frozen;
- exact post-upgrade bytes verified.

## Phase 6 — Clients, evidence, Edge, and operations

Implement:

- public TypeScript package;
- governance CLI;
- signer-provider injection;
- journals and execution locks;
- receipt v3;
- read-only public status;
- frozen mutation response;
- writer-timer stop/resume integration;
- operational rehearsal.

## Phase 7 — Bridge release and authority handoff

This phase requires a separate explicit authorization and independent review.

Sequence:

1. Deploy and independently attest controller and vote program.
2. Make trust-root programs immutable or document a stronger root.
3. Initialize config, policy, council set, token electorate, and a frozen gate.
4. Install the freeze-aware target bridge using the legacy authority.
5. Verify every recognized mutator rejects while frozen.
6. Verify public read paths remain available.
7. Transfer target ProgramData authority to controller PDA.
8. Produce finalized handoff receipt.
9. Prove old key cannot upgrade.
10. Run a complete governed upgrade rehearsal.
11. Keep target frozen until exact poststate approval and separate unfreeze.

Do not perform this phase from the current agent assignment.

---

# 22. First agent assignment

Implement **Phase 0 and Phase 1 only**.

## Required first-pass tasks

1. Confirm repository root, workspace layout, active branch, and current commit.
2. Compare current repository structure to the source-audit paths in Section 7.
3. Run the repository-native baseline build and relevant tests without changing code.
4. Add this specification under `docs/governance/upgrade-governance-spec.md`.
5. Create the `programs/upgrade_controller` scaffold.
6. Implement only:
   - versioned account discriminators;
   - `ControllerConfigV1`;
   - `GovernancePolicyV1`;
   - `CouncilSeatV1`;
   - `GovernanceCouncilSetV1`;
   - `ProtocolGateV1`;
   - `UpgradeProposalV1` enums and fixed-field scaffold;
   - PDA derivations;
   - proposal digest builder;
   - council-set validation;
   - council quorum/affiliation evaluation;
   - pure proposal-state transition guards;
   - error types.
7. Add tests proving:
   - two company seats cannot approve alone;
   - two company plus one non-company approval fails;
   - one company plus two non-company approvals passes;
   - three non-company approvals pass;
   - a third company-affiliated seat makes the council set invalid;
   - duplicate/default/expired seats fail;
   - digest changes when any target, artifact, epoch, council, vote, timing, or capacity field changes;
   - stale council versions fail;
   - invalid state transitions fail.
8. Add deterministic Rust test vectors for PDAs and digest.
9. Add TypeScript parity vectors only if the current client workspace can consume them without unrelated refactoring.
10. Do not touch target dispatch, live configuration, loader instructions, deployment scripts, or authority keys.

## Required report at the end of the first pass

Return:

- current repository commit and whether it matches the audited source;
- changed files;
- concise architecture notes;
- exact commands run;
- build and test results;
- deterministic account sizes;
- unresolved serialization or repository constraints;
- any divergence from this specification and why;
- recommended Phase 2 starting point;
- explicit confirmation that no deployment, authority transfer, signing, or live mutation occurred.

Stop after this report. Do not continue into Phase 2 without a new instruction.

---

# 23. Design acceptance checklist

- [ ] Controller program is separate from the target and cannot be self-authorized by the target.
- [ ] Controller and vote-program identities, ABIs, ProgramData, and authority states are independently attestable.
- [ ] Production council has exactly two core seats, two community delegates, and one security steward.
- [ ] No affiliation group controls more than two seats.
- [ ] Routine approval requires three total and at least two non-company approvals.
- [ ] Known protocol/company controlled non-circulating balances are excluded from token voting.
- [ ] Routine upgrades expose a binding token veto window.
- [ ] Economic, constitutional, council-policy, and immutability actions require affirmative token ratification.
- [ ] Token result is a deterministic account owned by a pinned vote program and binds the exact proposal digest.
- [ ] ProgramData authority and final buffer authority resolve to the controller authority PDA after handoff.
- [ ] All recognized production and feature mutation tags are mechanically gated.
- [ ] Unknown tags retain generic early rejection.
- [ ] Every mutator carries a signed expected-epoch data tail and a final read-only canonical gate account.
- [ ] Compressed execution preserves core account indexes and validates only the outer governance tail.
- [ ] Proposal approvals bind cluster, target, ProgramData, controller, policy, council, nonce, epoch, buffer, artifact, capacity, receipts, checkpoints, vote result, timing, rollback, and spill.
- [ ] Buffer is authority-locked before approval and the controller exposes no write path.
- [ ] Buffer bytes are mechanically verified against the committed artifact before execution.
- [ ] Extension and upgrade are separate transactions and slots.
- [ ] `ExecuteUpgrade` permits exactly one inner loader Upgrade and no sibling mutation instructions.
- [ ] Upgrade success remains frozen until exact ProgramData, state, history, and read-path verification passes.
- [ ] Unfreeze is a separate council action with at least two non-company approvals.
- [ ] Guardian can freeze but cannot approve, execute, rotate, or unfreeze.
- [ ] Public API, tunnel, markets, and charts remain online while writers are frozen.
- [ ] Old authority and stale clients fail closed.
- [ ] Rollback buffer and proposal are separately sealed and precommitted.
- [ ] Target immutability remains a distinct terminal decision with explicit loss-of-rollback acknowledgment.
- [ ] Documentation states that a malicious approved target artifact remains outside first-release gate protection.

---

# 24. Final implementation principle

Governance here is not a collection of nominal signers. It is a typed state machine whose transitions require independent evidence from different failure domains:

```text
sealed exact artifact
+ valid council coalition
+ tokenholder outcome when required
+ elapsed timelock
+ matching freeze epoch
+ matching ProgramData prestate
+ exact loader envelope
+ verified poststate
```

No single company bloc, guardian, operator, web service, or stale transaction should be able to synthesize that proof alone.
