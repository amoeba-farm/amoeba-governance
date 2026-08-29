# Final predeployment audit scope

Status: review boundary for Release 1 ceremony closure

Engineering code candidate: `1ff442252907a017913d47591c1857c2e4df3f0b`

Production controller identity: intentionally unselected

This document defines the independent review that remains necessary before a
future assignment may select a production controller identity or perform any
live ceremony. It is not a deployment authorization.

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
