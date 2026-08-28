# Amoeba Governance Release 1 completion report

**Status:** BLOCKED CANDIDATE — RELEASE 1 IS NOT EXIT-COMPLETE

**Branch:** `codex/release1-completion`

**Safety scope:** local source, local synthetic accounts, ProgramTest/local
validator, and reproducible artifacts only

This report records the completed local engineering candidate and the security
boundaries that prevent an exit-complete or ceremony-ready claim. Evidence that
has not run against a clean exact controller artifact is identified as awaiting
that run; it is never treated as success.

## 1. Source identity and tree state

| Field | Value |
|---|---|
| Governance starting commit | `c38867c2fe9b760f0c0c3a539d21f44a52e996bf` |
| Spread Phase 3 starting commit | `bc3af0e7922e1db5f103d10b64ae2d5866959439` |
| Spread Phase 3 closure implementation | `8417c53b3af99979ac0ab6f9e1a911eeaf415734` |
| Spread Phase 3 closure report | `02ebec33eac216245fc49fcaa0383001e3afea75` |
| Governance implementation/evidence commit before this report | `6151e2c50356d2031331feefeb5e7d01f1916463` |
| Spread implementation/evidence commit before its report | `120546171f37cc77fc4f138f62c05815bb027b2f` |
| Governance branch | `codex/release1-completion` |
| Spread branch | `codex/release1-completion` |
| Governance worktree/index | clean after committing this report; rechecked before the artifact run |
| Spread worktree/index | clean after committing its report; rechecked independently |
| Governance `origin/main` | `da12ead467426afb7fe06c3048e0687094ab5da5` (read-only observation) |
| Spread `origin/main` | `1b2230d96e51f6582155d8284900fbfc11ff1f18` (read-only observation) |
| Remote mutation | none; neither branch was pushed |

The report commit follows the implementation commit above. Git commits cannot
self-reference their own object ID; the final local report commit is captured
externally with `git rev-parse HEAD` and in the operator handoff.

### Final changed-file inventory

The exact tracked inventory is generated with
`git diff --name-only c38867c2fe9b760f0c0c3a539d21f44a52e996bf..HEAD`.
It contains only governance source/tests/package/CI/documentation. The Spread
inventory from `02ebec33eac216245fc49fcaa0383001e3afea75` contains only its CI
workflow and integration report; no Spread runtime or client source changed.

Generate this from both starting commits, review every path, and include only
the final tracked diff. No target economics, live release intent, key material,
or service configuration may appear.

## 2. Normative inputs

These hashes were measured from the local inputs before the final evidence run.
They must be rechecked if any normative file changes.

| Input | SHA-256 |
|---|---|
| `docs/governance/amendments/release-1-completion-batch.md` | `02882c25abcaf989676bd47b80523670f236a64ff6652e59226beb38683e5b4b` |
| `docs/governance/amendments/phase-3-universal-spread-gate-v1.md` | `eb4c18bb469dba1c66fa7e698a1c685d3fefc5ee34634976b2d29c671330b6ad` |
| `docs/governance/amendments/phase-2-bootstrap-v1.md` | `966efd6d42b4e2814b85dde836b4c1337cca227388c1c3f16e75301bb8e25fbf` |
| `docs/governance/serialization-decisions.md` | `9c767f5436632a9301d7246fd164a0b84556d56a2be84e3de8a69e7cc28abcfd` |
| `docs/governance/upgrade-governance-spec.md` | `16f8b4c0cb4e1b05752f5deb299570bf717ffb7ff4e53cd1325801dd4e246117` |
| Local architecture PDF | `c4ae5f589e30a52b881d935b46a9e2b93ac6336aa8d00313ff2e65190c57b011` |

The PDF was found at
`C:/Users/space/amoeba-farm/ameba_spread/output/pdf/Amoeba_Spread_Upgrade_Governance_Architecture.pdf`.
It is an input, not a generated Release 1 artifact.

## 3. Phase 3 prerequisite

Phase 3 is locally closed on the isolated Spread branch. The closure report
records 4/4 actual-SBF tests under each of SBPF v0 and v2, 311 passing client
tests plus one intentional skip, exact gate/epoch enforcement, all compressed
logical inner indexes, and closure of the two legacy packet blockers through a
finalized-ALT v0 path. The 1,237-byte eight-page and 1,276-byte max-20 legacy
forms remain rejected; the maintained forms measured 312 and 385 bytes.

This local prerequisite did not push or deploy either repository. Its evidence
must remain distinguishable from the Release 1 controller lifecycle evidence.

## 4. Schema decision and fixed accounts

`UpgradeProposalV1` remains a historical 1,280-byte predeployment scaffold.
Its discriminator, account version, digest domain, fields, and 142 zero reserved
bytes are unchanged. Release 1 uses `UpgradeProposalV2`; there is no implicit
migration and no Release 1 processor accepts V1.

| Account | Discriminator | Version | Bytes | Release 1 use |
|---|---|---:|---:|---|
| `ControllerConfigV1` | `AGVCFG01` | 1 | 512 | one-time target, authority, policy, council, guardian, treasury, timing, proposal-id and nonce root |
| `GovernancePolicyV1` | `AGVPOL01` | 1 | 160 | immutable equal-seat 3-of-5 policy; token fields canonical zero |
| `GovernanceCouncilSetV1` | `AGVCNS01` | 1 | 640 | immutable five-seat set |
| `ProtocolGateV1` | `AGVGAT01` | 1 | 192 | active/emergency/proposal-frozen gate and epoch |
| `UpgradeProposalV1` | `AGVPRP01` | 1 | 1,280 | historical codec/regression only |
| `UpgradeProposalV2` | `AGVPRP02` | 2 | 1,792 | complete immutable upgrade/rollback proposal plus separate approval accumulators |
| `BufferVerificationV1` | `AGVBFV01` | 1 | 512 | sealed Loader buffer and chunk bitmap |
| `ProgramDataVerificationV1` | `AGVPDV01` | 1 | 640 | deployed payload/tail bitmap and raw commitment |
| `StateCheckpointV1` | `AGVCKP01` | 1 | 704 | immutable accepted/rejected audit anchor |
| `CheckpointAttestationV1` | `AGVATT01` | 1 | 384 | one current-seat checkpoint attestation |
| `CouncilRotationProposalV1` | `AGVROT01` | 1 | 384 | typed immutable council rotation |
| `EmergencyFreezeResolutionV1` | `AGVEFR01` | 1 | 640 | governed resume-without-upgrade |
| `EmergencyFreezeObservationV1` | `AGVEFO01` | 1 | 512 | immutable guardian-freeze observation |
| `ProgramDataFailureObservationV1` | `AGVPDF01` | 1 | 512 | immutable typed failed-deployment evidence |

All persisted collections are bounded and fixed-width. Decoders reject unknown
versions, wrong lengths/discriminators/bumps, noncanonical options and booleans,
bad enums, trailing bytes, and nonzero reserved bytes.

Initialization rejects a target ProgramData account above the 1,572,909-byte
atomic raw-account ceiling because that target could never satisfy Release 1
mechanical hashing. The controller ProgramData is still linkage- and
initializer-authority-verified, but is not capped by the target checkpoint
policy.

Gate B closed at `81c6b5fd4b0de8e9f827f2c0265721ba73f2eb67`.
The checked-in fixture file currently hashes to
`277c6831615b84dd9ea144f6d1f84aa6dc6a350c1f6952e047f7ee2c9ff11c38`;
its canonical self-excluding fixture contract value is
`b7aa9c21aa843c23e26eca02e0a7ef9283527e4c3a6f2a1593d61f1df2143990`.
Rust/TypeScript Phase 2, Phase 3 bridge, and Release 1 vector drift checks pass.

## 5. Instruction tags and account contracts

Abbreviations: `SW` signer+writable, `SR` signer+read-only, `W` writable,
`R` read-only. Order shown is consensus-facing. Tags 0 and 26 are decoded only
far enough to reject; neither is executable.

| Tag | Instruction | Ordered accounts |
|---:|---|---|
| 0 | `RecordProposalApprovalV1` | closed historical codec |
| 1 | `InitializeControllerV1` | payer SW; initializer SR; controller Program R; controller ProgramData R; target Program R; target ProgramData R; Loader R; config W; authority PDA R; gate W; policy W; council W; treasury R; guardian R; five seat authorities R; System R |
| 2 | `CreateProposalV2` | payer SW; creator seat SR; config W; policy R; council R; gate R; target Program R; target ProgramData R; Loader R; authority PDA R; treasury R; buffer R; uploader R; proposal W; System R |
| 3 | `ApproveProposalV2` | config R; policy R; creation council R; gate R; proposal W; seat SR |
| 4 | `FinalizeGovernanceV2` | config R; policy R; creation council R; gate R; proposal W |
| 5 | `QueueProposalV2` | config R; policy R; gate R; proposal W |
| 6 | `FreezeProposalV2` | config W; policy R; council R; gate W; proposal W; target Program R; target ProgramData R; Loader R; authority PDA R; rollback proposal R; rollback verification R; rollback buffer R |
| 7 | `CancelProposalV2` | config R; policy R; council R; gate R; proposal W; seat SR |
| 8 | `ExpireProposalV2` | config R; gate R; proposal W |
| 9 | `GuardianFreezeV1` | payer SW; config R; gate W; target Program R; target ProgramData R; Loader R; authority PDA R; guardian SR; emergency observation W; System R |
| 10 | `CreateEmergencyResolutionV1` | payer SW; config R; policy R; council R; gate R; freeze observation R; resolution W; System R |
| 11 | `ApproveEmergencyResolutionV1` | config R; policy R; current council R; gate R; resolution W; seat SR |
| 12 | `QueueEmergencyResolutionV1` | config R; policy R; current council R; gate R; resolution W |
| 13 | `ExecuteEmergencyResolutionV1` | config R; policy R; current council R; gate W; resolution W; freeze observation R; emergency checkpoint R; target Program R; target ProgramData R; Loader R; authority PDA R; Instructions sysvar R |
| 14 | `ConvertEmergencyFreezeV2` | config W; policy R; council R; gate W; proposal W; freeze observation R; target Program R; target ProgramData R; Loader R; authority PDA R; rollback proposal R; rollback verification R; rollback buffer R |
| 15 | `CreateCheckpointAttestationV1` | payer SW; config R; policy R; current council R; gate R; subject R; checkpoint R; attestation W; seat SR; System R |
| 16 | `RecastCheckpointAttestationV1` | config R; policy R; current council R; gate R; subject R; checkpoint R; attestation W; seat SR |
| 17 | `FinalizeCheckpointV1` | payer SW; config R; policy R; current council R; gate R; subject R/W by phase; target Program R; target ProgramData R; typed phase evidence R; required baseline R for Poststate/rollback Prestate only; checkpoint W; three attestations R; System R |
| 18 | `CreateCandidateCouncilSetV1` | payer SW; creator seat SR; config R; policy R; current council R; gate R; candidate council W; five candidate seats R; System R |
| 19 | `CreateCouncilRotationV1` | payer SW; creator seat SR; config R; policy R; current council R; candidate council R; gate R; rotation W; System R |
| 20 | `ApproveCouncilRotationV1` | config R; policy R; current council R; candidate council R; gate R; rotation W; seat SR |
| 21 | `ActivateCouncilRotationV1` | config W; policy R; current council R; candidate council R; gate R; rotation W |
| 22 | `QueueCouncilRotationV1` | config R; policy R; current council R; candidate council R; gate R; rotation W |
| 23 | `ExpireEmergencyResolutionV1` | config R; policy R; gate R; resolution W |
| 24 | `CancelCouncilRotationV1` | config R; policy R; current council R; candidate council R; gate R; rotation W; seat SR |
| 25 | `ExpireCouncilRotationV1` | config R; gate R; rotation W |
| 26 | reserved emergency-resolution cancellation V2 | closed; no V1 cancellation accumulator exists |
| 27 | `AdoptBufferV1` | payer SW; config R; gate R; proposal W; buffer W; uploader SR; authority PDA R; buffer verification W; Loader R; System R |
| 28 | `VerifyBufferChunkV1` | config R; gate R; proposal R; buffer R; buffer verification W; authority PDA R; Loader R |
| 29 | `FinalizeBufferVerificationV1` | config R; gate R; proposal W; buffer R; buffer verification W; authority PDA R; Loader R |
| 30 | `ExtendTargetV1` | payer SW; config R; gate R; proposal W; accepted Prestate R; target ProgramData W; target Program W; authority PDA W; Loader R; System R; Rent R; Instructions sysvar R |
| 31 | `ExecuteUpgradeV1` | payer SW; config R; policy R; gate R; proposal W; counterpart proposal R; counterpart buffer verification R; accepted Prestate R; buffer verification W; ProgramData verification W; target ProgramData W; target Program W; sealed buffer W; treasury W; Rent R; Clock R; authority PDA R; Loader R; System R; Instructions sysvar R |
| 32 | `VerifyProgramDataChunkV1` | config R; gate R; proposal R; target Program R; target ProgramData R; authority PDA R; Loader R; ProgramData verification W |
| 33 | `FinalizeProgramDataVerificationV1` | config R; gate R; proposal W; target Program R; target ProgramData R; authority PDA R; Loader R; ProgramData verification W |
| 34 | `ApproveUnfreezeV1` | config R; policy R; current council R; gate R; proposal W; accepted Poststate R; verified ProgramData verification R; target Program R; target ProgramData R; authority PDA R; Loader R; seat SR |
| 35 | `ExecuteUnfreezeV1` | config R; policy R; current council R; gate W; proposal W; reciprocal proposal W; accepted Poststate R; ProgramData verification R; target Program R; target ProgramData R; authority PDA R; Loader R; Instructions sysvar R |
| 36 | `CloseAbandonedBufferV1` | config R; gate R; proposal R; buffer verification W; buffer W; treasury W; authority PDA R; Loader R |
| 37 | `ActivateRollbackV1` | config R; policy R; gate W; primary R; rollback W; rollback buffer verification R; primary ProgramData verification R; typed failure evidence R; target Program R; target ProgramData R; authority PDA R; Loader R |
| 38 | `ObserveProgramDataFailureV1` | payer SW; config R; gate R; primary R; ProgramData verification R; target Program R; target ProgramData R; authority PDA R; Loader R; failure observation W; System R |

Candidate-council creation permits exactly one role-coalescing alias: a creator
who remains a candidate seat may supply the same signer/read-only account in
the creator and matching seat positions. Candidate seat authorities remain
unique, the guardian remains excluded, and every other account alias fails.

Tags 27–38 are open only through the production typed dispatcher. Unit and
ProgramTest account matrices pass; tag 0, reserved tag 26, and unknown tags
retain generic early rejection.

## 6. State transitions, timing, and nonce

| Flow | Legal transition |
|---|---|
| Upgrade | `Draft -> BufferAdopted -> BufferVerified -> CouncilApproved -> GovernanceSatisfied -> Timelocked -> Frozen -> Extended? -> UpgradeExecuted -> ProgramDataVerified -> PoststateAccepted -> UnfreezeApproved -> Completed` |
| Pre-freeze terminal | eligible pre-freeze state `-> Cancelled` by independent 3-of-5 cancellation, or `-> Expired` permissionlessly after expiry |
| Guardian | `Active -> EmergencyFrozen`; active proposal remains default and target nonce is unchanged |
| Emergency resume | `Draft -> CouncilApproved -> Timelocked -> Executed`; separate execute changes `EmergencyFrozen -> Active` only after delay, unchanged exact ProgramData, accepted Emergency checkpoint, and current 3-of-5 |
| Emergency conversion | approved/timelocked proposal bound to emergency epoch; `EmergencyFrozen -> FrozenForUpgrade` with no Active interval |
| Rollback | prepared `EmergencyRollback` stays timelocked until typed recoverable failure; activation changes the active frozen proposal and increments the gate epoch; verification/poststate/unfreeze remain separate |
| Council rotation | immutable candidate `->` rotation `Draft -> CouncilApproved -> Timelocked -> Activated`, with `Cancelled` and `Expired` pre-activation terminals |

An ordinary freeze requires `proposal.target_nonce == config.target_nonce`, then
atomically increments `target_nonce` once, increments the gate epoch, binds the
active proposal, and sets `Frozen`. All frozen-or-later paths require
`config.target_nonce == proposal.target_nonce + 1`. Competing proposals at the
old nonce become stale. Guardian freeze increments only the epoch. Emergency
conversion consumes the nonce once while remaining continuously frozen.
Overflow and every stale-nonce path fail byte-identically in the 48 generated
reference-model traces and processor/model differential tests.

Freeze, emergency conversion, and rollback activation also reserve enough
pre-expiry runway for checkpoint review and at least one execution slot, plus a
separate earlier extension slot when required. Post-upgrade verification and
recovery do not become impossible merely because expiry has elapsed.

## 7. Guardian, council, and token boundaries

- Council state contains exactly five equal, unclassified authorities.
- Routine governance is exactly 3-of-5; 4-of-5 remains reserved and cannot
  reach target immutability in Release 1.
- Token governance fields remain canonical defaults; there is no token vote,
  escrow, snapshot, delegation, veto, or vote-result program/account.
- No company class, weight, affiliation, appointment body, or non-company
  minimum enters consensus.
- The guardian can perform only the Active-to-EmergencyFrozen transition. It is
  rejected as a council seat and cannot resolve, convert, approve, rotate,
  invoke the loader, or unfreeze.
- There is no recovery superuser. Irrecoverable loss of three current seats
  leaves the protocol frozen.
- Initial proposal approvals use the pinned creation council. Poststate and
  unfreeze use the current council while binding the original proposal digest.

All 32 five-seat masks, rotation races, guardian-role exclusions, and a real
smart-account PDA signer supplied through CPI pass locally.

## 8. Checkpoints and external drift

Each checkpoint binds the finalized observation slot, frozen epoch,
ProgramData slot/capacity/payload/raw commitments, program-owned and compressed
roots/counts, semantic custody/accounting, hard combined root, external
metadata/raw-balance observations, schema, and a separate 3-of-5 attestation
accumulator.

Program-owned, compressed, semantic custody, identity, owner, mint, authority,
deficit, count, schema, and unexpected ProgramData mismatches are hard blockers.
Only a nonnegative donation to the same known identity, with unchanged semantic
accounting and no deficit, may be explicitly recorded and accepted by the same
current 3-of-5. It is never silently normalized.

A rollback failure Prestate deliberately binds two different facts:

- `target_payload_commitment` is the expected candidate artifact payload
  commitment from the linked primary proposal; and
- `target_raw_programdata_commitment` is the actual failed raw ProgramData
  observation.

It inherits the accepted primary Prestate's protected roots and policy. It does
not claim the failed bytes equal the expected artifact. Header, authority, and
capacity observations are evidence-only and cannot activate typed rollback;
only `PayloadLeaf` or `ZeroTail` failure with a still-canonical Loader graph is
recoverable through tag 37, or a separately attested rejected Poststate may
serve as the typed failure evidence.

Checkpoint donation/deficit/identity/replay tests pass in host, model, and
ProgramTest coverage. Positive drift is never silently normalized.

## 9. Artifact Merkle and byte custody

Release 1 selects a fixed 16,384-byte chunk and a 1,572,864-byte maximum
artifact. The selected maximum has 96 real chunks; the tree pads to 128 leaves
and proofs have at most seven nodes. The fixed bitmap remains 64 bytes and all
bits above `chunk_count` stay zero.

```text
leaf  = SHA256("AMOEBA_ARTIFACT_CHUNK_V1"
               || chunk_index_u32_le
               || actual_chunk_length_u32_le
               || exact_chunk_bytes)
node  = SHA256("AMOEBA_ARTIFACT_NODE_V1" || left || right)
empty = SHA256("AMOEBA_ARTIFACT_EMPTY_V1" || padded_index_u32_le)
```

Scheme ID:
`8a859639697974c16e2eb3743d260d303c11313c7d3c5c0ddcd0563f5d1a32a5`.

Golden vector: 32,785 generated bytes, three chunks, root
`9acc02d749902b3a13336fa278bba9a0686087c3e66ae02aac08de7b1e0aabaa`.
The first/middle/final leaf lengths are 16,384, 16,384, and 17 bytes; their
hashes are respectively
`6df939795086eb954ffce30332644b8b8af3ad9fbeb991f82efc1f2ae58757bd`,
`c4c267619eb62c19b25d4e4667bfbbb73e362477e96a0a2ae94ca3e9ac5083cc`,
and `4eea3daae3c1e39b693157e831c0a796b7619c9463b926b257230c04cef1cab7`.

The benchmarked 16-KiB standalone leaf/proof used 10,615 CU under v0 and
10,581 under v2. The selected composed raw ProgramData ceiling is 1,572,909
bytes including the 45-byte Loader header; its guardian benchmark used 798,245
CU under v0 and 798,323 under v2. These are component measurements, not final
integrated-controller results.

Buffer adoption validates Loader layout and length, invokes only
`SetAuthorityChecked`, re-reads controller custody, and creates the canonical
verification bitmap. The controller has no buffer-write instruction. Execute
must remain closed until all chunks are mechanically proven and finalized.

Rust/TypeScript vectors and duplicate/missing/wrong-proof/no-write-after-adoption
tests pass. The maximum-size integrated actual-SBF benchmark awaits the clean
v0/v2 artifact run recorded in Section 13.

## 10. Loader envelope, ProgramData, and rollback

The upgrade top-level envelope permits only bounded canonical ComputeBudget
instructions, optionally one exact nonce advance, and one final controller
`ExecuteUpgradeV1`; no sibling arbitrary, target, token, System, or Loader
instruction is accepted. The inner CPI is exactly one Loader-v3 `Upgrade` over
the committed ProgramData, Program, sealed Buffer, canonical treasury, Rent,
Clock, and authority PDA.

Checked extension uses only `ExtendProgramChecked`, in a strictly earlier slot,
for the exact delta and capacity. There is no unchecked fallback. Upgrade
success changes only to `UpgradeExecuted`; ProgramData payload chunks, zero
tail, header, authority, deployed slot, capacity, and full raw commitment are
then verified in later transactions.

A rollback is a distinct precommitted `EmergencyRollback` proposal and sealed,
verified, approved, governance-satisfied, timelocked buffer. It is activated
only from typed recoverable evidence while the gate stays frozen. It never
auto-unfreezes and must pass its own deployed-byte verification, poststate, and
separate unfreeze.

Gate E host runs pass checked buffer adoption against real Loader-v3. The full
checked extend/upgrade/close and failure-atomic rehearsal awaits the exact clean
controller artifact selected by the final v0/v2 build.

Gate F actual-controller-SBF tests are implemented for the happy lifecycle,
recoverable rollback, and model/processor differential under v0 and v2. Their
clean-artifact rerun awaits the attested builds. These tests deliberately use a
test-only bank transition from bootstrap-frozen to Active and a legacy
unchecked sacrificial target handoff; they do not prove either missing
production ceremony path described in Section 15.

The two are not interchangeable. A test using `prefer_bpf(false)` proves real
Loader behavior but not execution of the controller ELF.

## 11. TypeScript package, CLI, and operator

The public package exports constants/types, V1/V2 codecs and digests, PDA
derivations, Merkle proofs, instruction builders, finalized observations,
planning, redaction, operator controls, CLI routing, and receipt v3. Wallet/KMS
execution is caller-injected; the package contains no private-key fallback.

Required CLI commands are present:

```text
schema observe plan-initialize plan-proposal adopt-buffer verify-buffer approve
finalize-governance queue guardian-freeze plan-emergency-resolution freeze
bind-prestate approve-checkpoint execute-extension execute-upgrade
verify-programdata bind-poststate approve-unfreeze unfreeze cancel expire
close-buffer plan-rollback create-council-set rotate-council
plan-controller-immutability plan-authority-handoff verify-handoff
```

The last three are planning/verification only and reject arming. Mutations
require exact explicit operation-ID arming, finalized genesis-bound reads,
pre-sign and pre-submit re-reads, full decoded confirmation, an exclusive local
lock, a hash-chained JSONL journal, injected signing, and first-429 persistence /
backoff / exit without automatic retry. Plan IDs bind controller/config,
target/ProgramData and live slot/capacity/authority, gate status/epoch, proposal
digest/state/immutable timing, exact council identity/version/hash, nonce,
buffer authority/status/chunk progress, artifact commitments, ProgramData
verification status and payload/zero-tail progress, and checkpoint
identity/digest/phase/acceptance.

TypeScript typecheck passes; 95 tests pass with zero failures; vector and bridge
fixtures match; build, installed-package consumer, and dry-run package checks
pass. The dry-run tarball is 109,151 bytes with npm shasum
`277f03125e56b7d364f3534d4959b5bd208d3c93`. `npm audit --audit-level=high`
exits successfully while reporting four lower-severity transitive advisories
(one low, three moderate) in `esbuild` and the pinned Solana web3 dependency
chain.

## 12. Receipt v3

Receipt v3 independently verifies the exact top-level envelope, one exact inner
Loader CPI, governance identities/quorum/timing/nonce/epochs, sealed buffer
bytes and bitmap, ProgramData payload/raw hash/zero tail, hard pre/post roots,
explicit positive donation drift, frozen history, and controller trust root.
Synthetic/default production identities fail closed. A simulated post-handoff
receipt must reject an external-key direct upgrade.

The receipt uses the explicit predeployment schema identity
`amoeba-governed-upgrade-receipt-v3-predeployment-r4` at receipt version 3; the
earlier internal drafts were not externally frozen. It records proposal class and
the committed routine/major/rollback/review/expiry delays, derives the exact
class-selected timing, verifies first approval and threshold crossing inside
the review window, orders governance satisfaction and queue before freeze,
requires sealed-buffer verification before first approval, enforces protected
freeze runway, and distinguishes one exact ordinary-freeze epoch increment
from one exact emergency-conversion epoch increment before the separate
unfreeze increment.

The receipt fixture, canonical-account and frozen-history re-queries, trust-root
recomputation, altered-byte negatives, and former-authority negative proof pass
inside the 95-test TypeScript suite. Production trust claims remain rejected.

## 13. Verification matrix

| Required evidence | Exact final result |
|---|---|
| Rust formatting | pass |
| Clippy `-D warnings` | pass across workspace/all targets |
| Host/unit/property/model tests | 188 pass; 48 deterministic model traces included |
| Account/privilege/failure-atomic matrix | tags 1–25 and 27–38 pass; rejected writes remain byte-identical |
| Native ProgramTest | 1 complete Gate C matrix pass in 24.64 seconds |
| Real Loader-v3 SetAuthorityChecked/Extend/Upgrade/Close/rollback | checked adoption passes; artifact-consuming rehearsals await clean ELF |
| Complete controller actual-SBF lifecycle v0 | awaiting clean-artifact run; downstream only, not bootstrap/handoff proof |
| Complete controller actual-SBF lifecycle v2 | awaiting clean-artifact run; downstream only, not bootstrap/handoff proof |
| SBPF-v0 linked-ELF stack analysis | awaiting clean checked build |
| SBPF-v2 linked-ELF stack analysis | awaiting clean checked build |
| Rust/TypeScript fixture parity | pass |
| TypeScript type/test/build/package | pass; 95/95 tests |
| Receipt-v3 verifier | pass, predeployment schema r4 |
| Packet/ALT 1,232-byte matrix | 40 shapes pass; all v0 fit; maximum 1,136 bytes |
| Synthetic identity release rejection | pass |
| CI workflow validation/run | workflow expanded and locally represented; no hosted run because no push is authorized |

No pure mock may substitute for the final Loader acceptance test. No host
processor delegate may substitute for the full controller ELF. No cached
artifact from another checkout or architecture may be used.

## 14. Final artifacts and diagnostics

| Artifact | Bytes | SHA-256 | Source commit/toolchain |
|---|---:|---|---|
| Controller SBPF v0 | awaiting clean build | awaiting clean build | pinned Agave `cargo-build-sbf`, tools `v1.53`, locked Cargo graph |
| Controller SBPF v2 | awaiting clean build | awaiting clean build | pinned Agave `cargo-build-sbf`, tools `v1.53`, locked Cargo graph |
| TypeScript package dry run | 109,151 | npm shasum `277f03125e56b7d364f3534d4959b5bd208d3c93` | Node/npm versions captured by finalizer |

Compiler diagnostics, exact linked symbols, maximum frames, caller-overlap
analysis, and dependency-only symbol exclusion await the two clean checked
build receipts.

## 15. Warnings and unresolved blockers

Unresolved blockers and warnings:

1. The controller has no typed `AcceptTargetAuthorityV1`. Loader-v3
   `SetAuthorityChecked` requires both current and new authorities to sign, and
   the controller authority PDA can become a signer only through a narrowly
   typed controller `invoke_signed` CPI. A legacy unchecked transfer is
   technically possible but is not the reviewed ceremony.
2. Initialization deliberately creates an epoch-1 bootstrap
   `EmergencyFrozen` gate, but no production instruction can govern it to
   `Active`. The actual-SBF harness bank-patches Active only for downstream
   lifecycle testing. Council rotation is reachable but does not activate the
   gate.
3. Making this controller immutable would permanently preserve both omissions.
   Phase 7 is therefore not executable-ready, regardless of downstream Loader
   test success.
4. Clean v0/v2 artifacts, linked-ELF stack analysis, Gate E artifact-consuming
   rehearsals, and Gate F downstream actual-SBF runs still need capture after
   the report commit.
5. Four lower-severity npm advisories (one low, three moderate) originate in
   `esbuild` and pinned Solana web3 transitive dependencies. No breaking or
   unsafe dependency downgrade was used to hide them.
6. No independent audit or hosted CI run exists on these unpushed branches.

No blocker may be converted into a warning merely to claim completion.

## 16. Phase 7 boundary and no-live attestation

Phase 7 outputs are templates, plans, runbooks, and read-only verifiers only.
No final production controller ID or real seat key is populated.

For this local batch, no live deployment, Mainnet/Devnet upgrade, production
key access, signing, transaction submission, live RPC write, controller or
Spread initialization, ProgramData/buffer authority transfer, controller or
target immutability, token governance, repository push, `main` update, service
change, timer change, tunnel change, Edge change, or frontend mutation is
authorized or recorded.

Operator attestation: the local command history, Git state, and branch boundary
show no live or remote mutation. The Spread Devnet ProgramData was untouched.

## 17. Exit decision

**Current decision:** NOT EXIT-COMPLETE; NOT PHASE-7 READY.

The downstream Release 1 kernel is implemented and host/package verification is
green. Completion remains blocked by the missing checked PDA-accepted handoff
and governed bootstrap activation capabilities, plus the clean-artifact SBF
evidence still awaiting capture. Neither blocker may be downgraded to a warning
or bypassed with legacy unchecked handoff or test-only bank mutation.
