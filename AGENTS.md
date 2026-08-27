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

Only the execution-free `ameba_gov` slice of Phase 3 is authorized:

- preserve the normative Phase 3 amendment byte-for-byte;
- publish the canonical fixed-width `ProtocolGateV1` and governance-tail
  codecs and deterministic bridge fixture;
- freeze Rust and TypeScript parity/rejection vectors for that fixture;
- add pinned trust-root CI with SBPF v0/v2 diagnostic analysis; and
- record the controller-side Phase 3 gate ABI report.

Do not add another executable controller instruction. The only executable
surface remains `RecordProposalApprovalV1`; the gate/tail work in this
repository is codec, derivation, fixture, test, CI, and documentation only.
Target dispatch enforcement, tag manifests, compressed integration, client
migration, and packet tests belong to the separately scoped `ameba_spread`
slice and remain out of bounds here.

## Safety boundary

Do not:

- deploy to Mainnet, Devnet, or a validator;
- request, create, import, or use production keys;
- sign or submit live transactions;
- transfer ProgramData or buffer authority;
- mutate live configuration, services, accounts, release intent, or
  automation;
- modify `ameba_spread`;
- add a proposal, initialization, gate-mutation, freeze, unfreeze, recovery,
  loader, or deployment processor;
- add an arbitrary-CPI surface;
- add an ungated compatibility path;
- claim this Phase 3 ABI slice is production ready or live.

The source repository at `C:\Users\space\amoeba-farm\ameba_spread` is pinned to
`1b2230d96e51f6582155d8284900fbfc11ff1f18` and remains read-only throughout
this `ameba_gov` Phase 3 slice.

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
- Amoeba Farm operationally controls three authorities, but company,
  appointment, affiliation, and signer-kind metadata must not exist in
  consensus state or quorum logic.
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
```
