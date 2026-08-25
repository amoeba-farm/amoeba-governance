# ameba_gov

`ameba_gov` is the independent, local-first implementation repository for the
Amoeba Spread upgrade-governance trust root.

The current repository contains only the Phase 0/1 controller policy scaffold:
fixed account models, domain-separated PDA derivations, deterministic proposal
and council-set digests, council validation, quorum evaluation, state-transition
guards, and cross-language test vectors.

The repository is intentionally standalone from `ameba_spread`. Its controller
program ID has not been assigned, and the checked-in PDA vectors use a clearly
labelled synthetic ID.

It does **not** contain an executable Solana entrypoint, loader CPI, target
dispatcher changes, token voting, deployment tooling, key material, or an
authority handoff. Nothing in this repository is production ready or live.

The complete governing specification is preserved byte-for-byte at
[`docs/governance/upgrade-governance-spec.md`](docs/governance/upgrade-governance-spec.md).

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
