# Governance Liveness V2

**Status:** Authorized implementation amendment  
**Scope:** Fresh controller release and Devnet ceremony only

## Problem

The first Devnet controller made proposal liveness depend on two unsuitable
choices:

1. Council rotation creation required an operator-supplied creation slot to
   equal the slot in which the transaction actually landed.
2. Handoff and activation proposal addresses were keyed by council version, so
   an expired proposal permanently occupied the only address available to that
   council.

The observed 450-slot review window amplified the second defect. Those values
were initialization choices, not unavoidable Solana limits.

## V2 decisions

V1 account bytes, discriminators, digest domains, and PDA meanings remain
historical and unchanged. The corrected controller adds new versioned accounts
and instructions.

### Timing profiles

The controller has one active, versioned timing profile. It contains separate
review, delay, and expiry durations for:

- emergency rollback;
- routine actions;
- major actions; and
- constitutional actions.

The initial Devnet profile keeps routine approvals open for nominally one week
(`1_512_000` slots at 400 ms per slot), major approvals for two weeks, and
constitutional approvals for four weeks. This is an operational slot estimate,
not a promise of exact wall-clock duration.

The approval window and timelock are independent. A proposal may collect its
three approvals at any point in its review window. Its immutable
`not_before_slot` is `creation_slot + delay_slots`; it is not the end of the
review window plus the delay. The initial Devnet delays are 4,500 slots for a
routine action, 9,000 for a major action, and 18,000 for a constitutional
action; emergency rollback also uses 4,500 slots. The corresponding generous
expiry durations remain 216,000, 2,592,000, 5,184,000, and 10,584,000 slots for
emergency, routine, major, and constitutional actions. These are rehearsal
values, not a Mainnet recommendation. A later council-governed profile may
replace them.

Every profile must satisfy protocol hard floors and:

```text
expiry > max(review, delay) + execution margin
```

### Governed replacement

A candidate timing profile is immutable after creation. Replacing the active
profile requires an ordinary three-of-five proposal evaluated under the
currently active profile. Activation atomically changes only the registry's
active profile identity, version, and hash.

Existing proposals are unaffected. Each proposal stores and digests its exact
profile identity, version, hash, durations, and derived timing slots.

### Proposal identity

The lifecycle registry owns one monotonically increasing proposal ID. Every V2
proposal creation:

1. requires the expected current ID;
2. derives its PDA from target, proposal kind, and proposal ID;
3. atomically increments the registry; and
4. rejects overflow.

Council and candidate versions remain commitments, never uniqueness seeds.

### On-chain time capture

Creation instructions do not supply a creation slot or a full digest containing
one. The controller records `Clock::get()?.slot`, derives every timing boundary
with checked arithmetic, then computes the proposal digest. The timing-profile
hash normalizes `creation_slot` to zero because that slot is observation
metadata, not policy semantics; the account still stores the exact observed
slot.

No transaction must land in a predicted exact slot.

### Cancellation, expiry, and replacement

Before execution, three current council seats may cancel a V2 proposal using a
separate cancellation approval accumulator. Anyone may mark it expired at or
after its expiry slot. Cancelled and expired accounts remain immutable history;
replacement uses the next proposal ID and a fresh PDA.

### Fixed governance rules

- exactly five equal, unclassified seats;
- ordinary quorum remains any three of five;
- token governance remains disabled;
- the guardian can freeze and has no proposal, policy, rotation, handoff, or
  activation authority;
- no recovery superuser or single-key bypass;
- no target immutability instruction;
- policy changes affect future proposals only.

## Deployment boundary

The existing controller is immutable. V2 therefore requires a fresh controller
program identity and fresh initialization before immutability.

Spread business logic and existing program-owned state do not migrate. Because
Spread compiles the controller identity, the later Devnet ceremony must rebuild
only its reviewed bridge-identity include and artifact, then replace ProgramData
while the legacy authority still controls the target and both gates remain
frozen. Writers stay stopped. Mainnet, writer restart, and unrelated economic
changes remain unauthorized.
