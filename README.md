# ameba_gov

`ameba_gov` is the independent, local-first implementation repository for the
Amoeba Spread upgrade-governance trust root.

The current repository contains the Phase 0/1 state scaffold plus the reviewed
Phase 2 Bootstrap V1 council model and minimal executable approval kernel. It
provides fixed account models, domain-separated PDA derivations, deterministic
proposal and council-set digests, equal-seat quorum evaluation, cross-language
vectors, and exactly one executable instruction:
`RecordProposalApprovalV1`.

Bootstrap V1 is operationally company-led: Amoeba Farm controls three of the
five equal seat authorities. The on-chain consensus model does not classify a
seat as company, non-company, appointed, affiliated, or keypair-backed. Every
configured seat carries one equal vote; any three pass routine governance and
any four pass terminal governance. A seat authority may be a direct
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

The executable surface records council approval only. It does **not** contain
loader CPI, proposal creation, target dispatcher changes, a universal Spread
gate, token voting, deployment tooling, key material, or an authority handoff.
The controller remains predeployment, has no production program ID, is not yet
the Amoeba Spread trust root, and is not production ready or live. The
universal `ameba_spread` gate is Phase 3.

The original governing specification is preserved byte-for-byte at
[`docs/governance/upgrade-governance-spec.md`](docs/governance/upgrade-governance-spec.md).
The current Phase 2 amendment is preserved byte-for-byte at
[`docs/governance/amendments/phase-2-bootstrap-v1.md`](docs/governance/amendments/phase-2-bootstrap-v1.md)
and prevails over conflicting earlier text.

## Verify

```bash
cargo fmt --all -- --check
cargo test --workspace --all-targets
cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

Regenerate the frozen vector only after an intentional ABI change, then review
the full fixture diff in both languages:

```bash
cd clients/ts
npm run generate:vectors
```
