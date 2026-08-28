# Rollback rehearsal plan

**Status:** sacrificial local rehearsal only

Rollback is an independently sealed, approved, timed, executed, verified, and
unfrozen governance proposal. It is not an operator escape hatch and never
auto-unfreezes the target.

## Artifacts and proposals

Prepare two exact artifacts:

- candidate artifact B for the primary proposal; and
- known-good artifact A for the `EmergencyRollback` proposal.

Before the primary crosses the freeze boundary, both proposals must already
exist and be reciprocally linked. Each binds its own buffer, artifact SHA-256,
Merkle root, exact length, chunk geometry, capacity assumptions, checkpoint
policy, immutable timing, creation council, and target nonce. The primary also
binds the rollback identity and known-good commitment; the rollback binds the
primary and candidate commitment.

Both Loader-v3 buffers are transferred to the controller authority PDA with the
checked operation, mechanically verified chunk by chunk, finalized, approved by
3-of-5, governance-satisfied, queued, and still unexpired. A rollback proposal
requiring extension is invalid.

## Complete local sequence

1. Initialize the synthetic controller and sacrificial target; verify the
   bootstrap-frozen state.
2. Use the test-only bridge activation fixture to reach Active only after the
   target bridge and authority graph are locally verified.
3. Create and prepare the rollback proposal, then create and prepare the primary
   proposal at the same current target nonce.
4. Freeze the primary. Atomically consume the one target nonce, increment gate
   epoch, bind the primary, and keep the target frozen.
5. Finalize an exact accepted Prestate checkpoint with three distinct current
   council attestations.
6. If required, perform checked primary extension in a strictly earlier slot.
7. Execute the primary through one exact controller top-level instruction and
   one exact inner Loader-v3 Upgrade CPI.
8. Exercise at least two failure branches in separate fresh fixtures:
   - a canonical ProgramData failure observation; and
   - a finalized rejected Poststate checkpoint with real forbidden hard drift.
9. Before the rollback delay, prove activation fails without mutation.
10. After the rollback delay, activate the prepared rollback with 3-of-5
    evidence already present. The gate stays frozen, increments epoch, and
    changes only its active proposal binding; no second target nonce is consumed.
11. Bind the rollback Prestate to the linked primary's exact verified candidate
    deployment and accepted protected-state evidence.
12. Execute the rollback's one exact Loader-v3 Upgrade CPI.
13. Mechanically verify every deployed known-good chunk, exact authority,
    capacity, deployed slot, raw ProgramData hash, and zero tail.
14. Finalize and accept the rollback Poststate checkpoint with the current
    council, including any narrowly admitted positive donation drift.
15. Collect a separate current-council unfreeze 3-of-5 quorum.
16. In a separate transaction, execute unfreeze. Mark the rollback Completed,
    mark the primary SupersededByRollback, increment gate epoch, and return the
    gate to Active.

## Mandatory negative matrix

- unprepared, unsealed, partially verified, unapproved, unqueued, expired, or
  nonreciprocal rollback;
- wrong primary, buffer, artifact, capacity, authority, ProgramData verification,
  failure evidence, checkpoint, council, policy, target nonce, or gate epoch;
- failed primary evidence supplied for another proposal or lifecycle epoch;
- false rejected Poststate with no actual mismatch;
- rotation with stale seat-index approvals;
- rollback activation before configured delay;
- rollback extension request;
- sibling loader/target/token/arbitrary instruction;
- successful loader CPI followed by automatic poststate acceptance or unfreeze;
- primary or rollback buffer close while still actionable; and
- repeated activation, execution, verification, poststate, approval, or unfreeze.

Every failure preserves every writable account byte for byte. Loader failure
leaves the target and governance state frozen by transaction atomicity.

## Evidence

The rehearsal bundle records exact commits, runtime versions, fixture identities,
proposal/checkpoint/verification digests, transaction envelopes, inner CPI,
artifact and raw hashes, slots, capacities, roots, state transitions, failure
errors, byte-identity comparisons, and the independently verified receipt v3.
It explicitly states that no live cluster or deployed Spread program was used.
