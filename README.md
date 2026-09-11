# Amoeba Governance

Solana program for a five seated council governance of Amoeba's program upgrades.
This controller helps to manage proposals, approvals, and governance
gates and much more for registered programs!

[Website](https://amoeba.farm) · [Amoeba Program](https://github.com/amoeba-farm/amoeba-program) · [Security](SECURITY.md)

## Architecture

This governance program utilizes a council of five equal seat authorities. Typical
actions require three approvals. Proposals commit to their action and timing
parameters; upgrades and gate activation are separate governed operations.

| Path | Contents |
| --- | --- |
| [`programs/governance_controller_v3`](programs/governance_controller_v3) | V3 council controller and registered target operations |
| [`programs/upgrade_controller`](programs/upgrade_controller) | Earlier controller implementation and shared governance primitives |
| [`clients/ts`](clients/ts) | TypeScript codecs, instruction builders, and tools |
| [`fixtures`](fixtures) | Cross-language account, instruction, and digest vectors |

## Development

Use the Rust toolchain pinned in [`rust-toolchain.toml`](rust-toolchain.toml).

```sh
cargo check --locked --workspace --lib
cargo test --locked --workspace --all-targets
```

For the TypeScript client, use Node.js 22 and npm 10.9.8:

```sh
cd clients/ts
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test
```

The V3 client entry point is `@amoeba/upgrade-governance/governance-v3`.

## Deployment

The published V3 controller is on **Solana Devnet**:
`8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx`.

The [deployment identity](docs/governance/evidence/v3-demo-setup-20260906/identity.json)
and [release receipt](docs/governance/evidence/v3-demo-setup-20260906/receipt.json)
record the associated program identities and artifact evidence. These are
historical records; query the chain for current council, timing, and gate state.

## License

[Apache License 2.0](LICENSE).
