#!/usr/bin/env python3
"""Summarize an isolated actual-SBF artifact-chunk benchmark run."""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

DEFAULT_COMPUTE_LIMIT = 200_000
SELECTION_COMPUTE_CAP = 25_000
SELECTION_PROCESSOR_FRAME_CAP = 512
SBF_FRAME_LIMIT = 4096
SELECTED_CHUNK_BYTES = 16_384
ELF_NAME = "ameba_artifact_chunk_sbf_benchmark.so"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def stack_metrics(arch: str, disassembly: str) -> dict[str, int]:
    current_symbol: str | None = None
    linked: list[tuple[int, str]] = []
    for line in disassembly.splitlines():
        symbol = re.match(r"^[0-9a-f]+ <(.+)>:$", line)
        if symbol:
            current_symbol = symbol.group(1)
        if current_symbol is None:
            continue
        if arch == "v0":
            for encoded in re.findall(r"\[r10 - 0x([0-9a-f]+)\]", line):
                linked.append((int(encoded, 16), current_symbol))
        else:
            frame = re.search(r"add64 r10, -0x([0-9a-f]+)", line)
            if frame:
                linked.append((int(frame.group(1), 16), current_symbol))
    if not linked:
        raise RuntimeError(f"no {arch} stack accesses or frames found")
    processor = [
        size for size, symbol in linked if "artifact_chunk_sbf_benchmark19process_instruction" in symbol
    ]
    if not processor:
        raise RuntimeError(f"{arch} process_instruction stack metric missing")
    linked_max = max(size for size, _ in linked)
    processor_max = max(processor)
    return {
        "method": "max_r10_direct_offset" if arch == "v0" else "dynamic_frame_prologue",
        "sbf_frame_limit_bytes": SBF_FRAME_LIMIT,
        "process_instruction_frame_bytes": processor_max,
        "process_instruction_margin_bytes": SBF_FRAME_LIMIT - processor_max,
        "linked_elf_max_frame_or_offset_bytes": linked_max,
        "linked_elf_margin_bytes": SBF_FRAME_LIMIT - linked_max,
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: summarize_benchmark.py RUN_ROOT REPO_ROOT")
    run_root = Path(sys.argv[1]).resolve()
    repo_root = Path(sys.argv[2]).resolve()
    benchmark_dir = repo_root / "benchmarks" / "artifact_chunk_sbf"
    source_files = [
        benchmark_dir / "Cargo.toml",
        benchmark_dir / "Cargo.lock",
        benchmark_dir / "rust-toolchain.toml",
        benchmark_dir / "src" / "lib.rs",
        benchmark_dir / "tests" / "actual_sbf.rs",
        benchmark_dir / "run-benchmark.sh",
        benchmark_dir / "summarize_benchmark.py",
    ]
    source = text(benchmark_dir / "src" / "lib.rs")
    if "try_borrow_data" not in source or "to_vec" in source:
        raise RuntimeError("benchmark does not retain the direct-borrow contract")

    architectures: dict[str, dict[str, object]] = {}
    all_measurements: list[dict[str, object]] = []
    all_safe = True
    for arch in ("v0", "v2"):
        arch_root = run_root / arch
        build_log = text(arch_root / "build.log")
        test_log = text(arch_root / "test.log")
        symbols = text(arch_root / "symbols.txt")
        diagnostic_symbols = re.findall(r"^Error: Function (\S+) overflows", build_log, re.MULTILINE)
        linked_diagnostic_symbols = [name for name in diagnostic_symbols if name in symbols]
        caller_overlap_count = sum(
            build_log.count(phrase)
            for phrase in (
                "overwrites values in the caller frame",
                "overwrites values in frame",
                "Stack offset of",
            )
        )
        measurements = [
            json.loads(match)
            for match in re.findall(r"^AMOEBA_BENCH_RESULT (\{.*\})$", test_log, re.MULTILINE)
        ]
        if [item["chunk_bytes"] for item in measurements] != [4096, 8192, 16384]:
            raise RuntimeError(f"{arch} did not emit all required chunk measurements")
        if any(item["execution"] != "actual_sbf_programtest" for item in measurements):
            raise RuntimeError(f"{arch} did not use actual SBF")
        if "SBF program from" not in test_log:
            raise RuntimeError(f"{arch} ProgramTest SBF load evidence missing")
        for item in measurements:
            item["compute_usage_basis_points"] = round(
                int(item["compute_units"]) * 10_000 / DEFAULT_COMPUTE_LIMIT
            )
            item["compute_margin_basis_points"] = 10_000 - int(
                item["compute_usage_basis_points"]
            )
        stack = stack_metrics(arch, text(arch_root / "disassembly.txt"))
        elf = arch_root / "sbf-out" / ELF_NAME
        architecture_safe = not linked_diagnostic_symbols and caller_overlap_count == 0
        all_safe = all_safe and architecture_safe
        architectures[arch] = {
            "elf": {
                "bytes": elf.stat().st_size,
                "sha256": sha256(elf),
            },
            "measurements": measurements,
            "stack": stack,
            "build_diagnostics": {
                "compiler_frame_diagnostic_count": len(diagnostic_symbols),
                "diagnostic_symbols_absent_from_linked_elf": len(diagnostic_symbols)
                - len(linked_diagnostic_symbols),
                "diagnostic_symbols_present_in_linked_elf": linked_diagnostic_symbols,
                "caller_frame_or_stack_offset_diagnostic_count": caller_overlap_count,
                "linked_elf_safe": architecture_safe,
            },
        }
        all_measurements.extend(measurements)

    selected = [
        item for item in all_measurements if int(item["chunk_bytes"]) == SELECTED_CHUNK_BYTES
    ]
    processor_frames = [
        int(architectures[arch]["stack"]["process_instruction_frame_bytes"])
        for arch in ("v0", "v2")
    ]
    decision_passes = (
        len(selected) == 2
        and max(int(item["compute_units"]) for item in selected) <= SELECTION_COMPUTE_CAP
        and max(processor_frames) <= SELECTION_PROCESSOR_FRAME_CAP
        and all_safe
    )
    if not decision_passes:
        raise RuntimeError("16 KiB does not satisfy the predeclared conservative selection gates")

    result = {
        "schema": "ameba-artifact-chunk-sbf-benchmark-evidence-v1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_commit": text(run_root / "git-head.txt").strip(),
        "environment": {
            "rustc": text(run_root / "rustc-version.txt").strip(),
            "cargo_build_sbf": text(run_root / "cargo-build-sbf-version.txt").strip(),
            "program_test": "2.3.13",
            "solana_program": "2.3.0",
            "platform_tools": "v1.53",
            "host": text(run_root / "uname.txt").strip(),
            "network_or_rpc_used": False,
        },
        "benchmark_contract": {
            "artifact_cap_bytes": 2 * 1024 * 1024,
            "chunk_candidates_bytes": [4096, 8192, 16384],
            "leaf_domain_utf8": "AMOEBA_ARTIFACT_CHUNK_V1",
            "node_domain_utf8": "AMOEBA_ARTIFACT_NODE_V1",
            "leaf_index_encoding": "u32_le",
            "actual_chunk_length_encoding": "u32_le",
            "measured_leaf": "final full leaf at exact 2 MiB cap",
            "proof": "maximum-depth binary Merkle proof for candidate chunk count",
            "account_data_access": "direct AccountInfo::try_borrow_data slice; no chunk copy",
            "production_instruction_tag_added": False,
        },
        "selection_gates": {
            "selected_case_compute_cap": SELECTION_COMPUTE_CAP,
            "selected_case_compute_cap_basis_points_of_default": round(
                SELECTION_COMPUTE_CAP * 10_000 / DEFAULT_COMPUTE_LIMIT
            ),
            "process_instruction_frame_cap_bytes": SELECTION_PROCESSOR_FRAME_CAP,
            "linked_compiler_frame_or_caller_overlap_allowed": False,
            "actual_sbf_required_for": ["v0", "v2"],
        },
        "architectures": architectures,
        "decision": {
            "selected_v1_chunk_bytes": SELECTED_CHUNK_BYTES,
            "passes_selection_gates": decision_passes,
            "max_selected_compute_units": max(int(item["compute_units"]) for item in selected),
            "min_selected_compute_margin_units": min(
                int(item["compute_margin"]) for item in selected
            ),
            "max_selected_compute_usage_basis_points": max(
                int(item["compute_usage_basis_points"]) for item in selected
            ),
            "min_process_instruction_stack_margin_bytes": min(
                int(architectures[arch]["stack"]["process_instruction_margin_bytes"])
                for arch in ("v0", "v2")
            ),
            "reason": "16 KiB passes both conservative resource gates and minimizes chunk count, bitmap bytes, proof depth, and instruction bytes among the measured candidates.",
        },
        "source_sha256": {
            str(path.relative_to(repo_root)).replace("\\", "/"): sha256(path)
            for path in source_files
        },
        "commands": [
            "cargo fmt --manifest-path benchmarks/artifact_chunk_sbf/Cargo.toml -- --check",
            "cargo clippy --manifest-path benchmarks/artifact_chunk_sbf/Cargo.toml --lib --tests -- -D warnings",
            "cargo-build-sbf --manifest-path benchmarks/artifact_chunk_sbf/Cargo.toml --arch v0 --tools-version v1.53 --sbf-out-dir <fresh>/v0/sbf-out -- --locked",
            "cargo test --manifest-path benchmarks/artifact_chunk_sbf/Cargo.toml --test actual_sbf -- --nocapture --test-threads=1 (BPF_OUT_DIR=<fresh>/v0/sbf-out)",
            "cargo-build-sbf --manifest-path benchmarks/artifact_chunk_sbf/Cargo.toml --arch v2 --tools-version v1.53 --sbf-out-dir <fresh>/v2/sbf-out -- --locked",
            "cargo test --manifest-path benchmarks/artifact_chunk_sbf/Cargo.toml --test actual_sbf -- --nocapture --test-threads=1 (BPF_OUT_DIR=<fresh>/v2/sbf-out)",
        ],
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
