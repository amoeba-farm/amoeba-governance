# ProgramData authority handoff plan

**Status:** planning and verification only; no live handoff is authorized

The future handoff moves exactly one capability: the Spread ProgramData upgrade
authority, from the then-current external authority to the immutable
controller's canonical authority PDA. It must not upgrade either program,
initialize accounts, activate the gate, unfreeze Spread, or mutate protocol
state in the same transaction.

## Mandatory prerequisites

1. The controller production identity and artifact have independent approval.
2. Controller initialization is finalized and exactly matches its reviewed
   manifest: one config, one policy, one five-seat council, and a canonical
   bootstrap-frozen gate.
3. The controller ProgramData authority is already `None`, and all controller
   code and state hashes have been independently verified after immutability.
4. The exact Spread bridge release is finalized and its ProgramData bytes match
   the reviewed Phase 3 artifact.
5. Spread rejects every mutation while the gate is frozen and still serves its
   read-only API path.
6. The current Spread ProgramData authority is observed at finalized commitment
   and is not already the controller authority PDA.
7. A sacrificial handoff and old-authority negative test have passed under the
   pinned Loader-v3 runtime.
8. A complete rollback proposal and known-good sealed buffer rehearsal has
   passed. Handoff itself is not coupled to an upgrade transaction.

## Bound plan identity

The deterministic operation ID must bind:

- cluster genesis and cluster-domain hash;
- controller Program, ProgramData, raw hash, immutability observation, config,
  authority PDA, gate, and gate epoch;
- target Program, canonical ProgramData, deployed slot, capacity, payload hash,
  raw hash, and current authority;
- policy and current council version/hash;
- exact current target nonce;
- bridge release receipt and controller initialization receipt; and
- the canonical checked Loader-v3 authority-transfer instruction bytes and
  ordered account vector.

Any drift invalidates the plan before signing and again before submission.

## Closed future transaction envelope

The handoff transaction may contain only bounded canonical ComputeBudget
instructions, optionally one exact admitted durable-nonce advance, and one
checked Loader-v3 authority transfer for the exact target ProgramData. It must
contain no controller instruction, target instruction, loader upgrade/extend/
close operation, token instruction, arbitrary program instruction, or trailing
instruction.

The new authority is exactly the derived controller authority PDA. `None`, a
different PDA, a direct key, and any recovery authority are invalid.

## Pre-sign and pre-submit rereads

Immediately before each boundary, independently re-read:

- controller ProgramData immutability and raw bytes;
- controller config/policy/current council/gate/epoch/target nonce;
- Spread Program/ProgramData linkage, bytes, slot, capacity, and authority;
- installed bridge identity; and
- transaction envelope and decoded action.

The complete decoded action is displayed before an injected signer provider is
asked to authorize it. No private-key fallback exists.

## Finalized postcondition

The handoff is complete only after independent finalized reads prove:

- Spread ProgramData authority equals the exact controller authority PDA;
- controller ProgramData remains immutable and byte-identical;
- Spread ProgramData slot, capacity, payload bytes, raw hash, and zero tail are
  unchanged by the handoff;
- config, policy, council, gate, epoch, target nonce, and all protocol-owned
  accounts are byte-identical;
- Spread remains frozen until a separately governed activation/unfreeze path;
  and
- the former authority fails the negative-test plan on a sacrificial target and
  is not treated as an accepted direct-upgrade path by receipt v3.

No successful authority transfer is evidence that a later upgrade, activation,
or service change is authorized.
