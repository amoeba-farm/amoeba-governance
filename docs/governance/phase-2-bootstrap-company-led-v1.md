# Amoeba Governance Phase 2
## Bootstrap Company-Led V1 and Universal Freeze-Gate Bridge

**Status:** Agent implementation specification  
**Primary repositories:** `SPACE999978/ameba_gov` and `SPACE999978/ameba_spread`  
**Target Spread baseline:** `1b2230d96e51f6582155d8284900fbfc11ff1f18`  
**Observed governance baseline:** `ameba_gov/main` after the Phase 0/1 verification report  
**Deployment authority:** None. This phase does not authorize deployment, signing, key use, or ProgramData authority transfer.

---

## 1. Purpose of this phase

Phase 1 overcorrected toward early decentralization. It encoded a five-seat council with only two company seats, three nominally token-appointed seats, and quorum predicates that required a minimum number of non-company approvals.

That is not the intended V1.

Amoeba Spread is still in a bootstrap stage. The company must retain operational control while the protocol, governance process, external reviewer set, token distribution, and release machinery mature.

Phase 2 must therefore do two things, in order:

1. **Correct the governance scaffold to a company-led, equal-vote V1.**
2. **Build the universal target-side freeze-gate bridge without implementing token voting, loader execution, deployment, or authority handoff.**

The result must be honest about what it is:

> V1 is company-led governance with external council participation, equal council votes, public commitments, timelocks, and an enforceable freeze boundary. It is not yet decentralized token governance.

---

## 2. Non-negotiable governance decisions

These decisions supersede the earlier Phase 1 council-composition and non-company-quorum rules.

### 2.1 Five equal council votes

The council has exactly five seats.

Every active council seat has exactly one vote.

No vote is weighted or discounted because of:

- company affiliation;
- non-company affiliation;
- seat class;
- appointing body;
- reputation;
- token balance;
- affiliation group; or
- signer identity.

The authorization predicate is only:

\[
\operatorname{popcount}(\text{approval\_bitset}) \geq \text{required threshold}
\]

There must be no `minimum_noncompany`, `minimum_company`, affiliation-concentration, or seat-class approval predicate.

Seat metadata may remain for disclosure, indexing, future migration, and user interfaces, but it must not affect the validity of an approval.

### 2.2 Bootstrap council composition

The V1 council contains:

- **3 Core Protocol seats controlled by Amoeba Farm**
- **1 External Reviewer seat**
- **1 Security Steward seat**

Canonical seat indexes:

| Index | Role | Bootstrap affiliation | Bootstrap appointing body |
|---:|---|---|---|
| 0 | Core Protocol | Company | Company |
| 1 | Core Protocol | Company | Company |
| 2 | Core Protocol | Company | Company |
| 3 | External Reviewer | Non-company | Council |
| 4 | Security Steward | Non-company | Council |

The two external seats are real voting seats, not observers. Their votes count exactly the same as company-seat votes.

The company nevertheless retains V1 control because it holds three of the five equal votes.

### 2.3 V1 thresholds

Use these bootstrap thresholds:

| Decision class | Threshold | Result |
|---|---:|---|
| Routine code upgrade | 3-of-5 | Company can approve alone |
| Economic change | 3-of-5 | Company can approve alone |
| Constitutional change | 3-of-5 | Company can approve alone during bootstrap |
| Council-set rotation | 3-of-5 | Company can evolve the council during bootstrap |
| Emergency rollback | 3-of-5 | Company can restore a precommitted artifact |
| Poststate acceptance | 3-of-5 | Ordinary governed verification |
| Unfreeze | 3-of-5 | Separate action after verification |
| Target immutability | 4-of-5 | Irreversible terminal action requires one additional equal vote |

This specification interprets “retain control” as unilateral company control over every reversible V1 governance action. The only exception is target immutability because it permanently destroys upgrades and rollback.

Do not add a rule saying the fourth immutability vote must be non-company. It may be any fourth valid seat.

### 2.4 Token voting is disabled in V1

Phase 2 must not implement token voting.

For the bootstrap policy:

- `token_governance_enabled = false`
- all vote-program identities are the default public key;
- all `*_requires_vote` policy flags are false;
- all token-vote quorum and approval basis-point fields are zero;
- every Phase 2 proposal has `VoteRequirementV1::None`;
- `vote_program` and `vote_result_pda` are default public keys;
- `TokenReviewOpen` is unreachable under the bootstrap policy.

Keep the versioned fields and enum space needed for a future token-governance release, but do not activate, simulate, or partially implement it.

### 2.5 Future maturity path

Future governance may change the council to, for example:

- two company seats;
- two token-elected delegates; and
- one token-elected or ratified security steward.

That is a future versioned policy and council rotation. It is not part of Phase 2.

Phase 2 must preserve a clean future path by retaining:

- immutable/versioned council-set accounts;
- immutable/versioned policy accounts;
- appointment and affiliation metadata;
- token-governance account fields;
- proposal classes for constitutional change and council rotation; and
- reserved vote-related lifecycle states.

Do not enforce future non-company approval minimums now. A later version may change council ownership without changing the basic rule that one council seat equals one council vote.

---

## 3. Normative-document hierarchy

Create:

```text
docs/governance/phase-2-bootstrap-company-led-v1.md
```

This document becomes the normative amendment for:

- council composition;
- approval thresholds;
- equal-vote semantics;
- token-governance activation; and
- Phase 2 scope.

Update `AGENTS.md` to state:

1. `upgrade-governance-spec.md` remains normative for the controller/gate/artifact architecture.
2. `phase-2-bootstrap-company-led-v1.md` supersedes any conflicting council-composition, minimum-non-company, affiliation-concentration, and active-token-voting requirements.
3. The agent must stop at the Phase 2 boundary described here.

Do not delete the original specification or Phase 1 report. Preserve the decision history.

---

# Part A — Correct the `ameba_gov` V1 scaffold

## 4. Required state-model changes

### 4.1 `SeatClassV1`

Replace the current community-specific name with a bootstrap-neutral external role:

```rust
pub enum SeatClassV1 {
    CoreProtocol = 0,
    ExternalReviewer = 1,
    SecuritySteward = 2,
}
```

The wire values remain explicit one-byte values.

Because no production ABI has been deployed, this is the correct time to make the terminology honest.

### 4.2 `AppointingBodyV1`

Use:

```rust
pub enum AppointingBodyV1 {
    Company = 0,
    Council = 1,
    TokenGovernance = 2,
}
```

Bootstrap use:

- Core Protocol seats: `Company`
- External Reviewer: `Council`
- Security Steward: `Council`

`TokenGovernance` remains reserved for a future policy version.

### 4.3 `GovernancePolicyV1`

Replace the current five quorum-composition bytes:

```text
routine_threshold
routine_min_noncompany
terminal_threshold
terminal_min_noncompany
max_same_affiliation
```

with:

```text
company_seat_count
token_appointed_seat_count
routine_threshold
major_threshold
terminal_threshold
```

Bootstrap values:

```text
company_seat_count         = 3
token_appointed_seat_count = 0
routine_threshold          = 3
major_threshold            = 3
terminal_threshold         = 4
```

The policy account should remain fixed-width. Prefer preserving:

```text
GovernancePolicyV1::LEN = 160
POLICY_HASH_MATERIAL_LEN = 96
```

by replacing the five one-byte fields in place rather than expanding the account.

Policy validation must enforce:

```text
1 <= company_seat_count <= 5
token_appointed_seat_count <= 5
company_seat_count + token_appointed_seat_count <= 5

1 <= routine_threshold <= 5
routine_threshold <= major_threshold
major_threshold <= terminal_threshold
terminal_threshold <= 5
```

For the Phase 2 bootstrap policy, additionally enforce:

```text
company_seat_count == 3
token_appointed_seat_count == 0
routine_threshold == 3
major_threshold == 3
terminal_threshold == 4
```

Keep the general pure policy model capable of representing a future policy, but add a Phase 2 bootstrap validator that rejects any non-bootstrap activation or initialization.

### 4.4 Token-policy canonical form

When no proposal class requires a token vote:

```text
veto_quorum_bps            = 0
affirmative_quorum_bps     = 0
affirmative_approval_bps   = 0
routine_requires_vote      = false
economic_requires_vote     = false
constitutional_requires_vote = false
rotation_requires_vote     = false
immutability_requires_vote = false
```

When any future policy enables token voting, the existing basis-point validity rules may apply. That future-enabled branch may be represented and tested as a pure data rule, but Phase 2 initialization and runtime must reject it.

Add or retain a function with semantics equivalent to:

```rust
validate_policy_against_config(policy, config)
```

It must reject:

- token-required policy plus disabled token configuration;
- enabled token configuration plus missing vote identities;
- disabled token configuration plus nondefault vote identities; and
- bootstrap Phase 2 initialization with any token-vote requirement.

### 4.5 `GovernanceCouncilSetV1`

Replace the current redundant authorization fields:

```text
threshold
min_noncompany_approvals
max_same_affiliation
```

with composition summaries:

```text
seat_count
company_seat_count
token_appointed_seat_count
```

Bootstrap values:

```text
seat_count                 = 5
company_seat_count         = 3
token_appointed_seat_count = 0
```

Prefer preserving:

```text
GovernanceCouncilSetV1::LEN = 640
COUNCIL_SET_HASH_MATERIAL_LEN = 511
```

The council set does not carry its own authorization threshold. Thresholds come from the pinned policy.

Validate:

- exactly five seats;
- five unique nondefault signers;
- valid active terms;
- the canonical role order;
- exactly three `company_affiliated` seats under the bootstrap policy;
- exactly zero `TokenGovernance`-appointed seats under the bootstrap policy;
- all `Company`-appointed seats are company-affiliated;
- all `TokenGovernance`-appointed seats are non-company;
- the two bootstrap external seats use `AppointingBodyV1::Council`;
- all affiliation hashes are nonzero; and
- the stored composition summaries equal both the actual seat data and the pinned policy.

Do **not** reject a council merely because three or more seats share one affiliation hash.

Affiliation data is disclosure metadata in V1, not an authorization primitive.

### 4.6 Canonical bootstrap role order

For the Phase 2 bootstrap policy, validate:

```text
indexes 0, 1, 2 -> CoreProtocol
index 3          -> ExternalReviewer
index 4          -> SecuritySteward
```

The role order gives stable approval-bit meanings across Rust, TypeScript, receipts, and signing surfaces.

Do not use this role order to weight or filter votes.

---

## 5. Required quorum changes

### 5.1 Approval requirements

Use:

```rust
pub enum ApprovalRequirementV1 {
    Routine,
    Major,
    Terminal,
}
```

Threshold selection:

```text
Routine  -> policy.routine_threshold
Major    -> policy.major_threshold
Terminal -> policy.terminal_threshold
```

Proposal-class mapping:

```text
RoutineUpgrade       -> Routine
EmergencyRollback    -> Routine
EconomicChange       -> Routine
ConstitutionalChange -> Major
CouncilSetRotation   -> Major
TargetImmutability   -> Terminal
```

Bootstrap values make both Routine and Major 3-of-5.

### 5.2 Equal-vote quorum evaluator

The evaluator must:

1. validate the council, policy, version, set hash, terms, and approval encoding;
2. count the set bits for active seats;
3. compare only that count to the selected threshold.

Equivalent rule:

```rust
if approval_bitset.count_ones() as u8 < required_threshold {
    return Err(GovernanceError::QuorumNotSatisfied);
}
```

Remove from authorization:

- non-company approval counting;
- company approval counting;
- affiliation-group counting;
- seat-class minimums; and
- appointing-body minimums.

A diagnostic result may report metadata counts for display, but no metadata count may change pass/fail.

### 5.3 Required coalition tests

Exhaustively test all 32 five-seat approval masks.

For bootstrap Routine and Major:

```text
valid iff popcount(mask) >= 3
```

For bootstrap Terminal:

```text
valid iff popcount(mask) >= 4
```

Mandatory explicit cases:

```text
00111  -> passes Routine and Major
11001  -> passes Routine and Major
10110  -> passes Routine and Major
11100  -> passes Routine and Major
00011  -> fails
11101  -> passes Terminal
01111  -> passes Terminal
00111  -> fails Terminal
```

The test names and comments must state that any three equal seats pass routine governance.

### 5.4 Affiliation-neutral test

Construct a valid council in which all five seats carry the same nonzero `affiliation_group`.

The council must remain valid if every other bootstrap composition rule is satisfied.

Then prove that every three-seat coalition still passes Routine, regardless of which affiliation metadata appears on those seats.

This test exists to prevent reintroduction of an affiliation-concentration quorum rule.

---

## 6. Required token-disabled proposal changes

### 6.1 `vote_requirement_for_class`

Under the bootstrap policy, every class returns:

```rust
VoteRequirementV1::None
```

Keep the future logic capable of deriving `Veto` or `Affirmative` only from a future policy. Callers must never supply a free-standing vote mode.

### 6.2 Proposal key canonicalization

The current scaffold must be corrected so a no-vote proposal does not require a nondefault vote program.

For:

```text
VoteRequirementV1::None
```

require:

```text
vote_program    == Pubkey::default()
vote_result_pda == Pubkey::default()
```

For future:

```text
VoteRequirementV1::Veto
VoteRequirementV1::Affirmative
```

require both keys to be nondefault.

Do not include `vote_program` in an unconditional required-public-key list.

### 6.3 Bootstrap transition graph

For the bootstrap policy:

```text
CouncilApproved -> GovernanceSatisfied
```

is the only valid governance-satisfaction path.

```text
CouncilApproved -> TokenReviewOpen
```

must fail because no vote is required.

Retain `TokenReviewOpen` in the enum for future ABI evolution.

### 6.4 Fixtures

Update the canonical proposal fixture:

```text
vote_requirement = None
vote_program = default
vote_result_pda = default
```

Regenerate and review all Rust and TypeScript vectors.

Do not preserve the old digest merely for continuity. The old digest represented the wrong V1 governance policy.

---

## 7. Required documentation changes

Update:

```text
README.md
AGENTS.md
docs/governance/serialization-decisions.md
docs/governance/phase-1-report.md
```

Do not rewrite historical claims in `phase-1-report.md` as though the earlier implementation never existed. Add a clearly dated Phase 2 amendment or correction note.

Create:

```text
docs/governance/phase-2-bootstrap-company-led-v1.md
docs/governance/phase-2-report.md
```

The README must say:

- V1 is company-led;
- the company controls three of five equal seats;
- external seats have equal votes;
- token governance is reserved but inactive;
- no non-company quorum rule exists;
- the repository is still not production-ready.

Do not use the phrases “decentralized governance” or “independently controlled council” for the bootstrap configuration.

---

# Part B — Build the universal Spread freeze-gate bridge

Part B starts only after Part A is complete, reviewed, committed, and all Rust/TypeScript tests pass.

## 8. Phase 2 bridge objective

Make this target-side invariant mechanically true:

> Every recognized state-changing `ameba_spread` instruction must read the same canonical controller-owned gate as its absolute final account and must bind the expected gate epoch before existing business logic is reached.

This part does not implement controller loader execution. It implements the target-side enforcement surface and clients.

---

## 9. Generate the instruction-surface manifest

Do not maintain the gate list by hand.

Generate a machine-reviewed manifest that classifies all 256 first-byte values for:

- the ordinary build;
- every supported feature configuration;
- the Devnet backfill configuration;
- all DLMM instruction registries; and
- the separate writer-math or benchmark prefix, if it is a top-level dispatch surface.

Each byte must be classified as exactly one of:

```text
Unknown
RecognizedReadOnly
RecognizedMutating
Reserved
FeatureGatedMutating
```

CI must fail when:

- a new assigned tag lacks a governance classification;
- two registries claim the same byte unexpectedly;
- an assigned mutator is omitted;
- a checked-in manifest differs from generated output; or
- a feature build changes classification without an intentional reviewed update.

Unknown bytes must continue to fail with the existing generic invalid-instruction error before account access or payload decoding.

---

## 10. Canonical gate decoder

Add a minimal fixed decoder to `ameba_spread`.

Do not make the target program depend on the full controller implementation crate.

The decoder must validate:

```text
account address == canonical ProtocolGateV1 PDA
account owner == pinned controller program
account is read-only
data length == ProtocolGateV1::LEN
discriminator == PROTOCOL_GATE_DISCRIMINATOR
version == ACCOUNT_VERSION_V1
bump == canonical bump
controller_config == pinned controller config
target_program == this Spread program
target_programdata == canonical Spread ProgramData
status == Active
epoch == expected epoch supplied by the instruction
```

Use shared golden bytes and PDA vectors to prove parity between:

- `ameba_gov`;
- the target-side decoder; and
- TypeScript clients.

No permissive or legacy decoder is allowed.

---

## 11. Exact dispatch order

The top-level target dispatcher must perform operations in this order:

1. Enforce the existing outer instruction-data maximum.
2. Read only the first instruction byte.
3. Classify it using the generated manifest.
4. Reject unknown bytes with the existing generic error before touching accounts.
5. For every recognized mutator, require exactly one canonical gate as the absolute final account.
6. Validate the gate and expected epoch.
7. Strip the gate and epoch wrapper exactly once.
8. Pass the unchanged original payload and original business-account slice to the existing handler.

Existing handlers must not learn about the physical gate account.

Do not scatter gate checks through individual handlers.

---

## 12. Epoch binding

Preserve the already specified canonical epoch-tail ABI from the governance specification.

Do not invent a second epoch encoding.

Every mutating instruction must bind:

```text
expected_gate_epoch
```

The top-level dispatcher removes the governance epoch wrapper before invoking the old decoder or handler.

Freeze increments the gate epoch. Governed unfreeze increments it again.

A transaction prepared at epoch `e` must remain invalid after a freeze/unfreeze cycle reaches `e + 2`.

Old clients must fail closed. Do not add a retry path that removes the governance tail or gate.

---

## 13. Compressed-state rule

For compressed and Light-backed execution:

- preserve every existing core account count;
- preserve every proof-account index;
- do not place the gate in the logical inner instruction;
- append the gate only after the full outer Light/proof suffix;
- validate and strip it once at the top-level dispatcher; and
- pass a private typed marker such as `ExecutionContext<GateValidated>` internally.

The typed marker must not be publicly constructible by ordinary callers or handlers.

The compressed inner contract must remain byte-for-byte identical except for the top-level governance wrapper.

---

## 14. Client migration

Create one canonical constructor for mutating Spread instructions.

It must:

- derive or verify the gate PDA;
- bind the exact current gate epoch;
- append the governance epoch wrapper;
- append the gate as the final read-only account;
- reject missing governance identity;
- reject writable gate metadata; and
- expose no fallback ungated constructor.

Migrate all centralized and direct builders, including:

- oracle;
- writer vault;
- settlement;
- staking;
- DLMM;
- compressed state;
- operator automation; and
- test helpers.

Add a repository check that identifies direct mutating `TransactionInstruction` construction outside the approved constructor or an explicit audited exception list.

Add the gate to the relevant address lookup table path and rerun packet-size boundary tests.

---

## 15. Required bridge tests

### 15.1 Dispatch coverage

Enumerate all 256 bytes in every supported build configuration.

Prove:

- every recognized mutator requires exactly one final gate;
- every recognized read-only instruction retains its intended behavior;
- every unknown byte fails before account access; and
- feature-only tags are gated whenever compiled.

### 15.2 Gate decoder failures

Test:

- missing gate;
- duplicate gate;
- gate not in final position;
- writable gate;
- foreign owner;
- wrong address;
- wrong size;
- truncation;
- trailing bytes;
- wrong discriminator;
- wrong version;
- wrong bump;
- wrong controller config;
- wrong target;
- wrong ProgramData;
- frozen status;
- stale epoch; and
- malformed boolean or enum encoding.

### 15.3 Concurrency

Using ProgramTest or a local validator, prove the account-lock boundary:

```text
mutating transaction reads gate
freeze transaction writes gate
```

The result must be one of:

```text
mutation commits before freeze
or
mutation conflicts/fails after freeze
```

No mutation may commit across the freeze boundary.

### 15.4 Durable-nonce stale transaction

Prepare a durable-nonce mutation at epoch `e`.

Then simulate:

```text
freeze -> epoch e + 1
unfreeze -> epoch e + 2
```

The old transaction must still fail.

### 15.5 Compressed-state parity

Prove:

- existing core account indexes are unchanged;
- proof-account indexes are unchanged;
- the gate appears only at the outer absolute tail;
- the internal typed marker cannot be forged; and
- maximum proof packets remain within the network packet limit.

---

## 16. Production identity handling

No production controller program ID is assigned in this phase.

Use an explicitly labelled non-production controller ID and matching golden vectors for local tests only.

Do not:

- present the synthetic ID as production;
- initialize live accounts;
- deploy a controller;
- deploy the bridge;
- transfer ProgramData authority; or
- create production PDA vectors.

Before any later deployment phase, the real controller program ID must receive a separately reviewed vector set.

---

## 17. Out of scope

Do not implement any of the following in Phase 2:

- token escrow;
- token snapshots;
- token voting;
- delegation;
- token-elected council seats;
- finalized vote-result accounts;
- loader CPI;
- buffer adoption or sealing;
- ProgramData extension;
- ProgramData replacement;
- ProgramData authority transfer;
- controller immutability;
- target immutability execution;
- live council rotation;
- live constitutional-policy mutation;
- production keys;
- Mainnet or Devnet deployment;
- RPC writes;
- service mutations;
- economic-logic changes in Spread; or
- a legacy ungated compatibility path.

Do not claim that Phase 2 is production-ready governance.

---

## 18. Required commit sequence

Use small, reviewable commits in approximately this order:

1. `docs: record bootstrap company-led V1 governance decision`
2. `refactor: make council approvals equal-weight`
3. `refactor: encode three-company-seat bootstrap composition`
4. `refactor: disable token governance canonically in V1`
5. `test: freeze new Rust and TypeScript governance vectors`
6. `test: exhaust all equal-vote coalition masks`
7. `feat: generate exhaustive Spread instruction governance manifest`
8. `feat: add fixed target-side gate decoder`
9. `feat: enforce gate at central dispatch`
10. `feat: preserve compressed outer-tail gate contract`
11. `feat: migrate canonical client constructor`
12. `test: add gate, concurrency, stale-epoch, and packet-boundary coverage`
13. `docs: record Phase 2 verification report`

Do not combine the governance-policy rewrite and target dispatch integration into one unreviewable commit.

---

## 19. Phase 2 exit criteria

Phase 2 is complete only when all of the following are true.

### Governance scaffold

- [ ] Five seats exist.
- [ ] Exactly three bootstrap seats are company-affiliated.
- [ ] All five seats have equal approval weight.
- [ ] Routine quorum is any 3-of-5.
- [ ] Major quorum is any 3-of-5 in bootstrap V1.
- [ ] Terminal quorum is any 4-of-5.
- [ ] No minimum non-company rule exists.
- [ ] No affiliation-concentration approval rule exists.
- [ ] Token governance is canonically disabled.
- [ ] No-vote proposals use default vote identities.
- [ ] `TokenReviewOpen` is unreachable under bootstrap policy.
- [ ] Rust and TypeScript vectors agree.
- [ ] All 32 approval masks are exhaustively tested.

### Spread bridge

- [ ] Every recognized mutator is mechanically gated.
- [ ] Unknown bytes retain generic early rejection.
- [ ] Existing handlers receive their old account slices.
- [ ] Compressed account and proof indexes are unchanged.
- [ ] Official clients append one final read-only gate and the expected epoch.
- [ ] Missing, malformed, writable, foreign, frozen, and stale gates fail closed.
- [ ] Mutation/freeze account-lock behavior is proven.
- [ ] A pre-freeze durable-nonce transaction remains invalid after unfreeze.
- [ ] Packet-size and ALT tests pass.
- [ ] No loader, deployment, authority, token-vote, or live-state surface exists.

---

## 20. Verification commands

At minimum, run and report:

### `ameba_gov`

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

### `ameba_spread`

Run the repository’s existing formatting, Rust, TypeScript, feature-build, and packet-boundary suites, plus the new governance manifest and gate tests.

The agent must record exact commands, exit codes, test counts, skipped tests, warnings, and dependency advisories.

---

## 21. Required final report

Create:

```text
docs/governance/phase-2-report.md
```

The report must include:

1. exact starting and ending commits for both repositories;
2. repository cleanliness before and after;
3. every changed file;
4. final account lengths and discriminators;
5. final policy and council hash material lengths;
6. the new synthetic vector digest and program ID;
7. the exact bootstrap council and thresholds;
8. proof that any three equal seats satisfy routine quorum;
9. proof token governance remains disabled;
10. the generated tag-classification counts for every build;
11. gate decoder test coverage;
12. compressed-state index parity evidence;
13. concurrency and stale-epoch test results;
14. packet-size results;
15. every unresolved blocker; and
16. explicit confirmation that no deployment, signing, key access, authority transfer, loader invocation, service mutation, or live RPC mutation occurred.

---

## 22. Stop conditions

Stop and report instead of improvising if:

- the observed repository HEAD differs materially from the expected baseline;
- a production controller ID appears to be required;
- a current instruction cannot be safely classified as mutating or read-only;
- the compressed account contract cannot preserve its existing indexes;
- the existing epoch-tail ABI is ambiguous or absent;
- a test requires a production key, live RPC mutation, or authority handoff;
- token governance would have to be implemented to continue;
- a loader CPI or ProgramData operation would be required; or
- the model finds a conflict between this Phase 2 amendment and a security invariant outside council composition or token activation.

Do not silently resolve a stop condition by weakening a check.

---

## 23. Final governing summary

For Phase 2, the intended V1 authority graph is:

```text
Five equal council votes
        |
        |-- 3 Amoeba Farm seats
        |-- 1 External Reviewer
        |-- 1 Security Steward
        |
        +-- any 3 approve reversible decisions
        +-- any 4 approve terminal immutability
        +-- no token vote yet
        +-- no special non-company vote rule
```

The company deliberately retains bootstrap control.

The two external members add review, operational resilience, and an early path toward broader governance, but they do not form a privileged chamber and they do not possess a class-specific veto.

Future decentralization occurs through a later, explicit, versioned governance release after the protocol and token distribution are mature enough to support it.
