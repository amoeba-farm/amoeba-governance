# V3 council initialization of Spread Light configuration

On September 6, 2026 the user authorized matching the old Devnet's oracle state,
demo contract issuance, and liquidity on the new Spread deployment. This extends
the earlier stop-after-registration boundary for Devnet preparation. Application
and service rollout remain separate. Work uses `codex/v3-light-bootstrap` in its
isolated governance worktree; the running oracle executor and its dependencies
remain frozen until that executor finishes.

Spread's current tag 216 creates its Light configuration only when the current
Loader upgrade authority signs. That authority is now the council's target PDA.
The existing controller cannot furnish that signature for this operation. This
amendment adds one typed, create-once council action; it does not introduce an
arbitrary CPI executor or transfer authority out of council custody.

## Fixed action and instruction

Action kind 5 (`initializeSpreadLightConfig`) retains the 193-byte action format.
Its 124-byte body contains, in order: target pubkey, expected gate epoch u64,
ProgramData deployment slot u64, compression authority pubkey, eight-byte rent
policy, write top-up u32, and address tree pubkey. Integers are little endian.
The remaining 68 bytes must be zero. The rent policy is base rent u16,
compression cost u16, lamports per byte per epoch u8, maximum funded epochs u8,
and maximum top-up u16. Epoch and both configurable pubkeys must be nonzero.
The target is exclusively `2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw`.

Instruction 15 executes that proposal with its exact 32-byte digest. Its exact
account order is payer (writable signer), config (readonly), proposal (writable),
Spread executable, Spread ProgramData, gate, target authority, Light config
(writable), system executable, and instructions sysvar. Unspecified privileges
are readonly and nonsigner. Duplicate accounts and extra accounts are rejected.
Only this exact final top-level instruction with at most two bounded,
nonduplicate ComputeBudget prefixes is admitted. Retired tags 10 and 13 remain
rejected; tags 16 and above remain unknown.

Normal proposal creation, three-seat approval, council-epoch freshness,
execution delay, expiry, cancellation, and digest rules apply. This is a policy
action with no artifact-verification state. It snapshots the current timing
profile, including the live 4,000,000-slot review window; timing is unchanged.

## Fixed CPI and postconditions

Execution checks an Active gate at the approved epoch, canonical Loader
Program/ProgramData linkage, the approved deployment slot, and unchanged council
target authority. It derives the sole Light config from
`compressible_config / u16(0)` and rent sponsor from `rent_sponsor` under Spread.
Only a system-owned, zero-data config address is accepted; prefunding is retained.

The controller constructs Spread tag 216 itself with the derived rent sponsor,
approved compression authority, rent policy, write top-up, exactly one approved
address tree, and config version selector zero. It appends the fixed 16-byte
governance tail at the approved epoch and the canonical readonly gate account.
Only the council's exact target-authority PDA is signed through `invoke_signed`.

Success requires the exact 156-byte `LightCfg` layout, every approved field,
derived bumps and sponsor, council update authority, owner and executable state,
and exact payer/config rent deltas. Proposal execution is recorded atomically
after those checks. Repeat initialization fails without mutation. No loader CPI,
gate transition, arbitrary accounts, authority handback, business economics, or
existing account migration is part of this operation.

## Focused verification and release

Run the Rust core and self-upgrade tests, the actual controller-to-Spread SBF
rehearsal in `spread_light_config`, and the TypeScript V3 wire/builder tests plus
typecheck. The rehearsal uses this worktree's controller artifact and its paired
Spread candidate. The existing Spread artifact rejects all CPI at its central
stack-height check, so the paired Spread change admits only tag 216 at depth two
with the pinned council target-authority PDA signature. Ordinary gate validation
and the unchanged tag 216 handler still execute. It covers approvals beyond 450 slots, rejection
of two-seat execution, stale gates and foreign config ownership, preserved
prefunding, exact resulting bytes, and repeat-execution rejection.

Build and attest the final controller artifact twice with platform-tools v1.53.
Install it only after the existing oracle executor finishes, using the current
council self-upgrade process and preserving the live config, authority, and
timing. The paired Spread ProgramData replacement follows the ordinary frozen
target-upgrade and separate activation proposals, with an exact active-state
account census before and after the loader-only replacement. Then create and approve a distinct typed Light
initialization proposal against freshly finalized state. Devnet identity, shared
RPC lease, bounded submission, verification, and journal requirements continue
to apply. This amendment does not claim the deployment or demo replay is done.
