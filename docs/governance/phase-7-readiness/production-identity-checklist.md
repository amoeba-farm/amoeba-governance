# Production identity checklist

**Status:** unpopulated, read-only Phase 7 readiness artifact

This checklist must be completed by at least two independent reviewers from
finalized observations and reproducible artifacts before any future production
ceremony is authorized. It intentionally contains no controller program ID,
seat authority, guardian, treasury, wallet, endpoint credential, or signature.

## Release authorization

- [ ] A separate written assignment authorizes the exact deployment or handoff
  step. Release 1 completion alone is not authorization.
- [ ] The reviewed controller and Spread commits are fetched from their public
  remotes and match the manifest exactly.
- [ ] Both repositories are clean and the build inventory contains no
  uncommitted or untracked build input.
- [ ] The normative amendment and completion-report SHA-256 values match.
- [ ] Every internal Release 1 gate is green, including real Loader-v3,
  full sacrificial SBF lifecycle, receipt-v3 verification, packet sizing, and
  linked-ELF stack analysis.
- [ ] An independent security review has accepted every warning and blocker.

## Cluster domain

- [ ] The RPC URL is HTTPS and its credential-free provider origin is recorded.
- [ ] `getGenesisHash` at finalized commitment equals the separately approved
  production genesis hash.
- [ ] The 32-byte cluster-domain value is independently derived and reproduced.
- [ ] No local-validator, Devnet, synthetic, default, or stale cluster identity
  appears in a production manifest.
- [ ] Observation and submission providers agree on genesis and finalized state.

## Controller identity and artifact

- [ ] A final controller Program ID has been selected by a separately authorized
  process; it is not the checked-in synthetic vector identity.
- [ ] The canonical controller ProgramData PDA is derived from that Program ID.
- [ ] The controller source commit, tree, build-input inventory, tool versions,
  artifact length, artifact SHA-256, and reproducible-build receipt match.
- [ ] Two clean SBF builds in separate output roots are byte-identical.
- [ ] The deployed Program/ProgramData linkage, loader owner, slot, capacity,
  payload bytes, raw ProgramData hash, and upgrade authority are observed at
  finalized commitment.
- [ ] Release tooling rejects the synthetic ID, every default identity, and any
  artifact mismatch before planning a transaction.

## Target identity

- [ ] The exact Spread Program ID is independently confirmed from the current
  production release policy; it is not copied from an operator prompt alone.
- [ ] The canonical Spread ProgramData PDA is derived and matches the Program
  account's Loader-v3 linkage.
- [ ] The current authority, deployed slot, capacity, payload hash, and raw
  ProgramData hash are captured at finalized commitment.
- [ ] The canonical Upgradeable Loader ID is exact.
- [ ] The installed Spread gate bridge build, ABI vectors, config/gate PDAs,
  signed epoch tail, and frozen/read-only behavior match both repositories.
- [ ] No current market, oracle, writer, DLMM, staking, custody, settlement, or
  service state is mutated by identity verification.

## Bootstrap identities

- [ ] Exactly five nondefault, distinct, read-only, nonexecutable seat
  authorities are supplied.
- [ ] Seats are equal and unclassified; no weight, company class, appointment
  body, affiliation group, or non-company threshold exists.
- [ ] Each seat capability's independent recovery procedure is documented at
  the smart-account, multisig, KMS, or hardware layer without exposing keys.
- [ ] The guardian is nondefault and distinct; its only controller capability is
  `GuardianFreezeV1`.
- [ ] The canonical spill treasury is nondefault, distinct, and approved.
- [ ] No recovery superuser, hidden override, single-key council replacement,
  vote program, vote mint, vote result, token escrow, or token governance flag
  is populated.

## Derived controller state

- [ ] Controller config, authority, gate, policy, and council PDAs are derived
  independently in Rust and TypeScript from the final controller and target.
- [ ] Policy version and council version begin at 1.
- [ ] `next_proposal_id`, `target_nonce`, and gate epoch begin at 1.
- [ ] Gate status begins `EmergencyFrozen`, with the canonical initialization
  reason, nonzero freeze slot, and default active proposal.
- [ ] Routine quorum is 3-of-5 and terminal quorum remains reserved at 4-of-5.
- [ ] Token governance identities and fields are canonical defaults.
- [ ] Timing configuration satisfies checked-arithmetic lower bounds and has
  been reviewed in wall-clock units for the exact cluster slot behavior.

## Independent sign-off

- [ ] Reviewer A records observation slot, operation ID, manifest hash, and
  receipt hash.
- [ ] Reviewer B independently reproduces every derivation and artifact hash.
- [ ] Any discrepancy invalidates the manifest; values are never normalized or
  repaired during the ceremony.
- [ ] Final sign-off identifies the one exact next ceremony step and explicitly
  states that later steps remain unauthorized.
