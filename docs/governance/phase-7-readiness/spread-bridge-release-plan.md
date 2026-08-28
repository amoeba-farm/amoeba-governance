# Spread bridge release plan

**Status:** future release plan only; the current deployed Spread program is not
changed by Release 1 engineering

The Spread bridge release is a separate, code-only target release whose purpose
is to install the already verified universal mutation gate. It must not change
market, oracle, writer, staking, DLMM, custody, settlement, collateral, or
economic behavior.

## Required inputs

- Exact reviewed `ameba_spread` commit containing the completed Phase 3 bridge.
- Matching bridge ABI identities and golden vectors from both repositories.
- Two byte-identical SBF artifacts from clean, separate output roots.
- Public-source, release-intent, build-input, packet, constructor-coverage,
  client, SBF-v0, SBF-v2, and linked-ELF stack results.
- Finalized pre-upgrade Program/ProgramData/authority/feature observation.
- Complete compatible account and custody inventory under the separately
  reviewed code-only release mode.
- A separately authorized, rollback-safe service/cutover plan that keeps the
  public read path available while mutation writers remain locked.

## Bridge invariants

The candidate must mechanically prove:

1. Every assigned top-level target mutator requires the canonical final gate
   account and signed epoch tail.
2. Every logical inner instruction, including compressed execution, preserves
   and checks its exact logical index.
3. Unknown instruction tags fail through the generic early invalid-instruction
   path before decoding or account access.
4. Official TypeScript mutation paths always build the governance envelope;
   no raw ungated constructor remains reachable.
5. Stale epoch, gate freeze race, wrong gate, wrong account order, duplicate
   alias, and privilege drift fail without target-state mutation.
6. Read-only target instructions remain available while the canonical gate is
   frozen.

## Future rehearsal sequence

1. Reproduce the candidate and release evidence from the fetched remote commit.
2. Create a sacrificial local target with representative current accounts.
3. Install the bridge build locally and run the complete mutation classifier,
   stale-epoch, freeze-race, packet, and actual-SBF suites.
4. Capture a byte-for-byte prestate inventory, perform only the Loader-v3
   replacement, then compare the identical inventory afterward.
5. Verify public read-only clients against a local frozen target.
6. Rehearse rollback to the known-good prior artifact without unfreezing.
7. Independently verify the direct-loader handoff receipt used only for this
   future bridge release.

## Production gate

A future live bridge release requires separate authorization. Its plan must pin
the exact target ProgramData capacity and use checked extension only when the
attested final artifact requires an exact delta. Upgrade uses the final artifact
only, forbids auto-extension, and verifies the finalized deployed bytes before
the authority-handoff plan may begin.

The release is rejected if it requires dropping a gate account, governance
tail, compressed logical index, invariant, or packet-safety field to fit the
1,232-byte transaction limit.

## No-action boundary for this pack

This plan does not deploy the controller or Spread, touch the live Devnet
contract, lock or restart services, start automation, sign a transaction, read
keys, mutate RPC state, initialize the live gate, or transfer authority.
