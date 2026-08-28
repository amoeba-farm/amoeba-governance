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

Two additional immutable observation accounts and one replaceable pre-
finalization attestation account are introduced rather than
placing freeze-time or failed-verification evidence into any V1 or V2 reserved
region. `EmergencyFreezeObservationV1` records the guardian freeze boundary;
`ProgramDataFailureObservationV1` records exact failed post-upgrade evidence.
`CheckpointAttestationV1` prevents a permissionless binder or one seat from
squatting the one canonical checkpoint PDA. Their separate discriminators,
PDA domains, and digest domains prevent any record from being confused with a
proposal, finalized checkpoint, or verification accumulator.

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
digest material: 1,416 bytes
digest preimage: 1,442 bytes
```

| Offsets | Fields |
|---|---|
| 0-15 | discriminator, version, bump, initialized, class, state, creation gate status, zero-tail-required, zero flags |
| 16-39 | proposal ID, target nonce, creation slot |
| 40-167 | cluster domain, controller program, controller config, gate |
| 168-263 | policy version/hash, pinned creation council version/hash, creation epoch, lifecycle frozen epoch |
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
through fixed timing. It excludes header/bump, mutable state, the lifecycle
`freeze_gate_epoch`, lifecycle slots, approval accumulators, reason codes,
stored digest, and reserved bytes. `freeze_gate_epoch` is zero at creation,
becomes the exact current gate epoch only when the nonce-consuming freeze or
continuous emergency-to-upgrade conversion succeeds, and is bound separately
by every frozen-or-later transition and approval.

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

`expected_execution_pre_payload_hash` commits the complete Loader ProgramData
capacity region `[45 .. 45 + current_capacity)`, including the exact zero tail.
It is a governance-attested payload identity in the Prestate checkpoint, not a
second maximum-size hash pass in a loader transaction. The controller instead
mechanically hashes the complete raw ProgramData account exactly once before
extension or upgrade and compares that hash to the proposal/accepted-Prestate
commitment. Checked extension preserves that verified prefix, and the controller
separately verifies every newly appended byte is zero.

`expected_execution_pre_chunk_root` is a separate audit commitment. For a
prepared rollback it must equal the linked primary artifact Merkle root; the
linked primary's finalized `ProgramDataVerificationV1` proves every artifact
chunk and the complete zero tail at the exact post-upgrade capacity. The
rollback Prestate then binds that mechanical evidence, the full-capacity payload
SHA-256, and the full raw ProgramData hash without performing two maximum-size
SHA passes in one instruction. Ordinary proposals retain the field as a
digest-bound audit commitment while their exact pre-upgrade bytes are enforced
by the raw ProgramData hash. Independent receipt verification recomputes the
convenience payload SHA-256 from captured bytes. No omitted tail, alternate
padding rule, or caller-only raw-hash assertion is accepted.

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

Release 1 caps artifacts at 1,572,864 bytes (1.5 MiB). The 512-bit bitmap ABI
remains fixed at 64 bytes; it is intentionally not resized when this executable
payload ceiling is lowered. The selected 16-KiB scheme uses at most 96 bits and
has proof depth seven. Its maximum Merkle tree pads to 128 leaves, so canonical
empty-leaf indices are separately bounded by 128 while real leaf indices remain
bounded by 96. SBF measurements compared 4, 8, and 16 KiB; the processor admits
exactly the selected Release 1 size. Bits outside `chunk_count` remain zero.

Statuses are `Adopted`, `Verifying`, `ReadyToFinalize`, `Verified`,
`ConsumedByUpgrade`, and `ClosedAbandoned`. The last chunk moves the account to
`ReadyToFinalize`; complete bitmap/count evidence is invalid while still marked
`Verifying`. A separate finalization instruction re-reads the sealed buffer and
moves only the exact complete account to `Verified`. `ConsumedByUpgrade` and
`ClosedAbandoned` are distinct terminal evidence; neither can be rewritten into
the other. Duplicate chunks, wrong proof/index/actual length, bitmap/count
mismatch, or any buffer authority, header, payload-length, or account drift
fails before mutation.

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

Statuses are `Verifying`, `ReadyToFinalize`, and `Verified`.
`raw_programdata_hash` is canonical zero in the first two states. The last
required payload/tail chunk moves the account to `ReadyToFinalize`; a complete
bitmap is invalid while still marked `Verifying`. The raw hash is written only
by the separate finalization instruction after both bitmaps are complete, the
exact loader header/authority/capacity are re-read, and the exact raw account
SHA-256 is recomputed. A caller cannot seed a purported raw hash into an
in-progress or awaiting-finalization account.

It has two independent 512-bit bitmaps:

1. payload chunks proven against the proposal's Merkle root; and
2. chunks covering exactly `artifact_end..capacity`, each read from ProgramData
   and proven byte-for-byte zero.

A separate zero-tail bitmap is mandatory. Payload Merkle proofs do not prove
unused capacity is zero, and a large tail cannot safely be scanned in one SBF
transaction. Finalization requires exact bitmap/count parity for both regions,
canonical Program/ProgramData linkage and loader header, exact deployed slot,
authority, capacity, payload length, and zero tail.

Zero-tail chunks use a separate, non-Merkle leaf domain:

```text
SHA256(
  "AMOEBA_PROGRAMDATA_ZERO_TAIL_CHUNK_V1"
  || tail_relative_chunk_index_u32_le
  || actual_chunk_length_u32_le
  || exact_chunk_bytes
)
```

The index is relative to the first byte after the deployed artifact, not to the
start of the ProgramData account or payload. For tail chunk `i`, the processor
derives the byte range as
`artifact_length + i * chunk_size .. min(capacity, start + chunk_size)` and
derives the exact final-partial-chunk length from that range. It hashes the
actual bytes and, independently, an equal-length canonical all-zero byte slice
under the same domain and tail-relative index. Verification succeeds only when
those two processor-derived hashes are equal. Neither hash is trusted from the
caller. A zero-tail chunk always carries an empty `FixedMerkleProofV1`; it is
not a member of the artifact Merkle tree and any nonempty proof is rejected.

Failure evidence is canonical rather than caller-selected. The processor
chooses the first applicable mismatch in this strict order:

```text
Header -> Authority -> Capacity -> lowest mismatching payload index
       -> lowest mismatching zero-tail index
```

For either chunked class, every lower index in that phase must already be
verified before a failure at index `i` can be finalized. A zero-tail failure is
not admissible until every payload chunk is verified. The instruction's
`expected_leaf_hash` is only a stale-plan guard: the processor recomputes the
expected artifact leaf or canonical zero-tail leaf and the actual leaf from the
supplied account bytes. The immutable failure record stores those derived
values. This prevents an operator from selecting a later or less severe failure
and hiding an earlier header, authority, capacity, payload, or tail mismatch.

Every ProgramData verification or failure path also receives the exact target
Program account. The controller must prove that both accounts are the pinned
proposal/config identities, that the Program account is loader-owned,
executable, exactly the Loader-v3 Program layout, and names the supplied
ProgramData address. ProgramData owner/executable/header metadata are then
checked or recorded from the exact linked account. A standalone ProgramData
account, an alternate Program that points at it, or a caller assertion of the
link is not evidence.

Post-extension exactness does not require a second pre-upgrade full payload
hash. It follows from the closed transition chain: the frozen boundary has one
exact raw ProgramData hash; the controller admits only the exact checked
extension committed by the proposal; extension is in a strictly earlier slot;
the controller re-reads the exact post-extension header, authority, and
capacity; and the upgrade envelope rejects any intervening sibling or target/
loader mutator. Any broken link leaves the gate frozen and the proposal
non-executable.

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
and a forbidden-drift count that is digest-bound evidence.

The canonical checkpoint PDA never exists in a draft or partially approved
state. Seats instead write their own `CheckpointAttestationV1` accounts. A
permissionless finalizer receives exactly three distinct canonical read-only
attestations from the current council and the exact candidate checkpoint bytes.
It requires byte-for-byte agreement on checkpoint digest, subject/digest,
phase, gate epoch, council PDA/version/hash, and controller/config identities,
then atomically creates and fully populates the canonical checkpoint with the
derived approval bitset/count and nonzero `finalized_slot`. This removes the
single-binder/one-seat PDA-squatting deadlock: no caller can reserve or populate
the canonical checkpoint before quorum evidence exists.

The immutable checkpoint digest ends before approval-council fields. A
finalized checkpoint records exactly the three agreeing 3-of-5 attestations
consumed by the finalizer and is immutable.
An accepted checkpoint requires `forbidden_drift_count == 0`. A rejected
checkpoint requires `accepted == false` and an explicit nonzero
`forbidden_drift_count`; it is not an empty draft. That count remains covered by
the checkpoint digest and therefore serves as explicit 3-of-5-attested failure
evidence for the frozen rollback path without falsely accepting bad poststate.
Hard-root equality and all other acceptance predicates are recomputed by the
finalizer; any hard mismatch must be represented by the rejected shape.
Poststate finalization additionally receives the canonical accepted Prestate
checkpoint as a separate read-only baseline alongside the exact verified
`ProgramDataVerificationV1` evidence. It compares schema, counts, hard roots,
semantic custody, identity metadata, and explicit donation evidence. Prestate
and Emergency finalization omit the baseline account, giving each phase an
exact account count rather than accepting a dummy alias.

`FinalizeCheckpointV1.phase_evidence` is a phase-selected typed account, not a
generic evidence slot:

| Candidate phase | Subject | Exact `phase_evidence` | Additional baseline |
|---|---|---|---|
| `Prestate` for a primary upgrade | exact frozen non-rollback `UpgradeProposalV2` | its canonical, fully `Verified` `BufferVerificationV1` | none |
| `Prestate` for `EmergencyRollback` | exact frozen rollback `UpgradeProposalV2` | either the linked primary's canonical fully `Verified` `ProgramDataVerificationV1`, or its canonical finalized recoverable `ProgramDataFailureObservationV1` from the immediately prior frozen epoch | canonical immutable accepted `Prestate` checkpoint for the linked primary |
| `Poststate` | exact `UpgradeProposalV2` in `ProgramDataVerified` | its canonical, fully `Verified` `ProgramDataVerificationV1` | canonical immutable accepted `Prestate` checkpoint for the same proposal/schema/epoch |
| `Emergency` | exact `EmergencyFreezeResolutionV1` | canonical immutable `EmergencyFreezeObservationV1` for the resolution's target and frozen epoch | none |

The processor selects the discriminator, exact length, PDA, embedded config,
target, subject, digest, gate epoch, and terminal status from `candidate.phase`.
It never accepts a different Release 1 account with coincidentally matching
bytes or digest. For Poststate, both the ProgramData evidence and accepted
Prestate baseline are required and must be distinct. A rollback Prestate also
requires the linked primary's accepted Prestate as a distinct baseline; a
primary Prestate and Emergency checkpoint accept no baseline, so supplying a
dummy alias changes the exact account count and fails.

A rollback Prestate intentionally separates expected candidate identity from
actual failure evidence. Its `target_payload_commitment` is the expected
candidate artifact payload commitment bound by the linked primary proposal.
Its `target_raw_programdata_commitment` is the actual failed raw ProgramData
observation. The two are not asserted equal: describing the expected artifact
as if it were the observed failed payload would erase the very mismatch that
authorizes recovery. The rollback checkpoint inherits the accepted primary
Prestate's schema, protected roots, counts, semantic custody, hard root, and
external-drift policy; it cannot normalize corrupted protected state into a new
baseline.

Slot ordering is part of the account contract. The phase evidence must satisfy
`evidence.finalized_slot <= candidate.finalized_observation_slot`; a Poststate
baseline must satisfy the same inequality. For Emergency, the freeze observation
is atomically final at `freeze_slot` and
`resolution.creation_slot <= candidate.finalized_observation_slot`. Every
attestation must satisfy
`attested_slot >= candidate.finalized_observation_slot` and must not precede the
phase evidence's finalization slot or optional baseline's finalization slot. The
checkpoint finalizer derives a nonzero `finalized_slot` from Clock that is at or
after the candidate observation, phase evidence, optional Prestate baseline,
and all three attestation slots.
Prestate evidence must precede extension/upgrade; Poststate ProgramData evidence
must follow upgrade and precede Poststate acceptance; Emergency evidence must
belong to the exact continuously frozen epoch. These relational checks remain a
Gate C processor requirement; the current fixed account schemas enforce the
nonzero and terminal shapes but cannot establish cross-account slot ordering by
themselves.

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
change, or semantic deficit increments `forbidden_drift_count` and blocks
checkpoint acceptance. The unaccepted record remains immutable audit evidence.

`hard_combined_root` is not a free nonzero label. Rust, TypeScript, the
controller, and the receipt verifier deterministically recompute it as:

```text
SHA256(
  "AMOEBA_CHECKPOINT_HARD_ROOT_V1"
  || schema_identifier
  || program_owned_state_root
  || program_owned_state_count_u64_le
  || logical_compressed_state_root
  || logical_compressed_state_count_u64_le
  || semantic_custody_accounting_root
  || external_metadata_observation_root
)
```

The material is exactly 176 bytes and the domain-prefixed preimage is 206
bytes. Any internal disagreement between the component roots/counts/schema and
the stored combined root fails schema/digest verification. The external raw
balance and admitted-donation roots remain separately visible so donation
policy cannot be smuggled into the hard invariant.

## 8.1 `CheckpointAttestationV1`

```text
discriminator: AGVATT01
version: 1
exact length: 384 bytes
reserved: 27 zero bytes
digest domain: AMOEBA_CHECKPOINT_ATTESTATION_V1
digest material: 314 bytes
digest preimage: 346 bytes
PDA: [ameba-upgrade-v1, checkpoint-attestation, checkpoint,
      council_version_le, seat_index_u8]
```

Each account binds controller program/config, the not-yet-created canonical
checkpoint PDA, one typed subject pubkey and subject digest, checkpoint phase,
exact checkpoint digest, current council PDA/version/hash, gate epoch, seat
index and authority, attestation slot, bump, and zero reserved bytes. The seat
authority must be the exact active authority at `seat_index` in that current
council and must sign directly or through its approved signer-PDA capability.

The seat may recast its own attestation to a different candidate digest only
while the canonical checkpoint is absent. Recasting writes the same canonical
seat attestation PDA with a new signed digest and slot; it never creates or
mutates the checkpoint. Once the checkpoint exists, attest/recast rejects.
Finalization rejects duplicate accounts, duplicate seat indexes, stale or
noncurrent councils, wrong PDA/bump/authority, any disagreement between the
three attestations, any mismatch between an attestation and the candidate
checkpoint bytes, and any attempt to create an already existing checkpoint.
The account's own digest separates seat evidence from the checkpoint and
proposal/resolution digest domains, so signatures cannot replay across seats,
councils, epochs, phases, subjects, or checkpoints.

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
five valid unique authorities, have a version strictly greater than the current
version, have no deactivation slot, and hash its exact authorities and terms.
Unused candidate versions may be skipped: an immutable cancelled, expired, or
losing candidate must never occupy `current + 1` permanently and block all
future rotation. Activation requires the original
current council's 3-of-5 approvals, the major delay, unexpired timing, unchanged
target nonce, and unchanged current council. It updates only
`config.current_council_version`; the old council remains immutable history.

Candidate creation has one narrow account-alias exception: when the creator is
also a seat in the candidate set, the creator-authority account may be the same
signer/read-only account as that exact candidate-seat authority position. This
supports unchanged five-seat term renewal without requiring a sixth key. The
candidate still contains five unique seat authorities, the configured guardian
cannot be a seat, and every other duplicate account alias remains rejected.

Binding both current council version and target nonce makes stale and competing
rotations fail without adding a rotation field to `ControllerConfigV1`.
Rotation uses lazy staleness and explicit repinning of later approval
accumulators. It never enumerates, iterates, or rewrites every outstanding
proposal account.

`CouncilRotationProposalV1` stores an activation slot but has no separate
cancelled/expired slot. Release 1 therefore treats finalized transaction
history as the authoritative timestamp for those two terminal transitions.
Receipt v3 must include and independently verify that transition transaction,
its finalized slot, the pre/post account bytes, quorum or expiry condition, and
the immutable expiry commitment. The account's terminal/cancellation reason is
not presented as a standalone proof of when the transition occurred.

## 10. `EmergencyFreezeResolutionV1`

```text
discriminator: AGVEFR01
version: 1
exact length: 640 bytes
reserved: 100 zero bytes
digest domain: AMOEBA_EMERGENCY_RESOLUTION_V1
digest material: 442 bytes
digest preimage: 472 bytes
```

The account binds config, gate, target, ProgramData, the canonical immutable
`EmergencyFreezeObservationV1`, exact emergency epoch, freeze slot/reason,
`ResumeWithoutUpgrade`, creation/not-before/expiry slots, target nonce snapshot,
the observation's target Program owner/executable/data length/canonical-header/
linked-ProgramData evidence, ProgramData account owner/executable/data length/
canonical-header metadata, slot/raw-hash completeness and commitment/capacity/
optional authority, and the emergency checkpoint PDA. It does not store or
require a second full payload hash. A complete raw ProgramData SHA-256 covers
the Loader header, payload, and tail; the emergency checkpoint separately
commits its audited payload view.

Creation is permissionless and payer-only; it has no proposer seat or privileged
creator. The processor mechanically derives every immutable field: canonical
PDA and observation, current config/gate/epoch/nonce, `creation_slot` from
Clock, `not_before_slot = freeze_slot + routine_delay`, checked
`expiry_slot = freeze_slot + proposal_expiry`, fixed
`ResumeWithoutUpgrade`, all ProgramData observations copied byte-for-byte from
the canonical freeze observation, and the canonical emergency checkpoint PDA.
A caller cannot select roots, timing, kind, authority, or identity. Council
approval is a later and separate capability.

Approval council fields and bitset are mutable and excluded from the base
digest so an incomplete approval accumulator can repin after rotation. Execution
requires the completed accumulator still match the current council, the routine
delay, unchanged target nonce, exact unchanged ProgramData observation and
optional authority, accepted emergency checkpoint, no active proposal, and the
exact emergency epoch. The re-read authority must equal the recorded optional
authority and both must be `Some(controller_authority)`; `None` or drift remains
safely frozen and cannot resume. The initialization freeze reason is
categorically rejected. Executed state additionally requires a complete raw
hash and the canonical Loader-v3 Program/ProgramData graph; an incomplete or
malformed freeze observation may be governed and checkpointed but can never
execute ResumeWithoutUpgrade.

`EmergencyFreezeResolutionV1` stores an execution slot but no separate expired
slot; its `Cancelled` enum value is mechanically unreachable in Release 1
because V1 has no independent cancellation accumulator and tag 26 remains
closed. Finalized transaction history is the authoritative expiry-transition
timestamp. Receipt v3 must bind the exact expiry transaction and pre/post bytes
rather than infer a timestamp from the terminal reason alone.

## 10.1 `EmergencyFreezeObservationV1`

```text
discriminator: AGVEFO01
version: 1
exact length: 512 bytes
reserved: 19 zero bytes
digest domain: AMOEBA_EMERGENCY_FREEZE_OBSERVATION_V1
digest material: 450 bytes
digest preimage: 488 bytes
PDA: [ameba-upgrade-v1, emergency-observation, target_program, frozen_epoch_le]
```

Guardian freeze creates this account and finalizes it atomically with the gate
epoch transition. It binds controller program/config, gate, target Program and
ProgramData, Upgradeable Loader, canonical controller authority, exact frozen
epoch/slot/reason, deployed ProgramData slot, exact raw ProgramData SHA-256,
capacity, exact optional observed authority, target Program runtime evidence,
raw-hash completeness, and finalization slot.
`finalized_slot` must equal the freeze slot. Observed authority is a canonical
`OptionalPubkeyV1`: it may be the controller authority, another authority, or
`None`, because authority drift or removal must never prevent the guardian from
freezing. That evidence grants no loader or resume power. Resume separately
requires an unchanged observation and `Some(controller_authority)`. There is no
provisional state and no caller-supplied second payload hash. A wrong
discriminator/version, false initialized/finalized byte, noncanonical optional
encoding, zero commitment, nonzero reserved byte, or digest drift fails closed.

The observation also binds the actual ProgramData account owner, executable
flag, and exact data length, plus whether the Upgradeable Loader ProgramData
header is canonically valid and representable. It separately binds the target
Program account owner, executable flag, exact data length, canonical Program
header classification, and canonical optional linked ProgramData key. A
guardian freeze remains recordable if either account
has the wrong owner, executable flag, malformed length/header, or no authority.
The no-header shape requires zero header slot/capacity and absent authority;
resolution may preserve that immutable evidence but cannot execute resume until
the current account is the exact canonical loader-owned, non-executable,
well-formed ProgramData with unchanged metadata and `Some(controller_authority)`.

`program_header_present` and `programdata_header_present` mean canonical-valid
and representable, not merely byte-decodable. A Program tag whose 32-byte link
is the default key is recorded with `program_header_present = false` and absent
link. A ProgramData header containing a noncanonical optional authority such as
`Some(default)` is recorded with `programdata_header_present = false`, zero
slot/capacity, and absent authority. Exact owner/executable/data length and the
raw ProgramData hash-completeness evidence remain recorded, so malformed loader
bytes cannot block GuardianFreeze account creation.

## 10.2 `ProgramDataFailureObservationV1`

```text
discriminator: AGVPDF01
version: 1
exact length: 512 bytes
reserved: 24 zero bytes
digest domain: AMOEBA_PROGRAMDATA_FAILURE_OBSERVATION_V1
digest material: 444 bytes
digest preimage: 485 bytes
PDA: [ameba-upgrade-v1, programdata-failure, primary_proposal, frozen_epoch_le]
```

This immutable account binds config, gate, primary proposal, target Program and
ProgramData, frozen epoch, exact actual raw ProgramData SHA-256, actual account
owner, executable flag, exact data length, whether a canonical ProgramData
header was present, exact actual header slot/capacity/optional authority, typed
mismatch class, optional failing chunk evidence, target Program runtime
evidence, raw-hash completeness, and finalization slot. Raw
bytes alone do not commit runtime/RPC account metadata, so owner, executable,
and length are mandatory processor-derived evidence even for a header failure.
Mismatch classes are `Header`, `Authority`, `Capacity`,
`PayloadLeaf`, and `ZeroTail`. Header/authority/capacity failures require the
sentinel chunk index and zero leaf hashes. Payload and zero-tail failures
require a real chunk index and distinct nonzero expected/actual leaf hashes.
Absent headers require zero slot/capacity, absent authority, and the `Header`
class. These combinations are schema-validated so placeholder evidence cannot
be serialized as a different failure class. `PayloadLeaf` and `ZeroTail`
require a complete raw hash. `Header`, `Authority`, and `Capacity` may record
canonical incomplete/zero raw-hash evidence when the exact ProgramData account
length exceeds the separately benchmarked atomic ceiling.

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

The target ProgramData account must not exceed
`MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1` (1,572,909 bytes) at
initialization. A larger target could never satisfy Release 1 proposal,
emergency-resume, or checkpoint mechanical hashing, so accepting it would
create a permanently unusable trust root. This cap is target-policy-specific:
the controller's own ProgramData remains subject to exact Program/ProgramData
linkage and initializer-authority verification but is not constrained by the
target artifact/checkpoint ceiling.

Initialization deliberately does **not** require the target ProgramData
authority already equal the controller authority PDA. The authorized future
ceremony initializes and verifies the controller first, then makes the
controller immutable, then installs/verifies the Spread bridge, and only then
hands off target authority. Requiring target custody at initialization would
invert that safety order.

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

Predeployment audit finding: the current Release 1 instruction set does not
contain that bootstrap-activation transition, and it also does not contain a
typed controller CPI that can make the authority PDA sign Loader-v3
`SetAuthorityChecked` during target custody handoff. Because the intended
ceremony makes the controller immutable before those steps, the current
artifact is not Phase 7 ceremony-ready. This is not a schema-capacity problem
and reserved bytes must not be repurposed to hide it. A future explicit version
must add and independently audit both narrowly typed transitions before any
controller immutability or target authority handoff.

The frozen field name `vote_review_slots` is retained only for ABI compatibility;
Release 1 interprets it as `council_review_slots` while token governance remains
mechanically disabled. Validation uses checked arithmetic and requires
`1 + council_review_slots + major_delay_slots < proposal_expiry_slots`.
Overflow and the equality boundary fail closed. No Release 1 instruction
mutates timing or enables vote fields.

## 14. Instruction/version compatibility

The existing tag-0 `RecordProposalApprovalV1` codec remains byte-for-byte frozen
for historical regression vectors, but Release 1 requires processor dispatch to
reject it. It is codec-only, not an active timeless V1 approval path. The
versioned V2 approval path enforces review start/end, strict pre-expiry timing,
current target nonce, creation gate status/epoch, verified buffer, exact pinned
creation council and digest, duplicate rejection, and one threshold crossing.

Every new decoder rejects unknown tags before payload allocation, unknown
account versions, truncation, and trailing bytes. No new processor treats a V1
proposal as V2 and there is no migration instruction.

`FreezeProposalV2` and `ConvertEmergencyFreezeV2` account contracts include
the exact read-only target Program, ProgramData, Upgradeable Loader, and
controller authority PDA. They also require the exact reciprocal rollback
proposal, rollback `BufferVerificationV1`, and sealed rollback buffer as
read-only accounts. Before consuming the nonce or advancing the epoch, the
processor proves the rollback is the committed reciprocal proposal, fully
authority-locked and `Verified`, 3-of-5 approved, governance-satisfied,
timelocked, unexpired, and has sufficient rollback-delay runway. This lets the
freeze transition validate the complete authority and rollback graph instead
of trusting proposal copies. Guardian freeze also uses that exact graph plus
the canonical emergency observation PDA. No freeze account contract accepts an
arbitrary loader or writable target graph.

Checkpoint tags 15-17 are the closed anti-squatting surface:

- `CreateCheckpointAttestationV1` is payer + current-seat signer scoped and
  creates only that seat's canonical attestation PDA;
- `RecastCheckpointAttestationV1` lets the same current seat replace its own
  attestation while the checkpoint is absent; and
- permissionless `FinalizeCheckpointV1` accepts exactly three distinct
  canonical read-only current-council attestations plus payer/System Program,
  and atomically creates the canonical finalized checkpoint. Poststate has one
  additional canonical accepted-Prestate baseline account.

`CreateEmergencyResolutionV1` is payer-only and derives every field from Clock,
config, policy, gate, and the canonical freeze observation. Guardian/create/
execute wire data use the same canonical `OptionalInstructionPubkeyV1`
authority encoding and bind ProgramData metadata. `ExecuteEmergencyResolutionV1`
also requires the Instructions sysvar and rejects any envelope other than the
separate canonical emergency-resume transaction.

The corrected fixed instruction vectors are:

| Tag | Instruction | Payload bytes | Exact accounts |
|---:|---|---:|---:|
| 6 | `FreezeProposalV2` | 171 | 12 |
| 9 | `GuardianFreezeV1` | 259 | 10 |
| 10 | `CreateEmergencyResolutionV1` | 395 | 8 |
| 13 | `ExecuteEmergencyResolutionV1` | 420 | 12 |
| 14 | `ConvertEmergencyFreezeV2` | 203 | 13 |
| 15 | `CreateCheckpointAttestationV1` | 489 | 10 |
| 16 | `RecastCheckpointAttestationV1` | 521 | 8 |
| 17 | `FinalizeCheckpointV1` | 488 | 14 for primary Prestate/Emergency; 15 for rollback Prestate/Poststate |
| 23 | `ExpireEmergencyResolutionV1` | 157 | 4 |

Tag 23 uses config `R`, the exact current policy `R`, gate `R`, and emergency
resolution `W`, in that order. The policy account is consensus-required: the
instruction's expected policy hash is revalidated against the canonical policy
PDA and cannot be treated as an off-chain receipt-only guard.

Tags 27-38 are the complete typed Loader-v3, deployed-byte-verification,
rollback-activation, and unfreeze codec surface. Exact wire lengths include the
one-byte tag. Account order and privileges are consensus-facing; `S+W` means
signer+writable, `S` signer+read-only, `W` writable, and `R` read-only.

| Tag | Instruction | Payload bytes | Accounts | Exact ordered account contract |
|---:|---|---:|---:|---|
| 27 | `AdoptBufferV1` | 163 | 10 | payer `S+W`; config `R`; gate `R`; proposal `W`; buffer `W`; uploader authority `S`; controller authority PDA `R`; BufferVerification `W`; Upgradeable Loader `R`; System Program `R` |
| 28 | `VerifyBufferChunkV1` | 461 | 7 | config `R`; gate `R`; proposal `R`; buffer `R`; BufferVerification `W`; authority PDA `R`; Loader `R` |
| 29 | `FinalizeBufferVerificationV1` | 232 | 7 | config `R`; gate `R`; proposal `W`; buffer `R`; BufferVerification `W`; authority PDA `R`; Loader `R` |
| 30 | `ExtendTargetV1` | 297 | 12 | payer `S+W`; config `R`; gate `R`; proposal `W`; accepted Prestate checkpoint `R`; target ProgramData `W`; target Program `W`; authority PDA `W`; Loader `R`; System Program `R`; Rent sysvar `R`; Instructions sysvar `R` |
| 31 | `ExecuteUpgradeV1` | 391 | 20 | payer `S+W`; config `R`; policy `R`; gate `R`; proposal `W`; reciprocal counterpart proposal `R`; counterpart BufferVerification `R`; accepted Prestate checkpoint `R`; BufferVerification `W`; ProgramDataVerification `W`; target ProgramData `W`; target Program `W`; sealed buffer `W`; canonical spill treasury `W`; Rent `R`; Clock `R`; authority PDA `R`; Loader `R`; System Program `R`; Instructions sysvar `R` |
| 32 | `VerifyProgramDataChunkV1` | 530 | 8 | config `R`; gate `R`; proposal `R`; target Program `R`; target ProgramData `R`; authority PDA `R`; Loader `R`; ProgramDataVerification `W` |
| 33 | `FinalizeProgramDataVerificationV1` | 316 | 8 | config `R`; gate `R`; proposal `W`; target Program `R`; target ProgramData `R`; authority PDA `R`; Loader `R`; ProgramDataVerification `W` |
| 34 | `ApproveUnfreezeV1` | 252 | 12 | config `R`; policy `R`; current council `R`; gate `R`; proposal `W`; accepted Poststate checkpoint `R`; verified ProgramDataVerification `R`; target Program `R`; target ProgramData `R`; authority PDA `R`; Loader `R`; current seat authority `S` |
| 35 | `ExecuteUnfreezeV1` | 362 | 13 | config `R`; policy `R`; current council `R`; gate `W`; proposal `W`; reciprocal linked proposal `W`; accepted Poststate checkpoint `R`; verified ProgramDataVerification `R`; target Program `R`; target ProgramData `R`; authority PDA `R`; Loader `R`; Instructions sysvar `R` |
| 36 | `CloseAbandonedBufferV1` | 240 | 8 | config `R`; gate `R`; proposal `R`; BufferVerification `W`; buffer `W`; canonical spill treasury `W`; authority PDA `R`; Loader `R` |
| 37 | `ActivateRollbackV1` | 435 | 12 | config `R`; policy `R`; gate `W`; primary proposal `R`; rollback proposal `W`; rollback BufferVerification `R`; primary ProgramDataVerification `R`; typed failure evidence `R`; target Program `R`; target ProgramData `R`; authority PDA `R`; Loader `R` |
| 38 | `ObserveProgramDataFailureV1` | 624 | 11 | payer `S+W`; config `R`; gate `R`; primary proposal `R`; ProgramDataVerification `R`; target Program `R`; target ProgramData `R`; authority PDA `R`; Loader `R`; failure observation `W`; System Program `R` |

Tag 35 never accepts a default or dummy `linked_proposal`. For primary success it
must be the committed reciprocal rollback proposal, which becomes `Retired`
when the primary completes. For rollback success it must be the reciprocal
primary, which becomes `SupersededByRollback`. The two proposal accounts are
separately writable because this paired terminalization is atomic with the gate
becoming Active.

Tag 37's `failure_evidence` is generic only across two closed typed alternatives:
a canonical finalized *recoverable* `ProgramDataFailureObservationV1` for the
primary and frozen epoch, or a canonical finalized rejected Poststate
`StateCheckpointV1` for that same primary, digest, schema, and epoch. A
ProgramData failure is recoverable here only when its class is `PayloadLeaf` or
`ZeroTail` and the canonical Loader Program/ProgramData/authority/capacity graph
still holds. `Header`, `Authority`, and `Capacity` observations remain immutable
evidence but cannot activate typed rollback. The rejected checkpoint must have
`accepted == false`, nonzero `forbidden_drift_count`, and an exact 3-of-5
attestation finalization. The payload binds
`expected_failure_evidence_digest`; the processor selects and recomputes the
corresponding observation or checkpoint digest after validating the exact
account discriminator, length, PDA, and embedded identities. No arbitrary
account, raw digest, structural-loader failure, or caller-described failure can
activate rollback.

The processor contract for all 12 instructions requires rejection of a wrong
account count/order, privilege shape, identity, owner, executable flag,
duplicate alias, PDA/bump, embedded relation, or sysvar/program ID before
mutation. Their fixed expectations are stale-plan guards; processors must
re-read the gate, proposal, target nonce, loader header, buffer/ProgramData
authority, verification accumulators, checkpoints, and current council
immediately before transition or CPI. The current fixed codecs/builders encode
these closed account vectors; completion of those processor checks and their
failure-atomic matrix remains an explicit Gate C/D blocker.

### 14.1 Canonical per-state account invariants

The fixed schemas already enforce these local invariants. Cross-account,
current-slot, CPI, and transition atomicity remain Gate C/D processor work until
their processors and failure-atomic tests land.

| Account | Canonical per-state shape |
|---|---|
| `UpgradeProposalV2` | `TokenReviewOpen` is invalid; `freeze_gate_epoch` is nonzero exactly for Frozen-or-later states. Draft/BufferAdopted have no initial approvals; BufferVerified may have fewer than three; CouncilApproved and every later executable state have exactly three. GovernanceSatisfied requires council quorum; Timelocked and Frozen-or-later also require queued evidence. Extension slot exists exactly when a nonzero extension has executed. Upgrade, ProgramData, Poststate, unfreeze, and terminal slots appear only in their corresponding later states and are monotonically nondecreasing. Cancellation and unfreeze use independent council/version/hash/bitsets. Completed, Cancelled, Expired, SupersededByRollback, and Retired have their one exact terminal reason/slot shape. `Retired` is rollback-only; `SupersededByRollback` is primary-only. |
| `BufferVerificationV1` | Adopted has zero verified chunks and no final/terminal slot; Verifying has `0 < count < chunk_count`; ReadyToFinalize has the exact complete bitmap/count and no final slot; Verified adds a nonzero final slot; ConsumedByUpgrade requires complete verified evidence plus distinct final and terminal slots; ClosedAbandoned has a terminal slot and preserves whatever canonical partial-or-complete bitmap existed. All states bind the exact proposal/buffer/loader/uploader/controller authority, artifact commitment, selected chunk geometry, adoption slot, and nonzero sealed-header hash. |
| `ProgramDataVerificationV1` | Verifying is incomplete with zero raw hash, zero-tail flag false, and no final slot. ReadyToFinalize has both exact complete bitmaps/counts but still zero raw hash, false zero-tail flag, and no final slot. Verified requires both complete bitmaps, `zero_tail_verified == true`, nonzero exact raw hash, and nonzero final slot. Every state binds canonical Program/ProgramData/loader/authority identities, artifact commitment, deployed slot, capacity, and `tail_length == capacity - artifact_length`. |
| `StateCheckpointV1` | Prestate/Poststate have a proposal subject and default emergency subject; Emergency has the inverse. The record is never draft: it is created only with exactly three current-council attestations, a nonzero final slot, and exact bitset/count parity. `accepted` is true exactly when `forbidden_drift_count == 0`; a rejected immutable record has a positive forbidden count. Donation root is nonzero exactly when donation count is positive. Hard root is deterministically recomputed from schema, protected roots/counts, semantic custody, and external metadata. Exact phase evidence and slot ordering are defined in Section 8. |
| `CouncilRotationProposalV1` | Current/candidate identities and hashes are nondefault; candidate version is strictly greater than current and not `u64::MAX`; creation `<` not-before `<` expiry; nonce/digest are nonzero; approval and cancellation bitsets exactly match their counts and cannot exceed three. Draft has fewer than three approvals; CouncilApproved, Timelocked, and Activated have exactly three. Cancellation participation is present exactly when its reason is nonzero; only Cancelled reaches three cancellation approvals and its terminal reason equals that cancellation reason. Only Activated has a nonzero activation slot, which is at/after not-before and before expiry. Activated and Expired use their exact fixed terminal reasons; nonterminal states have zero terminal reason. Candidate council bytes are immutable; activation changes only config's current council version, never old council history. |
| `EmergencyFreezeResolutionV1` | Only `ResumeWithoutUpgrade` is representable. The exact non-bootstrap frozen epoch/reason, canonical observation, Program and ProgramData runtime evidence, raw-hash completeness, target nonce, checkpoint, and timing are digest-bound; freeze `<=` creation `<` expiry and freeze `<` not-before `<` expiry. Draft has fewer than three approvals; CouncilApproved, Timelocked, and Executed have exactly three. V1 Cancelled is schema-invalid and its cancellation reason is always zero because tag 26 is closed. Only Executed has a nonzero execution slot, at/after creation and not-before but before expiry; Executed and Expired have exact fixed terminal reasons while nonterminal states have zero. Resume remains blocked unless the current graph is canonical, unchanged, controller-authorized, delayed, unexpired, completely raw-hashed, and backed by the accepted exact Emergency checkpoint. |
| `ProgramDataFailureObservationV1` | Finalized and immutable; header/authority/capacity classes use the sentinel index and zero leaf hashes. Payload/ZeroTail classes require a real index and distinct nonzero processor-derived expected/actual leaves; ZeroTail uses no proof. Absent header permits only Header. Canonical mismatch precedence and lowest-index rules are above. |

The fixed raw-account hashing ceiling is
`MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 = 1,572,909`: exactly the
1,572,864-byte payload ceiling plus the 45-byte Loader-v3 ProgramData metadata.
The composed actual-SBF observation benchmark measured 798,245 CU under SBPF v0
(601,755 margin) and 798,323 CU under SBPF v2 (601,677 margin) against the
1,400,000-CU limit. At or below the ceiling, `raw_hash_complete` is true and the
raw hash is nonzero. Above it, the flag is false and the hash is canonical zero.
Guardian freeze and Header/Authority/Capacity failure evidence remain
recordable; ResumeWithoutUpgrade and PayloadLeaf/ZeroTail evidence require a
complete hash.

## 15. Audit conclusion

The Release 1 lifecycle is representable with the versioned accounts above.
The design does not require a production controller ID, token governance,
target immutability, hidden recovery authority, V1 reserved-byte reuse, dynamic
state allocation, or live mutation.

Gate B closed on the isolated local branch at
`81c6b5fd4b0de8e9f827f2c0265721ba73f2eb67`, after the Rust and TypeScript
encode/decode/digest/PDA implementations consumed the same checked-in Release 1
fixture and the historical V1 fixtures remained unchanged. The canonical
Release 1 fixture is `fixtures/upgrade_governance_release1.json`; its current
checked-in SHA-256 is
`277c6831615b84dd9ea144f6d1f84aa6dc6a350c1f6952e047f7ee2c9ff11c38`.

Closing Gate B authorizes lifecycle implementation but does not close Gates C
through F. The final candidate must rerun fixture-drift, unknown-version,
reserved-byte, account-length, discriminator, and Rust/TypeScript parity tests
after all processor changes. Any intentional schema change requires a new
version/domain and a reviewed fixture change; it must not reinterpret V1 bytes.
