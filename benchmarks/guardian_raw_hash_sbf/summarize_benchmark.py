#!/usr/bin/env python3
"""Summarize the composed guardian raw-ProgramData actual-SBF benchmark."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

COMPUTE_LIMIT = 1_400_000
SELECTED_PAYLOAD_BYTES = 3 * 1024 * 1024 // 2
PROGRAMDATA_METADATA_BYTES = 45
SELECTED_ACCOUNT_BYTES = SELECTED_PAYLOAD_BYTES + PROGRAMDATA_METADATA_BYTES
SELECTED_COMPUTE_CAP = 850_000
SELECTED_MIN_COMPUTE_MARGIN = COMPUTE_LIMIT - SELECTED_COMPUTE_CAP
SBF_FRAME_LIMIT = 4096
PROCESSOR_FRAME_CAPS = {"v0": SBF_FRAME_LIMIT, "v2": 1536}
EXPECTED_PAYLOAD_BYTES = [
    5 * 1024 * 1024 // 4,
    3 * 1024 * 1024 // 2,
    7 * 1024 * 1024 // 4,
    2 * 1024 * 1024,
]
ELF_NAME = "ameba_guardian_raw_hash_sbf_benchmark.so"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def stack_metrics(arch: str, disassembly: str) -> dict[str, int | str]:
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
        size
        for size, symbol in linked
        if "guardian_raw_hash_sbf_benchmark19process_instruction" in symbol
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
    benchmark_dir = repo_root / "benchmarks" / "guardian_raw_hash_sbf"
    source_files = [
        benchmark_dir / ".gitignore",
        benchmark_dir / "Cargo.toml",
        benchmark_dir / "Cargo.lock",
        benchmark_dir / "rust-toolchain.toml",
        benchmark_dir / "src" / "lib.rs",
        benchmark_dir / "tests" / "actual_sbf.rs",
        benchmark_dir / "run-benchmark.sh",
        benchmark_dir / "summarize_benchmark.py",
    ]
    source = text(benchmark_dir / "src" / "lib.rs")
    required_source_markers = [
        "validate_program_link",
        "validate_and_hash_programdata",
        "hashv(&[&data])",
        "write_observation",
        "freeze_gate",
    ]
    if any(marker not in source for marker in required_source_markers) or "to_vec" in source:
        raise RuntimeError("benchmark lost the declared composed direct-borrow contract")

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
            for match in re.findall(
                r"^AMOEBA_GUARDIAN_HASH_BENCH_RESULT (\{.*\})$",
                test_log,
                re.MULTILINE,
            )
        ]
        if [int(item["payload_capacity_bytes"]) for item in measurements] != EXPECTED_PAYLOAD_BYTES:
            raise RuntimeError(f"{arch} did not emit every required candidate")
        if any(item["execution"] != "actual_sbf_programtest" for item in measurements):
            raise RuntimeError(f"{arch} did not use actual SBF")
        if any(not item["observation_preallocated_and_serialized"] for item in measurements):
            raise RuntimeError(f"{arch} did not serialize the observation account")
        if any(
            item["synthetic_target_program_executable"]
            or item["synthetic_target_program_owner"]
            != "CDY4kzJhAWJcA2XFQb9XJK7dXMvQoYy7kjdvg6ST2JYM"
            for item in measurements
        ):
            raise RuntimeError(f"{arch} synthetic target Program contract drifted")
        if any(item["gate_transition"] != "Active -> EmergencyFrozen" for item in measurements):
            raise RuntimeError(f"{arch} did not exercise the gate mutation")
        if "SBF program from" not in test_log:
            raise RuntimeError(f"{arch} ProgramTest SBF load evidence missing")
        for item in measurements:
            item["compute_usage_basis_points"] = round(
                int(item["compute_units"]) * 10_000 / COMPUTE_LIMIT
            )
            item["compute_margin_basis_points"] = 10_000 - int(
                item["compute_usage_basis_points"]
            )
        stack = stack_metrics(arch, text(arch_root / "disassembly.txt"))
        elf = arch_root / "sbf-out" / ELF_NAME
        architecture_safe = not linked_diagnostic_symbols and caller_overlap_count == 0
        all_safe = all_safe and architecture_safe
        architectures[arch] = {
            "elf": {"bytes": elf.stat().st_size, "sha256": sha256(elf)},
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
        item
        for item in all_measurements
        if int(item["payload_capacity_bytes"]) == SELECTED_PAYLOAD_BYTES
    ]
    processor_frames = {
        arch: int(architectures[arch]["stack"]["process_instruction_frame_bytes"])
        for arch in ("v0", "v2")
    }
    decision_passes = (
        len(selected) == 2
        and max(int(item["compute_units"]) for item in selected) <= SELECTED_COMPUTE_CAP
        and min(int(item["compute_margin"]) for item in selected)
        >= SELECTED_MIN_COMPUTE_MARGIN
        and all(
            processor_frames[arch] <= PROCESSOR_FRAME_CAPS[arch]
            for arch in ("v0", "v2")
        )
        and all_safe
    )
    if not decision_passes:
        raise RuntimeError(
            "1.5 MiB payload / 1,572,909-byte raw account does not satisfy the "
            "predeclared conservative completeness gates"
        )

    hashes_by_size: dict[int, set[str]] = {}
    for item in all_measurements:
        payload = int(item["payload_capacity_bytes"])
        hashes_by_size.setdefault(payload, set()).add(str(item["raw_sha256"]))
    if any(len(hashes) != 1 for hashes in hashes_by_size.values()):
        raise RuntimeError("v0/v2 raw SHA-256 mismatch")

    result = {
        "schema": "ameba-guardian-raw-programdata-sbf-benchmark-evidence-v1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_commit": text(run_root / "git-head.txt").strip(),
        "environment": {
            "rustc": text(run_root / "rustc-version.txt").strip(),
            "cargo_build_sbf": text(run_root / "cargo-build-sbf-version.txt").strip(),
            "program_test": "2.3.13",
            "solana_program": "2.3.0",
            "platform_tools": "v1.53",
            "host": text(run_root / "uname.txt").strip(),
            "cargo_offline": True,
            "cluster_or_rpc_used": False,
        },
        "benchmark_contract": {
            "candidate_payload_bytes": EXPECTED_PAYLOAD_BYTES,
            "candidate_raw_account_bytes": [
                value + PROGRAMDATA_METADATA_BYTES for value in EXPECTED_PAYLOAD_BYTES
            ],
            "programdata_metadata_bytes": PROGRAMDATA_METADATA_BYTES,
            "account_data_access": "direct AccountInfo::try_borrow_data slice; no raw-account copy",
            "program_graph_checks": (
                "exact read-only privileges, equal-cost synthetic owner comparison, and exact "
                "Program -> ProgramData linkage bytes; the synthetic target is benchmark-owned "
                "and nonexecutable because ProgramTest deploy-cache loading rejects a synthetic "
                "Loader-v3 Program record before the benchmark entrypoint runs"
            ),
            "programdata_header_checks": "exact loader owner, length, tag, nonzero slot, and controller authority",
            "observation": "preallocated zeroed 256-byte PDA validated and serialized in the same transaction",
            "digest": "one additional domain-separated SHA-256 over graph, header, raw hash, epoch, slot, and reason",
            "gate": "validated canonical 192-byte Active gate and mutated it to EmergencyFrozen with epoch increment",
            "compute_measurement_includes_compute_budget_instruction": True,
            "production_instruction_tag_added": False,
        },
        "selection_gates": {
            "compute_limit": COMPUTE_LIMIT,
            "selected_compute_cap": SELECTED_COMPUTE_CAP,
            "selected_min_compute_margin": SELECTED_MIN_COMPUTE_MARGIN,
            "selected_min_compute_margin_basis_points": round(
                SELECTED_MIN_COMPUTE_MARGIN * 10_000 / COMPUTE_LIMIT
            ),
            "process_instruction_frame_cap_bytes": PROCESSOR_FRAME_CAPS,
            "v0_stack_rule": (
                "direct r10 offsets may use the complete fixed 4,096-byte frame; any compiler "
                "overflow, caller-frame overlap, or linked diagnostic symbol is forbidden"
            ),
            "linked_compiler_frame_or_caller_overlap_allowed": False,
            "actual_sbf_required_for": ["v0", "v2"],
        },
        "architectures": architectures,
        "decision": {
            "passes_selection_gates": decision_passes,
            "max_atomic_raw_programdata_account_bytes": SELECTED_ACCOUNT_BYTES,
            "max_atomic_payload_capacity_bytes": SELECTED_PAYLOAD_BYTES,
            "raw_hash_complete_rule": (
                "true only for a structurally valid ProgramData account whose exact data length "
                f"is at most {SELECTED_ACCOUNT_BYTES}; false with a zero raw hash above that bound"
            ),
            "max_selected_compute_units": max(int(item["compute_units"]) for item in selected),
            "min_selected_compute_margin_units": min(
                int(item["compute_margin"]) for item in selected
            ),
            "min_selected_compute_margin_basis_points": min(
                int(item["compute_margin_basis_points"]) for item in selected
            ),
            "min_process_instruction_stack_margin_bytes": min(
                int(architectures[arch]["stack"]["process_instruction_margin_bytes"])
                for arch in ("v0", "v2")
            ),
            "reason": (
                "The 1.5 MiB payload case passes the predeclared 850,000-CU cap, "
                "retains at least 550,000 CU for production-specific variance and checks, "
                "covers the expected 1.1-1.3 MiB Spread artifact range, and has no linked "
                "frame-overflow or caller-overlap diagnostic. Larger measured cases are evidence "
                "only and are deliberately outside the V1 atomic-complete bound."
            ),
        },
        "limitations": [
            "This standalone benchmark is a faithful composed resource model, not the production GuardianFreeze processor.",
            "The synthetic target Program is benchmark-owned and nonexecutable; production must validate the Loader-v3 owner and executable bit. These are constant-cost checks and must be included in the integrated rebenchmark.",
            "The observation PDA is preallocated. Any production instruction that creates it through System CPI must be remeasured; the selected bound reserves at least 550,000 CU for integration work.",
            "It does not prove semantic correctness of the production schema, digest, state transition, or failure atomicity.",
            "A ProgramData account above the selected bound must skip the raw hash, record incomplete evidence, and remain fail closed for ResumeWithoutUpgrade.",
            "The full production GuardianFreeze and failure-observation SBF instructions must be remeasured after integration.",
        ],
        "source_sha256": {
            str(path.relative_to(repo_root)).replace("\\", "/"): sha256(path)
            for path in source_files
        },
        "commands": [
            "cargo fmt --manifest-path benchmarks/guardian_raw_hash_sbf/Cargo.toml -- --check",
            "cargo clippy --manifest-path benchmarks/guardian_raw_hash_sbf/Cargo.toml --locked --offline --lib --tests -- -D warnings",
            "cargo-build-sbf --manifest-path benchmarks/guardian_raw_hash_sbf/Cargo.toml --arch v0 --tools-version v1.53 --sbf-out-dir <fresh>/v0/sbf-out -- --locked --offline",
            "cargo test --manifest-path benchmarks/guardian_raw_hash_sbf/Cargo.toml --locked --offline --test actual_sbf -- --nocapture --test-threads=1 (BPF_OUT_DIR=<fresh>/v0/sbf-out)",
            "cargo-build-sbf --manifest-path benchmarks/guardian_raw_hash_sbf/Cargo.toml --arch v2 --tools-version v1.53 --sbf-out-dir <fresh>/v2/sbf-out -- --locked --offline",
            "cargo test --manifest-path benchmarks/guardian_raw_hash_sbf/Cargo.toml --locked --offline --test actual_sbf -- --nocapture --test-threads=1 (BPF_OUT_DIR=<fresh>/v2/sbf-out)",
        ],
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
