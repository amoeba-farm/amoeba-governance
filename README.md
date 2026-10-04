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

The V3 controller is deployed on **Solana Mainnet Beta and Devnet** at:
`8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx`.

The [deployment identity](docs/governance/evidence/v3-demo-setup-20260906/identity.json)
and [release receipt](docs/governance/evidence/v3-demo-setup-20260906/receipt.json)
record the associated program identities and artifact evidence. These are
historical Devnet records; query each chain for current council, timing, and gate state.

The [verification metadata amendment](docs/governance/amendments/governance-v3-verification-metadata.md)
adds a closed, council-approved way for the existing authority PDAs to publish
Otter Verify build metadata. Publishing source does not itself upgrade either
deployment or prove a hosted verification result.

Reproduce the Mainnet verification candidate using solana-verify 0.5.1:

```sh
solana-verify build --library-name governance_controller_v3 \
  --base-image solanafoundation/solana-verifiable-build@sha256:0b4e3716fad9ca4b4aac3e3f977f43aad93a18c22296c0c0f44fc22e644bdd68 \
  --arch v1
```

The currently deployed ELF is 219,584 bytes, SHA-256
`e06bf76acfacbf7e58f9bcdd0637051ea1ca629951e41a7b47738e082e51a8eb`.
Independent local and Docker builds matched exactly. The existing three-of-five
council, 4,500-slot execution delay, upgrade flow, and separate gate activation remain unchanged.

### Prepared controller upgrade (2026-10-04)

This source candidate raises the artifact ceiling to 2 MiB and 128 chunks,
preserves account layouts, and binds self-upgrade proposals to the running
controller release. ProgramData growth no longer stales an approved upgrade;
installation still requires enough live capacity. Retired instructions 10 and
13 remain rejected. [Change details and checks](docs/CONTROLLER_2MIB_CAP.md).

The candidate ELF is **219,928 bytes**, SHA-256
`1442c507f6f40f666e4191d767f8a892d61ddf73c82ab80da593c611c7312780`.
The exact Docker command above reproduced the independently built local bytes.
Its normalized executable hash is
`d94509fe0c18d32d4eab18c49942dee769984c78a5688ae8d8db75555bccb0cd`.
It fits the existing 223,096-byte allocation.

**Deployment is pending.** The existing hosted verification still describes
commit `7b5930dc290fe2955e16aac05c8baa90ff2f96ac`, with normalized hash
`ef4ff09b7fd3a7b813a4a575efc3dfea6556d2eb6ec44fdbc7445761c9fdabb1`.
After installation, a separate council-approved action 6 and instruction 16
must publish the new deployment slot and public source commit before requesting
hosted verification. This README will record the finalized deployment and
verification evidence when those operations complete.

## License

[Apache License 2.0](LICENSE).
