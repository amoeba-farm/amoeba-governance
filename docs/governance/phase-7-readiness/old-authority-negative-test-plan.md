# Old-authority negative-test plan

**Status:** sacrificial rehearsal plan only

This plan proves that an authority retained outside the controller cannot
directly upgrade the target after handoff. It must be run against a sacrificial
local target or another separately authorized disposable environment, never the
current deployed Spread program.

## Fixture

- Deploy a sacrificial upgradeable target with known artifact A and external
  authority X.
- Deploy the exact candidate controller artifact under a synthetic local ID.
- Initialize the exact target config/policy/council/bootstrap-frozen gate.
- Verify the controller artifact and initialized bytes, then emulate the future
  controller-immutability boundary in the disposable environment.
- Install the completed Spread bridge behavior in the sacrificial target.
- Transfer the sacrificial target ProgramData authority from X to the exact
  controller authority PDA using the canonical checked Loader-v3 instruction.
- Record finalized local ProgramData and protocol-state bytes before testing.

## Required negative cases

Each transaction is isolated and every writable account is compared byte for
byte after failure.

1. X attempts a direct Loader-v3 upgrade to artifact B.
2. X attempts checked and unchecked ProgramData authority changes.
3. X attempts checked and unchecked extension.
4. X attempts to close ProgramData or a controller-owned buffer.
5. X supplies the controller authority PDA without an `invoke_signed` signer.
6. X wraps a loader instruction beside a target or arbitrary instruction.
7. X attempts a direct-loader packet that the bridge-release receipt format
   would have accepted before handoff.
8. X attempts the same cases with alternate ProgramData, loader, spill,
   authority, nonce, or durable-nonce accounts.

Every case must fail. The target artifact, raw ProgramData bytes, slot,
capacity, authority, gate, epoch, target nonce, and protected state remain
unchanged.

## Positive control

To prove that negative failures are not caused by a broken fixture, run one
fully governed local proposal using sealed mechanically verified bytes, 3-of-5
approval, elapsed timing, consumed target nonce, accepted prestate, the one
typed controller Loader CPI, exact deployed-byte verification, accepted
poststate, separate unfreeze approval, and separate unfreeze execution.

The positive control uses a different transaction sequence from every negative
case and does not restore authority X.

## Receipt checks

- The old direct-loader receipt remains valid only for the historical bridge/
  handoff ceremony that occurred before controller custody.
- Receipt v3 rejects every post-handoff external-key direct upgrade, even if the
  loader itself reports success in a deliberately malformed fixture.
- The verifier requires the controller top-level envelope and exact inner CPI
  once the handoff observation is present.

## Exit evidence

Record the exact fixture commits, tool/runtime versions, controller/target
artifacts, initial and final raw hashes, transaction errors, byte-identity
comparisons, and receipt-verifier outcomes. No key material or raw signatures
belong in the evidence bundle.
