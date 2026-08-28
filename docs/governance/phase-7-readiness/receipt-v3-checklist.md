# Receipt v3 checklist

**Status:** independent verifier acceptance checklist

The deterministic governed receipt is valid only if every applicable item below
is mechanically reproduced from canonical transaction, account, artifact, and
checkpoint evidence. A self-reported operator assertion is not evidence.

## Receipt identity and encoding

- [ ] Exact receipt-v3 schema/version and canonical field ordering.
- [ ] Strict rejection of unknown versions, fields where forbidden, malformed
  numbers, duplicate identities, noncanonical optional values, and trailing data.
- [ ] Deterministic receipt ID and canonical JSON SHA-256 reproduce independently.
- [ ] Cluster genesis, cluster-domain hash, controller/config, target Program/
  ProgramData, authority PDA, gate, epoch, proposal digest, council version/hash,
  target nonce, buffer, artifact, and checkpoint digest are all bound.

## Top-level transaction envelope

- [ ] Bounded canonical ComputeBudget instructions only.
- [ ] At most one exact admitted durable-nonce advance.
- [ ] Exactly one top-level controller `ExecuteUpgradeV1`.
- [ ] No sibling target, loader, System other than the admitted nonce advance,
  token, or arbitrary program instruction.
- [ ] No instruction follows `ExecuteUpgradeV1`.
- [ ] Account order and privileges match the frozen Release 1 ABI.

## Inner Loader-v3 CPI

- [ ] Exactly one inner Upgradeable Loader `Upgrade`.
- [ ] Exact ProgramData, Program, sealed Buffer, canonical spill treasury, Rent,
  Clock, and controller authority PDA.
- [ ] No arbitrary instruction bytes, program ID, or account vector was accepted.
- [ ] Loader failure is represented as a failed atomic transaction, never a
  partially successful governance transition.

## Governance proof

- [ ] Exact config, active policy, gate, proposal, pinned creation council,
  current council where required, and immutable digests.
- [ ] Exactly five equal, unclassified seats and exact 3-of-5 routine quorum.
- [ ] Token governance canonical defaults and no vote-result evidence.
- [ ] Approval review start/end, class-selected immutable delay, not-before,
  strict expiry, and no delay shortening.
- [ ] Proposal ID and target nonce were current at creation; the freeze consumed
  exactly one target nonce and made competitors stale.
- [ ] Frozen epoch, active proposal, and every lifecycle transition are exact.
- [ ] Accepted Prestate precedes loader work; ProgramData verification precedes
  Poststate; Poststate precedes separate unfreeze approval and execution.

## Sealed buffer proof

- [ ] Initial owner/header/uploader and exact payload length are observed.
- [ ] Checked authority transfer to the controller PDA and final authority
  reread are proven.
- [ ] The sealed interval contains no controller write capability.
- [ ] Artifact SHA-256, 16-KiB chunk root, domains, count, proof geometry, and
  complete bitmap/count reproduce from exact bytes.
- [ ] First, middle, final partial chunk and deterministic padding rules match.
- [ ] Buffer consumption or separately authorized canonical-treasury close is
  exact; no alternate recipient is admitted.

## ProgramData proof

- [ ] Canonical Program/ProgramData linkage and Loader-v3 header.
- [ ] Pre/post deployed slot, capacity, authority, payload length, raw hash, and
  artifact commitment.
- [ ] Every deployed artifact chunk verifies against the proposal Merkle root.
- [ ] Every required zero-tail chunk is complete and zero.
- [ ] Final raw ProgramData SHA-256 is recomputed from captured bytes.
- [ ] Extension, when present, is checked, exact, separate, and strictly earlier
  than upgrade; absent checked support makes the proposal nonexecutable.

## Protected state proof

- [ ] Prestate and Poststate checkpoint schema, finalized observation slots,
  gate epochs, proposal digests, and independent checkpoint approval bitsets.
- [ ] Program-owned root/count equality.
- [ ] Logical compressed-state root/count equality.
- [ ] Semantic custody/accounting root equality with no deficit.
- [ ] Account identity, owner, mint, authority, and required ProgramData evidence.
- [ ] External metadata and raw-balance observation roots.
- [ ] Every admitted drift is a nonnegative donation to the exact same known
  account with unchanged identity and semantic accounting, explicitly listed
  and approved by the same Poststate quorum.
- [ ] Negative delta, missing account, identity mutation, liability change, or
  semantic deficit is rejected.

## History and trust root

- [ ] No target mutation occurred between the accepted freeze checkpoint and
  governed unfreeze except the admitted controller/loader activity.
- [ ] Controller source, ABI, build, artifact, ProgramData, initialization state,
  and future immutability evidence match.
- [ ] Receipt policy distinguishes the pre-handoff direct-loader bridge receipt
  from governed receipt v3.
- [ ] After simulated handoff, an external-key direct upgrade is rejected.
- [ ] Successful loader execution alone is insufficient for acceptance.

## Terminal result

- [ ] ProgramData verification completed.
- [ ] Poststate checkpoint received its separate current-council quorum.
- [ ] Unfreeze approvals bind exact current council, frozen epoch, verified
  artifact/authority, and accepted Poststate digest.
- [ ] Separate unfreeze atomically increments epoch, clears freeze fields,
  records the completed proposal, and makes the gate Active.
- [ ] Rollback, if used, has its own sealed/approved/timed/verified lifecycle and
  terminalizes the linked primary without automatic unfreeze.
