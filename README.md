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

## Mainnet verification recipe candidate (2026-10-05)

This revision advances the controller release to 2 and pins the public Spread
build to `--features mainnet-v3`. It updates the existing authority metadata PDA
while preserving its rent and donations. Matching native and public Docker
builds produced the 222,856-byte candidate recorded in the
[local qualification receipt](docs/governance/evidence/mainnet-controller-recipe-20261005-candidate.json).
Publication, the council upgrade, and hosted verification are pending in that
receipt. The completed October 4 release remains documented below.

## Mainnet upgrade and verification (2026-10-04)

The Mainnet controller [8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx](https://solscan.io/account/8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx)
was upgraded through the existing three-of-five council. It now accepts artifacts
up to **2 MiB (128 chunks)**. ProgramData growth no longer invalidates an upgrade
proposal; installation still requires sufficient capacity.

**Public source verification passed.** [Verifier status](https://verify.osec.io/status/8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx) ·
[Verified source commit 1f9befd](https://github.com/amoeba-farm/amoeba-governance/commit/1f9befd30d46367bac8ee0ac7527613dadec10ad) ·
[Finalized release receipt](docs/governance/evidence/mainnet-controller-20261004.json).

| Evidence | Value |
| --- | --- |
| Controller deployment slot | 453329188 |
| ELF size | 219,928 bytes |
| ELF SHA-256 | `1442c507f6f40f666e4191d767f8a892d61ddf73c82ab80da593c611c7312780` |
| Verified executable hash | `d94509fe0c18d32d4eab18c49942dee769984c78a5688ae8d8db75555bccb0cd` |
| ProgramData capacity | 223,096 bytes; no extension |
| Upgrade authority | `Frc28QFQxqUxF9HPgzcmm5VkqorqUb2LeLPE5uKU6Ycp` |
| Execution delay | 4,500 slots per proposal |

[Upgrade transaction](https://solscan.io/tx/QpM1e1CEKqtcTM2P6Y4buvfzp5vXY67cC7YNbQqRuXStuJbJYkxG7cp8bDy66uFYG8YSjCiPtWbgEkXE2xCmTMm) and
[verification metadata transaction](https://solscan.io/tx/2ZYCf9bJPMDT56EkZZbHvtVaxWyc2TH2dp2HBoXhD9sxmudZVVXNxkD3fb8sDEg1MeReuX4p9mpoiR8hcHWoG5MS)
both finalized with three council approvals. The full buffer balance of 1.118072441 SOL,
including the 1.11807244 SOL funded rent, returned to the KMS treasury. Existing council settings and account layouts
were preserved, and Spread's gate remained Active at epoch 21.

Reproduce the verified commit using solana-verify 0.5.1:

```sh
git clone https://github.com/amoeba-farm/amoeba-governance.git amoeba-governance-verified
cd amoeba-governance-verified
git checkout 1f9befd30d46367bac8ee0ac7527613dadec10ad
solana-verify build --library-name governance_controller_v3 \
  --base-image solanafoundation/solana-verifiable-build@sha256:0b4e3716fad9ca4b4aac3e3f977f43aad93a18c22296c0c0f44fc22e644bdd68 \
  --arch v1
```

The pinned Docker build matched two independent clean local builds byte for byte.
See [the controller change and focused checks](docs/CONTROLLER_2MIB_CAP.md).

## Earlier deployment records

The same program address also exists on Devnet. The [September 6 Devnet receipt](docs/governance/evidence/v3-demo-setup-20260906/receipt.json) is historical; the Mainnet evidence above describes this release.

## License

[Apache License 2.0](LICENSE).
