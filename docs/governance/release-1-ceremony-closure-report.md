# Amoeba Governance Release 1 ceremony-closure report

Status: **LOCAL ENGINEERING GATES COMPLETE — EXTERNAL AUDIT AND PRODUCTION
CEREMONY REMAIN OPEN**

Branch: `codex/release1-ceremony-closure`

Controller runtime-source candidate: `25e1244485339d272948cc4806ee75694909ebae`

Governance integrated verification candidate before this report refresh:
`4167b191f9d816f07a26abf428c2d8a49e2a60b8`

Production controller identity: intentionally unselected

This report records the engineering and local-rehearsal outcome defined by
`Amoeba_Governance_Release_1_Ceremony_Closure_Agent_Spec.md`. It does not
authorize a merge, tag, release, live deployment, production identity, signing
ceremony, RPC mutation, authority transfer, immutability action, or service
change. A later user instruction authorizes publication of the reviewed feature
branches and pull requests only; it does not widen the live boundary.

## 1. Source and publication boundary

| Item | Value |
|---|---|
| Governance starting commit | `c2771a7a74c895bbb9a81ba38273e19ac25931ea` |
| Governance executable-source ending commit | `25e1244485339d272948cc4806ee75694909ebae` |
| Governance integrated verification commit before report refresh | `4167b191f9d816f07a26abf428c2d8a49e2a60b8` |
| Spread starting commit | `88c067ae6f2901131698be1e12fdff6f259b361b` |
| Spread integrated verification commit before report refresh | `486cf624797b9a28e2634b20e83380ec82ba3a53` |
| Branches | `codex/release1-ceremony-closure` in both isolated worktrees |
| Ceremony specification SHA-256 | `11b211c82a0662f8394e6719180b48be32cdabfcf9607f4f1a519e1fcb65ed20` |
| Production identity | unselected; synthetic local identities are release-forbidden |

Normative and prerequisite inputs were byte-identified before implementation:

| Document | SHA-256 |
|---|---|
| Ceremony-closure assignment | `11b211c82a0662f8394e6719180b48be32cdabfcf9607f4f1a519e1fcb65ed20` |
| Governance Phase 3 amendment | `eb4c18bb469dba1c66fa7e698a1c685d3fefc5ee34634976b2d29c671330b6ad` |
| Governance Phase 3 ABI report | `f9b16d217668389d07b8702431e568459b4c310345d051c243ca7d38311c3fc6` |
| Bootstrap V1 amendment | `966efd6d42b4e2814b85dde836b4c1337cca227388c1c3f16e75301bb8e25fbf` |
| Serialization decisions | `9c767f5436632a9301d7246fd164a0b84556d56a2be84e3de8a69e7cc28abcfd` |
| Upgrade-governance specification | `16f8b4c0cb4e1b05752f5deb299570bf717ffb7ff4e53cd1325801dd4e246117` |
| Release 1 completion amendment | `02882c25abcaf989676bd47b80523670f236a64ff6652e59226beb38683e5b4b` |
| Release 1 completion report | `60125897268c34ded10c386f1bc3db77bdda643ef6cde93ddcd872e8fe718a02` |
| Spread Phase 3 amendment | `b70f6cba33597b5c89517ff7a73838a18e3c75bc630887d9162369a82a640599` |
| Spread Phase 3 report | `dfb941414c2199ac9508eb9af27cd9972abf5ff5b3a284c4451c248792afe2ae` |
| Spread Phase 3 closure report | `fa13de3d95608445893287cc846f7429e1a8a012514d3bc8b38bc069403810bb` |
| Spread Phase 3 instruction-manifest report | `738295aab703e0c033c1eafd7314c015e05bea908ebfa17694c65c0315a85310` |
| Spread Release 1 integration report | `821748866b60481396c8911ff6076979d00add161418997cfcf153b9705ddcfe` |

`Amoeba_Spread_Upgrade_Governance_Architecture.pdf` was not present in the
inspected worktrees or Downloads directory, so no PDF hash is claimed.

The publication preflight independently confirmed the expected pushed
baselines and a completed Phase 3 prerequisite. The hosted workflow runs
`33232928194` (governance) and `33232927105` (Spread) failed before executing
repository steps because GitHub reported an account billing/spending limit.
That is a hosted-infrastructure blocker, not a passing CI result. Branch
protection was not enabled at inspection time, and the observed tips were
unsigned. Repository settings were not changed.

## 2. Governance invariants retained

- exactly five equal, unclassified seat authorities;
- 3-of-5 routine quorum; 4-of-5 remains reserved terminal policy;
- no weighted, company-classified, or affiliation-dependent vote;
- token governance mechanically disabled;
- no recovery superuser or single-key council replacement;
- target immutability unsupported in Release 1;
- controller immutability, production identity selection, and live authority
  handoff remain future ceremonies;
- the canonical Spread gate remains 192-byte `AGVGAT01` V1 with the exact
  16-byte `AGV1` signed epoch tail; and
- unknown, retired, and reserved instruction tags reject generically before
  payload or account access.

## 3. Schema and account decision

Existing V1/V2 meanings and reserved bytes were not repurposed. The
capacity-fragile V1/V2 processor surface is retired from the current dispatcher
while its codecs, account images, and vectors remain regression-tested. The
production-reachable upgrade lifecycle is V3 with V2 checkpoint, verification,
emergency, and custody schemas.

The capacity-safe replacement accounts are:

| Account | Discriminator | Version | Bytes | Reserved bytes |
|---|---:|---:|---:|---:|
| `UpgradeProposalV3` | `AGVPRP03` | 3 | 2,048 | 274 |
| `ProgramDataVerificationV2` | `AGVPDV02` | 2 | 1,024 | 129 |
| `StateCheckpointV2` | `AGVCKP02` | 2 | 1,280 | 147 |
| `EmergencyFreezeObservationV2` | `AGVEFO02` | 2 | 768 | 21 |
| `EmergencyFreezeResolutionV2` | `AGVEFR02` | 2 | 1,152 | 122 |
| `ProgramDataFailureObservationV2` | `AGVPDF02` | 2 | 1,024 | 47 |

New ceremony accounts are fixed, strictly versioned, PDA-bound, and reject
nonzero reserved bytes:

| Account | Discriminator | Bytes | Reserved bytes |
|---|---:|---:|---:|
| `ProgramDataCapacityPolicyV1` | `AGVCAP01` | 512 | 122 |
| `ControllerReleaseCommitmentV1` | `AGVREL01` | 640 | 59 |
| `ProgramDataObservationV1` | `AGVOBS01` | 1,280 | 15 |
| `CurrentDeploymentStateV1` | `AGVDEP01` | 1,024 | 187 |
| `ControllerImmutabilityReceiptV1` | `AGVIMR01` | 1,024 | 218 |
| `TargetAuthorityHandoffProposalV1` | `AGVTHP01` | 1,280 | 212 |
| `TargetAuthorityHandoffReceiptV1` | `AGVTHR01` | 1,024 | 112 |
| `BootstrapActivationProposalV1` | `AGVBAP01` | 1,280 | 180 |
| `BootstrapActivationReceiptV1` | `AGVBAR01` | 1,024 | 56 |

The Rust-generated fixture
`fixtures/release1_ceremony_accounts_v1.json` is consumed independently by Rust
and TypeScript. Its file SHA-256 is
`0881fc62546c05610467c0259908380eaf5de8ddcaa41b2bcf3ad02fd07b1c52`.
Activation uses separate slot-independent plan digests; the
controller derives the actual landing-slot-bound deployment and receipt digests
after the committed static image matches.

## 4. Closure instruction ABI

`r`, `w`, and `s` below mean read-only, writable, and signer. The checked-in
TypeScript matrix freezes the exact ordered list and rejects count, order, or
privilege drift.

| Tag | Instruction | Data bytes | Accounts |
|---:|---|---:|---|
| 39 | `BeginProgramDataObservationV1` | 254 | 10: payer `ws`; config, gate, capacity policy, subject, Program, ProgramData `r`; observation `w`; Loader, System `r` |
| 40 | `AppendProgramDataObservationChunkV1` | 66 | 8: config, gate, capacity policy, subject, Program, ProgramData `r`; observation `w`; Loader `r` |
| 41 | `VerifyObservedArtifactChunkV1` | 303 | same ordered eight-account observation-step contract |
| 42 | `FinalizeProgramDataObservationV1` | 78 | same ordered eight-account observation-step contract |
| 43 | `RecordControllerImmutabilityV1` | 161 | 11: payer `ws`; controller Program/ProgramData, config, policy, release, pre/post observations `r`; receipt `w`; Loader/System `r` |
| 44 | `CreateTargetAuthorityHandoffV1` | 161 | 18: payer `ws`, active seat creator `rs`, exact controller/config/policy/council/gate/capacity/immutability/bridge/target/authorities `r`, proposal `w`, Loader/System `r` |
| 45 | `ApproveTargetAuthorityHandoffV1` | 57 | 16: exact handoff graph, proposal `w`, seat authority `rs` |
| 46 | `QueueTargetAuthorityHandoffV1` | 57 | 15: approval graph without seat signer; proposal `w` |
| 47 | `AcceptTargetAuthorityCheckedV1` | 159 | 19: payer `ws`; exact graph; proposal/target ProgramData/receipt `w`; legacy authority `rs`; Instructions sysvar `r` |
| 48 | reserved | n/a | always rejected |
| 49 | `CreateBootstrapActivationV1` | 129 | 20: payer `ws`, active seat creator `rs`, exact trust graph, proposal/receipt/deployment `w`, Loader/System `r` |
| 50 | `ApproveBootstrapActivationV1` | 57 | 16: exact activation graph, proposal `w`, current seat `rs` |
| 51 | `QueueBootstrapActivationV1` | 57 | 15: approval graph without seat signer; proposal `w` |
| 52 | `ExecuteBootstrapActivationV1` | 223 | 18: exact trust graph; gate/proposal/receipt/deployment `w`; Instructions sysvar `r` |

The capacity-safe current lifecycle/custody contracts are:

| Tag | Instruction | Data bytes | Ordered accounts |
|---:|---|---:|---|
| 53 | `InitializeControllerV2` | 633 | payer `ws`; initializer `rs`; controller Program/ProgramData, target Program/ProgramData, Loader `r`; config, gate, policy, council, capacity policy, release commitment `w`; authority, treasury, guardian, five seats, System `r` |
| 54 | `CreateProposalV3` | 694 | payer `ws`; creator seat `rs`; config `w`; policy, council, gate, capacity, deployment, target graph, treasury, buffer/uploader `r`; proposal `w`; System `r` |
| 55 | `ApproveProposalV3` | 165 | config, policy, creation council, gate, capacity, deployment `r`; proposal `w`; buffer verification `r`; seat `rs` |
| 56 | `FinalizeGovernanceV3` | 125 | config, policy, creation council, gate, capacity, deployment `r`; proposal `w` |
| 57 | `QueueProposalV3` | 123 | config, policy, gate, capacity, deployment `r`; proposal `w` |
| 58 | `FreezeProposalV3` | 131 | config, gate, proposal `w`; policy, creation council, capacity, deployment, target graph, rollback proposal/verification/buffer `r` |
| 59 | `CancelProposalV3` | 167 | config, policy, current council, gate, capacity, deployment `r`; proposal `w`; seat `rs` |
| 60 | `ExpireProposalV3` | 123 | config, gate, capacity, deployment `r`; proposal `w` |
| 61 | `GuardianFreezeV2` | 99 | payer `ws`; config `r`; gate `w`; capacity, deployment, target graph `r`; guardian `rs`; freeze observation `w`; System `r` |
| 62 | `CreateEmergencyResolutionV2` | 250 | payer `ws`; creator seat `rs`; config, policy, council, gate, capacity, deployment, freeze/ProgramData observations `r`; resolution `w`; System `r` |
| 63 | `ApproveEmergencyResolutionV2` | 229 | config, policy, council, gate, capacity, deployment, freeze/ProgramData observations, emergency checkpoint `r`; resolution `w`; seat `rs` |
| 64 | `QueueEmergencyResolutionV2` | 227 | tag 63 graph without the seat signer |
| 65 | `ExecuteEmergencyResolutionV2` | 305 | config, policy, council `r`; gate, deployment, resolution `w`; capacity, observations, checkpoint, target graph, Instructions sysvar `r` |
| 66 | `ExpireEmergencyResolutionV2` | 227 | config, gate, capacity, deployment `r`; resolution `w` |
| 67 | `CreateCheckpointV2` | 591 | payer `ws`; config/policy/council/gate/subject/linked authority/capacity/deployment/observation/target/checkpoint `r`; attestation `w`; seat `rs`; System `r` |
| 68 | `RecastCheckpointV2` | 591 | tag 67 graph without payer/System; attestation remains `w`, seat `rs` |
| 69 | `FinalizeCheckpointV2` | 558 | payer `ws`; config/policy/council/gate `r`; subject `r` for Prestate or `w` otherwise; linked authority/capacity/deployment/observation/target `r`; checkpoint `w`; three attestations/System `r` |
| 70 | `BindProgramDataVerificationV2` | 251 | payer `ws`; config/gate/proposal/capacity/deployment/observation/target/authority/Loader `r`; verification `w`; System `r` |
| 71 | `FinalizeProgramDataVerificationV2` | 242 | config/gate `r`; proposal `w`; capacity/deployment/observation/target/authority/Loader `r`; verification `w` |
| 72 | `ObserveProgramDataFailureV2` | 473 | payer `ws`; config/gate/primary/verification/capacity/deployment/observation/target/authority/Loader `r`; failure observation `w`; System `r` |
| 73 | `ApproveUnfreezeV2` | 323 | config/policy/current council/gate `r`; proposal `w`; poststate/verification/capacity/deployment/target/authority/Loader `r`; seat `rs` |
| 74 | `ExecuteUnfreezeV2` | 433 | config/policy/current council `r`; gate/proposal/linked proposal `w`; poststate/verification/capacity `r`; deployment `w`; target/authority/Loader/Instructions `r` |
| 75 | `AdoptBufferV2` | 123 | payer `ws`; config/gate/capacity/deployment/authority/Loader/System `r`; proposal, buffer, verification `w`; uploader `rs` |
| 76 | `VerifyBufferChunkV2` | 421 | config/gate/proposal/buffer/authority/Loader `r`; verification `w` |
| 77 | `FinalizeBufferVerificationV2` | 224 | config/gate/buffer/authority/Loader `r`; proposal, verification `w` |
| 78 | `ExtendTargetV2` | 385 | payer `ws`; config/gate/capacity/observation/prestate/Loader/System/Rent/Instructions `r`; proposal/deployment/target ProgramData/Program/authority `w` |
| 79 | `ExecuteUpgradeV2` | 399 | config/policy/gate/counterpart/capacity/deployment/observations/prestate/Rent/Clock/authority/Loader/Instructions `r`; proposal, buffer verification, target ProgramData/Program, buffer, treasury `w` |
| 80 | `CloseAbandonedBufferV2` | 200 | config/gate/proposal/authority/Loader `r`; verification, buffer, treasury `w` |
| 81 | `ActivateRollbackV2` | 410 | config/policy/primary/verification/failure/capacity/deployment/observation/target/authority/Loader `r`; gate, rollback proposal `w` |

The current dispatcher exposes only retained council tags 18-22 and 24-25,
tags 39-47 and 49-81. Tags 0-17, 23, 26-38, reserved tag 48, and unknown tags
reject generically before payload or account access. The corresponding fixed
TypeScript builders and packet matrix enforce the exact account order and
privileges shown above.

## 5. Capacity threat model and liveness result

The artifact ceiling remains `1,572,864` bytes. It is deliberately separated
from the pinned Loader/runtime ceiling:

```text
maximum raw ProgramData account  10,485,760 bytes
Loader-v3 ProgramData header             45 bytes
maximum payload capacity          10,485,715 bytes
selected observation chunk             16 KiB
maximum real raw chunks                   640
padded leaves                            1,024
frontier depth                              10
```

Consensus binds a versioned ProgramData Merkle root; full raw SHA-256 is
independently recomputed as receipt evidence and is never trusted from an
operator. Observation leaf, node, and empty domains are:

```text
AMOEBA_PROGRAMDATA_OBSERVATION_CHUNK_V1
AMOEBA_PROGRAMDATA_OBSERVATION_NODE_V1
AMOEBA_PROGRAMDATA_OBSERVATION_EMPTY_V1
```

The scheme-material SHA-256 / scheme ID is
`6f7afe51acf1d701bdc5d9de7145de24de10d6d454182dcdc69e68b549242ed2`.
For the deterministic cross-language subject fixture, the stable 16-KiB
partial and padded roots are respectively
`21d6a5fc9bb40303c13cb4c7f9c7d8cde9c6c64108afbadc75ac5602acd84a60`
and `1a9a553ee1ef86be2f7f9610736b6248fdd678b49b4efb0f7256857c7b167c24`.
The independent full-raw SHA-256 for the partial vector is
`dd1dd97c58b38010c1646a30bc55ef5825b550d0f0790cd3dfb6a1481ffb04b8`.

Each leaf binds the observation subject, ordered chunk index, actual length,
and exact bytes read from ProgramData. Nodes bind level and order. Padding binds
the subject and padded index. A second cursor verifies every payload chunk
against the immutable artifact root and scans the entire post-artifact tail for
zero bytes.

A permissionless extension can invalidate an observation but cannot change the
immutable proposal. Every transition either accepts a fresh mechanically
equivalent observation or fails without mutation; new observation generations
restore progress before approval, after approval, while frozen, after checked
extension, before upgrade, after upgrade, during poststate, and before
unfreeze. Guardian freeze remains O(1) and defers traversal until after the
gate is frozen. Maximum-capacity and adversarial extension tests prove there is
no valid unchecked extension that creates an absorbing governance state.

Actual controller-SBF maximum-capacity runs traversed the full
10,485,760-byte raw ProgramData account in 640 ordered chunks and completed the
full frozen lifecycle plus the first gated Spread mutation on both engines.
Those lifecycle runs measured the first selected 16-KiB append at 64,674
compute units on v0 and 71,121 compute units on v2. The subsequent complete
candidate matrix measures the more expensive maximum-merge append for every
predeclared size against the same 10,485,760-byte ceiling:

| Chunk | SBPF v0 full transaction CU | SBPF v2 full transaction CU | 200,000-unit gate |
|---:|---:|---:|---|
| 16 KiB | 158,883 | 193,681 | pass; selected |
| 32 KiB | 251,878 | 317,921 | reject |
| 64 KiB | 428,915 | 563,487 | reject |
| 128 KiB | 790,676 | 1,051,813 | reject |

Each matrix sample repeated twice with identical compute. Controller execution
is exactly 300 units below the full transaction because the envelope contains
two 150-unit ComputeBudget instructions. The measurement transaction used an
explicit 1,400,000-unit limit so the rejected candidates could be observed;
the pinned runtime default for the one non-builtin instruction remains
200,000 units. The v2 selected result retains only 6,319 units (3.16%) of
default-budget margin, so selection is conditional on exact runtime/ELF
reproduction and pre-ceremony remeasurement; the report does not call that
margin generous. Normal Release 1 builds still admit only 16 KiB.

The complete matrix report is
`docs/governance/programdata-observation-chunk-controller-sbf-matrix-v1.md`.
Its final integrated JSON evidence hashes to
`48141ca03d65fc289e509f6effc654be63844c0dd6967932f57040b3d41b0278`.
The missing-candidate measurement blocker is closed.
The v0 and v2 maximum-geometry JSON evidence files hash respectively to
`8ac1642582dd7f6743399694a5b545a77bf8085721ac48fbedb97ccee7638122`
and `31b7edc44582e203ce1a890d34d0378258e9b93064fac65c0c8aaadcc8832e8d`.

## 6. Checked handoff and activation

The handoff path requires the immutable controller receipt, exact bridge
observation, equal-seat quorum, immutable timing, current gate epoch and target
nonce, canonical Loader, Program/ProgramData linkage, legacy authority signer,
and controller authority PDA. The controller performs exactly one inner
Loader-v3 `SetAuthorityChecked` CPI. It accepts no arbitrary CPI data, program,
or account vector.

The local ceremony then submitted a separately signed direct Loader upgrade by
the former authority and required exact failure, unchanged ProgramData bytes,
and the controller PDA still installed. Receipt v4 rejects a simulated handoff,
bank patch, unchecked authority instruction, successful external-key upgrade,
or identical pre/post raw roots across the header authority change.

Bootstrap activation is a distinct 3-of-5 proposal and delay. It begins from
the initialization-only emergency-frozen gate, binds the immutable controller
and handoff receipts plus the exact bridge observation, increments gate epoch
once, does not consume target nonce, records `CurrentDeploymentStateV1`, and
opens the gate without a bank patch or inner CPI. No Active interval exists
before these proofs compose.

| Ceremony transition | Gate/nonce result |
|---|---|
| initialize | canonical initialization freeze, nonzero epoch, no active proposal |
| checked handoff | authority becomes controller PDA; gate, epoch, nonce, code, and protocol state unchanged |
| bootstrap activation | gate becomes Active; epoch increments once; target nonce unchanged |
| ordinary proposal freeze | gate becomes FrozenForUpgrade; epoch and target nonce each increment once |
| successful Loader CPI | proposal becomes UpgradeExecuted; gate remains frozen |
| verified poststate plus separate unfreeze | proposal becomes Completed; gate becomes Active; epoch increments once; active proposal clears |

## 7. Complete Gate F happy-path and rollback evidence

The actual controller-SBF happy path covers:

```text
initialize frozen V2 controller state
observe and record controller immutability
create / approve / queue / execute checked target-authority handoff
prove former authority rejection
create / approve / queue / execute bootstrap activation
create primary and rollback proposals
adopt and mechanically verify both buffers
approve / satisfy / queue / freeze primary
bind and accept prestate
execute one typed Loader-v3 Upgrade CPI
verify deployed ProgramData
bind and accept poststate
approve separate unfreeze
execute unfreeze
retire prepared rollback
perform first Spread mutation through the active canonical gate
```

ProgramTest v0 and v2 results are complete. The standalone validator also
completed the entire identity-bound on-chain trace, including the real
durable-nonce v0 upgrade transaction, ALT, separate unfreeze, and first Spread
mutation. The original test wrapper stopped only after the trace while spawning
the TypeScript finalizer. Receipt finalization and two independent read-only CLI
passes were recovered from the preserved ledger without replaying a ceremony
transaction. Exact files, hashes, recovery diagnostics, and the four-entry
journal are recorded in `release-1-local-ceremony-receipt.md`.

The independent V3 rollback rehearsal uses the exact final integrated
controller and exact Phase 3 Spread artifacts under both engines. After a
successful primary upgrade, the harness injects one ProgramData payload-byte
fault through the ProgramTest bank fixture. That fault injection is explicitly
test-only; it is not a controller instruction or production-reachable mutation
claim. From that point onward, the actual controller SBF creates the immutable
failure witness, activates the presealed rollback while continuously frozen,
executes one typed Loader-v3 Upgrade CPI, mechanically verifies rollback
ProgramData, accepts poststate with three seats, collects a separate unfreeze
quorum, executes unfreeze, and admits the first gated Spread mutation only after
the gate is Active.

The exact final rollback artifacts and results are:

| Engine | Controller artifact | Spread artifact | Result |
|---|---|---|---|
| SBPF v0 | 1,114,448 bytes; `2864df9cb04363ee3acef8b6df50153cf1f7e6a468215aed76125fa6ff093f98` | 1,154,184 bytes; `7b29416cba304909b5546aa4726aedbf7fb7a9b4e506d7292f171f5afcb20749` | pass, 83.44 s |
| SBPF v2 | 1,115,080 bytes; `8f32e309db1b70581148b05fc1e3a287011f4888d5d487675a1882077b33f364` | 1,281,248 bytes; `e93c70b96c398fde4029fd2e873c547858880d668489f25477721034c944a514` | pass, 93.03 s |

Wrong witness, observation/epoch drift, wrong accepted prestate, repaired
mismatch, and mismatch-class drift all fail atomically before Loader execution.
Only reprovable `ArtifactPayload` and `ZeroTail` mismatch classes can authorize
rollback. The dedicated report is
`docs/governance/evidence/release-1-v3-rollback-rehearsal.md`.

## 8. Packet and operator evidence

All 47 current operator mutation tags have exact serialized legacy and v0
measurements. Four large V3 surfaces do not fit legacy but all required v0
surfaces fit the 1,232-byte limit:

| Surface | Legacy | v0 |
|---|---:|---:|
| V3 create checkpoint | 1,321 | 923 |
| V3 recast checkpoint | 1,287 | 920 |
| V3 finalize checkpoint | 1,257 | 797 |
| V3 execute upgrade | 1,314 | 699 |
| checked authority handoff | 1,040 | 549 |
| governed bootstrap activation | 1,039 | 517 |

The operator requires finalized reads, exact genesis/domain, explicit arming,
deterministic operation IDs, a durable hash-chained JSONL journal, an exclusive
lock, first-429 persist/backoff/exit, decoded-action confirmation, injected
wallet/KMS/hardware signers, exact message/signature binding, and immediate
rereads before signing/submission. It has no private-key, raw-signature,
environment-secret-dump, arbitrary-program, arbitrary-account-vector, or raw
instruction fallback.

## 9. Artifact evidence

The final controller artifacts were rebuilt from integrated verification commit
`4167b191f9d816f07a26abf428c2d8a49e2a60b8` with platform-tools v1.53.
The Spread artifacts are the exact governance-gated Phase 3 artifacts retained
through the lint and TypeScript/package integration commits. These are
synthetic local review artifacts, not production release identities.

| Artifact | SBPF | Bytes | SHA-256 |
|---|---|---:|---|
| controller | v0 | 1,114,448 | `2864df9cb04363ee3acef8b6df50153cf1f7e6a468215aed76125fa6ff093f98` |
| controller | v2 | 1,115,080 | `8f32e309db1b70581148b05fc1e3a287011f4888d5d487675a1882077b33f364` |
| Spread target | v0 | 1,154,184 | `7b29416cba304909b5546aa4726aedbf7fb7a9b4e506d7292f171f5afcb20749` |
| Spread target | v2 | 1,281,248 | `e93c70b96c398fde4029fd2e873c547858880d668489f25477721034c944a514` |

The final unstripped controller linked ELFs were 1,328,840 bytes / SHA-256
`1000095b4892850f1b3c4c1e71aacc96926af94636063549daf373fba0179e52`
for v0 and 1,328,520 bytes / SHA-256
`d67a96ad1f2e51f4c229076fa782cfbc64bf34e9cba7d341b753deec24a7468e`
for v2. The v0 analyzer classified 16 diagnostics as dependency-only and proved
every reported symbol absent from the linked ELF; v2 reported zero diagnostics.

## 10. Verification matrix

| Check | Result |
|---|---|
| Phase 3 actual SBF v0/v2 prerequisite | pass, 4/4 each; no prohibited stack diagnostics |
| Governance TypeScript typecheck | pass |
| Governance TypeScript tests | pass, 127/127 |
| Governance package build/consumer | pass; 49 entries, packed 162,491 bytes, unpacked 1,039,452 bytes, shasum `fff1310c413b0672f31465394cb338f7032021e4` |
| Spread TypeScript typecheck/tests | pass, 312 total: 311 pass, 1 intentional skip |
| Full controller ProgramTest v2 | pass, 1/1, 104.20 s |
| Full controller ProgramTest v0 | pass, 1/1, prior evidence retained |
| Full standalone local validator | pass: complete controller-SBF/real-Loader happy path, checked handoff, former-authority rejection, bootstrap activation, durable-nonce v0 upgrade, separate unfreeze, final epoch 4, and first gated Spread mutation |
| Receipt v4 independent verifier | pass: actual receipt digest `faae42ced84225366d4ef5eb99bdfe69aaa1094e000756195382e08bd477cb11`; two read-only CLI processes, four-entry journal, lock absent |
| Governance Rust format / Clippy `-D warnings` | pass |
| Governance all host targets | pass: 287 unit tests, 1 fixture generator ignored, plus capacity and golden suites; explicit manual/SBF cases remained ignored |
| Governance release build | pass |
| Controller SBF v0/v2 rebuild and linked-ELF stack analysis | pass with the dependency-only v0 qualification above |
| Maximum-capacity actual controller-SBF lifecycle | pass v0 and v2; 640 raw chunks, final epoch 4, first gated Spread mutation succeeded |
| Final ProgramData chunk matrix | pass v0 and v2; 16 KiB selected at 158,883 / 193,681 CU; 32/64/128 KiB measured and rejected |
| Actual controller-SBF V3 rollback | pass v0 and v2 against exact Spread artifacts; real Loader-v3 recovery, poststate, and separate unfreeze |
| Spread format and host tests | final rerun recorded in Spread integration report |
| Spread Clippy `-D warnings` | pass: full locked workspace/all-targets, zero warnings |
| Workflow syntax | pass: actionlint 1.7.12 and PyYAML parse across all three workflow files |
| Changed shell scripts | pass: ShellCheck 0.11.0 and `bash -n` |
| Hosted CI | not run on this unpushed branch; baseline runs blocked by billing before steps |

## 11. Changed-file inventory

Exact inventory relative to
`c2771a7a74c895bbb9a81ba38273e19ac25931ea` (`M` modified, `A` added):

```text
M .github/workflows/governance-trust-root.yml
M Cargo.lock
A benchmarks/programdata_observation_chunk_controller_sbf/.gitignore
A benchmarks/programdata_observation_chunk_controller_sbf/run-benchmark.sh
A benchmarks/programdata_observation_chunk_controller_sbf/summarize_benchmark.py
M clients/ts/package.json
M clients/ts/tools/check-package-consumer.ts
A clients/ts/tools/finalize-local-ceremony-receipt.ts
A clients/ts/tools/local-ceremony-readonly-adapter.mjs
M clients/ts/upgradeGovernance/cli.test.ts
M clients/ts/upgradeGovernance/cli.ts
M clients/ts/upgradeGovernance/cliMain.ts
M clients/ts/upgradeGovernance/index.ts
M clients/ts/upgradeGovernance/operator.test.ts
M clients/ts/upgradeGovernance/operator.ts
A clients/ts/upgradeGovernance/programDataObservationMerkleV1.test.ts
A clients/ts/upgradeGovernance/programDataObservationMerkleV1.ts
A clients/ts/upgradeGovernance/receiptV4.test.ts
A clients/ts/upgradeGovernance/receiptV4.ts
A clients/ts/upgradeGovernance/release1AuthorityInstructions.ts
A clients/ts/upgradeGovernance/release1Ceremony.test.ts
A clients/ts/upgradeGovernance/release1Ceremony.ts
A clients/ts/upgradeGovernance/release1CeremonyGolden.test.ts
A clients/ts/upgradeGovernance/release1CeremonyInstructions.test.ts
A clients/ts/upgradeGovernance/release1CeremonyInstructions.ts
A clients/ts/upgradeGovernance/release1CeremonyPacket.test.ts
A clients/ts/upgradeGovernance/release1CurrentInstructions.test.ts
A clients/ts/upgradeGovernance/release1CurrentInstructions.ts
A clients/ts/upgradeGovernance/release1FixedWire.ts
M clients/ts/upgradeGovernance/release1PacketPlanning.test.ts
M clients/ts/upgradeGovernance/release1PacketPlanning.ts
M clients/ts/upgradeGovernance/release1PacketSurfaceMatrix.test.ts
M clients/ts/upgradeGovernance/release1Planning.test.ts
A clients/ts/upgradeGovernance/release1V3Builders.ts
A clients/ts/upgradeGovernance/release1V3CustodyInstructions.ts
A clients/ts/upgradeGovernance/release1V3Instructions.ts
M clients/ts/upgradeGovernance/spreadGateBridgeV1.ts
A docs/governance/evidence/programdata-observation-chunk-controller-sbf-matrix-v1.json
M docs/governance/evidence/release-1-packet-surface-v1.json
A docs/governance/evidence/release-1-v3-rollback-rehearsal.md
A docs/governance/final-predeployment-audit-scope.md
A docs/governance/programdata-observation-chunk-controller-sbf-matrix-v1.md
A docs/governance/release-1-capacity-liveness-audit.md
A docs/governance/release-1-ceremony-closure-report.md
A docs/governance/release-1-local-ceremony-receipt.md
A docs/governance/release-1-publication-addendum.md
A fixtures/README.md
A fixtures/release1_ceremony_accounts_v1.json
M programs/upgrade_controller/Cargo.toml
M programs/upgrade_controller/src/error.rs
M programs/upgrade_controller/src/lib.rs
M programs/upgrade_controller/src/pda.rs
M programs/upgrade_controller/src/processor.rs
A programs/upgrade_controller/src/programdata_observation_merkle.rs
M programs/upgrade_controller/src/release1_account_io.rs
A programs/upgrade_controller/src/release1_authority_instruction.rs
A programs/upgrade_controller/src/release1_ceremony_digest.rs
A programs/upgrade_controller/src/release1_ceremony_instruction.rs
A programs/upgrade_controller/src/release1_ceremony_state.rs
A programs/upgrade_controller/src/release1_processor_authority.rs
M programs/upgrade_controller/src/release1_processor_checkpoint.rs
A programs/upgrade_controller/src/release1_processor_initialize_v2.rs
A programs/upgrade_controller/src/release1_processor_observation.rs
A programs/upgrade_controller/src/release1_processor_v3_custody.rs
A programs/upgrade_controller/src/release1_processor_v3_lifecycle.rs
A programs/upgrade_controller/src/release1_v3_custody_instruction.rs
A programs/upgrade_controller/src/release1_v3_digest.rs
A programs/upgrade_controller/src/release1_v3_instruction.rs
A programs/upgrade_controller/src/release1_v3_state.rs
M programs/upgrade_controller/src/state.rs
A programs/upgrade_controller/tests/capacity_liveness_regression.rs
A programs/upgrade_controller/tests/ceremony_closure_program_test.rs
M programs/upgrade_controller/tests/loader_program_test.rs
M programs/upgrade_controller/tests/program_test.rs
A programs/upgrade_controller/tests/programdata_observation_chunk_sbf.rs
A programs/upgrade_controller/tests/release1_ceremony_golden.rs
M scripts/build-sbpf-checked.sh
```

No market, oracle, writer, DLMM, staking, custody, settlement, or Spread
economic code is present in this repository. The Spread integration report
records its separate exact inventory.

## 12. Remaining inputs and blockers

The three previously recorded local engineering blockers are closed: the full
four-size ProgramData chunk matrix passes its stated gate, the exact Spread
workspace is Clippy-clean with warnings denied, and the V3 rollback completes
through actual controller SBF and Loader-v3 on both engines. No known local
engineering blocker remains from that closure list.

Engineering completion also cannot supply the external production trust
inputs. The remaining production items are the final controller identity and
artifact, five real seat capabilities, guardian and treasury identities,
finalized cluster/feature observations, independent audit, reviewed Spread
identity manifest, immutable-controller receipt, live compatibility census,
operator ALT/nonce plan, and separate authorization for each live signature
and mutation.

Hosted CI must still execute successfully after feature-branch publication;
branch protection and required checks are recommended. The present GitHub
billing failure must not be described as a repository test result or source
failure.

## 13. Safety statement

No push, main merge, tag, release, package publication, production controller
selection, production-key access, live signing, Devnet/Mainnet RPC write, live
deployment, ProgramData authority transfer, controller or target immutability,
gate initialization, service/tunnel/timer mutation, automation change, frontend
change, or deployed Spread contract change occurred. All Loader activity used
synthetic identities in ProgramTest or an ephemeral loopback local validator.
