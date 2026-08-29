# Amoeba Governance Release 1 ceremony-closure report

Status: **FINAL LOCAL EVIDENCE PENDING**  
Branch: `codex/release1-ceremony-closure`  
Executable-source candidate: `1ff442252907a017913d47591c1857c2e4df3f0b`  
Production controller identity: intentionally unselected

This report closes the engineering and local-rehearsal scope defined by
`Amoeba_Governance_Release_1_Ceremony_Closure_Agent_Spec.md`. It does not
authorize a push, merge, tag, release, live deployment, production identity,
signing ceremony, RPC mutation, authority transfer, immutability action, or
service change.

## 1. Source and publication boundary

| Item | Value |
|---|---|
| Governance starting commit | `c2771a7a74c895bbb9a81ba38273e19ac25931ea` |
| Governance executable-source ending commit | `1ff442252907a017913d47591c1857c2e4df3f0b` |
| Spread starting commit | `88c067ae6f2901131698be1e12fdff6f259b361b` |
| Spread integration code commit | `1f34487` plus final documentation commit |
| Branches | `codex/release1-ceremony-closure` in both isolated worktrees |
| Ceremony specification SHA-256 | `11b211c82a0662f8394e6719180b48be32cdabfcf9607f4f1a519e1fcb65ed20` |
| Production identity | unselected; synthetic local identities are release-forbidden |

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
and TypeScript. Activation uses separate slot-independent plan digests; the
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

Tags 53-81 are the current V3 initialization/lifecycle/custody surface already
reported in `release-1-completion-report.md`. Tags 27-38 remain decodable only
as historical ABI and are not executable through the current dispatcher.

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

## 7. Complete local Gate F

The actual controller-SBF path covers:

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

ProgramTest v0 and v2 results are complete. The final standalone validator,
real durable-nonce transaction, v0 ALT, receipt-v4 files, and two-process CLI
journal evidence are recorded in `release-1-local-ceremony-receipt.md` once the
active rehearsal finishes.

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

| Artifact | SBPF | Bytes | SHA-256 |
|---|---|---:|---|
| controller | v0 | 1,109,344 | `f7aefb5fad26836e0cb835fec728ba39ecb5e4d92aa38e2548c56b3c4137362f` |
| controller | v2 | 1,109,432 | `4ee8bc7221f23d533d92eea797cd0b7ab67fb708603cf9ef7475f59a4ebd2c5d` |
| Spread target | v0 | 1,155,088 | `4c9c5d791260016afd8decbd77b68625e89405f6a2e332fa5d3aeb6505ff56e5` |
| Spread target | v2 | 1,282,184 | `efd4f8ce4fe8ca9d16d5b97247e6065e47ba3e65a862c6dccc61095cbe2032b2` |

These are synthetic local ceremony artifacts, not release artifacts. Fresh
final SBF rebuild and linked-ELF stack-analysis results are listed in the final
verification table below.

## 10. Verification matrix

| Check | Result |
|---|---|
| Phase 3 actual SBF v0/v2 prerequisite | pass, 4/4 each; no prohibited stack diagnostics |
| Governance TypeScript typecheck | pass |
| Governance TypeScript tests | pass, 125/125 |
| Governance package build/consumer | pass before packet update; final rerun pending |
| Spread TypeScript typecheck/tests | pass, 312 total: 311 pass, 1 intentional skip |
| Full controller ProgramTest v2 | pass, 1/1, 104.20 s |
| Full controller ProgramTest v0 | pass, 1/1, prior evidence retained |
| Full standalone local validator | **pending active rehearsal** |
| Receipt v4 independent verifier | synthetic negatives pass; actual receipt pending |
| Rust format / Clippy `-D warnings` / all targets | final fresh run pending |
| SBF v0/v2 rebuild and linked-ELF stack analysis | final fresh run pending |
| Hosted CI | not run on this unpushed branch; baseline runs blocked by billing before steps |

## 11. Changed-file inventory

The exact inventory relative to the governance starting commit is produced by:

```text
git diff --name-status c2771a7a74c895bbb9a81ba38273e19ac25931ea..1ff442252907a017913d47591c1857c2e4df3f0b
```

It contains the controller ceremony/V3 implementation, fixed TypeScript
package, tests, fixtures, evidence, and this report set. No market, oracle,
writer, DLMM, staking, custody, settlement, or Spread economic code is present
in this repository. The final handoff records the complete command output and
the Spread integration report records its separate exact inventory.

## 12. Remaining inputs and blockers

Engineering completion does not supply the external production trust inputs.
The remaining items are the final production controller identity and artifact,
five real seat capabilities, guardian and treasury identities, finalized
cluster/feature observations, independent audit, reviewed Spread identity
manifest, immutable-controller receipt, live compatibility census, rollback
rehearsal, operator ALT/nonce plan, and separate authorization for each live
signature and mutation.

Hosted CI must also execute successfully after a future authorized push; branch
protection and required checks are recommended. The present GitHub billing
failure must not be described as a repository test result.

## 13. Safety statement

No push, main merge, tag, release, package publication, production controller
selection, production-key access, live signing, Devnet/Mainnet RPC write, live
deployment, ProgramData authority transfer, controller or target immutability,
gate initialization, service/tunnel/timer mutation, automation change, frontend
change, or deployed Spread contract change occurred. All Loader activity used
synthetic identities in ProgramTest or an ephemeral loopback local validator.
