# Phase 1 serialization decisions

The specification deliberately leaves several layout sizes and two digest
details open. Phase 1 freezes the following safe interpretations.

## Frozen account ABI

All integers are fixed-width little-endian, public keys are raw 32-byte values,
and booleans are canonical Borsh `0` or `1`. Stable enums use hand-written
one-byte codecs rather than relying on declaration order. Every load must reject
truncation, trailing bytes, unknown enum values, noncanonical booleans, wrong
headers, and nonzero reserved bytes.

| Type | Discriminator | Reserved bytes | Exact serialized length |
|---|---|---:|---:|
| `ControllerConfigV1` | `AGVCFG01` | 28 | 512 |
| `GovernancePolicyV1` | `AGVPOL01` | 21 | 160 |
| `CouncilSeatV1` | embedded | 12 | 96 |
| `GovernanceCouncilSetV1` | `AGVCNS01` | 26 | 640 |
| `ProtocolGateV1` | `AGVGAT01` | 2 | 192 |
| `UpgradeProposalV1` | `AGVPRP01` | 142 | 1,280 |

The policy, council, and proposal hash materials are exactly 96, 511, and
1,084 bytes. The proposal domain is the exact 26 ASCII bytes
`AMOEBA_UPGRADE_PROPOSAL_V1`, producing a 1,110-byte frozen preimage. The
language-neutral fixture records the complete material, preimage, digest, and
all nine Phase 1 PDA addresses and bumps.

The persisted `Pubkey` type uses the pinned `solana-pubkey` 2.4.0 Borsh feature
to make its 32-byte Borsh 0.10 representation explicit. No variable-width
collection, string, or Borsh `Option` appears in an account.

## Company affiliation

`CouncilSeatV1` carries an explicit `company_affiliated` boolean. V1 requires
both `CoreProtocol` seats to be company-appointed and company-affiliated, while
both `CommunityDelegate` seats and the `SecuritySteward` must be token-appointed
and non-company. This avoids deriving the quorum-critical non-company count from
an ambiguous affiliation hash.

The affiliation hash remains mandatory and the set rejects more than two seats
sharing any affiliation. It cannot prove undisclosed beneficial ownership; it
only enforces the ratified metadata, as the specification acknowledges.

Seat indexes are canonical: indexes 0-1 are `CoreProtocol`, 2-3 are
`CommunityDelegate`, and index 4 is `SecuritySteward`. Approval bits therefore
have one unambiguous meaning across Rust, TypeScript, receipts, and signers.

## Digest completeness

The canonical proposal digest commits both the creation epoch and expected
freeze/execution epoch. It also commits `source_tree_hash` and the optional
rollback proposal, which are required proposal fields but omitted from the
specification's recommended digest sketch.

All review, queue, not-before, and expiry slots are committed when the proposal
is created. A later queue transition validates those commitments and must not
rewrite them after an approval.

Optional public keys use a fixed 33-byte encoding: one canonical `0` or `1`
presence byte followed by 32 key bytes. An absent value with nonzero key bytes is
invalid.

`GovernancePolicyV1.set_hash` is named `policy_hash` in code. Policy, council,
and gate accounts include an explicit controller-config identity and the same
discriminator/version/bump/initialized header shape. Proposal, poststate, and
unfreeze approvals use separate bitsets and counts so one decision cannot be
replayed as another.

`source_commit_hash` and `source_tree_hash` are 32-byte release commitments,
not padded Git SHA-1 object IDs. Operator tooling must supply SHA-256 commitments
from the canonical release receipt and must independently display the original
Git object IDs.

## Static controller and gate rules

Version 1 leaves `policy_flags` at zero until individual bits are specified.
Configured delays must satisfy
`rollback <= routine <= major <= terminal`, and the vote-review interval must
be shorter than proposal expiry. While token governance is disabled, all four
vote identities are canonically default; enabling it requires all four to be
nondefault.

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
current council version/hash, seat signer, and term. The lower-level bit helper
is crate-private. Transition validation is explicitly graph-shape validation,
not runtime authorization; later handlers must additionally prove quorum, vote,
time, gate, and account evidence.

`EmergencyRollback` is deliberately unsupported in the Phase 1 acceptance API.
Presence fields on the current proposal cannot prove that a prior governed
proposal precommitted the exact rollback proposal, buffer, and artifact. Phase 3
must add that cross-account proof before rollback can bypass a new vote.
`CouncilSetRotation` and `TargetImmutability` likewise have no invented
code-upgrade graph in this phase.

## PDA vector identity

No production controller program ID has been assigned. Golden vectors therefore
use an explicitly synthetic program ID and are marked non-production. They lock
the derivation algorithms and seed encodings only; a production ID requires a
second reviewed vector set before initialization or deployment.

## Phase boundary

No program entrypoint or instruction processor is present in Phase 1. That
makes the scaffold non-deployable and prevents an accidental loader or authority
surface before later phases receive explicit authorization.
