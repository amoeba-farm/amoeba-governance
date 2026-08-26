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

## Current assignment

Only Phase 2 from `amendments/phase-2-bootstrap-v1.md` is authorized:

- simplify consensus state to five unclassified, equal seat authorities;
- mechanically disable token governance;
- add the minimal executable `RecordProposalApprovalV1` kernel; and
- prove direct-signer and PDA `invoke_signed` authorization with local
  ProgramTest.

Stop at the Phase 2 boundary. There must be no token escrow, snapshots, voting,
delegation, loader CPI, buffer adoption or sealing, ProgramData operation,
immutability execution, target gate, signed epoch tail, mutating-tag manifest,
deployment script, production controller ID, production PDA vector, or
authority-transfer path. The universal Spread gate is Phase 3.

## Safety boundary

Do not:

- deploy to Mainnet, Devnet, or a validator;
- request, create, import, or use production keys;
- sign or submit transactions;
- transfer ProgramData or buffer authority;
- mutate live configuration, services, accounts, release intent, or
  automation;
- modify `ameba_spread`;
- add an arbitrary-CPI surface;
- add an ungated compatibility path;
- claim this Phase 2 implementation is production ready.

The source repository at `C:\Users\space\amoeba-farm\ameba_spread` is pinned to
`1b2230d96e51f6582155d8284900fbfc11ff1f18` and remains read-only throughout
Phase 2.

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
cargo test --workspace --all-targets
cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```
