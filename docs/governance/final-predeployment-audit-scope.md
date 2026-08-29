# Final predeployment audit scope

Status: **NOT AUDIT-READY — REVIEW BOUNDARY DEFINED, ENGINEERING BLOCKERS OPEN**

Engineering code candidate: `1ff442252907a017913d47591c1857c2e4df3f0b`

Production controller identity: intentionally unselected

This document defines the independent review that remains necessary before a
future assignment may select a production controller identity or perform any
live ceremony. It is not a deployment authorization.

## Current pre-audit blockers

The branch must not be presented as an exit-complete audit candidate while any
of these engineering gaps remains open:

1. the V3 happy path uses the real Loader, but an actual controller-SBF V3
   rollback execution has not been demonstrated; the retained ignored V1/V2
   rollback fixtures fail their obsolete configuration preflight if forced and
   are not V3 Loader evidence; and
2. the Spread repository's exact Clippy `-D warnings` gate reports 86
   pre-existing errors outside the governance bridge. The gate source is absent
   from that error set, but the repository-wide gate still fails.

The ProgramData observation candidate-matrix gap is closed. Actual controller
SBF measured the maximum-merge 16, 32, 64, and 128 KiB steps on both engines;
only 16 KiB fits the existing 200,000-unit gate, and normal builds continue to
reject every larger size. The v2 selected case has only 7,819 units (3.91%) of
margin, so exact final-artifact remeasurement remains inside the future audit
scope rather than being treated as generic headroom.

Hosted CI also remains unavailable as evidence because the inspected baseline
runs stopped before repository steps at the account billing/spending boundary.
These gaps must be resolved and independently reproduced before production
identity selection or a live ceremony can be proposed.

The complete local happy-path ceremony is no longer a blocker. Controller SBF
completed checked handoff, former-authority rejection, bootstrap activation,
typed Loader upgrade, ProgramData verification, protected poststate, separate
unfreeze, and the first gated Spread mutation on the sacrificial validator.
Receipt v4 independently verified digest
`faae42ced84225366d4ef5eb99bdfe69aaa1094e000756195382e08bd477cb11`,
and two read-only CLI processes recovered one four-entry journal. That success
does not substitute for the missing V3 rollback execution listed above.

## In scope

The audit should independently reproduce and review:

1. the exact controller source, fixed account schemas, PDA derivations, digest
   domains, strict decoders, instruction tags, account order, and privilege
   contracts;
2. the five-equal-seat, 3-of-5 Release 1 trust model, with token governance
   disabled, no recovery superuser, no target-immutability path, and a frozen
   safe outcome when council quorum is lost;
3. bounded ProgramData observation through the pinned Loader-v3 maximum raw
   account length of `10,485,760` bytes and payload capacity of `10,485,715`
   bytes;
4. liveness after any valid zero-only permissionless extension, including an
   extension while a proposal is frozen;
5. controller immutability evidence, the exact checked SetAuthorityChecked CPI,
   former-authority rejection, continuously frozen bootstrap activation, and
   gate epoch behavior;
6. the complete V3 proposal, sealed-buffer, checkpoint, checked extension,
   typed Upgrade CPI, ProgramData verification, rollback, poststate, and
   separate-unfreeze lifecycle;
7. the closed top-level instruction envelope, durable nonce and v0 lookup-table
   bindings, 1,232-byte packet boundary, journal recovery, first-429 exit, and
   signer-provider-only operator surface;
8. receipt v4 reconstruction from finalized account bytes and transaction
   evidence; and
9. actual controller and Spread SBF under SBPF v0 and v2, linked-ELF stack
   diagnostics, and the standalone local-validator rehearsal.

The auditor should rebuild from a fresh checkout of the exact reviewed commit
and compare artifact length and SHA-256, generated fixtures, package contents,
and every report command. Cached artifacts or a different checkout are not
accepted as evidence.

## Explicitly out of scope

This review must not itself:

- choose a production controller program ID or real council seat;
- access a private key, keypair file, seed phrase, or raw operator signature;
- deploy or initialize the controller;
- make a controller or target immutable;
- transfer live Spread ProgramData authority;
- initialize a live Spread gate;
- write to Devnet or Mainnet RPC;
- change `main`, create a tag/release, or publish a package;
- change a service, tunnel, timer, frontend, market, oracle, writer, DLMM,
  custody, staking, settlement, or economic parameter.

## Remaining production inputs

A future ceremony assignment must receive and independently review all of:

1. final controller Program and ProgramData identities;
2. five production seat-capability authorities and their off-chain recovery
   procedures;
3. guardian and canonical spill-treasury identities;
4. exact production cluster genesis/domain;
5. finalized Loader feature-state evidence for checked extension and checked
   authority transfer;
6. reproducible controller and Spread bridge artifact/source/build/package
   commitments;
7. an initialized frozen controller-state manifest;
8. an immutable-controller verification receipt;
9. a reviewed Spread identity-generation manifest and independent approvals;
10. a live-state compatibility census, rollback rehearsal, ALT/nonce plan, and
    bounded operator journal location; and
11. separate, explicit authorization for every signing and live mutation step.

The deterministic local identities and artifacts in the ceremony evidence are
release-forbidden synthetic fixtures. They must never be promoted into any
production manifest.

## Stop rule

Any identity mismatch, unchecked Loader fallback, stale finalized observation,
nonzero ProgramData tail, packet overflow, reachable stack violation, hidden
override, production-key request, or inability to reproduce the complete local
ceremony stops the future process. The safe response is to remain frozen and
return evidence; it is not to weaken the verification kernel.
