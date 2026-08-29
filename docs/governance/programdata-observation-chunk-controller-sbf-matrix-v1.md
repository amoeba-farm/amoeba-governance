# ProgramData observation chunk actual-controller-SBF matrix v1

Status: **COMPLETE FOR THE RELEASE 1 CANDIDATE MATRIX; 16 KiB REMAINS THE
ONLY ADMITTED SIZE**

Evidence source commit:
`2f1154e7b21440878afa33bfc9a2796cd009dee9`

Evidence JSON:
`docs/governance/evidence/programdata-observation-chunk-controller-sbf-matrix-v1.json`

Evidence JSON SHA-256:
`42c77a82b9a164f09f150f06b08b8d6d54e64df5bfa0945260e2c673ebf4fe11`

This report closes the missing actual-SBF measurements for the 32, 64, and
128 KiB ProgramData observation candidates. It does not change the Release 1
account ABI, digest ABI, instruction ABI, selected 16-KiB consensus policy, or
any live state.

## Benchmark contract

The benchmark executes production instruction tag 40,
`AppendProgramDataObservationChunkV1`, from an actual checked
`upgrade_controller.so` loaded through canonical Loader-v3 Program and
ProgramData accounts in ProgramTest. The observed ProgramData account is the
pinned runtime maximum of `10,485,760` raw bytes.

For each candidate, the fixture creates the genuine canonical frontier prefix
and measures a full chunk at the highest real index that produces that
candidate's maximum power-of-two merge depth:

| Chunk | Real chunks | Measured index | Merge depth |
|---:|---:|---:|---:|
| 16 KiB | 640 | 511 | 9 |
| 32 KiB | 320 | 255 | 8 |
| 64 KiB | 160 | 127 | 7 |
| 128 KiB | 80 | 63 | 6 |

The explicitly test-only `programdata-observation-chunk-matrix` feature admits
the three nonselected candidates to this measurement ELF. Normal controller
builds do not enable that feature and continue to reject every size except
16 KiB. A normal-build regression and a feature-build regression both pass.

## Compute results

The pinned Agave runtime default is `200,000` compute units for the one
non-builtin instruction in this transaction. The benchmark deliberately sets
the runtime maximum `1,400,000`-unit ComputeBudget limit so the rejected larger
candidates can be measured rather than merely exhausting the default budget.
That measurement limit is not a policy change or an execution recommendation.

Every candidate is simulated twice before commit. All sixteen per-engine
samples were byte-for-byte compute deterministic. The full transaction costs
exactly 300 units more than the controller execution: 150 units for each of the
two canonical ComputeBudget instructions.

| Engine | Chunk | Controller CU | Full transaction CU | Margin to 200,000 | Current gate |
|---|---:|---:|---:|---:|---|
| SBPF v0 | 16 KiB | 160,083 | 160,383 | +39,617 (19.81%) | pass; selected |
| SBPF v0 | 32 KiB | 257,578 | 257,878 | -57,878 | reject |
| SBPF v0 | 64 KiB | 430,115 | 430,415 | -230,415 | reject |
| SBPF v0 | 128 KiB | 790,376 | 790,676 | -590,676 | reject |
| SBPF v2 | 16 KiB | 191,881 | 192,181 | +7,819 (3.91%) | pass; selected |
| SBPF v2 | 32 KiB | 314,621 | 314,921 | -114,921 | reject |
| SBPF v2 | 64 KiB | 560,187 | 560,487 | -360,487 | reject |
| SBPF v2 | 128 KiB | 1,059,013 | 1,059,313 | -859,313 | reject |

The v2 16-KiB result has only 7,819 units, or 3.91%, of headroom below the
existing 200,000-unit gate. This report therefore does **not** characterize
that margin as generous or broadly conservative. It is sufficient for the
exact measured controller ELF and pinned runtime, and no adjustment to the
current 200,000-unit policy is required for that exact combination. It is not
permission to add work to the instruction or assume the margin survives a
toolchain, runtime, dependency, or source change.

Release and ceremony tooling must rebuild and remeasure the exact final
production candidate before selection. A result above 200,000 units, a changed
envelope cost, nondeterministic samples, or a changed stack result is a stop
condition. Raising the admitted budget would require a separate reviewed
policy decision; this benchmark does not do so.

## Stack and linked-ELF result

| Engine | Controller ELF | SHA-256 | Linked stack metric | Margin | Diagnostics |
|---|---:|---|---:|---:|---|
| SBPF v0 | 1,109,664 B | `9034b2546825bb848e7ae6b7d54f25258bb993b42d3aa1f1658a01a9ba84c92b` | maximum direct `r10` offset 4,096 B | 0 B | 16 dependency-only frame diagnostics; all exact symbols absent from linked ELF; no caller-frame/stack-offset diagnostic |
| SBPF v2 | 1,109,656 B | `1912f4b3b3e613fe8fefd07d67c6eba076e741bdb61b0832e36f8010ac1e5234` | maximum dynamic frame 3,904 B | 192 B | no frame or caller-overlap diagnostic |

The v0 linked ELF reaches, but does not exceed, the 4,096-byte direct-offset
limit. It has no inferred spare direct-offset margin. Both engines completed
all candidate transactions with no runtime stack fault. The analyzer also
proved that no compiler-reported overflow symbol is present in the linked v0
ELF. As with compute, any linked-ELF or toolchain drift requires remeasurement;
an offset or frame above 4,096 bytes, a reachable diagnostic symbol, or caller
overlap remains a hard blocker.

## Decision

- 16 KiB remains the only Release 1 schema-admitted ProgramData observation
  chunk.
- 32, 64, and 128 KiB are measured, exceed the current 200,000-unit default on
  both engines, and remain mechanically rejected by normal builds.
- The matrix measurement blocker is closed for engineering review.
- Production selection remains conditional on exact final-artifact
  reproduction and independent pre-ceremony review; this is not deployment
  authorization.

## Reproduction and CI

The clean evidence run used:

```bash
AMOEBA_BENCH_BASE_COMMIT=2f1154e7b21440878afa33bfc9a2796cd009dee9 \
AMOEBA_BENCH_EVIDENCE_OUT="$PWD/docs/governance/evidence/programdata-observation-chunk-controller-sbf-matrix-v1.json" \
bash benchmarks/programdata_observation_chunk_controller_sbf/run-benchmark.sh
```

The runner performs format and Clippy checks, builds fresh isolated v0 and v2
matrix ELFs with platform-tools v1.53, analyzes linked symbols and
disassembly, runs the complete actual-controller-SBF matrix, verifies the two
deterministic samples and 300-unit envelope cost, and emits the JSON. The
`governance-trust-root.yml` hosted workflow now runs this same complete matrix
on both engines.

The evidence environment was rustc 1.89.0, cargo-build-sbf 4.0.0,
platform-tools v1.53, and ProgramTest 2.3.13 under Ubuntu-22.04 WSL. No network,
RPC, deployment, key, signature, ProgramData authority, service, or live
identity was used or changed.
