# Controller immutability verification plan

**Status:** verification design only; no authority mutation is authorized

Controller immutability is a future ceremony boundary because the immutable
controller becomes the target's upgrade trust root. This plan does not include
a signing command, key source, transaction packet, or submit path.

## Preconditions

1. A separate assignment authorizes the exact controller identity and the
   immutability ceremony.
2. The controller is deployed from the independently reproduced Release 1
   artifact and its full ProgramData bytes match the attestation.
3. One-time initialization has created exactly one canonical config, policy,
   five-seat council, and bootstrap-frozen gate for the exact Spread target.
4. Every initialized account decodes canonically and its PDA, bump, owner,
   length, discriminator, version, embedded identity, digest, and zero reserved
   region match independent Rust and TypeScript derivations.
5. The target ProgramData authority has not yet been handed to the controller.
6. The Spread gate remains frozen/read-only; no service or timer relies on this
   plan to remain available.

## Pre-ceremony observation

At finalized commitment, two independent observers record:

- cluster genesis and cluster-domain hash;
- controller Program and canonical ProgramData linkage;
- deployed slot, capacity, payload length, payload SHA-256, raw ProgramData
  SHA-256, zero tail, and current authority;
- controller source commit/tree/build inventory and two reproducible receipts;
- exact config/policy/council/gate bytes and their decoded form;
- target Program/ProgramData identity and current authority; and
- absence of any production-reachable target-immutability or arbitrary-CPI
  instruction.

The observation operation ID binds all values. Drift invalidates the plan.

## Proposed future mutation

The only admissible mutation is the canonical Loader-v3 checked authority
change that clears the controller ProgramData upgrade authority. The transaction
must have a separately reviewed closed envelope and no sibling instruction that
can deploy, extend, upgrade, close, initialize, transfer target authority, or
mutate protocol state.

No fallback to an unchecked loader instruction is allowed. No new authority,
recovery key, or controller-owned replacement authority may be substituted for
`None`.

## Independent post-verification

After finalization, observers must independently re-read and prove:

- the same Program and canonical ProgramData linkage;
- unchanged deployed slot, capacity, payload bytes, raw bytes, and zero tail;
- `upgrade_authority == None` in the canonical Loader-v3 ProgramData header;
- byte-identical initialized config, policy, council, and frozen gate;
- unchanged target ProgramData bytes and authority;
- no instruction was executed after the one admitted authority-clear; and
- the receipt and journal contain no secret material.

The ceremony is incomplete if any observer cannot reproduce the raw account
hashes or if the authority-clear is merely confirmed at a weaker commitment.

## Failure handling

- A validation, simulation, signing, submission, finalization, or post-read
  mismatch leaves the ceremony incomplete.
- A 429 is persisted with `Retry-After`, followed by backoff and exit; it is not
  an implicit retry authorization.
- If the controller bytes or initialized state drift before signing, discard
  the plan and generate a new operation ID from fresh finalized observations.
- If immutability succeeds but independent verification cannot complete, do not
  proceed to the Spread bridge or target handoff. Escalate with raw evidence.

Controller immutability is intentionally irreversible. This plan contains no
rollback mechanism for the controller itself.
