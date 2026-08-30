# Release 1 V3 rollback rehearsal evidence

Status: **PASS for the actual-controller-SBF V3 rollback recovery path on SBPF
v0 and v2; local and sacrificial only**

Date: 2026-08-29

This report closes the Release 1 engineering blocker that previously prepared
and retired a rollback without executing it. It does not claim that the
ProgramTest-only fault trigger occurred naturally, and it does not provide live
cluster or production evidence.

## Source boundary

| Item | Value |
|---|---|
| Starting governance commit | `a14f6bf6ef506532b4ed7ff57a35c6ecd4b5961c` |
| Rollback implementation evidence tip | `4a67ebdfccdfd2830868b933d178b7c258e68d2f` |
| Rollback runtime-source tip | `9c1a45236279f37bfa934b3a70ededb77136e3e2` |
| Final integrated verification tip before report refresh | `0771dd3e9dd1e2f96c24d4910339253852db772b` |
| Final branch | `codex/release1-ceremony-closure` |
| Spread source used for the exact-artifact rehearsal | clean integrated Phase 3 commit `35f1aa5` |
| Runtime version | V3 only; no V1/V2 lifecycle was revived |

The evidence-covered changes are:

1. `b65ce3ca8affc11682b55e5077dfe08d9c22b551` — add the
   witness-authorized V3 rollback execution path and actual-SBF lifecycle;
2. `35af8b43c2163edcfa8c0aa8cf810113ff55bfac` — add runtime
   negative cases, writable-account atomicity snapshots, and the complete
   mismatch-class unit matrix;
3. `0d27c89781d1453bde52589a371135ecc653c5b7` — replace the obsolete
   hosted differential step with the self-contained V3 rollback proof; and
4. `4a67ebdfccdfd2830868b933d178b7c258e68d2f` — bind the local
   rehearsal to an explicit controller identity and assert exact terminal
   proposal, gate, and current-deployment links;
5. `9c1a45236279f37bfa934b3a70ededb77136e3e2` — require the exact
   rollback delay at activation, reject structural mismatch classes before
   activation, and prove early failure atomicity through actual SBF; and
6. `158978a91911582ea6aa5b7dcb2b7c8923eca763` — replace stale hosted
   V1/V2 Loader lanes with the current V3 happy, rollback, and
   maximum-geometry ceremony harness.

The changed implementation surfaces are limited to:

- `programs/upgrade_controller/src/release1_processor_v3_custody.rs`;
- `programs/upgrade_controller/tests/ceremony_closure_program_test.rs`; and
- `.github/workflows/governance-trust-root.yml`.

The shared ceremony-closure report integrates this final evidence together
with the independently rerun chunk matrix and maximum-geometry proofs.

## Narrow controller rule

Ordinary primary execution is unchanged. An `EmergencyRollback` proposal may
use the already-typed `ExecuteUpgradeV2` Loader envelope only when all of these
conditions are simultaneously true:

- the primary and rollback proposals form the exact immutable reciprocal graph;
- the primary is the failed frozen proposal and the rollback is the active
  frozen proposal for the exact current epoch and consumed target nonce;
- activation occurs no earlier than the checked sum of the primary's recorded
  upgrade-execution slot and the configured rollback delay;
- an immutable, finalized `ProgramDataFailureObservationV2` is bound to the
  primary proposal, the same target deployment, capacity, observation
  generation, and frozen epoch;
- the failure class is `ArtifactPayload` or `ZeroTail`, and the controller
  re-reads ProgramData and reproduces that same mismatch before the CPI;
- the primary accepted prestate anchor is exact;
- the rollback buffer is the exact sealed, fully verified, controller-owned
  Loader buffer; and
- the target Program, ProgramData, Loader, authority PDA, capacity, and spill
  treasury remain canonical.

No arbitrary program ID, instruction bytes, or account vector is accepted. The
successful transaction still performs one ordinary typed Upgradeable Loader
`Upgrade` CPI. A Loader or validation error remains transaction-atomic and
leaves the gate frozen.

## Fault trigger versus recovery proof

The distinction is material:

- **Fault trigger:** after the successful primary Loader upgrade, the harness
  changes one ProgramData payload byte through the ProgramTest bank fixture.
  The controller then creates the immutable `ArtifactPayload` failure witness
  through actual SBF. The direct byte change is test-fixture injection, not a
  controller instruction, Loader CPI, standalone-validator transaction, or
  production-reachable mutation claim.
- **Recovery:** failure-witness creation, governed rollback activation, rollback
  execution through the real Loader-v3 `Upgrade`, mechanical ProgramData
  verification, three-seat rollback poststate acceptance, separate three-seat
  unfreeze approval/execution, and the final active-gate transition all execute
  through the actual controller SBF program.

A natural `ZeroTail` trigger was tested first. On the pinned Loader-v3 runtime,
upgrading the larger target ProgramData to the shorter primary ELF zeroed every
byte from the new payload end through the existing capacity. The v0 tail was
39,704 bytes and the v2 tail was 166,120 bytes; both were entirely zero. The
report therefore does not relabel stale Loader bytes as a natural failure.

The actual-SBF rollback recovery exit criterion is met. A separate claim that a
production-reachable failure was naturally triggered on a standalone validator
would remain unmet; this rehearsal intentionally makes no such claim. A
standalone rollback run was not performed because the only demonstrated fault
trigger is explicitly ProgramTest-only.

## Exact artifacts

All paths are local WSL cache paths and are not repository inputs or hosted CI
dependencies.

| Role | SBPF | Bytes | SHA-256 |
|---|---:|---:|---|
| final integrated controller | v0 | 1,114,592 | `0c107bce1ec34d3badf72b69161f0cae0b82a7b85ea714770f3876c08e6c1b18` |
| final integrated controller | v2 | 1,115,232 | `29f5f746a3d1f9dbd5ebcf72ef5d4450bb0d10a67cf4c6c047124da7eb0b9b56` |
| exact Phase 3 Spread | v0 | 1,154,184 | `7b29416cba304909b5546aa4726aedbf7fb7a9b4e506d7292f171f5afcb20749` |
| exact Phase 3 Spread | v2 | 1,281,248 | `e93c70b96c398fde4029fd2e873c547858880d668489f25477721034c944a514` |
| self-contained generic sacrificial target | v0 | 1,328,056 | `6d5313a1c55148f07d8a3591dcb3e5f3e40f7ff5fbb7d5c72328fe16229fe4ae` |
| self-contained generic sacrificial target | v2 | 1,328,048 | `5c4ae80c125db3a21169f0954802e37f7199a16e785d907768cd085158bd6d0b` |

Both controller builds are byte-for-byte reproducible from runtime-source tip
`9c1a452`. Their linked ELFs are the generic sacrificial targets in the same
rows. The exact-Spread rows were rerun after the activation guards and CI repair,
so the final claim does not inherit the older rollback-only artifact hashes.

The exact Spread artifacts pin the Phase 3 manifest controller
`4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi`. Exact-Spread mode requires
that identity explicitly and rederives every controller-owned PDA from it. The
self-contained generic CI mode uses local controller
`8qbHbw2BbbTHBW1sbeqakYXVKRQM8Ne7pLK7m6CVfeR`, is labelled
`generic-sacrificial`, and cannot silently identify itself as Spread.

## Actual-SBF results

The common command was:

```bash
CARGO_TARGET_DIR="$HOME/.cache/release1-final-host" \
BPF_OUT_DIR="<exact-controller-deploy-directory>" \
AMOEBA_V3_ROLLBACK_REHEARSAL=1 \
AMOEBA_SBPF_TARGET="<v0-or-v2>" \
RUST_LOG=error \
cargo test --locked -p upgrade_controller \
  --test ceremony_closure_program_test \
  actual_controller_sbf_checked_handoff_and_governed_bootstrap_activation \
  -- --ignored --exact --nocapture --test-threads=1
```

Exact-Spread runs additionally set:

```bash
AMOEBA_SPREAD_TEST_ARTIFACT="$HOME/.cache/rb3-spread/<target>/deploy/light_token_minter.so"
AMOEBA_SYNTHETIC_CONTROLLER_PROGRAM_ID="4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi"
```

Generic hosted-CI-equivalent runs instead set
`AMOEBA_SACRIFICIAL_TARGET_ARTIFACT` to the matching controller build's
self-contained unstripped linked ELF.

| Run | Result | Runtime evidence |
|---|---|---|
| exact final Spread v0 | pass, 1/1, 94.06 s | witness, delayed activation, Loader rollback, ProgramData verification, poststate, separate unfreeze, and first gated Spread mutation all true |
| exact final Spread v2 | pass, 1/1, 99.26 s | same complete recovery path and first gated Spread mutation all true |

The generic current-V3 happy, rollback, and maximum-geometry jobs are configured
for hosted CI. This report does not claim a green hosted execution; the exact
Spread rollback rows above are the fresh local current-runtime evidence.

The final state assertions require:

- rollback proposal `Completed`;
- primary proposal `SupersededByRollback` and linked to that rollback;
- rollback linked to that primary;
- gate `Active`, active proposal cleared, epoch incremented, and
  `last_completed_proposal` equal to the rollback;
- current deployment `completed_proposal` equal to the rollback and artifact
  hash equal to the mechanically verified rollback artifact; and
- Spread mutation admitted only after those conditions are true.

## Negative and atomicity coverage

Before the successful rollback Loader CPI, actual SBF rejects each of these:

- rollback activation before the checked post-upgrade delay, with the gate and
  rollback proposal byte-identical after rejection;
- a different failure-witness account;
- stale observation generation or observation-state root;
- frozen-gate epoch drift;
- the wrong accepted prestate anchor;
- a repaired payload for which the witnessed mismatch no longer exists; and
- mismatch-class drift.

For every rejected case, the harness snapshots and then byte-compares all
writable rollback proposal, buffer-verification, ProgramData, Program, buffer,
and spill accounts. All remain byte-identical. The unit matrix enumerates all
14 `ProgramDataMismatchClassV2` values. Only the currently reprovable
`ArtifactPayload` and `ZeroTail` classes can activate or authorize Loader
execution; structural mismatch classes remain audit evidence and cannot strand
the gate on an unexecutable rollback proposal.

## Regression and CI results

| Check | Result |
|---|---|
| `cargo fmt --all -- --check` | pass |
| `cargo test --locked --workspace --all-targets` | pass: 287 unit tests, 0 failed, 1 fixture generator ignored; capacity and golden suites pass |
| `cargo clippy --locked --workspace --all-targets -- -D warnings` | pass in pinned WSL release path |
| workflow parse with Python `yaml.safe_load` | pass |
| obsolete `release1_model_differential_through_real_loader_and_separate_unfreeze` hosted step | removed |
| hosted v0/v2 current-V3 happy, rollback, and maximum-geometry steps | configured with self-contained generic sacrificial ELFs; no green hosted run claimed |

The generic hosted steps do not check out a private or unpushed Spread branch
and do not store an opaque Spread binary. Exact current Spread integration is
the separate local evidence above.

## Side-effect boundary

No Devnet or Mainnet RPC was contacted. No program was deployed, signed,
initialized, upgraded, or handed off on a live cluster. No production identity,
private key, service, deployed authority, or live ProgramData was read or
mutated. All Loader operations occurred in ephemeral ProgramTest banks against
sacrificial accounts. Git-only feature-branch publication, if performed, is a
separate repository action and does not expand this evidence boundary.
