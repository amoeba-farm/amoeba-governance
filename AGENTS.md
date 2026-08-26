# AGENTS.md — Amoeba upgrade governance

Read both governance documents completely before changing this repository:

- `docs/governance/upgrade-governance-spec.md` remains normative for the
  controller, gate, artifact, and proposal architecture.
- `docs/governance/phase-2-bootstrap-company-led-v1.md` is the normative Phase
  2 amendment. It supersedes conflicting council-composition,
  minimum-non-company, affiliation-concentration, approval-threshold, and
  active-token-voting requirements in the earlier specification.

## Current assignment

Only Phase 2 from `phase-2-bootstrap-company-led-v1.md` is authorized, in this
strict order:

- Part A corrects the scaffold to company-led, equal-vote bootstrap governance
  and must pass independent review and every Rust/TypeScript gate before Part B.
- Part B adds the universal target-side freeze-gate bridge and client migration
  without adding loader execution, deployment, or authority handoff.

Stop at the Phase 2 boundary. There must be no token escrow, snapshots, voting,
delegation, loader CPI, buffer adoption or sealing, ProgramData operation,
immutability execution, signer, deployment script, production controller ID,
production PDA vector, or authority-transfer path.

## Safety boundary

Do not:

- deploy to Mainnet, Devnet, or a validator;
- request, create, import, or use production keys;
- sign or submit transactions;
- transfer ProgramData or buffer authority;
- mutate live configuration, services, accounts, release intent, or
  automation;
- add an arbitrary-CPI surface;
- add an ungated compatibility path;
- claim this Phase 2 implementation is production ready.

The source repository at `C:\Users\space\amoeba-farm\ameba_spread` is pinned to
`1b2230d96e51f6582155d8284900fbfc11ff1f18`. Part A treats it as read-only.
Part B may change it only for the universal gate bridge described by the Phase
2 amendment and must not alter existing economic behavior.

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
- Bootstrap V1 has five equal votes: three company Core Protocol seats, one
  council-appointed External Reviewer, and one council-appointed Security
  Steward. Routine and Major require any three; Terminal requires any four.
- Affiliation and appointment metadata are disclosure data, never quorum
  filters.
- Token governance is canonically disabled: all vote identities are default,
  all vote flags and basis-point fields are zero, and every proposal has
  `VoteRequirementV1::None`.

## Local verification

```bash
cargo fmt --all -- --check
cargo test --workspace --all-targets
cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```
