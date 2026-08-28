# AGENTS.md — Amoeba upgrade governance

Read the governance documents completely in this order before changing this
repository:

- `docs/governance/upgrade-governance-spec.md` remains normative for the
  controller, gate, artifact, and proposal architecture.
- `docs/governance/phase-2-bootstrap-company-led-v1.md` is preserved as an
  earlier Phase 2 decision record.
- `docs/governance/amendments/phase-2-bootstrap-v1.md` is the current normative
  Phase 2 amendment and wins wherever either earlier document conflicts with
  it.
- `docs/governance/amendments/phase-3-universal-spread-gate-v1.md` is the
  current normative Phase 3 amendment. It wins for Phase 3 scope, bridge ABI,
  and phase numbering while preserving the Phase 2 Bootstrap V1 council model.

## Current assignment

`docs/governance/amendments/release-1-completion-batch.md` authorizes the local
Release 1 Phase 4-6 implementation and Phase 7 readiness work on the isolated
`codex/release1-completion` branch. It supersedes the former Phase 3-only source
boundary while preserving every Phase 2/3 wire invariant and the safety rules
below.

The clean local Phase 3 commits are the accepted development baselines. The
isolated Spread Release 1 branch closes the former packet and constructor-proof
blockers at `8417c53b3af99979ac0ab6f9e1a911eeaf415734` and records the closure at
`02ebec33eac216245fc49fcaa0383001e3afea75`. Those local commits are prerequisite
evidence only; they were not pushed or deployed. Work in `ameba_spread` is
allowed only in its separate isolated Release 1 worktree and only for
bridge/client/evidence integration; protocol economics remain out of scope.

Release 1 completion remains gated by the current controller source and its
fresh evidence. In particular, a native processor delegate driving the real
Loader-v3 is Gate E evidence, not proof that the controller ELF executed. Gate
F requires the production dispatcher, all typed custody tags, and the complete
initialize-through-separate-unfreeze lifecycle to execute as actual controller
SBF under both SBPF v0 and SBPF v2. Do not call ignored, delegated, partial, or
host-only tests actual-SBF completion.

## Safety boundary

Do not:

- deploy to Mainnet, Devnet, or a validator;
- request, create, import, or use production keys;
- sign or submit live transactions;
- transfer ProgramData or buffer authority;
- mutate live configuration, services, accounts, release intent, or
  automation;
- modify `ameba_spread` outside its isolated Release 1 worktree or beyond the
  authorized bridge/client/evidence boundary;
- deploy, initialize, sign, or invoke a loader on a live cluster;
- add an arbitrary-CPI surface;
- add an ungated compatibility path;
- claim Release 1 is production ready or live before every internal gate passes.

Never modify either `main` worktree or the deployed Devnet contract. Never push
without a separate authorization.

## Encoding rules

- All persisted fields are fixed width.
- Account discriminators are exactly eight bytes and account versions are
  explicit.
- Integers in digest preimages and PDA version/id seeds are fixed-width little
  endian.
- Optional public keys are encoded as one presence byte plus 32 bytes; absent
  values must contain an all-zero key.
- Reserved bytes must be zero.
- `ProtocolGateV1` is exactly 192 bytes with the offsets frozen by the Phase 3
  amendment; decode and canonical re-encode must reject size, bool, enum,
  discriminator, version, and reserved-byte drift.
- `GovernanceInstructionTailV1` is exactly 16 bytes: `AGV1`, version 1, three
  zero reserved bytes, then a little-endian expected epoch.
- Tests must assert serialized lengths, frozen vectors, and cross-language
  parity. Expected vectors must not be generated from the implementation while
  the test is running.
- Bootstrap V1 has five equal, unclassified seat authorities. Any three pass
  ordinary governance; any four pass terminal governance.
- No production seat allocation is selected here. Company, appointment,
  affiliation, and signer-kind metadata must not exist in consensus state or
  quorum logic.
- A seat authority may be a direct signer or a PDA signer furnished by another
  program through CPI and `invoke_signed`; no private key or signature bytes
  are accepted by governance.
- Token governance is canonically disabled: all vote identities are default,
  all vote flags and basis-point fields are zero, and every proposal has
  `VoteRequirementV1::None`.

## Local verification

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace --all-targets
cargo build --workspace --release
cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
npm run check:package
cd ../..
scripts/build-sbpf-checked.sh v0 /tmp/ameba-gov-sbpf
scripts/build-sbpf-checked.sh v2 /tmp/ameba-gov-sbpf
```

Use a fresh output root for every SBPF run. Keep host Cargo output separate from
both architecture outputs. Real Loader-v3 tests that consume a locally built
ELF must identify that artifact explicitly and must report whether the
controller ran natively or as SBF. An ignored test is an unresolved gate unless
an evidence command deliberately selects and passes it.
