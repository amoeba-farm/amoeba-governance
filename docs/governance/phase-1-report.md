# Phase 0/1 implementation report

Date: 2026-08-25

This report closes the first implementation slice assigned by Section 22 of
`upgrade-governance-spec.md`. Work stops at the Phase 1 policy and state-model
boundary.

## Source identity and specification

- Audited target repository: `C:\Users\space\amoeba-farm\ameba_spread`
- Active target branch: `main`
- Audited target commit:
  `1b2230d96e51f6582155d8284900fbfc11ff1f18`
- Local `HEAD`, local `main`, `origin/main`, and the live remote `main` all
  resolved to that exact commit.
- The target worktree and index were clean before and after the baseline audit.
- The emailed specification is preserved byte-for-byte at
  `docs/governance/upgrade-governance-spec.md`: 63,270 bytes, SHA-256
  `16f8b4c0cb4e1b05752f5deb299570bf717ffb7ff4e53cd1325801dd4e246117`.

The target repository therefore matches the audited source. No source
divergence report was required.

## Repository and changed files

The implementation lives in the new independent local Git repository
`C:\Users\space\amoeba-farm\ameba_gov`. It is intentionally not a worktree,
submodule, or path dependency of `ameba_spread`.

- Branch: `main`
- Phase 1 implementation commit before this report:
  `884df7de566f17b8a3c15fcef6d8d3b7e1e1f518`
- Configured Git remote: none

Repository-level files:

- `.gitattributes`
- `.gitignore`
- `AGENTS.md`
- `Cargo.lock`
- `Cargo.toml`
- `LICENSE`
- `README.md`
- `rust-toolchain.toml`

Governance evidence and frozen vectors:

- `docs/governance/upgrade-governance-spec.md`
- `docs/governance/repository-survey.md`
- `docs/governance/serialization-decisions.md`
- `docs/governance/phase-1-report.md`
- `fixtures/upgrade_governance_v1.json`

Rust controller scaffold:

- `programs/upgrade_controller/Cargo.toml`
- `programs/upgrade_controller/src/lib.rs`
- `programs/upgrade_controller/src/state.rs`
- `programs/upgrade_controller/src/pda.rs`
- `programs/upgrade_controller/src/digest.rs`
- `programs/upgrade_controller/src/policy.rs`
- `programs/upgrade_controller/src/council.rs`
- `programs/upgrade_controller/src/proposal.rs`
- `programs/upgrade_controller/src/error.rs`
- `programs/upgrade_controller/src/tests/mod.rs`
- `programs/upgrade_controller/src/tests/support.rs`
- `programs/upgrade_controller/src/tests/layouts.rs`
- `programs/upgrade_controller/src/tests/golden_vectors.rs`
- `programs/upgrade_controller/src/tests/digest_vectors.rs`
- `programs/upgrade_controller/src/tests/council_policy.rs`
- `programs/upgrade_controller/src/tests/transitions.rs`

Independent TypeScript parity surface:

- `clients/ts/package.json`
- `clients/ts/package-lock.json`
- `clients/ts/tsconfig.json`
- `clients/ts/tools/generate-vectors.ts`
- `clients/ts/upgradeGovernance/v1.ts`
- `clients/ts/upgradeGovernance/syntheticVector.ts`
- `clients/ts/upgradeGovernance/v1.test.ts`

No file in `ameba_spread` was changed.

## Architecture delivered

The repository is a standalone Cargo workspace containing one nondeployable
library crate. There is deliberately no Solana entrypoint, instruction
processor, loader CPI or direct loader-operation code, signer, key material,
deployment script, or target-program bridge. The pinned `solana-program`
dependency naturally resolves Solana loader-interface crates transitively, but
this scaffold does not call them.

Phase 1 implements:

- fixed version-1 state layouts with eight-byte discriminators, exact byte
  lengths, explicit one-byte enum codecs, canonical booleans, and zero-reserved
  validation;
- domain-separated PDAs for controller config, controller authority, policy,
  council, gate, proposals, buffer verification, and pre/post checkpoints;
- canonical SHA-256 policy, council, and proposal commitments;
- a fixed 1,084-byte proposal material encoding and 1,110-byte domain-prefixed
  preimage;
- fixed seat indexes, explicit company-affiliation metadata, council shape,
  term, uniqueness, concentration, and hash validation;
- policy-derived routine and terminal quorum evaluation, including minimum
  non-company participation and affiliation caps;
- separate proposal, poststate, and unfreeze approval accumulators;
- policy-bound proposal approval and pure state-graph guards;
- fail-closed handling for proposal classes whose evidence model or transition
  graph is not complete in the specification;
- one language-neutral synthetic fixture consumed independently by Rust and
  TypeScript.

The frozen synthetic fixture uses a non-production controller program ID. It
records nine exact PDA addresses and bumps, the complete proposal material and
preimage, and digest
`4c4ca1378a4881777b104d55e8fde500e2ec8eb5380c53fbe022b3aeb93de027`.
The generator has a check-only mode so normal tests fail if the checked-in
fixture drifts.

## Deterministic account and hash sizes

| Type | Discriminator | Exact bytes |
|---|---|---:|
| `ControllerConfigV1` | `AGVCFG01` | 512 |
| `GovernancePolicyV1` | `AGVPOL01` | 160 |
| `CouncilSeatV1` | embedded | 96 |
| `GovernanceCouncilSetV1` | `AGVCNS01` | 640 |
| `ProtocolGateV1` | `AGVGAT01` | 192 |
| `UpgradeProposalV1` | `AGVPRP01` | 1,280 |

| Canonical hash input | Exact bytes |
|---|---:|
| Governance policy material | 96 |
| Council-set material | 511 |
| Proposal material | 1,084 |
| Proposal domain | 26 |
| Proposal domain plus material | 1,110 |

## Commands and results

The unchanged target baseline was run through WSL Ubuntu-22.04:

```text
cd /mnt/c/Users/space/amoeba-farm/ameba_spread/programs/light_token_minter
cargo fmt --all -- --check
cargo test --all-targets
cargo test --test devnet_solo_backfill_2026 \
  --features "devnet-solo-backfill-2026 test-sbf"
cd /mnt/c/Users/space/amoeba-farm/ameba_spread
npm run typecheck
npm test
```

All commands exited 0. The default Rust harnesses passed, the feature harness
passed 1/1, and the target Node suite passed 241/241 executed tests with one
intentional skip.

The final Phase 1 implementation was verified with:

```text
cd /mnt/c/Users/space/amoeba-farm/ameba_gov
CARGO_TARGET_DIR=/home/space/.cache/ameba-gov-target \
  cargo fmt --all -- --check
CARGO_TARGET_DIR=/home/space/.cache/ameba-gov-target \
  cargo clippy --workspace --all-targets -- -D warnings
CARGO_TARGET_DIR=/home/space/.cache/ameba-gov-target \
  cargo test --workspace --all-targets
CARGO_TARGET_DIR=/home/space/.cache/ameba-gov-target \
  cargo build --workspace --release
cd /mnt/c/Users/space/amoeba-farm/ameba_gov/clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

All commands exited 0. Rust passed 28/28 tests with Clippy warnings denied and
the release library built. TypeScript passed 3/3 tests, including fixture
freshness, all nine PDA vectors, and the complete digest material/preimage.
Rust tests independently cover digest mutation sensitivity. `npm ci` reported
the upstream deprecation warning for `uuid@8.3.2`; `npm audit` reported three
moderate advisories through `@solana/web3.js -> jayson -> uuid`, with zero high
or critical advisories. This dependency surface is local, offline vector
tooling and is not part of an executable program.

## Specification interpretations and constraints

The following ambiguities were resolved explicitly and frozen in
`serialization-decisions.md`:

- The user's separate-repository requirement supersedes the specification's
  implied in-target repository placement, while retaining the internal
  `programs/upgrade_controller` path.
- `CouncilSeatV1` has an explicit `company_affiliated` boolean, and the five
  indexes are fixed as two Core Protocol, two Community Delegate, and one
  Security Steward seat.
- The ambiguous policy field is named `policy_hash`, not `set_hash`.
- Source commit and tree fields are SHA-256 release commitments rather than
  padded Git SHA-1 identifiers.
- Fixed optional keys use a canonical presence byte plus 32 bytes; a missing
  value must carry a zero key.
- Proposal creation fixes every digest-bound review, queue, not-before, and
  expiry slot. Queueing may validate but never rewrite them after approval.
- The proposal digest binds both epochs, source tree, rollback proposal,
  buffer owner/authority, account identities, capacity plan, and every receipt
  commitment required by the fixed scaffold.
- `EmergencyFrozen` represents guardian freeze without an active proposal;
  `FrozenForUpgrade` requires one.
- `policy_flags` must remain zero until bits are specified, and delay ordering
  is constrained monotonically.

Remaining constraints are intentional blockers for later phases:

- No production controller program ID has been assigned. Production PDA
  vectors must be generated and independently reviewed after assignment.
- `EmergencyRollback` cannot be authorized from the current proposal alone;
  Phase 3 needs a prior-governed-proposal account and exact cross-account
  precommit proof. It is rejected in Phase 1.
- `CouncilSetRotation` and `TargetImmutability` do not have complete transition
  graphs in the supplied enum and are rejected rather than routed through the
  code-upgrade graph.
- Ratified affiliation metadata cannot prove undisclosed beneficial ownership.
- The exact emailed Markdown contains five intentional Markdown hard-line-break
  trailing spaces. They are retained to preserve byte identity.

These are documented conservative interpretations, not target-runtime
divergence. No target migration or compatibility fallback was introduced.

## Recommended Phase 2 starting point

Begin with a generated, mechanically exhaustive target instruction-surface
manifest before writing a dispatcher change. It must classify the 115 default
Vault tags, 14 DLMM tags, 12 feature-gated Devnet backfill tags, and the separate
writer-math benchmark prefix. Every recognized mutating instruction must be
governed, while any mechanically proven read-only tag must preserve its existing
behavior.

Then specify and test one canonical controller gate account as the absolute
final read-only account of every recognized mutating top-level target
instruction. The dispatcher must validate the instruction tag first, validate
and strip the gate exactly once, and only then decode or invoke the unchanged
handler. The compressed-state wrapper must carry the gate only at the outer
instruction tail so its exact inner-account contract remains intact. Unknown
tags must continue to fail before account access. This work requires a new
explicit instruction and a new independent review.

## Side-effect confirmation

No deployment, authority transfer, signing, key access, loader invocation,
target-program edit, live RPC call, configuration change, service change, or
live-state mutation occurred. No remote repository was created or pushed; the
new repository is local because repository hosting and visibility were not part
of this assignment.
