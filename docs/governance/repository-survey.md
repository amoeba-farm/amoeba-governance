# Repository survey and Phase 0 baseline

Date: 2026-08-25

## Source identity

- Source repository: `C:\Users\space\amoeba-farm\ameba_spread`
- Branch: `main`
- Audited commit: `1b2230d96e51f6582155d8284900fbfc11ff1f18`
- Local `HEAD`, local `main`, `origin/main`, and live remote `main`: exact match
- Source worktree and index: clean before and after baseline checks
- Governance specification SHA-256:
  `16f8b4c0cb4e1b05752f5deb299570bf717ffb7ff4e53cd1325801dd4e246117`

The source matches the specification's audited commit. No material divergence
report is required.

## Audited path comparison

All Section 7 target-program anchors exist at the audited commit:

- `programs/light_token_minter/src/lib.rs`
- `programs/light_token_minter/src/processor/instruction_dispatch.rs`
- `programs/light_token_minter/src/instruction/tags.rs`
- `programs/light_token_minter/src/ameba_dlmm_instruction.rs`
- `programs/light_token_minter/src/processor/devnet_solo_backfill_2026.rs`
- `programs/light_token_minter/src/processor/compressed_state/execute.rs`

The proposed governance modules and programs were absent, as expected before
implementation.

## Topology adaptation

The specification sketches `programs/upgrade_controller` beside the target
program. The user instead required an independent repository. This repository
preserves the internal `programs/upgrade_controller` path while keeping the
trust-root source separate from `ameba_spread`.

`ameba_spread` is not a Cargo workspace: its only Rust manifest is under
`programs/light_token_minter`. Its TypeScript package manifest is at the source
repository root even though sources live under `clients/ts`; npm commands must
therefore run from the source root.

## Source conventions retained

- Rust 1.89.0 host toolchain, aligned with `cargo-build-sbf` 4.0.0 and its
  platform-tools v1.53 bundled compiler.
- Direct target dependencies include Borsh 0.10.4 and `solana-program` 2.3.x.
- State and instruction fields use exact fixed-width little-endian encodings.
- Digests use ordered, domain-separated bytes and SHA-256.
- PDA versions and identifiers use fixed-width little-endian seed bytes.
- The controller follows its specification's eight-byte discriminator rule,
  not Spread's older three-byte account discriminator convention.

The default target build contains 115 vault tags and 14 DLMM tags. Feature
`devnet-solo-backfill-2026` adds 12 mutating dispatch bytes. Phase 3 must cover
those surfaces and the separate writer-math benchmark prefix, but this Phase 1
repository does not change target dispatch.

## Baseline commands and results

Run through WSL Ubuntu-22.04 against the unchanged source checkout:

```text
cd /mnt/c/Users/space/amoeba-farm/ameba_spread/programs/light_token_minter
cargo fmt --all -- --check
```

Exit 0.

```text
cargo test --all-targets
```

Exit 0. All harnesses passed. One existing warning reported an unused test
helper named `install_finalized_sku_coverage_for_test`.

```text
cargo test --test devnet_solo_backfill_2026 \
  --features "devnet-solo-backfill-2026 test-sbf"
```

Exit 0: 1 passed, 0 failed.

From the unchanged source repository root:

```text
npm run typecheck
npm test
```

Both exited 0. Node tests: 242 total, 241 passed, 1 intentionally skipped,
0 failed.

No tracked source file changed. No deployment, signing, key access, authority
transfer, service change, RPC mutation, or live-state mutation occurred.
