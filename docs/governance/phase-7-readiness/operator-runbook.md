# Release 1 operator runbook

**Status:** dry-run/read-only Phase 7 artifact

This runbook describes the required operating discipline for the public
execution-free package and injected local signer implementation. It is not a
production command sheet and contains no RPC URL, final controller identity,
seat key, wallet path, secret name, signature, or transaction authorization.

## 1. Non-negotiable boundaries

- A plan, passing test, simulation, signed packet, or loader success is not
  authority to submit a live transaction.
- Release 1 provides no private-key, keypair-file, seed-phrase, environment-key,
  or raw-signature fallback. Wallet, multisig, smart-account, KMS, or hardware
  execution is injected by the authorized local operator environment.
- Never print the process environment or signer-provider configuration.
- Use finalized observations and verify the exact cluster genesis before any
  plan is created.
- One exclusive local execution lock and one append-only JSONL journal govern a
  run. Do not start a second executor or monitor.
- On the first 429, persist `Retry-After` and the computed exponential backoff,
  then exit without automatic retry.
- A stale plan fails closed. Do not patch its JSON or substitute fresh values
  into an old operation ID.

## 2. Local workspace preparation

1. Fetch the exact reviewed commits without altering the release branch.
2. Verify branch, HEAD, origin tracking identity, clean working tree, clean
   index, and complete build-input inventory.
3. Install pinned dependencies with lifecycle scripts disabled where defined by
   repository policy.
4. Run format, strict Clippy, all Rust tests, ProgramTest/local-validator tests,
   release build, TypeScript type/test/build/package checks, fixture drift,
   SBF-v0/v2, linked-ELF analysis, receipt tests, packet checks, and synthetic
   production-identity rejection.
5. Put the journal and lock under a narrow operator-selected local directory.
   Neither path may resolve to a workspace root, home directory, or shared
   network folder.

## 3. Read-only discovery

The `schema` command prints exact account lengths, discriminators, instruction
tags, payload lengths, ordered account contracts, digest domains, Merkle
domains, and receipt version without contacting a cluster.

The `observe` command performs finalized reads only and records:

- genesis and cluster-domain identity;
- controller Program/ProgramData and initialization state;
- config, policy, current council, gate, and epoch;
- target Program/ProgramData linkage, authority, slot, capacity, and hashes;
- proposal, buffer authority/verification, checkpoints, target nonce, and
  verification accumulators where applicable; and
- a redacted deterministic observation ID.

Observation rejects wrong owner, size, discriminator, version, bump, PDA,
reserved bytes, embedded identities, duplicate aliases, malformed Loader-v3
headers, non-finalized responses, and mixed genesis.

For `plan-initialize`, reject a target ProgramData account larger than
1,572,909 bytes, including its 45-byte Loader-v3 metadata. Such a target cannot
complete Release 1's bounded raw-account hashing and must not be initialized
into a permanently unusable trust root. Do not apply that target policy ceiling
to the controller ProgramData; verify the controller's exact linkage and
initializer authority independently.

## 4. Planning commands

Every command below is plan-only until an injected execution provider is
explicitly selected, the exact action is armed, and a separate assignment
authorizes submission:

```text
plan-initialize
plan-proposal
adopt-buffer
verify-buffer
approve
finalize-governance
queue
guardian-freeze
plan-emergency-resolution
freeze
bind-prestate
approve-checkpoint
execute-extension
execute-upgrade
verify-programdata
bind-poststate
approve-unfreeze
unfreeze
cancel
expire
close-buffer
plan-rollback
create-council-set
rotate-council
plan-controller-immutability
plan-authority-handoff
verify-handoff
```

The last three remain planning/verification-only in Release 1 engineering.

Every plan ID binds the controller Program/config, target Program/ProgramData,
authority PDA, live ProgramData deployed slot/capacity/authority,
gate/status/epoch, proposal digest/state/immutable timing, current and pinned
council identities, target nonce, buffer authority/status/verified and total
chunk counts, artifact commitments, ProgramData-verification status and
payload/zero-tail verified counts, checkpoint identity/digest/phase/acceptance,
cluster genesis, and exact decoded instruction envelope. Fields irrelevant to
an action are canonical defaults, not omitted operator guesses.

## 5. Human review and arming

Before requesting any signature, show the entire decoded action:

- cluster and finalized observation slot;
- all program/account identities in order with signer/writable/executable
  privileges;
- proposal class/state/digest, timing, target nonce, gate epoch, and council;
- artifact length/SHA/Merkle/chunk geometry and buffer authority;
- checkpoint roots, counts, acceptance, and explicit donation drift;
- expected pre/post ProgramData slot/capacity/authority/raw hashes;
- ComputeBudget and optional durable-nonce envelope; and
- exact state transition and terminal consequences.

Arming is scoped to one deterministic operation ID and one decoded action. A
generic `yes`, previous approval, or armed sibling operation is invalid.

## 6. Mandatory reread sequence

Immediately before signing and again before submission, re-read at finalized
commitment:

1. genesis and cluster domain;
2. controller Program/ProgramData and expected immutability/authority state;
3. config, active policy, current council, gate, epoch, and target nonce;
4. proposal digest, lifecycle state, timing, and approval accumulators;
5. target Program/ProgramData linkage, authority, slot, capacity, and raw bytes;
6. exact buffer Loader-v3 header and authority;
7. BufferVerification and ProgramDataVerification state/bitmaps;
8. Prestate/Poststate/Emergency checkpoint and digest; and
9. durable nonce, if admitted.

Any difference from the plan invalidates the operation. Replanning creates a
new operation ID; it does not overwrite the old journal entry.

## 7. Submission and finalization discipline

- Persist the redacted unsigned plan before signer invocation.
- Persist signer-provider result metadata without signature bytes or secrets.
- Persist the exact serialized transaction hash before submission.
- Submit at most once per journaled operation unless a separately implemented
  idempotent status reconciliation proves that no accepted transaction exists.
- Poll no faster than the configured policy and stop on the first 429.
- Treat timeouts and transport errors as unknown state, not failed state.
- Confirm at finalized commitment, then independently re-read every changed
  account and compare the expected transition and unchanged-account inventory.
- Persist the receipt-v3 input bundle and independent verifier result.

## 8. Crash and journal recovery

On restart, obtain the same exclusive lock and validate the complete JSONL hash
chain. Reject truncation, reordered records, duplicate operation IDs with
different content, or a journal whose genesis/controller/target identity does
not match the current invocation.

For an operation with an unsigned plan only, reobserve and create a new plan.
For a signed-but-unsubmitted record, do not submit automatically. For an
unknown-submission record, perform read-only signature/status and account-state
reconciliation first. A final state that cannot be unambiguously attributed to
the journaled transaction requires operator escalation and no mutation.

## 9. Frozen-mode operations

Once the gate is frozen, keep transaction writers disabled until a fully
governed unfreeze finalizes. The public read path should remain online; its
availability is operationally independent from governance writer timers.

Cancellation after Frozen cannot reactivate the target. Loader success cannot
reactivate the target. Guardian authority cannot approve, resolve, convert,
upgrade, rotate, or unfreeze. Recovery proceeds only through verified primary
completion, governed emergency resolution, or the independently prepared
rollback lifecycle.

## 10. Completion record

The operator records exact starting/final commits, clean-state proof, normative
document hashes, tool versions, operation IDs, finalized slots, transaction and
receipt hashes, decoded state transitions, verification results, warnings, and
unresolved blockers. The record explicitly lists every action not performed,
including deployment, production key access, authority transfer, live RPC
mutation, service mutation, target immutability, controller immutability, and
token governance unless a later assignment separately authorized one exact
ceremony step.
