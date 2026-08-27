# Release 1 predeployment schema audit

**Date:** 2026-08-27

**Audited controller source:**
`c38867c2fe9b760f0c0c3a539d21f44a52e996bf`

**Release 1 branch:** `codex/release1-completion`

## 1. Decision

`UpgradeProposalV1` cannot represent the complete Release 1 lifecycle without
changing the meaning of its reserved bytes or overloading unrelated fields.
Release 1 therefore introduces `UpgradeProposalV2` with a new discriminator,
account version, fixed length, and digest domain.

`UpgradeProposalV1` remains exactly 1,280 bytes with discriminator `AGVPRP01`,
account version 1, and all 142 reserved bytes zero. No Release 1 creation,
transition, buffer, loader, checkpoint, rollback, or unfreeze processor accepts
V1. Its existing approval instruction and Rust/TypeScript vectors remain
historical predeployment regression coverage; the controller exposes no path
that can create a controller-owned V1 proposal.

`ControllerConfigV1`, `GovernancePolicyV1`, `GovernanceCouncilSetV1`, and
`ProtocolGateV1` are sufficient without reserved-byte reuse under the exact
rules below.

## 2. Current-account audit

| Account | Current ABI | Release 1 decision | Reason |
|---|---:|---|---|
| `ControllerConfigV1` | `AGVCFG01`, 512 bytes | Retain V1 | Already pins target graph, loader, authority, gate, treasury, guardian, current policy/council, `next_proposal_id`, `target_nonce`, disabled vote identities, and all delays. No delay/config mutation instruction will exist. |
| `GovernancePolicyV1` | `AGVPOL01`, 160 bytes | Retain V1 | Exactly five equal seats, 3-of-5 routine, reserved 4-of-5 terminal, BootstrapCouncilOnly, zero vote policy, immutable hash. |
| `GovernanceCouncilSetV1` | `AGVCNS01`, 640 bytes | Retain V1 | Immutable versioned five-seat set and hash are sufficient. Rotation changes only `config.current_council_version`. |
| `ProtocolGateV1` | `AGVGAT01`, 192 bytes | Retain V1 | Active, proposal-bound frozen, and proposal-free emergency-frozen shapes suffice. Bootstrap uses the proposal-free frozen shape with a distinct initialization reason that emergency-resume rejects. |
| `UpgradeProposalV1` | `AGVPRP01`, 1,280 bytes | Historical only | Missing scalable byte commitments, verification accounts, checkpoint policy, cancellation quorum, rotation-safe current-council bindings, complete rollback commitments, and lifecycle slots. |

The current reserved regions are `ControllerConfigV1[28]` at offset 484,
`GovernancePolicyV1[21]` at 139, `CouncilSeatV1[47]` at 49,
`GovernanceCouncilSetV1[26]` at 614, `ProtocolGateV1[2]` at 190, and
`UpgradeProposalV1[142]` at 1,138. Every current validator requires every byte
to remain zero.

The existing V1 policy, council, and proposal digest domains and material
lengths remain frozen:

| Digest | Domain | Material bytes |
|---|---|---:|
| Policy V1 | `AMOEBA_GOVERNANCE_POLICY_V1` | 96 |
| Council V1 | `AMOEBA_GOVERNANCE_COUNCIL_V1` | 336 |
| Proposal V1 | `AMOEBA_UPGRADE_PROPOSAL_V1` | 1,084 |

## 3. Why `UpgradeProposalV2` is mandatory

The 142 V1 reserved bytes remain zero. Release 1 requires more than a byte-count
increase; it requires new consensus meanings that cannot be inferred from V1:

- artifact Merkle root, scheme/domain identity, fixed chunk size/count, and
  zero-tail policy;
- separate uploader and final controller buffer authorities;
- canonical Buffer and ProgramData verification PDA identities;
- checkpoint schema and checkpoint-policy commitments;
- emergency-freeze creation binding;
- governed cancellation approvals independent from initial approvals;
- current-council version/hash bindings for cancellation and unfreeze after
  rotation;
- first-approval and every material lifecycle transition slot;
- rollback primary/candidate relationships and known-good artifact root; and
- strict separation between immutable proposal commitments and mutable evidence
  accumulators.

Silently interpreting V1 reserved bytes as any of these fields would invalidate
the claimed frozen V1 ABI and is prohibited.

## 4. Release 1 common encoding rules

- Integers are fixed-width little-endian.
- Public keys are exact 32-byte values.
- Optional keys are one canonical presence byte plus 32 key bytes.
- Booleans are exactly `0` or `1`.
- Enums have explicit one-byte discriminants and reject unknown values.
- Every account has an eight-byte discriminator, explicit version, bump,
  initialized byte, exact length, and zero reserved bytes.
- No persisted `Vec`, `String`, Borsh `Option`, dynamic collection, or
  caller-controlled realloc exists.
- Every account loader rejects wrong owner, length, discriminator, version,
  bump, initialized byte, reserved byte, PDA, embedded identity, duplicate
  alias, and privilege shape before mutation.
- Every digest excludes mutable approval accumulators and stored digest bytes,
  but instruction signatures bind the immutable digest, relevant council
  version/hash, gate epoch, and current state.

## 5. `UpgradeProposalV2`

```text
discriminator: AGVPRP02
account_version: 2
exact length: 1,792 bytes
reserved: 146 zero bytes
digest domain: AMOEBA_UPGRADE_PROPOSAL_V2
digest material: 1,424 bytes
digest preimage: 1,450 bytes
```

| Offsets | Fields |
|---|---|
| 0-15 | discriminator, version, bump, initialized, class, state, creation gate status, zero-tail-required, zero flags |
| 16-39 | proposal ID, target nonce, creation slot |
| 40-167 | cluster domain, controller program, controller config, gate |
| 168-263 | policy version/hash, pinned creation council version/hash, creation epoch, expected frozen epoch |
| 264-423 | target Program, target ProgramData, loader, authority PDA, canonical treasury |
| 424-615 | buffer, loader owner, uploader authority, final authority, BufferVerification PDA, ProgramDataVerification PDA |
| 616-727 | artifact length, SHA-256, Merkle root, scheme/domain ID, chunk size/count |
| 728-919 | source commit/tree, build inventory, reproducible-build, package, and release-intent hashes |
| 920-1047 | expected execution-pre payload SHA/root, raw ProgramData hash, deployed slot, capacity, delta, post-capacity |
| 1048-1175 | pre/post checkpoint PDAs, checkpoint schema ID, checkpoint-policy hash |
| 1176-1338 | optional primary/rollback/rollback-buffer keys and rollback artifact SHA/root |
| 1339-1403 | canonical-default vote requirement/program/result fields |
| 1404-1435 | immutable review start/end, not-before, and expiry slots |
| 1436-1523 | first approval, council-approved, governance-satisfied, queued, frozen, extended, upgraded, ProgramData-verified, poststate, unfreeze-approved, and terminal slots |
| 1524-1525 | initial approval bitset/count |
| 1526-1567 | cancellation approval council version/hash and independent bitset/count |
| 1568-1609 | unfreeze approval council version/hash and independent bitset/count |
| 1610-1641 | proposal digest |
| 1642-1645 | cancellation and terminal reason codes |
| 1646-1791 | zero reserved bytes |

The V2 digest includes every immutable field from cluster/controller identity
through fixed timing. It excludes header/bump, mutable state, lifecycle slots,
approval accumulators, reason codes, stored digest, and reserved bytes.

To avoid a digest cycle, a primary proposal binds the rollback proposal PDA,
buffer, artifact SHA-256, and artifact Merkle root. A rollback proposal binds
the primary proposal PDA and the primary artifact as the exact expected-current
candidate. Neither proposal embeds the other's digest.

An `EmergencyRollback` prepared before the primary executes cannot know the
future Loader-written deployment slot or literal raw ProgramData hash. Its
class-specific canonical encoding therefore requires a present primary
proposal, zero pre-upgrade deployed slot, and zero pre-upgrade raw hash while
binding the candidate payload SHA/root and exact candidate capacity. Rollback
execution loads the bound primary and its completed
`ProgramDataVerificationV1` to recover and mechanically verify the concrete
deployed slot/raw observation. It requires
`config.target_nonce == primary.target_nonce + 1` and does not consume a second
nonce or create a second Active-to-Frozen transition.

The rollback shares the primary target nonce. When governance activates it
against a still-frozen failed primary, the gate remains frozen, changes its
active proposal to the rollback, and increments the gate epoch. The rollback's
committed frozen epoch is therefore exactly `primary.freeze_gate_epoch + 1`,
not blindly its own creation epoch plus one. V2 appends the terminal states
`SupersededByRollback` for the primary after successfully verified rollback and
unfreeze, and `Retired` for an unused prepared rollback after its primary
completes. `Retired` is the only post-preparation state that permits closing an
unused rollback buffer; it is not post-freeze cancellation.

Release 1 creation accepts only `RoutineUpgrade`, `EmergencyRollback`,
`EconomicChange`, and `ConstitutionalChange`. `CouncilSetRotation` uses its
dedicated account, and `TargetImmutability` is rejected as unsupported.

## 6. `BufferVerificationV1`

```text
discriminator: AGVBFV01
version: 1
exact length: 512 bytes
reserved: 72 zero bytes
```

The account binds controller config, proposal, loader, buffer, expected uploader,
controller authority, artifact length/SHA/root/scheme, selected chunk size/count,
a 512-bit bitmap, verified count, adoption/finalization slots, status, the
sealed loader-header commitment, and a terminal slot.

Release 1 caps artifacts at 2 MiB. The 512-bit bitmap covers the worst permitted
case of 512 4-KiB chunks. SBF measurements compare 4, 8, and 16 KiB; after the
benchmark, the processor admits exactly one selected Release 1 chunk size. Bits
outside the selected `chunk_count` remain zero.

Statuses are `Adopted`, `Verifying`, `Verified`, `ConsumedByUpgrade`, and
`ClosedAbandoned`. `ConsumedByUpgrade` and `ClosedAbandoned` are distinct
terminal evidence; neither can be rewritten into the other. Duplicate chunks,
wrong proof/index/actual length, bitmap/count mismatch, or any buffer authority,
header, payload-length, or account drift fails before mutation.

## 7. `ProgramDataVerificationV1`

```text
discriminator: AGVPDV01
version: 1
exact length: 640 bytes
reserved: 119 zero bytes
```

This account is separate from buffer verification. It binds config, proposal,
target, ProgramData, loader, controller authority, artifact length/SHA/root/
scheme/chunk parameters, deployed slot, exact capacity, payload verification,
zero-tail verification, raw ProgramData observation, and finalization slot.

It has two independent 512-bit bitmaps:

1. payload chunks proven against the proposal's Merkle root; and
2. chunks covering exactly `artifact_end..capacity`, each read from ProgramData
   and proven byte-for-byte zero.

A separate zero-tail bitmap is mandatory. Payload Merkle proofs do not prove
unused capacity is zero, and a large tail cannot safely be scanned in one SBF
transaction. Finalization requires exact bitmap/count parity for both regions,
canonical Program/ProgramData linkage and loader header, exact deployed slot,
authority, capacity, payload length, and zero tail.

## 8. `StateCheckpointV1`

```text
discriminator: AGVCKP01
version: 1
exact length: 704 bytes
reserved: 37 zero bytes
digest domain: AMOEBA_STATE_CHECKPOINT_V1
digest material: 573 bytes
digest preimage: 599 bytes
```

The fixed fields bind phase (`Prestate`, `Poststate`, or `Emergency`), config,
normal proposal or emergency resolution, subject digest, target and ProgramData,
finalized observation slot, gate epoch, ProgramData slot, payload/raw
commitments, capacity, program-owned root/count, logical-compressed root/count,
semantic custody/accounting root, hard combined root, external metadata root,
external raw-balance root, schema ID, admitted-positive-donation root/count,
and a forbidden-drift count that must be zero.

The immutable checkpoint digest ends before approval-council fields. The first
approval pins the exact current council version/hash. If that council rotates
before quorum, the next approval atomically discards the incomplete bitset and
repins the new current council. An accepted checkpoint is immutable and cannot
reset. Approval instruction data additionally binds checkpoint digest, subject
digest, current council version/hash, and gate epoch.

For normal phases, `proposal` is nondefault and `emergency_resolution` is
default. For emergency phase the inverse holds. This prevents a proposal/
resolution digest cycle: the subject commits the checkpoint PDA, and the
checkpoint commits the subject digest.

Positive external donation drift is admissible only when the report commits a
nonzero donation root/count, forbidden-drift count remains zero, all identities
and semantic accounting remain unchanged, and the current 3-of-5 council
accepts it. Missing accounts, negative deltas, deficits, or owner/mint/authority
changes are never admissible.

The program-owned root covers address, owner, executable state, exact data,
schema, and semantic fields, but deliberately excludes raw lamport balances;
otherwise a one-lamport donation to a known PDA would become a permanent hard
denial of service. Raw lamports and token amounts belong in the separate raw-
balance observation root. The hard combined root commits program-owned
structural/data state, logical compressed state and counts, semantic custody/
accounting, external identity/metadata, and schema—not raw balances. Only
nonnegative deltas classified into the explicit donation root/count are
admissible. Every negative delta, missing identity, owner/mint/authority/state
change, or semantic deficit increments `forbidden_drift_count` and blocks both
checkpoint creation and acceptance.

## 9. `CouncilRotationProposalV1`

```text
discriminator: AGVROT01
version: 1
exact length: 384 bytes
reserved: 84 zero bytes
digest domain: AMOEBA_COUNCIL_ROTATION_V1
digest material: 240 bytes
digest preimage: 266 bytes
```

The account binds config/target, exact current council PDA/version/hash, exact
immutable candidate council PDA/version/hash, creation/not-before/expiry slots,
and the target nonce snapshot. Initial and cancellation approvals have distinct
bitsets. Activation slot and reason codes are mutable evidence.

The candidate is an ordinary immutable `GovernanceCouncilSetV1`, must contain
five valid unique authorities, have version `current + 1`, have no deactivation
slot, and hash its exact authorities and terms. Activation requires the original
current council's 3-of-5 approvals, the major delay, unexpired timing, unchanged
target nonce, and unchanged current council. It updates only
`config.current_council_version`; the old council remains immutable history.

Binding both current council version and target nonce makes stale and competing
rotations fail without adding a rotation field to `ControllerConfigV1`.

## 10. `EmergencyFreezeResolutionV1`

```text
discriminator: AGVEFR01
version: 1
exact length: 512 bytes
reserved: 91 zero bytes
digest domain: AMOEBA_EMERGENCY_RESOLUTION_V1
digest material: 323 bytes
digest preimage: 353 bytes
```

The account binds config, gate, target, ProgramData, exact emergency epoch,
freeze slot/reason, `ResumeWithoutUpgrade`, creation/not-before/expiry slots,
target nonce snapshot, observed ProgramData slot/payload/raw commitments,
capacity, authority, and emergency checkpoint PDA.

Approval council fields and bitset are mutable and excluded from the base
digest so an incomplete approval accumulator can repin after rotation. Execution
requires the completed accumulator still match the current council, the routine
delay, unchanged target nonce, exact unchanged ProgramData observation and
authority, accepted emergency checkpoint, no active proposal, and the exact
emergency epoch. The initialization freeze reason is categorically rejected.

## 11. Merkle commitment

The canonical leaf is:

```text
SHA256(
  "AMOEBA_ARTIFACT_CHUNK_V1"
  || chunk_index_u32_le
  || actual_chunk_length_u32_le
  || exact_chunk_bytes
)
```

The canonical node is:

```text
SHA256("AMOEBA_ARTIFACT_NODE_V1" || left || right)
```

Padding to the next power of two uses:

```text
SHA256("AMOEBA_ARTIFACT_EMPTY_V1" || padded_index_u32_le)
```

Artifacts must be nonempty. The final partial chunk uses its actual length;
bytes outside that length are not hashed. The proposal stores a 32-byte scheme
ID equal to SHA-256 over the exact three ASCII domains, u32 little-endian index
and length encoding, and the next-power-of-two padding rule. Validators accept
only the one compiled Release 1 scheme ID.

The canonical full-artifact SHA-256 remains release identity. The Merkle root is
the scalable controller-enforced byte commitment.

## 12. Council rotation during lifecycle

- Initial proposal approvals are pinned to the creation council. Once config's
  current council changes, no new initial approval may be added to that proposal.
- A proposal that already reached initial quorum may continue its frozen
  lifecycle with its creation council identity preserved in its digest.
- Poststate checkpoint and unfreeze approvals require the current council.
- Incomplete current-council accumulators reset and repin on rotation; accepted
  checkpoint or quorum-complete decisions do not reset.
- Unfreeze execution rechecks that its completed approval accumulator still
  matches the current council. If rotation occurred after approval, unfreeze
  must be reapproved by the new current council.

This prevents replay of seat-index bits across council versions while allowing
a safely frozen proposal to finish under the current trust root.

## 13. Controller initialization and retained V1 accounts

Initialization verifies the controller Program/ProgramData linkage and requires
the current controller ProgramData upgrade authority as initializer. It pins the
exact target Program/ProgramData/loader graph and creates config, policy,
council, and gate exactly once.

The initial values are:

```text
policy version:       1
council version:      1
next_proposal_id:     1
target_nonce:         1
gate epoch:           1
gate status:          EmergencyFrozen
gate reason:          distinct bootstrap-initialization reason
active proposal:      default
token governance:     disabled canonical defaults
```

The bootstrap reason is not a guardian incident and cannot use emergency
resume. A future separately authorized bridge-activation ceremony must verify
the target bridge and authority graph before first activation.

The fixed delay validation remains in `ControllerConfigV1`. Initialization also
requires checked arithmetic showing the configured proposal expiry can contain
the review interval and major delay. No Release 1 instruction mutates timing or
enables vote fields.

## 14. Instruction/version compatibility

The existing tag-0 `RecordProposalApprovalV1` remains byte-for-byte frozen and
accepts only `UpgradeProposalV1`. A distinct fixed-width
`RecordProposalApprovalV2` enforces review start/end, strict pre-expiry timing,
current target nonce, creation gate status/epoch, verified buffer, exact pinned
creation council and digest, duplicate rejection, and one threshold crossing.

Every new decoder rejects unknown tags before payload allocation, unknown
account versions, truncation, and trailing bytes. No new processor treats a V1
proposal as V2 and there is no migration instruction.

## 15. Audit conclusion

The Release 1 lifecycle is representable with the versioned accounts above.
The design does not require a production controller ID, token governance,
target immutability, hidden recovery authority, V1 reserved-byte reuse, dynamic
state allocation, or live mutation.

Gate B closes only after Rust and TypeScript encode/decode/digest/PDA vectors for
every new account match checked-in fixtures and V1 regression fixtures remain
unchanged. Lifecycle processors remain blocked until then.
