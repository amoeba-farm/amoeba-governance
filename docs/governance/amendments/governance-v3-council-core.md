# V3 Devnet council core

User decision, 2026-09-05: create a fresh governance program, replace the
450-slot approval deadline with approximately one week, and keep the controller
itself upgradeable through the existing KMS-backed three-of-five council.
The user authorized Devnet deployment and requested focused verification.
This decision supersedes the historical local-only and controller-immutability
requirements for this new program only. Production and Mainnet are outside scope.

## First deliverable

`programs/governance_controller_v3` is a separate program with a separate
`ameba-governance-v3` PDA namespace. Its first release governs its own upgrades,
timing policy, and council rotation. It has no Spread gate or external target
registration yet. It neither changes the immutable V2 controller nor transfers
the existing Spread authority. A replacement Spread integration is subsequent work.
No token, collateral, market, or GETC economics change in this deliverable.

## Timing and quorum

Every proposal snapshots the same timing policy at creation. Approval remains
open for **1,512,000 slots**, approximately seven days at 400 ms per slot; elapsed
wall time varies with the network. This is also the minimum accepted approval
window, including for controller upgrades. There is no 450-slot fallback.

The default execution delay is 4,500 slots from creation, independently of the
approval deadline; three approvals do not require waiting the whole week.
Expiry is 2,592,000 slots from creation. Policy changes require three council
approvals and cannot shorten review below 1,512,000 slots or the execution delay
below 4,500 slots. Expiry must exceed the larger window plus 9,000 slots.
All arithmetic is checked. Existing proposals retain their timing snapshots.

Any three of five unique seats approve execution or cancellation. Council
rotation increments the epoch, invalidating unfinished old-council proposals.
Concurrent timing proposals cannot overwrite a newer timing version. Cancellation
and expiration retain typed buffer-recovery paths to the configured treasury.

## Controller authority and upgrades

Create-once initialization requires the deployment authority and three of the
five chosen seat signers. It creates the council config and atomically transfers
the controller's Loader-v3 upgrade authority to its own authority PDA. There is
no instruction to revoke that authority, close ProgramData, or invoke arbitrary CPI.
The council can deliberately replace code through an approved upgrade; therefore
the one-week floor is enforced by this release, not an immutable constitutional rule.

An upgrade proposal binds its exact buffer, artifact length, SHA-256 commitment,
Merkle root, prior deployment slot/capacity, source and build commitments. Buffers
are sealed to a per-proposal PDA before on-chain verification. Every 16 KiB chunk
of the actual sealed buffer must pass its domain-separated Merkle proof before
approval. The Merkle root is the on-chain byte-verification commitment; operators
also verify the full SHA-256 and source/build commitments before signing.

After quorum and delay, exact Loader-v3 extension may grow ProgramData toward
the approved artifact, with no extra headroom, in at most 10,240-byte steps.
Extension records the observed deployment slot and capacity, and installation
occurs in a later slot. Concurrent changed deployments fail closed. Installation
atomically moves the sealed buffer authority and invokes Loader-v3 Upgrade,
preserving the council PDA as upgrade authority. Future artifacts may be up to
1,572,864 bytes under this core's bounded artifact protocol.

Loader execution accepts only a direct transaction with this exact final
instruction and at most two bounded, nonduplicate ComputeBudget prefixes.
The payer covers rent; buffer spill goes only to the configured treasury.

## Wire format and client

Config is exactly 384 bytes (`AG3CFG01`, version 1). Proposal is exactly 400
bytes (`AG3PRP01`, version 1). Reserved bytes are zero; identities, owner, PDA,
bump, initialization, lengths, bitmaps, and proposal digest are validated.
The digest includes the Devnet genesis identifier and controller identity.
Operators must independently verify the live genesis before submission: programs
cannot inspect cluster genesis through the Clock sysvar.

Tags: 0 initialize, 1 create, 2 seal, 3 verify chunk, 4 approve, 5 cancel,
6 expire, 7 execute policy, 8 upgrade controller, 9 close buffer, 10 extend
controller. Unknown tags fail before account access; outer input cap is 16,384
bytes. Actions have fixed 193-byte encodings and no caller-supplied CPI bytes.
TypeScript builders/decoders are exported at `./governance-v3`.

## Focused verification

Build the SBF artifact from this worktree with pinned platform-tools v1.53.
Set `AMOEBA_GOV_V3_SBF` to its exact path and run:

```sh
cargo test -p governance_controller_v3 --test core --test self_upgrade
cd clients/ts
npm run typecheck
node --import tsx --test upgradeGovernance/governanceV3.test.ts
```

The SBF rehearsal initializes through three seats, rejects approval before
buffer verification, verifies every chunk, approves beyond 450 slots, rejects
two-seat execution, extends ProgramData, installs a larger artifact using three
seats, and then creates a new proposal using the upgraded program. Core tests
cover all council subsets, timing boundaries, snapshot isolation, overflow,
closed dispatch and a frozen Rust/TypeScript digest vector. These focused checks
are not a full audit or completion evidence for the historical Release 1 gates.
