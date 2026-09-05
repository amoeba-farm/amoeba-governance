# ameba_gov

The new [V3 Devnet council core](docs/governance/amendments/governance-v3-council-core.md)
is in `programs/governance_controller_v3`. It gives every proposal an approximately
one-week approval window and supports three-of-five council upgrades of its own
code, including ProgramData growth. Its client export is `./governance-v3`.
Spread gate integration is subsequent work; the existing V2 deployment is unchanged.
The Release 1 description below is retained for the older program.

`ameba_gov` is the independent, local-first implementation repository for the
Amoeba Spread upgrade-governance trust root.

The current isolated Release 1 branch contains the reviewed Phase 2 Bootstrap
V1 council model, the Phase 3 Spread gate bridge ABI, and a predeployment
Release 1 controller candidate. The candidate adds versioned fixed accounts,
one-time initialization, proposal/timing/nonce transitions, guardian freeze and
governed resolution, checkpoints, sealed-buffer and deployed-byte verification,
typed Loader-v3 operations, rollback, separate unfreeze approval, and council
rotation. It also includes a public execution-free TypeScript package, an
injected operator surface, receipt-v3 verification, and Phase 7 planning
artifacts.

This is an engineering candidate, not a completion or readiness claim. The
schema and wire contracts are frozen by cross-language fixtures, while loader,
failure-atomic, production-dispatch, packet, stack, and complete actual-SBF
lifecycle evidence must all be refreshed at the final candidate commit. The
historical tag-0 `RecordProposalApprovalV1` codec remains regression-only and
is rejected by Release 1 dispatch; it is not a timeless approval oracle.

Bootstrap V1 uses exactly five equal, unclassified seat authorities. No
production council or seat allocation is selected in this repository. The
consensus model does not classify a seat as company, non-company, appointed,
affiliated, or keypair-backed. Every configured seat carries one equal vote;
any three pass routine governance and any four pass the reserved terminal
threshold. A seat authority may be a direct
cryptographic signer or a PDA made a signer by another program through CPI and
`invoke_signed`. Governance accepts only the runtime signer privilege—never a
private key, keypair file, seed phrase, or raw signature byte string.

Token governance is mechanically disabled in Bootstrap V1 and deferred to a
later optional phase. Controller configuration must keep all four vote
identities default, policies keep all vote flags and basis-point fields zero,
and proposals require `VoteRequirementV1::None` with default vote accounts.

The repository is intentionally standalone from `ameba_spread`. Its controller
program ID has not been assigned, and the checked-in PDA vectors use a clearly
labelled synthetic ID.

The controller has no production program ID and is not the live Amoeba Spread
trust root. The repository contains no production key material and grants no
authority merely by compiling. Controller deployment, live initialization,
controller immutability, Spread ProgramData authority handoff, target
immutability, token governance, and every live RPC or service mutation remain
outside this assignment. The final three operator commands concerning
controller immutability and handoff are planning/verification only.

The original governing specification is preserved byte-for-byte at
[`docs/governance/upgrade-governance-spec.md`](docs/governance/upgrade-governance-spec.md).
The current Phase 2 amendment is preserved byte-for-byte at
[`docs/governance/amendments/phase-2-bootstrap-v1.md`](docs/governance/amendments/phase-2-bootstrap-v1.md)
and prevails over conflicting earlier text. The current Phase 3 amendment is
preserved byte-for-byte at
[`docs/governance/amendments/phase-3-universal-spread-gate-v1.md`](docs/governance/amendments/phase-3-universal-spread-gate-v1.md)
and prevails for Phase 3 scope, bridge ABI, and phase numbering.
The local Release 1 authorization and safety boundary are recorded at
[`docs/governance/amendments/release-1-completion-batch.md`](docs/governance/amendments/release-1-completion-batch.md).
The predeployment V1/V2 decision is recorded at
[`docs/governance/release-1-schema-audit.md`](docs/governance/release-1-schema-audit.md).

## Verify

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

Those commands do not by themselves close the real Loader or complete
actual-SBF lifecycle gates. The completion report must identify the exact
production-dispatch harness and show a sacrificial local lifecycle through
poststate acceptance and a separate unfreeze under both architectures. A
native controller delegate exercising real Loader-v3 is reported separately as
Gate E evidence.

Regenerate the frozen vector only after an intentional ABI change, then review
the full fixture diff in both languages:

```bash
cd clients/ts
npm run generate:vectors
npm run generate:bridge
npm run generate:release1-vectors
```

Both SBPF commands require a fresh output root and use separate architecture
subdirectories. They fail closed when pinned stack diagnostics drift or a
diagnosed function survives in the linked controller ELF.
