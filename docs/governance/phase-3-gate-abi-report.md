# Phase 3 universal Spread gate ABI report

Date: 2026-08-27

This report closes only the execution-free `ameba_gov` slice authorized by
Sections 6, 19.1, 20, and 21 of the Phase 3 amendment. It does not claim that
the target-side `ameba_spread` universal gate or Phase 3 as a whole is complete.

## Source and commit identity

- Starting repository commit:
  `da12ead467426afb7fe06c3048e0687094ab5da5`.
- Before work began, the isolated worktree was clean and local `HEAD`, local
  `main`, `origin/main`, and a fresh live-remote `main` lookup all resolved to
  that commit.
- Isolated branch: `codex/phase3-gate-abi` in
  `C:\Users\space\.codex\worktrees\phase3-gate-abi\ameba_gov`.
- Ending implementation commit:
  `116e06393f93308b62915cab441b4e6da2377414`.
- The worktree was clean at that implementation commit. This report and its two
  companion documentation updates are the final documentation-only commit;
  that commit is intentionally reported in the branch handoff rather than
  self-referenced inside its own commit object.
- Normative source and preserved repository copy are each exactly 38,281 bytes
  with SHA-256
  `eb4c18bb469dba1c66fa7e698a1c685d3fefc5ee34634976b2d29c671330b6ad`.
  The copy is
  `docs/governance/amendments/phase-3-universal-spread-gate-v1.md`.

The implementation commits are:

```text
471e47639c2d545edb6a852acf24ea6adb583d47 docs: authorize Phase 3 universal Spread gate
111e56bc0413cea02dda1f1d21ca57a33523c37d feat: add canonical Spread gate bridge fixture
c0c6f71ad071ebc6dd9c1396e124c6c1628e4749 test: freeze Rust and TypeScript gate vectors
116e06393f93308b62915cab441b4e6da2377414 ci: add governance trust-root checks
```

Relative to the starting commit, this slice changes exactly these paths,
including this report and its companion documentation updates:

```text
.github/workflows/governance-trust-root.yml
AGENTS.md
README.md
clients/ts/package.json
clients/ts/tools/generate-spread-gate-bridge.ts
clients/ts/upgradeGovernance/spreadGateBridgeV1.test.ts
clients/ts/upgradeGovernance/spreadGateBridgeV1.ts
clients/ts/upgradeGovernance/v1.ts
docs/governance/amendments/phase-3-universal-spread-gate-v1.md
docs/governance/phase-3-gate-abi-report.md
docs/governance/serialization-decisions.md
fixtures/spread_gate_bridge_v1.json
programs/upgrade_controller/src/gate_abi.rs
programs/upgrade_controller/src/lib.rs
programs/upgrade_controller/src/pda.rs
programs/upgrade_controller/src/tests/gate_abi.rs
programs/upgrade_controller/src/tests/mod.rs
scripts/analyze-sbpf-diagnostics.py
scripts/build-sbpf-checked.sh
```

## Execution and identity boundary

The controller remains Bootstrap V1 and exposes exactly one executable
instruction, `RecordProposalApprovalV1`. This slice adds no executable tag,
processor, gate mutation, initialization, proposal creation, freeze, unfreeze,
loader, deployment, or arbitrary-CPI path. The new Rust module is a pure codec
and envelope library; the TypeScript module is a matching codec and derivation
library.

The bridge fixture carries this explicit warning: its controller identity is
synthetic and non-production. It cannot establish a deployed controller or
live governance state.

| Identity | Address | Bump |
|---|---|---:|
| Synthetic controller program | `4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi` | not a PDA |
| Real target program | `9ipkBCjEfeJDMF6AFrezRmDDHmbnmeyv45cfXNqAnWsH` | not a PDA |
| Canonical target ProgramData | `2DBN762WGdNc85xiVdvQX7Lo4TXAq3WhVz9mBQcaU3a3` | 254 |
| Synthetic controller-config PDA | `DeXoJJjvjQ8zbw9Dv6YeAiYJfx6UvQzFnZ4k8b6ZkYQK` | 254 |
| Synthetic protocol-gate PDA | `DKhD62NUwnURpbvxnrqvvfqTG7zix9nWn1j72r4k1jw1` | 254 |

## Frozen bridge bytes

The fixture active gate is exactly 192 bytes. Its status byte is `0` (`Active`),
epoch is 41, proposal/freeze/reason/last-completed fields are the canonical
active defaults, and both reserved bytes are zero.

```text
414756474154303101fe0100bbe98e86a3220ee814e5baa04c26d0dc7cfd29a2e63694f691a92707ec92ce7c81944b19c12423d188991aeca0658d4908d5318b064791955f7bcc580860ef5011fa60073288bc22065977ab098a7625b29ccc20cbf71b16dfc5468c9429c0ac290000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000
```

The governance tail is exactly 16 bytes: ASCII `AGV1`, version `1`, three zero
reserved bytes, and little-endian epoch 41.

```text
41475631010000002900000000000000
```

The sample legacy bytes and enveloped bytes are:

```text
legacy:    cb0102030405060708
enveloped: cb010203040506070841475631010000002900000000000000
stripped:  cb0102030405060708
```

The fixture's canonical self-hash is
`33838ce2c6d8b734fe22ff62f656bd9874e584cf7836ae746e862a47d6ea85f9`.
It is SHA-256 over the exact UTF-8, two-space-indented, LF-terminated JSON after
replacing the `fixtureSha256` value with 64 ASCII zeroes. The actual checked-in
file SHA-256, which necessarily also contains that self-hash, is
`798fd8a9a6374190a0d6283fa3d84789391f8040ba5c3bae95ce5c187aa10776`.

## Codec and parity results

Rust and TypeScript independently agree on:

- every field and offset of the exact 192-byte gate account;
- canonical gate re-encoding and all three valid gate-status state shapes;
- the target ProgramData, controller-config, and gate PDA derivations and bumps;
- the exact 16-byte tail and final-suffix parsing contract;
- unchanged recovery of the legacy instruction prefix; and
- the fixture placeholder-form self-hash.

The rejection matrices cover truncated and trailing gate/tail data, wrong
discriminator or magic, unsupported versions, noncanonical initialized bytes,
unknown gate status, nonzero gate/tail reserved bytes, invalid status-dependent
gate fields, and backward magic that is not the absolute final suffix. Tests
load the checked-in fixture; they do not regenerate expected values inside the
assertion.

## Native, TypeScript, and ProgramTest results

Native Rust verification ran through WSL Ubuntu-22.04 with Rust/Cargo 1.89.0
and isolated target directory
`/tmp/ameba-gov-phase3-native-target-20260827`:

```text
cargo fmt --all -- --check                         exit 0
cargo clippy --workspace --all-targets -- -D warnings
                                                     exit 0, no warnings
cargo test --workspace --all-targets               exit 0
  upgrade_controller unit tests                    38 passed, 0 failed
  ProgramTest integration tests                     2 passed, 0 failed
cargo build --workspace --release                  exit 0
```

No new ProgramTest was appropriate for an execution-free codec slice. The two
existing ProgramTests still exercised the sole executable approval kernel.
Only ephemeral in-process ProgramTest keypairs signed local simulated
transactions.

Local TypeScript verification used Node v24.14.0 and npm 11.9.0:

```text
npm ci --ignore-scripts --no-audit --no-fund       exit 0, 63 packages
npm run typecheck                                  exit 0
npm test                                            exit 0, 11 passed, 0 failed
```

The test command includes both Phase 2 vector drift and Phase 3 bridge fixture
drift checks. Detailed logs are under:

```text
C:\Users\space\.codex\tmp\ameba-gov-phase3-gate-abi-20260827\native-final
C:\Users\space\.codex\tmp\ameba-gov-phase3-gate-abi-20260827\ts-final
```

## SBPF and diagnostic results

Both architectures were built from the same implementation commit with
`cargo-build-sbf 4.0.0`, platform-tools v1.53, and bundled Rust 1.89.0. The
checked build script used distinct fresh target/deploy trees below
`/tmp/ameba-gov-phase3-sbpf-final-20260827-0601`; neither build used
`--ignore-rust-version`.

| Architecture | Exit | Artifact bytes | SHA-256 | Accepted compile diagnostics |
|---|---:|---:|---|---:|
| SBPF v0 | 0 | 119,760 | `e1969d0d5d3de4bd0b002f78103cf2b1f2edb48e81d2135556bfaff8b84714c9` | 16 |
| SBPF v2 | 0 | 118,496 | `d981013b126d86cd959c52e5920303f153c36668b7f6d324e5f39ccfe2eaa0d3` | 0 |

The v0 compiler emitted exactly the 16 pinned frame-overflow diagnostics in
`hybrid_array`/`crypto_common` dependency generics. The analyzer rejected any
unclassified function error, controller-owned function diagnostic, stack-offset
or caller-frame-overwrite phrase, count drift, or diagnosed exact symbol that
survived in the final linked ELF. All 16 exact dependency symbols were absent
from the final linked controller ELF. The v2 build emitted zero such diagnostic.
Thus this is not a claim that the v0 compiler output was warning-free; it is a
measured, pinned, reachability-aware acceptance of the known dependency-only
diagnostics.

Receipts and full command logs are:

```text
/tmp/ameba-gov-phase3-sbpf-final-20260827-0601/v0/receipt.txt
/tmp/ameba-gov-phase3-sbpf-final-20260827-0601/v0/build.log
/tmp/ameba-gov-phase3-sbpf-final-20260827-0601/v0/elf-symbols.txt
/tmp/ameba-gov-phase3-sbpf-final-20260827-0601/v2/receipt.txt
/tmp/ameba-gov-phase3-sbpf-final-20260827-0601/v2/build.log
/tmp/ameba-gov-phase3-sbpf-final-20260827-0601/v2/elf-symbols.txt
C:\Users\space\.codex\tmp\ameba-gov-phase3-gate-abi-20260827\sbpf-final
```

## Pinned CI trust root

The workflow pins checkout v4.2.2 and setup-node v4.4.0 to immutable commit
SHAs, Rust 1.89.0, Node 22.20.0, npm 10.9.8, Agave v2.3.13, platform-tools
v1.53, and the Agave release archive SHA-256
`c43539ebdf6942472e8b87635d6ea55f428a51e3d0219f7b6f720fc6b19fade0`.
It runs formatting, Clippy with warnings denied, unit and ProgramTest, release,
TypeScript type/tests and fixture drift, then fresh v0/v2 builds through the
same fail-closed diagnostic analyzer. The workflow is committed locally but was
not executed by GitHub because this branch was not pushed.

## Target-side evidence deliberately not claimed

The amendment's Section 21 combines controller- and target-side reporting
requirements. This controller-only report records every target item explicitly
as pending rather than manufacturing evidence from an untouched repository.

| Required target evidence | Result in this slice |
|---|---|
| Assigned-tag manifest counts and every assigned tag name | Not generated. The amendment declares 129 default and 141 Devnet-backfill assigned tags; those counts were not mechanically proven here. |
| Unknown-tag generic failure before account access | Not retested; `ameba_spread` was out of scope. |
| One absolute-final gate for every assigned mutator | Not implemented or tested. |
| Existing handler-input equivalence | Not measured. |
| Compressed core/proof index parity and outer-only gate/tail | Not implemented or measured. |
| Official TypeScript builder migration | Not started. |
| Raw-constructor coverage checker | Not created or run. |
| Before/after transaction and packet sizes | Not measured. |
| Actual target SBF/local-validator gate integration | Not run. Controller v0/v2 artifacts were built, but that is not target integration. |
| Freeze race and durable-nonce stale-epoch cases | Not run. |

Accordingly, the shared fixture currently has independent Rust/TypeScript
agreement in `ameba_gov`; agreement with a separately implemented target
decoder remains a Phase 3 exit condition.

## Warnings and side-effect confirmation

- `npm ci` emitted the upstream `uuid@8.3.2` deprecation warning. Because the
  required command used `--no-audit`, no dependency vulnerability audit was
  performed or claimed.
- The SBPF v0 dependency diagnostics are described exactly above; Clippy and the
  v2 build were clean.
- Whole-range `git diff --check` reports seven trailing-space lines in the
  byte-identical normative amendment. They are source bytes and cannot be
  normalized without breaking the required 38,281-byte/hash identity. The same
  check excluding that preserved amendment reports no whitespace error.
- A path-resolution mistake briefly created one untracked copy of the amendment
  under `ameba_spread`. It was immediately removed. Pre/post checks show
  `ameba_spread` still at
  `1b2230d96e51f6582155d8284900fbfc11ff1f18`, with clean index/worktree and no
  tracked or persistent file change.
- No live deployment, production key access, live or production signing,
  authority transfer, loader invocation, live RPC call or mutation, service or
  automation change, or live-state mutation occurred. No commit or branch was
  pushed. Only ephemeral local ProgramTest identities signed simulated
  transactions in-process.

## Remaining blockers before Phase 4

This `ameba_gov` ABI slice is complete, but Phase 3 is not. Before Phase 4:

1. Independently implement and review the full target-side `ameba_spread`
   manifest, gate decoder, exact-final account admission, private validated
   context, compressed outer contract, and client migration.
2. Prove tag counts/names, unknown-tag behavior, all mutator coverage, handler
   equivalence, compressed index parity, raw-constructor coverage, and packet
   boundaries mechanically.
3. Pass real target SBF integration, freeze-race, stale observation, and
   durable-nonce stale-epoch tests for both feature sets.
4. Reconcile the target-side report with this exact fixture and attach its
   independent decode results.
5. Assign and review a production controller program ID and production vectors;
   complete later deployment, authority-handoff, and operational evidence under
   separate authorization. Nothing in this report authorizes those actions.
