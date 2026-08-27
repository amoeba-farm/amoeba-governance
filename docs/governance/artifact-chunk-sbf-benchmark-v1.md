# Release 1 artifact-chunk actual-SBF benchmark

Status: measured and selected for the Release 1 schema/design baseline

Scope: standalone benchmark only. It adds no production controller instruction,
dispatcher tag, account ABI, deployment path, signer, RPC write, or live identity.

## Decision

Release 1 uses a fixed artifact chunk size of **16 KiB (16,384 bytes)** for the
2 MiB maximum artifact policy.

The selection was admitted only after the 16 KiB leaf plus its maximum-depth
proof passed both SBPF v0 and SBPF v2 under these predeclared gates:

- at most 25,000 compute units, or 12.5% of the default 200,000-unit transaction
  budget;
- at most 512 bytes in the benchmark `process_instruction` SBF frame;
- an actual ProgramTest-loaded SBF ELF for each architecture;
- no compiler-reported frame-overflow, stack-offset, or caller-frame symbol in
  the linked ELF.

The worst measured 16 KiB case consumed 10,615 units (5.31%), leaving 189,385
units (94.69%). Its smallest processor-frame margin was 3,776 of 4,096 bytes.
It therefore passes the gates while reducing a maximum artifact to 128 chunks,
128 live bitmap bits (16 used bytes within the fixed 64-byte schema bitmap), a
seven-node proof, and a 281-byte benchmark instruction.

## Measured contract

The fixture is one exactly 2,097,197-byte, program-owned, read-only account:
the Loader-v3 ProgramData metadata width of 45 bytes followed by the full
2,097,152-byte payload capacity. For each candidate, the benchmark verifies the
final payload leaf and the full proof depth at the cap. The SBF processor
retains the `AccountInfo::try_borrow_data` guard and passes the exact borrowed
chunk slice to `hashv`; it does not copy the chunk into a `Vec` or a chunk-sized
stack array.

The commitment shapes are:

```text
SHA256(
  "AMOEBA_ARTIFACT_CHUNK_V1"
  || chunk_index_u32_le
  || actual_chunk_length_u32_le
  || exact_chunk_bytes
)

SHA256(
  "AMOEBA_ARTIFACT_NODE_V1"
  || left_child
  || right_child
)
```

At the exact 2 MiB cap, all three candidate sizes divide the artifact evenly.
The final leaf is therefore full; the proof depth is still the maximum depth for
that candidate at the cap. Final-partial-chunk semantics remain a separate
golden-vector and processor-test obligation.

## Results

| Chunk | Chunks | Bitmap | Proof depth | Instruction | v0 CU | v2 CU |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 KiB | 512 | 64 B | 9 | 345 B | 4,848 | 4,814 |
| 8 KiB | 256 | 32 B | 8 | 313 B | 6,709 | 6,675 |
| 16 KiB | 128 | 16 B | 7 | 281 B | 10,615 | 10,581 |

Both test executions loaded an SBF program account owned by
`BPFLoader2111111111111111111111111111111111`; no native processor was supplied
to ProgramTest.

The stripped v0 ELF is 28,048 bytes with SHA-256
`9e310655ae7c898df17002dd93b5441edd8412381fdfe6f6a70ca1ea794336ce`.
The stripped v2 ELF is 27,624 bytes with SHA-256
`67a750820d6a1cf6b960617da1d8b848ff19d37f3c16f1fcee676681597ce902`.

## Exact raw ProgramData hash

The same actual-SBF run separately hashed the entire 2,097,197-byte raw
ProgramData-shaped account in a dedicated transaction with a 1,400,000-unit
limit. The predeclared acceptance cap was 1,150,000 units. SBPF v0 consumed
1,049,726 units and left 350,274; SBPF v2 consumed 1,049,697 and left 350,303.
Both produced the identical raw SHA-256
`c9b773fc5e275d257e0849da3b4dd8c619f719662ca461aa3238c809010a8304`.

This proves that exact maximum-size raw ProgramData SHA-256 fits only as its own
bounded finalization operation with conservative transaction margin. It is not
authorization to combine the raw hash with a Loader CPI or another full-account
hash; the composed production finalizer must be benchmarked again.

## Stack analysis

The v0 linked ELF's hashing processor uses a maximum direct `r10` offset of 264
bytes, leaving 3,832 bytes in its 4,096-byte frame. Other linked v0 runtime
support reaches the exact 4,096-byte offset. That yields no whole-ELF spare
offset, but it does not exceed the boundary and the build reports no linked
stack-offset or caller-frame overlap. The 16 v0 compiler diagnostics are exact
dependency-only generic symbols; all 16 are absent from the final linked ELF.

SBPF v2 uses dynamic frame prologues. The processor and whole linked ELF maximum
are both 320 bytes, leaving 3,776 bytes. The v2 build emits no frame diagnostic.

This evidence measures one chunk-verification operation, not the future complete
controller instruction. Production integration must retain direct borrowing and
rerun linked-ELF stack and actual-SBF compute checks after account validation,
bitmap mutation, and state serialization are composed around it.

## Reproduction

Run from WSL Ubuntu 22.04 with Rust 1.89.0, `cargo-build-sbf` 4.0.0, platform
tools v1.53, `solana-program` 2.3.0, and ProgramTest 2.3.13:

```bash
cd /mnt/c/Users/space/.codex/worktrees/release1-completion-gov/ameba_gov
export AMOEBA_BENCH_BASE_COMMIT="$(git rev-parse HEAD)"
benchmarks/artifact_chunk_sbf/run-benchmark.sh
```

When WSL cannot resolve a Windows-linked Git worktree, obtain the read-only HEAD
with Windows Git before entering WSL and export that exact value. The runner
creates fresh build/output directories under `/tmp`, performs formatting and
Clippy checks, builds both architectures with `--locked`, executes both ELFs,
analyzes disassembly and linked symbols, and prints the generated evidence path.

The checked machine-readable run record is
[`evidence/artifact-chunk-sbf-benchmark-v1.json`](evidence/artifact-chunk-sbf-benchmark-v1.json).
