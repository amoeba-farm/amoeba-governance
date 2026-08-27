# Amoeba Governance Release 1 completion batch

**Status:** Authorized local implementation amendment

**Date:** 2026-08-27

**Governance baseline:** local `codex/phase3-gate-abi` at
`c38867c2fe9b760f0c0c3a539d21f44a52e996bf`

**Spread baseline:** local `codex/phase3-universal-gate` at
`bc3af0e7922e1db5f103d10b64ae2d5866959439`

## 1. Precedence and local-baseline override

This amendment authorizes the Release 1 Phase 4, Phase 5, and Phase 6
engineering batch and Phase 7 readiness artifacts. It supersedes the earlier
`AGENTS.md` phase boundary for this isolated branch. The Phase 2 Bootstrap V1
amendment remains normative for the five equal, unclassified seat authorities,
3-of-5 routine quorum, reserved 4-of-5 terminal threshold, disabled token
governance, and absence of a recovery superuser.

The original assignment required completed Phase 3 evidence at pushed commits.
The user subsequently authorized using the two clean local Phase 3 branches as
the starting point. This is a narrow override of that pushed-baseline gate; it
is not a declaration that Phase 3 is exit-complete. These three Phase 3
blockers remain carried Release 1 blockers:

1. the eight-page governed DLMM legacy transaction is 1,237 bytes, above the
   1,232-byte packet ceiling;
2. the max-20 governed writer-close legacy transaction is 1,276 bytes; and
3. the TypeScript constructor/export checker is not branch-complete.

No Release 1 completion claim may hide or waive those blockers. Any required
Spread change must remain confined to the isolated Release 1 Spread worktree
and must not change market, oracle, writer, staking, DLMM, custody, or settlement
economics.

## 2. Absolute safety boundary

This batch authorizes source, local tests, local ProgramTest/test-validator
activity, synthetic SBF artifacts, documentation, and local commits only.

It does not authorize:

- changing either `main` branch or pushing a branch;
- deploying or upgrading the live Spread program;
- selecting or deploying a production controller identity;
- production or Devnet transaction signing or RPC mutation;
- production key, keypair, seed phrase, KMS, or wallet access;
- ProgramData or buffer authority transfer on a live cluster;
- live gate initialization, controller immutability, or target immutability;
- token voting, token escrow, delegation, snapshots, veto accounts, or vote PDAs;
- frontend, service, timer, tunnel, Edge, automation, or site mutation.

All cluster-facing commands in this batch are planning or read-only verification
unless they run against an isolated local bank with generated synthetic keys.

## 3. Bootstrap V1 consensus decisions

- The council contains exactly five unique, equal, unclassified seat
  authorities.
- Any three active seats satisfy ordinary governance.
- Four seats remain reserved for a future terminal immutability class, which is
  not executable in Release 1.
- Seat authorities may be direct runtime signers or PDA signers supplied by a
  smart-account/multisig CPI with `invoke_signed`.
- The controller accepts no private keys or caller-provided raw signatures.
- Token governance is mechanically disabled and all existing vote fields retain
  their canonical defaults.
- Council replacement is ordinary 3-of-5 governed rotation by the current
  council. There is no guardian, company, recovery, or single-key override.
- Irrecoverable loss of council quorum leaves the protocol frozen.

## 4. Schema gate

Before lifecycle processors, produce
`docs/governance/release-1-schema-audit.md`. Do not repurpose V1 reserved bytes.
Retain `UpgradeProposalV1` as a historical predeployment scaffold and add a
new discriminator, explicit version, digest domain, strict decoder, and
Rust/TypeScript vectors when the Release 1 lifecycle does not fit V1.

The fixed account model must include at least:

- `UpgradeProposalV2`;
- `BufferVerificationV1`;
- `ProgramDataVerificationV1` if byte verification is phase-separated;
- `StateCheckpointV1`;
- `CouncilRotationProposalV1`; and
- `EmergencyFreezeResolutionV1`.

Persisted state must contain only bounded fixed-width fields. Unknown versions,
truncation, trailing bytes, noncanonical booleans, invalid enums, bad bumps,
and nonzero reserved bytes fail closed. There is no implicit V1-to-V2 migration.

## 5. Release 1 lifecycle

The executable code-upgrade states are:

```text
Draft -> BufferAdopted -> BufferVerified -> CouncilApproved
      -> GovernanceSatisfied -> Timelocked -> Frozen
      -> Extended (optional) -> UpgradeExecuted -> ProgramDataVerified
      -> PoststateAccepted -> UnfreezeApproved -> Completed
```

Before `Frozen`, governed cancellation and permissionless expiry are terminal.
After `Frozen`, recovery proceeds only through verified upgrade or rollback,
accepted poststate, and separate governed unfreeze.

Executable proposal classes are `RoutineUpgrade`, `EmergencyRollback`,
`EconomicChange`, and `ConstitutionalChange`. All use equal-seat 3-of-5
approval; class selects rollback, routine, or major delay. Council rotation has
its own typed proposal. Target immutability is unsupported.

Any active seat may create a proposal with a separate payer. Proposal creation
atomically allocates `next_proposal_id`, binds the exact current policy,
council, gate epoch, target nonce, target/ProgramData/loader/authority graph,
artifact, buffer, capacity, rollback, checkpoints, release evidence, and fixed
timing. Initial approvals must occur inside the committed review window, before
expiry, against the pinned creation council and current target nonce.

An ordinary freeze consumes the matching target nonce, increments it, advances
the gate epoch, and makes all competing proposals at the old nonce stale.
Frozen-or-later transitions require the consumed-nonce relation. Overflow and
all stale paths fail.

## 6. Guardian and emergency freeze

The configured guardian may only freeze a canonical Active gate. Guardian
freeze increments the epoch, records a nonzero reason and slot, leaves the
active proposal empty, and consumes no target nonce.

Resumption without upgrade uses a dedicated resolution account bound to the
target and emergency epoch, a routine delay, an accepted emergency checkpoint,
and unchanged ProgramData payload/raw commitment, slot, capacity, and authority.
Three current seats approve; execution is separate and increments the epoch.

Conversion from emergency freeze to upgrade freeze remains continuously frozen.
It requires an approved and timelocked proposal bound to the emergency epoch,
consumes the target nonce, increments the gate epoch, binds the proposal, and
never passes through Active.

## 7. Checkpoints and external drift

`StateCheckpointV1` binds the proposal, phase (`Prestate`, `Poststate`, or
`Emergency`), finalized observation slot, gate epoch, ProgramData slot,
payload/raw commitments, capacity, program-owned root/count, logical compressed
root/count, semantic custody/accounting root, hard combined root, external
metadata root, external raw-balance root, schema identity, and a distinct
approval accumulator and digest.

Program-owned, compressed, semantic custody, identity, owner, mint, authority,
deficit, count, schema, and unexpected ProgramData mismatches are hard blockers.
Positive external donations may be reported only for the same known account
with unchanged identity and semantic accounting, no deficit, and explicit
3-of-5 poststate acceptance. They are never silently normalized.

## 8. Artifact and ProgramData verification

Benchmark 4 KiB, 8 KiB, and 16 KiB chunk hashing under the pinned SBF runtime
before selecting the fixed V1 chunk size. The proposal binds canonical full
artifact SHA-256 plus artifact length, chunk size/count, chunk-domain identity,
and a deterministic binary Merkle root.

Leaves include a domain separator, little-endian chunk index, exact actual
length, and exact bytes. Nodes include a distinct node domain. Empty/padding
rules and final partial chunks are deterministic and have Rust/TypeScript golden
vectors.

Before verification, validate the exact Upgradeable Loader Buffer representation
and payload length, transfer authority through `SetAuthorityChecked` to the
controller authority PDA, re-read the final authority, and enter
`BufferAdopted`. The controller exposes no buffer-write instruction. Chunk
verification reads exact bytes from the sealed account, verifies a bounded
proof, and sets one bitmap bit. Finalization requires every expected bit.

After upgrade, independently verify canonical Program/ProgramData linkage,
header, deployed slot, controller authority, capacity, payload length, every
payload chunk, required zero tail, and final raw ProgramData commitment before
entering `ProgramDataVerified`.

## 9. Closed Loader-v3 surface

The controller accepts no arbitrary program ID, CPI bytes, or account vector.
Only typed buffer adoption, checked extension, exact upgrade, verification, and
canonical-treasury close operations are permitted.

Checked extension is a separate transaction and strictly earlier slot. A
proposal requiring extension is non-executable if `ExtendProgramChecked` is not
available. Upgrade execution accepts only bounded canonical ComputeBudget
instructions, optionally one exact nonce advance, and exactly one top-level
controller `ExecuteUpgradeV1`, with nothing after it. The controller performs
one exact inner Loader-v3 Upgrade CPI using the committed ProgramData, Program,
sealed buffer, treasury, Rent, Clock, and authority PDA. Success remains frozen.

Rollback is its own precommitted, sealed, mechanically verified, approved,
governance-satisfied, and timelocked `EmergencyRollback` proposal. It never
automatically unfreezes.

## 10. Unfreeze and council rotation

Poststate and unfreeze approvals use different accumulators and digests. The
current council approves poststate and unfreeze while also binding the original
creation council and proposal digest. Unfreeze executes in a separate
transaction only after ProgramData verification and accepted poststate, then
increments the epoch, clears freeze fields, records the completed proposal, and
activates the gate.

Council rotation creates an immutable candidate five-seat council, then a typed
rotation proposal approved by the current council and delayed by the major
timelock. Activation updates only the current council version (and a dedicated
rotation nonce if introduced). Old council accounts remain immutable history.
Initial proposal approvals use the creation council; poststate and unfreeze use
the current council.

## 11. Clients, evidence, testing, and readiness

Complete a public execution-free `./upgrade-governance` package with constants,
types, derivations, V1/V2 codecs and digests, Merkle proofs, builders, finalized
observations, planning, verification, receipts, and redaction. Signer execution
is injected and local. Operator paths require finalized reads, exact
cluster/genesis checks, explicit arming, deterministic operation IDs, a durable
JSONL journal, exclusive lock, first-429 persistence/backoff/exit, full decoded
display, immediate pre-sign and pre-submit rereads, and no private-key fallback.

Receipt v3 independently proves the one-instruction controller envelope, one
inner loader CPI, complete governance state, sealed bytes, ProgramData bytes and
zero tail, protected pre/post roots, explicitly accepted donation drift,
bounded history, and controller trust root. After a simulated handoff it rejects
external-key direct upgrade.

Tests must include a pure reference state machine, exhaustive account and
privilege matrices with byte-identical failure atomicity, all 32 council masks,
timing and rotation races, guardian limits, checkpoints and donation/deficit
cases, Merkle vectors and bitmap failures, real Loader-v3 behavior, ProgramData
verification, packet/ALT boundaries, package consumer checks, journal/429
behavior, clean SBPF v0/v2 builds and linked-ELF stack analysis, and a complete
actual-SBF lifecycle against a sacrificial local target.

Phase 7 output is planning and verification only: production identity,
deployment/initialization manifests, controller immutability, Spread bridge,
authority handoff, old-authority negative test, rollback rehearsal, receipt-v3,
and operator-runbook artifacts. No production identity or real seat key is
populated.

## 12. Internal gates and completion reports

1. Schema and Rust/TypeScript vectors pass before lifecycle processors.
2. Lifecycle and failure-atomic tests pass before loader CPI.
3. Exact sealed bytes pass before `ExecuteUpgrade` is enabled.
4. Real loader rehearsal passes before receipt/readiness claims.
5. Actual SBF completes poststate and separate unfreeze before completion.

Required reports are:

```text
docs/governance/release-1-completion-report.md
docs/governance/phase-7-readiness-report.md
```

The isolated Spread branch additionally produces
`docs/governance/release-1-integration-report.md` if Spread integration files
change. Every report records exact commits, changed files, normative hashes,
schemas, tags/accounts, transitions, Merkle domains/vectors, loader envelope,
test/build/SBF/stack/packet evidence, warnings, blockers, and explicit
confirmation that no live or production mutation occurred.
