# Phase 2 Bootstrap V1 implementation report

Date: 2026-08-26

This report closes the Bootstrap V1 council correction and executable
seat-authority approval slice defined by
`amendments/phase-2-bootstrap-v1.md`. The historical Phase 0/1 report remains
unchanged. Work stops at the Phase 2 boundary.

## Baseline and specification identity

- Repository baseline: `c4468ded3791b2861d0a2dd769c0120b7a4b5a4f`.
- Before the isolated branch was created, local `HEAD`, local `main`,
  `origin/main`, and the live remote `main` all resolved to that commit.
- The baseline worktree and index were clean after a fresh fetch.
- Isolated implementation branch: `codex/phase2-part-a` in a dedicated Codex
  worktree.
- The earlier emailed Phase 2 record is preserved byte-for-byte at
  `docs/governance/phase-2-bootstrap-company-led-v1.md`: 29,289 bytes, SHA-256
  `18f3c99dafda6fe7dc12c62a4d2a691b0601715993e9b9defa8251d48ea65fa9`.
- The superseding amendment is preserved byte-for-byte at
  `docs/governance/amendments/phase-2-bootstrap-v1.md`: 22,259 bytes, SHA-256
  `966efd6d42b4e2814b85dde836b4c1337cca227388c1c3f16e75301bb8e25fbf`.
- `AGENTS.md` states the precedence explicitly.

Phase 2 branch commits before this final report correction:

```text
d7c5d380f1473473531aeff5e86770960b94c9ff docs: record bootstrap company-led V1 governance decision
f01168f158ecab2a1e28ab5eb8eb4ffd5a75c7f9 refactor: make council approvals equal-weight
0b095526ddda12dfcb9de5016b76be56aab50c1d docs: record revised bootstrap V1 amendment
cf040717255f3a55a196bb2af64267a59c700244 refactor: freeze bootstrap V1 council model
d296d8ea01fc1f7bb3a61d4693a86c0551b390f5 feat: add executable council approval kernel
4fabf69770183554d886c81d9df56dbcc4b8afaa test: prove direct and PDA seat approvals
f3dd49de60cc5fdbfb6add21627bd496aaa20576 docs: report Phase 2 bootstrap verification
3be082c5a4c6fbb10d1fcdebdef03e59d0879de5 fix: keep approval kernel within SBF stack limits
```

The intermediate history is retained rather than rewritten: the revised
amendment and `cf04071` remove the earlier company-classified model completely.

## Exact changed files

Relative to the baseline, Phase 2 changes exactly these paths:

```text
AGENTS.md
Cargo.lock
Cargo.toml
README.md
clients/ts/tools/generate-vectors.ts
clients/ts/upgradeGovernance/syntheticVector.ts
clients/ts/upgradeGovernance/v1.test.ts
clients/ts/upgradeGovernance/v1.ts
docs/governance/amendments/phase-2-bootstrap-v1.md
docs/governance/phase-2-bootstrap-company-led-v1.md
docs/governance/phase-2-report.md
docs/governance/repository-survey.md
docs/governance/serialization-decisions.md
fixtures/upgrade_governance_v1.json
programs/upgrade_controller/Cargo.toml
programs/upgrade_controller/src/authorization.rs
programs/upgrade_controller/src/council.rs
programs/upgrade_controller/src/entrypoint.rs
programs/upgrade_controller/src/error.rs
programs/upgrade_controller/src/instruction.rs
programs/upgrade_controller/src/lib.rs
programs/upgrade_controller/src/policy.rs
programs/upgrade_controller/src/processor.rs
programs/upgrade_controller/src/proposal.rs
programs/upgrade_controller/src/state.rs
programs/upgrade_controller/src/tests/council_policy.rs
programs/upgrade_controller/src/tests/golden_vectors.rs
programs/upgrade_controller/src/tests/layouts.rs
programs/upgrade_controller/src/tests/support.rs
programs/upgrade_controller/src/tests/transitions.rs
programs/upgrade_controller/tests/program_test.rs
rust-toolchain.toml
```

`docs/governance/phase-1-report.md` was intentionally not edited.

## Governance semantics removed and installed

Consensus code, active tests, TypeScript, and the current fixture no longer
contain:

- company or non-company seat classifications or vote counts;
- seat classes, appointing bodies, affiliations, or signer-kind metadata;
- minimum non-company or maximum-same-affiliation quorum rules;
- weighted, privileged, or index-dependent votes;
- the caller-selectable `Major` approval requirement; or
- a data-switchable token-governance path.

`CouncilSeatV1` now persists only one seat authority, its term, active status,
and 47 zero reserved bytes. Five unique authorities have equal weight. The
policy and council mechanically fix routine quorum at three and terminal quorum
at four. `TargetImmutability` selects terminal quorum; every other scaffolded
class—including emergency rollback—selects routine quorum for approval
accumulation. Rollback execution remains unimplemented.

Bootstrap V1 is operationally company-led because Amoeba Farm controls three
of five authorities. The controller itself does not encode which seats are
company controlled. Token governance is disabled: config static validation
rejects an enabled flag or any nondefault vote identity, policies require zero
vote fields, and proposals require `None` plus default vote identities.

## Fixed layouts, commitments, and instruction ABI

| Type | Exact bytes |
|---|---:|
| `ControllerConfigV1` | 512 |
| `GovernancePolicyV1` | 160 |
| `CouncilSeatV1` | 96 |
| `GovernanceCouncilSetV1` | 640 |
| `ProtocolGateV1` | 192 |
| `UpgradeProposalV1` | 1,280 |
| `RecordProposalApprovalV1` instruction data | 41 |

| Canonical commitment material | Exact bytes |
|---|---:|
| Governance policy | 96 |
| Governance council | 336 |
| Upgrade proposal | 1,084 |
| Proposal domain plus material | 1,110 |

The regenerated synthetic fixture has SHA-256
`d22742ed2341e2403589cd08f358048fa6220e1420be27f595d3dbff724eb8ea`.
Its policy, council, and proposal hashes are respectively:

```text
dbe7a6e086e89d3a13054cf44a41d677d8d5cbda44a4ce0f17ef018b57abbb18
fad4be88664eb3aacf6984d30a4b4206c4c0542147c315e76ff607bae2ed93d0
3306de5e0f562252c86b76f8c3e2929b6fdb8c9807a68ab844ba9ca27bcb222b
```

Rust and TypeScript independently agree on the 96/160/640-byte serialized
layouts, 96/336/1,084-byte materials, hashes, and all nine PDA vectors.
Field-by-field mutation tests cover every policy and council hash input;
reserved bytes are excluded from hashes but rejected by validation.

## Equal-vote quorum truth table

The Rust suite enumerates all 32 five-bit approval masks. For every mask:

```text
Routine  succeeds exactly when popcount(mask) >= 3
Terminal succeeds exactly when popcount(mask) >= 4
```

It separately proves all ten possible three-seat coalitions pass routine
quorum, all ten two-seat coalitions fail routine quorum, all five four-seat
coalitions pass terminal quorum, and all ten three-seat coalitions fail terminal
quorum. Seat index never changes vote weight.

## Executable controller result

The controller builds as `cdylib` plus `lib` and exposes exactly one instruction:
tag `0` `RecordProposalApprovalV1`. Its data is the expected 32-byte proposal
digest plus a little-endian `u64` expected council version. Unknown tags,
truncation, and trailing bytes fail before account mutation.

The processor accepts exactly five logical accounts and validates exact
privileges, controller owners and lengths before deserialization, canonical
PDAs and stored bumps, canonical Loader-v3 target ProgramData, authority/gate
and pre/post checkpoint PDAs, target/current version/hash/nonce identity graph,
active policy/council and seat term, expected digest/version, and a coherent
below-quorum `BufferVerified` accumulator. Existing proposal IDs must be below
the config's next-unallocated proposal ID. Mutation is computed and serialized
off-borrow; only the final validated 1,280-byte proposal is copied back.

Below-threshold approvals succeed and persist without advancing state. Only a
new threshold crossing changes `BufferVerified` to `CouncilApproved`.

## ProgramTest authorization results

ProgramTest runs both the controller and a tiny smart-account proxy as explicit
native processors with `prefer_bpf(false)`. All seeded state accounts are
rent-exempt, and the fee payer is distinct from every seat authority.

- Direct signer: three distinct configured cryptographic authorities record
  bits one at a time; approvals one and two persist in `BufferVerified`, and
  approval three advances a routine proposal to `CouncilApproved`.
- Terminal rule: three approvals leave target immutability in
  `BufferVerified`; approval four advances it.
- PDA signer through CPI: the proxy derives a configured PDA, sets the PDA
  signer privilege only through `invoke_signed`, and successfully records one
  approval.
- Same PDA without `invoke_signed`: direct submission with the PDA non-signer
  fails with `MissingSeatAuthoritySignature`, and proposal bytes are unchanged.

The negative matrix also covers unconfigured, missing, writable, executable,
duplicate, expired, and inactive authorities; stale versions; wrong hashes,
digest, state, owner, PDA, account count, privileges, and target ProgramData;
future policy; already-quorate `BufferVerified` corruption; wrong embedded
checkpoint PDAs; all four state-account lengths at `LEN - 1` and `LEN + 1`;
unknown/truncated/trailing instruction bytes; and noncanonical booleans in every
loaded account type. Every failed case asserts the proposal bytes remain
unchanged. The duplicate test refreshes the blockhash so it reaches the custom
`DuplicateApproval` error rather than transaction replay rejection.
Every successful routine, terminal, and PDA approval also compares the complete
decoded proposal against an expected clone with only the exact approval bit,
count, and threshold-crossing state change permitted.

## Verification commands and exact outcomes

The Rust and ProgramTest commands ran through WSL Ubuntu-22.04 with Rust
1.89.0 and an isolated Linux target directory because Windows-native
`solana-program-test` transitively builds vendored OpenSSL and the Windows host
does not provide Perl.

```text
cd /mnt/c/Users/space/.codex/worktrees/phase2-part-a/ameba_gov
export CARGO_TARGET_DIR=/tmp/ameba-gov-phase2-programtest-target
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release
```

All four commands exited 0. Clippy produced no warnings. Rust unit tests passed
34/34. ProgramTest passed 2/2 integration tests; those two tests execute the
complete positive and negative matrix described above. The optimized release
`cdylib` and library built successfully.

The release-path SBF checks used `cargo-build-sbf 4.0.0`, platform-tools v1.53,
and its bundled Rust 1.89.0 compiler. An audit build of the pre-remediation
source exposed a reachable 6,336-byte default-SBPF-v0 processor frame and three
caller-frame overlap diagnostics even though `cargo-build-sbf` exited 0. That
was treated as a blocker. The final processor heap-backs decoded controller
states, removes the second 1,280-byte proposal clone, and retains the detached
all-checks-before-write mutation boundary.

```text
cd programs/upgrade_controller
export CARGO_TARGET_DIR=/tmp/ameba-gov-phase2-sbf-v0-target
cargo-build-sbf --arch v0 \
  --sbf-out-dir /mnt/c/Users/space/.codex/tmp/ameba-gov-phase2-verification/sbf-v0-artifact
export CARGO_TARGET_DIR=/tmp/ameba-gov-phase2-sbf-v2-target
cargo-build-sbf --arch v2 \
  --sbf-out-dir /mnt/c/Users/space/.codex/tmp/ameba-gov-phase2-verification/sbf-v2-artifact
```

Each architecture used a distinct clean target and deploy output so a cached v2
artifact could not be mistaken for v0. Both final commands ran without
`--ignore-rust-version` and exited 0. The default SBPF v0 artifact is 119,392
bytes with SHA-256
`527414079fc86a94fa0bcc2f02507ddb798b6962e2a1e06946329d0b97272001`.
The SBPF v2 artifact is 118,096 bytes with SHA-256
`9e9113c98a9fbec77d56ac8da245681aab168c3af9bb8d024c78f67983c72866`.
Neither final controller build emitted an `upgrade_controller` stack-frame,
reachable-processor, or caller-frame-overlap diagnostic. Default v0 still emits
exactly 16 frame-overflow diagnostics while compiling `hybrid_array` and
`crypto_common` dependency rlibs. A final linked-ELF mangled dump contains zero
`hybrid_array` symbols, zero `crypto_common` symbols, and zero occurrences of
all 16 exact offending symbol hashes, proving those functions are absent from
the linked controller. The v2 build printed no stack or overlap diagnostic.

```text
cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

All commands exited 0. TypeScript typechecking passed. Fixture check passed.
The Node test runner passed 5/5 tests with zero failures. `npm ci` emitted the
upstream `uuid@8.3.2` deprecation warning and installed 63 packages; scripts,
audit, and funding output were disabled by the command.

## Target and side-effect confirmation

`C:\Users\space\amoeba-farm\ameba_spread` remained read-only at audited commit
`1b2230d96e51f6582155d8284900fbfc11ff1f18`. No file in that repository was
modified. The universal Spread gate, signed epoch tail, and exhaustive target
tag manifest were not started.

No deployment, local validator deployment, production key access, authority
transfer, loader invocation, live RPC call or mutation, service or automation
change, or live-state mutation occurred. Only ephemeral in-process ProgramTest
keypairs signed local simulated test transactions; no live or production
transaction was signed or submitted. No branch or commit from this worktree was
pushed.

## Remaining blockers before Phase 3

Phase 2 is not a production trust root. Before Phase 3 can close:

1. Review and explicitly authorize the universal `ameba_spread` gate design.
2. Mechanically inventory every target instruction tag and mutability class.
3. Specify the signed epoch tail and client/SDK propagation without changing
   existing inner-handler account contracts.
4. Implement exhaustive target dispatcher and adversarial gate tests in an
   independently reviewed `ameba_spread` change.
5. Preserve unknown-tag-before-account-access behavior and define a safe
   cutover/rollback plan.

Full proposal creation, timelock, freeze, checkpoints, unfreeze, cancellation,
and recovery are Phase 4. Buffer custody and typed Loader-v3 execution are Phase
5. Optional token governance and seat-selection changes are deferred to Phase
6. A production controller program ID, production PDA vectors, deployment,
authority handoff, and evidence bridge remain later explicitly authorized work.
