# AGENTS.md — Amoeba upgrade governance

Read `docs/governance/upgrade-governance-spec.md` completely before changing
this repository. That downloaded specification is normative.

## Current assignment

Only Phase 0 and Phase 1 from Section 22 are authorized:

- repository survey and design freeze;
- pure controller account/state scaffolding;
- deterministic PDA and proposal-digest definitions;
- council validation and quorum evaluation;
- pure proposal-state transition guards;
- local Rust and TypeScript parity tests.

Stop before Phase 2. There is intentionally no program entrypoint, processor,
loader CPI, target-program gate, vote escrow, signer, executor, deployment
script, or authority-transfer path in this repository yet.

## Safety boundary

Do not:

- deploy to Mainnet, Devnet, or a validator;
- request, create, import, or use production keys;
- sign or submit transactions;
- transfer ProgramData or buffer authority;
- mutate `ameba_spread`, live configuration, services, accounts, release
  intent, or automation;
- add an arbitrary-CPI surface;
- claim this scaffold is production ready.

The source repository at
`C:\Users\space\amoeba-farm\ameba_spread` is read-only evidence for this
assignment and is pinned to
`1b2230d96e51f6582155d8284900fbfc11ff1f18`.

## Encoding rules

- All persisted fields are fixed width.
- Account discriminators are exactly eight bytes and account versions are
  explicit.
- Integers in digest preimages and PDA version/id seeds are fixed-width little
  endian.
- Optional public keys are encoded as one presence byte plus 32 bytes; absent
  values must contain an all-zero key.
- Reserved bytes must be zero.
- Tests must assert serialized lengths, frozen vectors, and cross-language
  parity. Expected vectors must not be generated from the implementation while
  the test is running.

## Local verification

```bash
cargo fmt --all -- --check
cargo test --workspace --all-targets
cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

