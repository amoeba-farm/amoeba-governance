# Amoeba Governance Phase 7 readiness report

**Status:** NOT READY FOR CEREMONY — READ-ONLY EVIDENCE ONLY

**Branch:** `codex/release1-ceremony-closure`

Phase 7 in this assignment means dry-run plans, immutable templates, and
independent verification logic. It does not mean production readiness, a live
controller identity, deployment, initialization, immutability, bridge
activation, authority handoff, or any signed transaction.

## 1. Release 1 dependency

The readiness pack is usable for review, but none of it may be executed as a
ceremony until the exact published candidate receives independent audit and
the production trust inputs and explicit live authorizations exist.

Current Release 1 decision: implementation and exact-source local verification
are complete. Gates A-F pass through actual controller SBF and real Loader-v3
against sacrificial local targets under both engines. Phase 7 execution remains
blocked by external audit, production identities/capabilities, restored hosted
CI, and the separately authorized live ceremony described in Section 11.

Required Gate F evidence is a production-dispatch actual-controller-SBF
lifecycle under both SBPF v0 and v2 through:

```text
initialize
-> install and independently verify the exact Spread bridge while frozen
-> accept target authority through the typed checked PDA-signed handoff
-> verify the authority graph and former-authority rejection
-> approve and execute the dedicated governed bootstrap activation
-> create primary and rollback proposals
-> adopt and mechanically verify both buffers
-> approve, governance-satisfy, queue, and freeze
-> finalize accepted Prestate
-> checked extension if required
-> one typed Loader-v3 Upgrade CPI
-> mechanically verify deployed ProgramData
-> finalize accepted Poststate
-> collect separate unfreeze quorum
-> execute separate unfreeze
```

A host processor delegate driving the real Loader is useful Gate E evidence but
does not satisfy this Phase 7 prerequisite.

The exact local v0 and v2 artifacts each pass checked PDA-signed authority
handoff, former-authority rejection, governed bootstrap activation, the full
happy lifecycle, and recoverable V3 rollback. No gate activation or authority
handoff is bank-patched. The rollback fault trigger is ProgramTest-only, while
the recovery transitions and Loader-v3 Upgrade CPI execute through actual
controller SBF. This closes the local Gate F prerequisite without claiming a
live-cluster ceremony.

## 2. Readiness artifact inventory

| Artifact | Purpose | Mutation capability | Review status |
|---|---|---|---|
| `phase-7-readiness/production-identity-checklist.md` | independently select and verify future cluster/controller/target identities | none | drafted |
| `phase-7-readiness/controller-deployment-manifest.template.json` | schema for a future reproducible deployment record | none; placeholders only | drafted |
| `phase-7-readiness/controller-initialization-manifest.template.json` | schema for exact config/policy/council/frozen bootstrap state | none; placeholders only | drafted |
| `phase-7-readiness/controller-immutability-verification-plan.md` | plan to prove final controller ProgramData authority is `None` | read-only plan | drafted |
| `phase-7-readiness/spread-bridge-release-plan.md` | future target bridge build/install/verify sequence | plan only | drafted |
| `phase-7-readiness/programdata-authority-handoff-plan.md` | future one-way target custody transfer and verification sequence | plan only | drafted |
| `phase-7-readiness/old-authority-negative-test-plan.md` | prove the former key cannot upgrade a sacrificial post-handoff target | local rehearsal plan | drafted |
| `phase-7-readiness/rollback-rehearsal-plan.md` | rehearse presealed rollback and continuously frozen recovery | local rehearsal plan | drafted |
| `phase-7-readiness/receipt-v3-checklist.md` | independent receipt completeness checklist | read-only verification | drafted |
| `phase-7-readiness/operator-runbook.md` | future operator ordering, journals, locks, 429, and abort behavior | instructions only | drafted |

Directory index: `docs/governance/phase-7-readiness/README.md`.

The plan/template files are tracked and covered by the final changed-file
inventory. No independent review sign-off is claimed on this unpushed branch.

## 3. Identity safety

The repository uses a clearly synthetic controller program ID for vectors and
local tests. The templates keep controller, ProgramData, authority, target,
cluster/genesis, seat, guardian, and treasury values unpopulated. A future
production manifest must reject:

- the synthetic controller identity;
- every default public key;
- a local-validator or Devnet genesis where production is intended;
- a Program/ProgramData mismatch;
- an unverified or mutable controller artifact;
- duplicate/default/guardian council seats;
- a non-frozen or zero-epoch initial gate;
- enabled token-governance identities or flags; and
- a target authority graph inconsistent with the stated ceremony stage.

Synthetic-identity production release rejection passes in the TypeScript
planning/operator test suite.

No final production controller identity or real seat authority is present in
this readiness report.

## 4. Intended future ceremony ordering

The only reviewed high-level order is:

```text
deploy controller
-> initialize exact config/policy/five-seat council/frozen gate
-> independently verify state, source, build, and artifact
-> make controller immutable
-> install and independently verify the Spread bridge
-> transfer target ProgramData authority through the exact typed checked path
-> prove the old authority fails on a sacrificial rehearsal
-> verify the live authority graph
-> create and approve the dedicated governed bootstrap-activation proposal
-> activate only after the bridge and authority graph re-verify exactly
```

Initialization precedes controller immutability because an immutable but
uninitialized controller cannot become the trust root. The target authority
handoff follows controller immutability and bridge verification because the
target must never be entrusted to unreviewed mutable controller code. The gate
begins frozen at nonzero epoch and no step creates an unverified Active interval.

This ordering is a plan for a future ceremony using the independently audited
exact candidate. The current candidate implements the typed capabilities and
passes them locally, but that is not authorization to execute any live step.

## 5. Controller deployment and initialization readiness

The deployment template requires source/tree/build-input hashes, a pinned
toolchain, a clean source-bound artifact for each admitted SBPF architecture,
repeatability evidence, Program/ProgramData linkage, deployed artifact bytes,
upgrade authority, cluster/genesis, and independent review fields. The
initialization template requires exact target graph,
canonical PDAs, five unique equal seats, guardian and treasury separation,
timing policy, `next_proposal_id = 1`, `target_nonce = 1`, gate epoch 1,
bootstrap frozen status/reason, and canonical disabled token governance.
It rejects target ProgramData above the pinned 10,485,760-byte raw-account
runtime ceiling; the controller ProgramData is linkage/authority verified but
is not subject to the target proposal's artifact-size ceiling.

The controller's one-time initialization, reinitialization rejection, exact
Program/ProgramData linkage, malformed seat/timing rejection, canonical frozen
bootstrap, and separate governed bootstrap-to-Active transition pass host and
actual-controller-SBF coverage.

## 6. Controller immutability readiness

Release 1 implements planning and verification only. The plan requires an exact
controller source/build/artifact identity, initialized state, canonical target
pin, no arbitrary CPI, no target immutability instruction, and a finalized
post-operation read proving controller ProgramData authority is `None`.

This batch does not make any controller immutable. The candidate now has the
narrow typed PDA-signed target `SetAuthorityChecked` CPI and the governed
transition out of the initialization-only bootstrap freeze, and both pass local
actual-SBF rehearsal. Immutability nevertheless remains prohibited until the
exact production identity, artifact, initialization state, and independent
audit are fixed and reviewed. Unchecked authority transfer, a replacement
external key, arbitrary CPI, or a bank mutation remains unacceptable.

## 7. Spread bridge and authority-handoff readiness

The Spread Phase 3 bridge is locally verified at the isolated closure commits.
It preserves generic unknown-tag rejection, requires the canonical final gate
and signed epoch tail for every assigned top-level mutator, preserves every
logical compressed inner index, and envelopes official TypeScript mutation
paths. The legacy over-packet forms remain rejected and the maintained
finalized-ALT v0 forms fit.

No Release 1 controller ID is installed in Spread, no Release 1 target artifact
is built for deployment, and no live ProgramData authority is transferred.
The future handoff plan requires finalized pre/post authority reads, exact
cluster/genesis, a frozen verified bridge, explicit arming, decoded display,
injected signing, journal/lock protection, and an independent receipt.

Loader-v3 `SetAuthorityChecked` requires the new authority to sign. Because the
new authority is a PDA, the candidate performs the transfer as one narrowly
typed controller CPI with `invoke_signed`; a top-level Loader instruction cannot
satisfy that signer contract. The planner remains read-only in this assignment,
and the local former-authority negative rehearsal supplies sacrificial evidence
without authorizing or performing the production handoff.

## 8. Rollback readiness

The rollback rehearsal plan requires the rollback proposal and known-good
buffer to be created, authority-locked, byte-verified, 3-of-5 approved,
governance-satisfied, timelocked, and reciprocally committed before the primary
freeze. It covers recoverable payload/zero-tail failure while the Loader graph
remains canonical, continuous freeze, typed activation, real Loader rollback,
mechanical deployed-byte verification, protected poststate, and separate
unfreeze.

Header, authority, and capacity failures are retained as evidence but are not
treated as safe typed rollback activation. A rollback failure Prestate records
the expected primary artifact as its payload commitment and the actual failed
raw ProgramData observation separately; it never asserts they are equal.

The rollback model, processor, and actual-controller-SBF rehearsal pass from the
exact clean v0 and v2 artifacts after the checked handoff and governed bootstrap
activation. Only the injected one-byte fault trigger is ProgramTest-only; the
witness, activation, Loader rollback, deployed-byte verification, poststate,
separate unfreeze, and final gated Spread mutation execute through actual SBF.

## 9. Receipt-v3 readiness

Receipt v3 is expected to prove:

- the exact predeployment schema identity
  `amoeba-governed-upgrade-receipt-v3-predeployment-r4`; the earlier internal
  drafts were not externally frozen or published and are not silently accepted;
- one exact top-level controller execution envelope and no sibling mutation;
- one exact inner Loader-v3 Upgrade CPI;
- config, policy, gate, proposal, council, target nonce, approvals, and the
  executable proposal class;
- the committed routine, major, rollback, council-review, and proposal-expiry
  delays, with the class-selected delay, exact review/queue timing, and freeze
  runway derived independently by the verifier;
- sealed-buffer verification before first approval, first approval and
  threshold crossing inside the review window, and ordered governance
  satisfaction and queue before freeze;
- exact epoch relations for an ordinary Active-to-upgrade freeze and for a
  continuously frozen EmergencyFrozen-to-upgrade conversion, rather than a
  loose monotonic comparison;
- buffer origin, `SetAuthorityChecked`, sealed interval, exact bytes, SHA-256,
  Merkle root/bitmap, and consumption/close result;
- ProgramData pre/post slot, capacity, authority, payload, zero tail, Merkle and
  raw hash;
- protected pre/post roots, semantic custody equality, explicit admitted
  donation drift, and no deficit/identity mutation;
- bounded frozen history and no target mutation outside admitted controller /
  Loader activity; and
- controller source/ABI/build/artifact/ProgramData/initialization plus future
  immutability and authority-handoff evidence.

The independent receipt-v3 verifier, finalized-source re-query matrix, trust-root
recomputation, and deterministic former-authority negative proof pass within the
95-test TypeScript suite. Production claims remain mechanically rejected.

## 10. Operator readiness

The execution-free TypeScript surface includes every requested CLI name. The
immutability/handoff commands are read-only. Mutation adapters are injected and
require finalized reads, exact genesis, deterministic operation IDs, explicit
operation-ID arming, full decoded confirmation, an exclusive local lock,
hash-chained JSONL journal, injected signer, immediate pre-sign and pre-submit
re-reads, and first-429 persistence/backoff/exit.

Every proposal operation ID also binds the exact gate status; proposal state
and immutable review/not-before/expiry slots; live ProgramData deployed slot,
capacity, and authority; buffer-verification status, verified/chunk counts, and
authority; ProgramData-verification status and payload/zero-tail verified
counts; checkpoint phase and acceptance; and exact council key/version/hash.
The freshness adapter must reject one-field state drift before signing and
again before submission.

Journal recovery, stale-plan rejection, secret redaction, no-environment-dump,
durable nonce exactness, v0 ALT rereads, and all 1,232-byte boundaries pass.
The 40-shape packet surface covers all 37 executable tags; every v0 packet fits,
with a maximum of 1,136 bytes. Three legacy forms remain correctly rejected at
1,503, 1,411, and 1,241 bytes.

## 11. Open readiness blockers

1. No independent external audit or branch-protection setting is recorded. Branch
   protection is recommended, but repository settings are outside this batch.
2. Hosted CI has not produced repository-step evidence; the inspected baseline
   runs stopped at the GitHub billing/spending boundary.
3. Production controller identity and reproducible artifact selection remain
   intentionally unset.
4. Five production seat capabilities, guardian, treasury, and their recovery
   runbooks have not been established or reviewed.
5. Controller deployment, frozen initialization, independent verification, and
   immutability are separately authorized production ceremonies and were not
   performed.
6. Spread bridge installation, finalized live census/quiescence, target
   authority handoff, former-authority rejection, and governed activation are
   explicitly excluded live steps requiring separate authorization and review.
7. Production identity selection, production seat capabilities and recovery
   runbooks, deployment approval, and live change windows require separate
   authorization and independent review.

## 12. No-live attestation

This report neither authorizes nor records a push, `main` update, production ID,
real seat key, seed phrase, production KMS/wallet access, live or cluster-facing
transaction signature, RPC write, deployment, initialization,
ProgramData/buffer authority transfer, controller or target immutability, token
voting, Devnet upgrade, service/timer/tunnel/Edge change, or frontend mutation.

The local evidence does use ephemeral synthetic keypairs, local ProgramTest
signatures, and sacrificial Buffer/ProgramData authority transfers inside an
ephemeral test bank. Those local test actions are not a live ceremony or cluster
mutation.

**Readiness decision:** NOT READY FOR A LIVE CEREMONY. Exact local artifacts,
typed checked handoff, governed bootstrap activation, happy-path lifecycle, and
rollback recovery are green, and planning/verification artifacts are drafted.
External audit, production trust inputs, hosted CI, and explicit live authority
remain absent, so no production or Devnet ceremony is authorized.
