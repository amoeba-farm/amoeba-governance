# Release 1 ProgramData Capacity and Liveness Audit

Status: normative implementation decision for the ceremony-closure branch  
Governance baseline: `c2771a7a74c895bbb9a81ba38273e19ac25931ea`  
Spread baseline: `88c067ae6f2901131698be1e12fdff6f259b361b`  
Ceremony-closure specification SHA-256: `11b211c82a0662f8394e6719180b48be32cdabfcf9607f4f1a519e1fcb65ed20`

This audit is the design gate that precedes ceremony-closure processor work. It
does not authorize deployment, authority transfer, immutability, RPC mutation,
or a production controller identity.

## Decision

Release 1 will separate these three quantities:

1. the exact immutable artifact length;
2. the currently observed ProgramData payload capacity; and
3. the amount of ProgramData that one controller instruction hashes.

The artifact ceiling remains `1,572,864` bytes. The supported ProgramData raw
account length is the pinned Loader/runtime maximum of `10,485,760` bytes, which
means the maximum payload capacity is `10,485,715` bytes after the 45-byte
Loader-v3 ProgramData header.

The production-reachable ceremony path will use explicit new versions. It will
not reinterpret the published V1/V2 exact-capacity fields or reserved bytes.
The historical capacity-fragile tags remain byte-decodable for regression
vectors but become non-executable once the versioned replacement is complete.

The selected capacity policy is:

```text
artifact length                 exact and immutable
minimum required capacity       immutable proposal commitment
actual capacity                 freshly and mechanically observed
maximum supported raw length    10,485,760 bytes
maximum supported capacity      10,485,715 bytes
external monotonic extension    admissible only after fresh re-observation
appended bytes                  must all be zero
capacity decrease               rejected
payload drift                   rejected
Program/ProgramData linkage     rejected on drift
owner/executable/header drift   rejected
authority drift                 rejected except the typed checked handoff
```

A larger zero-only capacity invalidates stale evidence; it does not invalidate
the immutable proposal. A fresh observation generation can restore progress.

## Pinned runtime derivation

The controller and target repositories pin the Loader-v3 interface and Agave
2.3.13 test/runtime family. In the pinned sources:

- `solana-system-interface` defines `MAX_PERMITTED_DATA_LENGTH` as
  `10 * 1024 * 1024`, or `10,485,760` bytes;
- Loader-v3 ProgramData metadata is exactly 45 bytes;
- deploy and extend reject an account whose total data length would exceed the
  system maximum;
- extension only grows ProgramData and has no shrink operation;
- Upgrade preserves the allocated length, writes the new artifact, and zeroes
  the remaining capacity;
- checked extension and checked authority transfer are feature-gated typed
  Loader instructions.

The exact maximum is therefore:

```text
maximum raw ProgramData bytes = 10,485,760
metadata bytes                =         45
maximum payload capacity      = 10,485,715
```

The Spread release checker independently pins the same raw maximum in
`scripts/check_release_candidate.py`. A finalized feature-state read remains a
future production ceremony input; this local branch proves only the pinned
runtime behavior.

## Existing absorbing failures

The published candidate couples the artifact ceiling to ProgramData capacity:

- `UpgradeProposalV2` requires exact `current_capacity + extension_delta ==
  expected_post_capacity` and caps `expected_post_capacity` at `1,572,864`;
- `ProgramDataVerificationV1` rejects capacity above `1,572,864`;
- guardian and failure observations complete their raw hash only when the raw
  account is at most `1,572,909` bytes;
- initialization rejects a target already above that raw ceiling;
- Loader-v3 cannot shrink ProgramData.

Consequently, either of these adversarial traces is absorbing today:

```text
Active
-> permissionless valid extension beyond 1,572,864-byte payload capacity
-> initialization/proposal/emergency paths reject forever

FrozenForUpgrade
-> permissionless valid extension changes slot and exact capacity
-> proposal and verification expectations become stale
-> no governed re-observation or rebase path exists
```

Safe failure is not liveness. A controller that can only remain frozen after a
valid extension does not satisfy Release 1.

At the runtime maximum, a 16-KiB traversal has 640 real chunks, 1,024 padded
leaves, and depth 10. The published ProgramData verification schema has a
64-byte bitmap and a depth-seven artifact-proof ABI. Raising constants cannot
repair the mismatch without changing public meanings.

## Versioning decision

The following published objects retain their exact byte meanings:

- `UpgradeProposalV2`;
- `ProgramDataVerificationV1`;
- `EmergencyFreezeObservationV1`;
- `EmergencyFreezeResolutionV1`;
- `ProgramDataFailureObservationV1`;
- all existing reserved bytes and instruction tags.

The ceremony-safe path introduces these explicit schemas:

```text
UpgradeProposalV3
StateCheckpointV2
ProgramDataCapacityPolicyV1
ProgramDataObservationV1
ProgramDataVerificationV2
EmergencyFreezeObservationV2
EmergencyFreezeResolutionV2
ProgramDataFailureObservationV2
CurrentDeploymentStateV1
ControllerReleaseCommitmentV1
ControllerImmutabilityReceiptV1
TargetAuthorityHandoffProposalV1
TargetAuthorityHandoffReceiptV1
BootstrapActivationProposalV1
BootstrapActivationReceiptV1
```

Every new object has a unique discriminator or version, fixed length, strict
decoder, canonical PDA, zero reserved bytes, and deterministic Rust/TypeScript
vectors. No implicit V2-to-V3 migration exists because none of these schemas is
live on chain. Initialization remains bootstrap-frozen and the final dispatcher
exposes only the coherent V3 lifecycle for code upgrades.

`UpgradeProposalV3` keeps the artifact, source, build, rollback, timing,
checkpoint, council, and token-disabled commitments of V2. Its capacity fields
instead bind:

```text
capacity_policy_id
minimum_required_capacity
maximum_supported_raw_programdata_length
current_deployment_state
current_deployment_digest
```

It does not call a Merkle root a raw SHA-256 and does not immutably pin the
actual capacity or deployed slot. Fresh observations bind those mutable Loader
facts at each transition. Full raw SHA-256 is retained only as independently
recomputed receipt evidence.

`StateCheckpointV2` names the ProgramData observation key, root, and digest
explicitly. This avoids depending on whether the published V1 field named
`target_raw_programdata_commitment` was interpreted by a reviewer as a raw
SHA-256 or a scheme-tagged generic commitment.

`ControllerConfigV1` remains sufficient without changing its reserved bytes.
It already pins the target, ProgramData, Loader, authority PDA, gate, policy,
council version, target nonce, guardian, treasury, timing, and disabled token
governance. A separate immutable `ProgramDataCapacityPolicyV1` is derived
canonically from the controller config and target. It is initialized exactly
once while the gate is in the bootstrap initialization freeze and while the
controller ProgramData upgrade authority still signs. Every ceremony-safe
instruction derives and requires that policy PDA and its digest. The same
one-time ceremony-state initialization creates the canonical
`ControllerReleaseCommitmentV1`; therefore no caller can substitute a policy or
release identity and no ConfigV1 byte changes meaning.

## Bounded ProgramData observation

### Account and purpose separation

`ProgramDataObservationV1` is a canonical account keyed by target, purpose, and
generation. Its purpose is one of:

```text
ControllerImmutability
TargetHandoffBridge
ProposalPrestate
PostUpgrade
Rollback
EmergencyResolution
BootstrapActivation
```

The account binds the controller/config, subject key and digest, Program and
ProgramData, Loader, exact linkage, owners and executable flags, deployed slot,
upgrade authority, raw data length, payload offset, actual capacity, expected
artifact identity, minimum capacity, generation, scheme, chunk geometry,
frontier, next index, start/finalized slots, final root, status, and zero
reserved bytes.

Purpose and subject digest prevent replay between bridge, handoff, proposal,
emergency, post-upgrade, rollback, and activation evidence.

### Raw-byte accumulator

Each append instruction reads its exact range directly from the canonical
ProgramData account. The caller supplies no trusted bytes and no trusted leaf.
The leaf is:

```text
SHA256(
  "AMOEBA_PROGRAMDATA_OBSERVATION_CHUNK_V1"
  || observation_subject_digest
  || chunk_index_u32_le
  || actual_chunk_length_u32_le
  || exact_programdata_bytes
)
```

Nodes and padding use distinct domains:

```text
"AMOEBA_PROGRAMDATA_OBSERVATION_NODE_V1"
"AMOEBA_PROGRAMDATA_OBSERVATION_EMPTY_V1"
```

Node hashing also binds the tree level. Empty leaves bind the subject digest
and padded index. The tree is padded to the next power of two. A fixed streaming
frontier supports depth 10, sufficient for the runtime maximum even at the
smallest benchmark candidate. `next_index` must equal the supplied index, so a
duplicate or out-of-order append fails without a large bitmap.

Host geometry and deterministic root tests cover the 16, 32, 64, and 128 KiB
candidates. Actual controller-SBF measurement is presently complete only for
the selected 16-KiB production constant. At the 10,485,760-byte raw-account
maximum, observed append costs peaked at 64,674 compute units on SBPF v0 and
71,121 compute units on SBPF v2, each below the conservative 200,000-unit test
ceiling, with no runtime stack fault. The account ABI is sized for the
worst-case 16-KiB depth so benchmark selection cannot shrink runtime support.

The ceremony assignment separately required actual-SBF measurements for all
four candidates. The 32, 64, and 128 KiB candidates have not been exercised by
the actual-SBF compute-evidence lane. That is an explicit exit-criteria gap;
host geometry is not being presented as an SBF benchmark substitute.

### Artifact and zero-tail binding

The raw root proves the exact whole account but is not, alone, proof that the
payload equals a named release. The observation therefore has a second ordered
artifact-binding cursor. Each artifact step reads the exact 16-KiB payload range
directly from ProgramData and verifies its canonical artifact proof against the
subject's immutable artifact Merkle root. All artifact chunks must be verified.

Every raw traversal step also scans its intersection with the range after the
exact artifact length. Any nonzero tail byte is a hard failure. Finalization
requires:

```text
all raw chunks accumulated
all artifact payload chunks mechanically verified
all bytes after artifact length observed zero
header/linkage/owner/executable/slot/authority/length/capacity unchanged
actual capacity >= minimum required capacity
raw data length <= 10,485,760
```

The on-chain consensus commitment is explicitly the versioned ProgramData
Merkle root and observation digest. Receipt tooling independently recomputes
full raw SHA-256 and records it under an unambiguous receipt-only field.

### Drift and restart

Start, every chunk, every artifact-binding step, and finalization re-read the
entire bound header graph. Solana account locks serialize an extension with an
observation transaction. An extension between chunks changes at least deployed
slot, raw length, and capacity; the next observation step returns stale without
mutation. Anyone may start the next monotonic generation.

An observation generation is immutable after finalization. Stale partial
generations remain historical evidence and cannot be resumed or replayed.

## Current deployment state

`CurrentDeploymentStateV1` is the canonical trusted installed-release record.
It is first created by governed bootstrap activation and is updated only by a
completed separate unfreeze. It binds:

```text
target Program and ProgramData
artifact length, SHA-256, and artifact Merkle root
actual ProgramData capacity
ProgramData observation key, generation, root, and digest
deployed slot and controller authority
source/build/package/release commitments
activation receipt or completed proposal
gate epoch at activation
monotonic deployment generation
```

An external zero-only extension does not immediately mutate this trusted
record. It makes its observation stale. A transition that needs current state
must mechanically re-observe the same artifact and can then refresh the
capacity-bearing evidence without changing the installed artifact identity.
Only bootstrap activation and completed governed unfreeze advance the canonical
deployment generation.

## Lifecycle liveness proof obligation

The V3 proposal digest commits the artifact and minimum capacity, not the
mutable actual capacity. For every stage below, an extension first invalidates
the old observation. A new ordered observation with the same subject proves the
same artifact and a zero-only larger tail, after which the lifecycle continues.

| Extension point | Required recovery |
| --- | --- |
| Active, before observation | Start a current generation. |
| After observation, before proposal | Create proposal against deployment identity; re-observe before the first dependent transition. |
| After proposal creation or approval | Re-observe under the immutable proposal digest; approvals remain valid because actual capacity is not proposal consensus. |
| After ordinary freeze | Re-observe while continuously frozen; accepted Prestate must bind the fresh observation. |
| After checked extension | Checked extension records its slot, then a new observation proves the resulting capacity and zero tail. |
| Immediately before upgrade | Execute re-reads the finalized observation and ProgramData under the same writable lock; stale evidence fails and can be replaced. |
| After upgrade, before verification | Create a PostUpgrade observation for the new artifact. |
| During observation | Current append fails stale; start the next generation. |
| After ProgramData verification, before Poststate | Refresh ProgramDataVerificationV2 with a newer equivalent observation; proposal remains frozen. |
| After Poststate or during unfreeze approvals | Refresh equivalent evidence and clear/recollect only the evidence-specific unfreeze approvals. |
| During guardian freeze | Immediate freeze remains O(1); observe afterward and restart on drift. |
| After checked handoff, before activation | Re-observe with controller authority; stale activation evidence is replaced and activation approvals are recollected if their bound evidence changed. |

At maximum capacity no further positive extension is valid, but observation,
upgrade, rollback, emergency resolution, poststate, and unfreeze remain bounded
and reachable.

## Checked extension

If actual capacity is below the immutable minimum, a separate-slot
`ExtendProgramChecked` CPI may add exactly the deficit. No unchecked fallback is
permitted. The post-extension slot/capacity change necessarily invalidates the
old observation; execution requires a fresh observation in a later slot.

If the checked feature is unavailable and the proposal requires growth, that
proposal is non-executable. This is a deployment-readiness blocker, not a reason
to weaken the CPI. A third-party zero-only extension can still remove the need
for checked growth, but its bytes must be mechanically re-observed.

## Size-independent guardian freeze

`GuardianFreezeV2` performs no full-account hash. In one bounded transaction it
validates the canonical Program/ProgramData header graph, reads the current
deployment-state identity, increments the gate epoch, records slot, authority,
capacity, reason, and trusted deployment digest, and sets `EmergencyFrozen`.

Only after the gate is frozen does a permissionless observation traverse the
bytes. `EmergencyFreezeResolutionV2` can resume only after the current 3-of-5,
the routine delay, an accepted emergency checkpoint, and an observation proving
the trusted artifact unchanged with a zero-only tail. The guardian receives no
approval, resolution, conversion, loader, handoff, rotation, or unfreeze power.

## Authority-change raw commitments

Raw ProgramData commitment cannot remain equal across authority mutation because
the checked Loader CPI changes bytes in the 45-byte header. Controller
immutability similarly changes the controller ProgramData authority option tag
and may retain stale bytes in Loader padding when the option becomes `None`.

Handoff and immutability receipts therefore record distinct pre- and post-CPI
raw roots and prove the only admitted delta:

```text
canonical authority option/key transition
same Program -> ProgramData linkage
same owners and executable flags
same deployed slot
same raw length and capacity
same exact payload/artifact root
same zero tail
```

They never require an impossible whole-account raw-root equality.

## Production-path deprecation rule

Historical V1/V2 codecs, vectors, and account decoders remain tested. Their
capacity-fragile processor tags are not accepted by the final production
dispatcher. There is one executable code-upgrade path: V3 proposal plus bounded
observation and V2 verification. There is one size-independent guardian path.

This removes the unsafe choice between two superficially similar lifecycles.

## Gate conditions before enabling execution

The new loader execution tags stay unavailable until all of these pass:

1. fixed schema lengths, discriminators, and Rust/TypeScript vectors;
2. actual-SBF v0/v2 chunk benchmarks for all four candidates (**open for 32,
   64, and 128 KiB; selected 16 KiB is complete**);
3. maximum raw length traversal and finalization;
4. every extension timing point in the adversarial matrix;
5. nonzero-tail, payload, header, authority, and linkage drift negatives;
6. checked handoff with former-authority rejection;
7. governed bootstrap activation without a bank patch;
8. maximum-size upgrade, rollback, poststate, and separate unfreeze;
9. standalone local-validator ceremony and independent receipts.

Any valid unchecked extension that can still produce an absorbing state is a
release blocker. The supported maximum will not be lowered to make a test pass.

## Safety boundary

This audit and its implementation use only synthetic identities and ephemeral
local banks/validators. No production controller ID, real council key, live
signing, Devnet/Mainnet write, authority transfer, immutability action, service
change, or frontend mutation is authorized.
