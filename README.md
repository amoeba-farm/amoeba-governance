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

## 150-slot execution delay (2026-10-15)

Controller release 4 accepts an execution delay of 150 slots, replacing the
4,500-slot floor. Three of five council approvals, approval and expiry windows,
artifact verification and account layouts are unchanged. Existing proposals
retain their timing snapshots.

This source preserves the release-3 retirement functionality installed on
Mainnet earlier on October 15. A controller upgrade and separate timing-policy
proposal activate the shorter delay on Mainnet. The former Spread target has
been retired; older Spread deployment records below are historical.

## Mainnet verification recipe release (2026-10-05)

Controller release 2 was installed at slot **453498655** through
proposal 30 with three council approvals. The 222,856-byte ELF matches the
[native and public Docker builds](docs/governance/evidence/mainnet-controller-recipe-20261005-candidate.json)
and fits the existing 223,096-byte ProgramData capacity. Council policy and
unrelated controller accounts were preserved; Spread remained Active at epoch 24.

The authority metadata records now bind
[controller source b667b45](https://github.com/amoeba-farm/amoeba-governance/commit/b667b4507f6b76b1c6ed51782875b9a6cd92472e) and
[Spread source 1810b31](https://github.com/amoeba-farm/amoeba-program/commit/1810b31cd63e04f6dd89edeefdc9e3887adc2328).
Spread uses the closed build recipe `--features mainnet-v3`.
Both metadata updates preserved their authority balances.

Controller hosted verification: **verified**. Spread hosted verification: **verified**.
[Controller verifier status](https://verify.osec.io/status/8fhNi6QHU5TYNhoPDM4vs89ZBztnpxp3LnBXRgkBVKtx) ·
[Spread verifier status](https://verify.osec.io/status/2jVQSPny9eFoaG1ZWoJVAezQ5VgqJtF8rQCQXMktuBVw) ·
[Finalized installation and verification evidence](docs/governance/evidence/mainnet-controller-recipe-20261005-installed.json) ·
[Upgrade transaction](https://solscan.io/tx/3YyHznVqfLcaTW6aPqusm9HYDhZP7WBLQXFmTWDSutTU9hj2pSuaydRWqRTn8YEDfHnqu3VaE9n2gfHYgKZuX6e8).

The original qualification receipt and October 4 release remain as historical evidence.

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
