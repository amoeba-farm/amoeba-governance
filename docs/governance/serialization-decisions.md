# Bootstrap V1 and Phase 3 bridge serialization decisions

This file records the current implementation decisions after the Phase 2
Bootstrap V1 and Phase 3 universal Spread gate amendments. The historical
Phase 0/1 report remains unchanged; the Phase 2 amendment supersedes its
company-classified council and token-vote assumptions, while the Phase 3
amendment controls the bridge ABI and current phase boundary.

## Frozen account ABI

All integers are fixed-width little-endian, public keys are raw 32-byte values,
and booleans are canonical Borsh `0` or `1`. Stable enums use hand-written
one-byte codecs rather than relying on declaration order. Every load rejects
truncation, trailing bytes, unknown enum values, noncanonical booleans, wrong
headers, and nonzero reserved bytes.

| Type | Discriminator | Reserved bytes | Exact serialized length |
|---|---|---:|---:|
| `ControllerConfigV1` | `AGVCFG01` | 28 | 512 |
| `GovernancePolicyV1` | `AGVPOL01` | 21 | 160 |
| `CouncilSeatV1` | embedded | 47 | 96 |
| `GovernanceCouncilSetV1` | `AGVCNS01` | 26 | 640 |
| `ProtocolGateV1` | `AGVGAT01` | 2 | 192 |
| `UpgradeProposalV1` | `AGVPRP01` | 142 | 1,280 |

The policy, council, and proposal hash materials are exactly 96, 336, and
1,084 bytes. The proposal domain is the exact 26 ASCII bytes
`AMOEBA_UPGRADE_PROPOSAL_V1`, producing a 1,110-byte frozen preimage. The
language-neutral fixture records the complete policy, council, and proposal
materials and hashes, exact policy/council account bytes, the 96-byte seat
bytes, and all nine PDA addresses and bumps.

The persisted `Pubkey` type uses the pinned `solana-pubkey` 2.4.0 Borsh feature
to make its 32-byte Borsh 0.10 representation explicit. No variable-width
collection, string, or Borsh `Option` appears in an account.

## Phase 3 gate and tail bridge ABI

`ProtocolGateV1` remains the exact 192-byte account below. Rust and TypeScript
export the same offsets and reject every length, discriminator, version,
noncanonical-boolean, unknown-enum, reserved-byte, and invalid-state-shape
mutation before accepting a canonical re-encoding.

| Offset | Bytes | Field |
|---:|---:|---|
| 0 | 8 | discriminator `AGVGAT01` |
| 8 | 1 | account version `1` |
| 9 | 1 | PDA bump |
| 10 | 1 | initialized boolean |
| 11 | 1 | `GateStatusV1` |
| 12 | 32 | controller config |
| 44 | 32 | target program |
| 76 | 32 | target ProgramData |
| 108 | 8 | epoch, little-endian `u64` |
| 116 | 32 | active proposal |
| 148 | 8 | freeze slot, little-endian `u64` |
| 156 | 2 | freeze reason, little-endian `u16` |
| 158 | 32 | last completed proposal |
| 190 | 2 | zero reserved bytes |

`GovernanceInstructionTailV1` is exactly 16 bytes and is a signed instruction
suffix, not an account and not a detached signature: bytes 0–3 are ASCII
`AGV1`, byte 4 is version `1`, bytes 5–7 are zero, and bytes 8–15 are the
expected gate epoch as a little-endian `u64`. The parser consumes only the
absolute final 16 bytes, never searches backward for magic, and returns the
unchanged legacy prefix. The canonical epoch-41 tail is
`41475631010000002900000000000000`.

The bridge fixture uses the synthetic controller
`4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi`, the real Spread target program,
and that target's canonical upgradeable-loader ProgramData derivation. Its
self-hash is SHA-256 over the exact LF-terminated pretty JSON after replacing
the `fixtureSha256` value with 64 ASCII zeroes. This avoids a circular file-hash
definition while still committing every other byte. The generator is not used
inside the independent Rust or TypeScript fixture assertions.

## Equal, unclassified seat authorities

`CouncilSeatV1` contains only a nondefault `seat_authority`, an active term, an
`active` flag, and zero reserved bytes. It persists no company, non-company,
class, appointment, affiliation, or signer-kind metadata. The five indexes are
stable approval-bit positions, not governance classes, and one public key may
not occupy two seats in the same set.

Bootstrap V1 is operationally company-led because Amoeba Farm controls three
of five seat authorities, but this deployment fact is not an on-chain vote
weight or classification. Every seat casts one equal vote. Routine governance
requires any three seats; target immutability alone uses the four-seat terminal
threshold. Every other currently scaffolded proposal class, including emergency
rollback, uses routine quorum for approval accumulation. Implementing a later
class-specific execution path is separate from permitting approvals.

## Digest completeness

The canonical proposal digest commits both the creation epoch and expected
freeze/execution epoch. It also commits `source_tree_hash` and the optional
rollback proposal, which are required proposal fields but omitted from the
original specification's recommended digest sketch.

All review, queue, not-before, and expiry slots are committed when the proposal
is created. A later queue transition validates those commitments and must not
rewrite them after an approval.

Optional public keys use a fixed 33-byte encoding: one canonical `0` or `1`
presence byte followed by 32 key bytes. An absent value with nonzero key bytes
is invalid.

`GovernancePolicyV1.set_hash` is named `policy_hash` in code. Policy, council,
and gate accounts include an explicit controller-config identity and the same
discriminator/version/bump/initialized header shape. Proposal, poststate, and
unfreeze approvals use separate bitsets and counts so one decision cannot be
replayed as another.

`source_commit_hash` and `source_tree_hash` are 32-byte release commitments,
not padded Git SHA-1 object IDs. Operator tooling must supply SHA-256 commitments
from the canonical release receipt and independently display the original Git
object IDs.

## Static controller, policy, and gate rules

Version 1 leaves both policy flag fields at zero. The policy fixes council size
to five, routine threshold to three, terminal threshold to four, and governance
mode to `BootstrapCouncilOnly`. Configured delays must satisfy
`rollback <= routine <= major <= terminal`, and the vote-review interval must
be shorter than proposal expiry.

Token governance cannot be activated by data mutation in V1:
`ControllerConfigV1::validate_static` rejects an enabled flag or any nondefault
vote identity. Policies require every vote basis-point field to be zero and
every vote-required flag false. Proposals require `VoteRequirementV1::None` and
default vote program/result identities, making `TokenReviewOpen` unreachable.

An Active gate has no active proposal, freeze slot, or reason. A governed
`FrozenForUpgrade` gate binds a nondefault proposal plus nonzero freeze slot and
reason. A guardian-created `EmergencyFrozen` gate has no proposal—because the
guardian gains no proposal or loader authority—but does bind a nonzero freeze
slot and reason.

For a code artifact, `buffer_loader_owner` must equal the pinned upgradeable
loader and `buffer_authority` must equal the controller authority PDA. The
artifact length must fit the committed post-extension payload capacity.

## Policy-bound pure APIs

Vote requirements and quorum strength derive from `ProposalClassV1`; callers do
not supply a free-standing authorization mode. Initial proposal approval is
accepted only in `BufferVerified` and binds the exact policy, stored digest,
current council version/hash, seat authority, and active term. The lower-level
bit helper is crate-private. Emergency rollback approvals use routine quorum,
while rollback execution remains absent.

Transition validation is graph-shape validation, not runtime authorization;
later lifecycle handlers must additionally prove their complete gate, buffer,
time, loader, checkpoint, and recovery evidence. `CouncilSetRotation` and
`TargetImmutability` retain no invented code-upgrade execution graph.

## Executable approval ABI

The sole executable instruction is tag `0`, followed by the expected 32-byte
proposal digest and little-endian `u64` council version, for exactly 41 bytes.
It accepts exactly five logical accounts: read-only config, policy, and council;
writable proposal; and a read-only runtime signer seat authority with
unrestricted owner and non-executable status.

A direct signer and a PDA made a signer through CPI and `invoke_signed` use the
same authorization check. No private key, keypair file, seed phrase, raw
signature, or arbitrary authorization callback crosses the instruction ABI.

The processor verifies all controller owners and exact lengths before fixed
deserialization; canonical config, policy, council, proposal, authority, gate,
target ProgramData, and pre/post checkpoint identities; stored bumps; current
versions and hashes; target nonce and copied identities; active policy/council
and seat terms; and a below-quorum `BufferVerified` accumulator. Existing
proposal IDs must be strictly below `ControllerConfigV1.next_proposal_id`,
treating that field as the next unallocated sequential ID.

The next proposal representation is computed and serialized off-borrow. An
approval below threshold commits while state remains `BufferVerified`; only a
false-to-true threshold crossing changes state to `CouncilApproved`.

## PDA vector identity

No production controller program ID has been assigned. Golden vectors use an
explicitly synthetic program ID and are marked non-production. They lock the
derivation algorithms and seed encodings only; a production ID requires a
second reviewed vector set before initialization or deployment.

## Phase boundary

The controller remains predeployment. Phase 2 adds only the executable
`RecordProposalApprovalV1` kernel. The controller-side Phase 3 slice adds only
execution-free gate/tail codecs, ProgramData/PDA derivations, a deterministic
bridge fixture, parity tests, CI, and documentation. It adds no executable
instruction. Universal dispatch admission, the exhaustive tag manifest,
compressed-instruction integration, client migration, packet boundaries,
races, and durable-nonce behavior remain target-side `ameba_spread` work. The
full proposal lifecycle remains Phase 4. Initialization, gate mutation, buffer
custody, loader CPI, upgrade, recovery, authority transfer, token voting,
deployment, and arbitrary CPI remain absent.
