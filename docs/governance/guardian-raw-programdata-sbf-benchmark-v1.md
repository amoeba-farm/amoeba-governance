# Guardian raw ProgramData atomic-hash benchmark V1

Status: measured decision evidence. This document does not define a production
instruction, account layout, digest, deployment, or authority change.

## Decision

Release 1 should use this inclusive ceiling:

```text
MAX_ATOMIC_RAW_PROGRAMDATA_ACCOUNT_BYTES_V1 = 1_572_909
MAX_ATOMIC_PROGRAMDATA_PAYLOAD_BYTES_V1     = 1_572_864
UPGRADEABLE_LOADER_PROGRAMDATA_METADATA     =        45
```

The selected raw-account ceiling is exactly a 1.5 MiB payload plus the 45-byte
Upgradeable Loader ProgramData metadata prefix. At that size, the composed
operation consumed 798,245 CU under SBPF v0 and 798,323 CU under SBPF v2. The
worse result retains 601,677 CU, or 42.98%, below the 1,400,000-CU transaction
limit. This passes the predeclared 850,000-CU selected-case cap and 550,000-CU
minimum margin.

Larger cases succeeded as benchmark evidence, but they are deliberately not
the V1 completeness ceiling. Their compute margins fall below the reserved
550,000-CU integration margin.

## Required completeness behavior

`raw_hash_complete` may be true only when all of the following hold:

1. the observation covers the complete raw ProgramData account, including its
   metadata prefix and every payload/tail byte;
2. the account is structurally valid enough to establish the canonical
   Program/ProgramData graph and exact Loader-v3 header interpretation; and
3. the raw account data length is less than or equal to 1,572,909 bytes.

For an oversized or malformed ProgramData observation, GuardianFreeze must
remain live: it records incomplete evidence, uses a zero raw hash, and freezes
the gate without attempting an atomic full-account hash. Incomplete evidence
must never authorize `ResumeWithoutUpgrade`; that path requires a complete,
mechanically reverified observation. This fallback preserves the guardian's
ability to freeze while preventing an oversized or malformed account from
being represented as an exact hash match.

## Composed operation measured

Each case ran as an actual SBF ProgramTest transaction with a 1,400,000-CU
limit and performed representative work beyond hashing:

- exact read-only/signer/writable and account-length checks;
- fixed config, gate, and observation account parsing;
- Program to ProgramData linkage-byte validation;
- exact Loader-v3 ProgramData owner, length, tag, nonzero slot, option tag, and
  controller-authority validation;
- direct full raw-account SHA-256 through `AccountInfo::try_borrow_data`, with
  no raw-account copy;
- one additional domain-separated observation digest;
- serialization of a zeroed, preallocated 256-byte observation PDA; and
- validation and mutation of a 192-byte gate from Active to EmergencyFrozen,
  including checked epoch increment, slot, and reason.

ProgramTest rejects a synthetic Loader-v3 Program record in its deploy cache
before the benchmark entrypoint runs. The synthetic target Program account was
therefore benchmark-owned and nonexecutable while still exercising an
equal-cost exact-owner comparison and exact Program-to-ProgramData linkage
bytes. The large ProgramData account itself remained Loader-v3-owned. The
production processor must validate the actual target Program's Loader-v3 owner
and executable bit and must be rebenchmarked after integration.

## Compute results

All values include the canonical compute-budget instruction overhead.

| Architecture | Payload bytes | Raw account bytes | CU consumed | CU margin |
|---|---:|---:|---:|---:|
| SBPF v0 | 1,310,720 | 1,310,765 | 668,673 | 731,327 |
| SBPF v0 | 1,572,864 | 1,572,909 | 798,245 | 601,755 |
| SBPF v0 | 1,835,008 | 1,835,053 | 932,317 | 467,683 |
| SBPF v0 | 2,097,152 | 2,097,197 | 1,060,389 | 339,611 |
| SBPF v2 | 1,310,720 | 1,310,765 | 668,751 | 731,249 |
| SBPF v2 | 1,572,864 | 1,572,909 | 798,323 | 601,677 |
| SBPF v2 | 1,835,008 | 1,835,053 | 932,395 | 467,605 |
| SBPF v2 | 2,097,152 | 2,097,197 | 1,060,467 | 339,533 |

The v0 and v2 raw SHA-256 values matched at every candidate size. The selected
case raw hash was:

```text
fd48573b34682236243917b1b88a640987f718c70bc8fbbbc1f61192da55a7ed
```

## Stack and linked-ELF analysis

| Architecture | Processor metric | Linked maximum | Compiler diagnostics | Linked diagnostic symbols | Caller overlap diagnostics |
|---|---:|---:|---:|---:|---:|
| SBPF v0 | 4,096-byte max direct r10 offset | 4,096 bytes | 16 | 0 | 0 |
| SBPF v2 | 1,152-byte dynamic frame | 1,152 bytes | 0 | 0 | 0 |

SBPF v0 used the complete legal fixed 4,096-byte frame, so this benchmark does
not claim byte-local v0 stack headroom. All 16 v0 build diagnostics were in
dependency-only generic serialization symbols and every exact symbol was
absent from the linked ELF. No benchmark/controller symbol appeared in a frame
diagnostic, and there was no caller-frame overlap or stack-offset diagnostic.
SBPF v2 retained 2,944 bytes of dynamic-frame margin. The integrated production
instruction remains subject to a fresh linked-ELF stack audit under both
architectures.

## Artifacts and environment

Base commit recorded for the isolated worktree:
`67e351346f2e6aa6e9cbb0acb84ef9c2ba367e53`.

| Architecture | Stripped ELF bytes | SHA-256 |
|---|---:|---|
| SBPF v0 | 49,152 | `acfe53dae4caf7c044dba1db79fa10cfa0e947e301d322dd99e1d0425351e58c` |
| SBPF v2 | 49,384 | `2c2c82f8ee086a154775f73edee6323f792500bacffddbc9e4e9453bb460fe65` |

The run used WSL2 Ubuntu-22.04, `cargo-build-sbf 4.0.0`, platform-tools v1.53,
Rust 1.89.0, `solana-program` 2.3.0, and ProgramTest 2.3.13. Cargo ran offline.
No cluster, RPC, key, signature, deployment, authority, service, Devnet, or
live state was accessed or changed.

Machine-readable evidence is in
`docs/governance/evidence/guardian-raw-programdata-sbf-benchmark-v1.json`.

## Reproduction

From the repository root in WSL Ubuntu-22.04:

```bash
AMOEBA_BENCH_BASE_COMMIT=67e351346f2e6aa6e9cbb0acb84ef9c2ba367e53 \
AMOEBA_BENCH_EVIDENCE_OUT="$PWD/docs/governance/evidence/guardian-raw-programdata-sbf-benchmark-v1.json" \
bash benchmarks/guardian_raw_hash_sbf/run-benchmark.sh
```

The runner performs format and Clippy `-D warnings` checks, fresh offline SBPF
v0/v2 builds, actual-SBF ProgramTest execution at all four sizes, linked-ELF
disassembly and symbol checks, and deterministic evidence validation.

## Limitations and integration gate

- This is a faithful composed resource benchmark, not the production
  GuardianFreeze processor or its consensus ABI.
- The observation PDA was preallocated. If production creates it with a System
  CPI, that integrated path must be remeasured.
- The synthetic Program owner/executable workaround described above omits the
  real production identities but not the dominant raw-hash work.
- This evidence does not prove production schema, digest, transition, or
  failure-atomicity correctness.
- The production GuardianFreeze and failure-observation instructions must pass
  their own actual-SBF v0/v2 benchmark and linked-ELF stack audit without
  increasing this V1 ceiling.
