#!/usr/bin/env python3
"""Summarize the actual-controller-SBF ProgramData chunk candidate matrix."""

from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path


CANDIDATE_BYTES = [16_384, 32_768, 65_536, 131_072]
SELECTED_BYTES = 16_384
CONSERVATIVE_CEILING = 200_000
TRANSACTION_LIMIT = 1_400_000
EXPECTED_ENVELOPE_UNITS = 300
DETERMINISM_SAMPLES = 2
EXPECTED_FRAME_DIAGNOSTICS = {"v0": 16, "v2": 0}
FRAME_DIAGNOSTIC = re.compile(
    r"Error: Function\s+(\S+)\s+overflows the maximum allowed frame space"
)
UNSAFE_DIAGNOSTICS = (
    "Stack offset of ",
    "overwrites values in the frame",
    "call overwrites the frame",
)


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def text(path: Path) -> str:
    return path.read_text(encoding="utf-8", errors="replace")


def linked_stack_metric(arch: str, disassembly: str) -> dict[str, int | str]:
    values: list[int] = []
    if arch == "v0":
        values = [int(value, 16) for value in re.findall(r"\[r10 - 0x([0-9a-f]+)\]", disassembly)]
        method = "max_r10_direct_offset"
    else:
        values = [int(value, 16) for value in re.findall(r"add64 r10, -0x([0-9a-f]+)", disassembly)]
        method = "dynamic_frame_prologue"
    if not values:
        raise RuntimeError(f"{arch} linked stack metric missing")
    maximum = max(values)
    return {
        "method": method,
        "linked_elf_max_frame_or_offset_bytes": maximum,
        "sbf_frame_limit_bytes": 4096,
        "linked_elf_margin_bytes": 4096 - maximum,
    }


def main() -> None:
    if len(sys.argv) != 3:
        raise SystemExit("usage: summarize_benchmark.py RUN_ROOT REPO_ROOT")
    run_root = Path(sys.argv[1]).resolve()
    repo_root = Path(sys.argv[2]).resolve()
    source_files = [
        repo_root / "programs" / "upgrade_controller" / "Cargo.toml",
        repo_root / "programs" / "upgrade_controller" / "src" / "release1_ceremony_state.rs",
        repo_root / "programs" / "upgrade_controller" / "tests" / "programdata_observation_chunk_sbf.rs",
        repo_root / "benchmarks" / "programdata_observation_chunk_controller_sbf" / "run-benchmark.sh",
        repo_root / "benchmarks" / "programdata_observation_chunk_controller_sbf" / "summarize_benchmark.py",
        repo_root / ".github" / "workflows" / "governance-trust-root.yml",
    ]
    architectures: dict[str, dict[str, object]] = {}
    all_measurements: list[dict[str, object]] = []
    for arch in ("v0", "v2"):
        arch_root = run_root / arch
        build_log = text(arch_root / "build.log")
        test_log = text(arch_root / "test.log")
        linked_symbols = text(arch_root / "linked-symbols.txt")
        measurements = [
            json.loads(match)
            for match in re.findall(
                r"^AMOEBA_PROGRAMDATA_OBSERVATION_CHUNK_MATRIX_SBF_EVIDENCE=(\{.*\})$",
                test_log,
                re.MULTILINE,
            )
        ]
        if [int(item["chunk_size"]) for item in measurements] != CANDIDATE_BYTES:
            raise RuntimeError(f"{arch} did not emit the complete ordered candidate matrix")
        if any(item["execution"] != "actual_controller_sbf_programtest" for item in measurements):
            raise RuntimeError(f"{arch} did not execute the actual controller SBF")
        if any(item["sbpf_target"] != arch for item in measurements):
            raise RuntimeError(f"{arch} evidence target mismatch")
        if any(not item["test_only_feature"] for item in measurements):
            raise RuntimeError(f"{arch} evidence omitted the test-only feature marker")
        if any(int(item["compute_limit"]) != TRANSACTION_LIMIT for item in measurements):
            raise RuntimeError(f"{arch} compute limit drifted")
        if any(
            int(item["runtime_default_instruction_compute_limit"])
            != CONSERVATIVE_CEILING
            for item in measurements
        ):
            raise RuntimeError(f"{arch} runtime default compute limit drifted")
        if any(int(item["units_consumed"]) >= TRANSACTION_LIMIT for item in measurements):
            raise RuntimeError(f"{arch} candidate exhausted the transaction compute limit")
        if len({item["controller_elf_sha256"] for item in measurements}) != 1:
            raise RuntimeError(f"{arch} evidence did not use one exact controller ELF")
        frame_symbols = FRAME_DIAGNOSTIC.findall(build_log)
        linked_frame_symbols = [symbol for symbol in frame_symbols if symbol in linked_symbols]
        if len(frame_symbols) != EXPECTED_FRAME_DIAGNOSTICS[arch]:
            raise RuntimeError(f"{arch} frame diagnostic count drifted")
        if linked_frame_symbols:
            raise RuntimeError(f"{arch} diagnostic symbols reached the linked ELF")
        if any(phrase in build_log for phrase in UNSAFE_DIAGNOSTICS):
            raise RuntimeError(f"{arch} emitted a caller-frame or stack-offset diagnostic")
        artifact = arch_root / "sbf-out" / "upgrade_controller.so"
        for item in measurements:
            full_samples = [int(value) for value in item["full_transaction_units_samples"]]
            controller_samples = [int(value) for value in item["controller_units_samples"]]
            if (
                int(item["determinism_samples"]) != DETERMINISM_SAMPLES
                or len(full_samples) != DETERMINISM_SAMPLES
                or len(controller_samples) != DETERMINISM_SAMPLES
                or len(set(full_samples)) != 1
                or len(set(controller_samples)) != 1
                or full_samples[0] != int(item["units_consumed"])
                or controller_samples[0] != int(item["controller_units_consumed"])
            ):
                raise RuntimeError(f"{arch} candidate was not compute-deterministic")
            envelope_units = int(item["compute_budget_envelope_units"])
            if (
                envelope_units != EXPECTED_ENVELOPE_UNITS
                or int(item["controller_units_consumed"]) + envelope_units
                != int(item["units_consumed"])
            ):
                raise RuntimeError(f"{arch} candidate envelope overhead drifted")
            within_conservative_ceiling = (
                int(item["units_consumed"]) <= CONSERVATIVE_CEILING
            )
            if bool(item["within_conservative_ceiling"]) != within_conservative_ceiling:
                raise RuntimeError(f"{arch} candidate resource classification drifted")
            item["compute_usage_basis_points"] = round(
                int(item["units_consumed"]) * 10_000 / TRANSACTION_LIMIT
            )
            item["runtime_default_margin_basis_points"] = round(
                int(item["default_budget_margin_units"])
                * 10_000
                / CONSERVATIVE_CEILING
            )
            item["conservative_compute_gate"] = (
                "pass" if within_conservative_ceiling else "reject"
            )
            item["candidate_admission"] = (
                "selected_release1"
                if int(item["chunk_size"]) == SELECTED_BYTES
                else "measurement_only_rejected_by_normal_schema"
            )
        architectures[arch] = {
            "elf": {"bytes": artifact.stat().st_size, "sha256": sha256(artifact)},
            "measurements": measurements,
            "stack": linked_stack_metric(arch, text(arch_root / "disassembly.txt")),
            "build_diagnostics": {
                "compiler_frame_diagnostic_count": len(frame_symbols),
                "diagnostic_symbols_absent_from_linked_elf": len(frame_symbols),
                "diagnostic_symbols_present_in_linked_elf": linked_frame_symbols,
                "caller_frame_or_stack_offset_diagnostic_count": 0,
                "linked_elf_safe": True,
            },
        }
        all_measurements.extend(measurements)

    selected = [item for item in all_measurements if int(item["chunk_size"]) == SELECTED_BYTES]
    selected_by_arch = {
        arch: next(
            item
            for item in architectures[arch]["measurements"]
            if int(item["chunk_size"]) == SELECTED_BYTES
        )
        for arch in ("v0", "v2")
    }
    selected_passes = (
        len(selected) == 2
        and max(int(item["units_consumed"]) for item in selected) <= CONSERVATIVE_CEILING
    )
    if not selected_passes:
        raise RuntimeError("selected 16 KiB case exceeded its conservative ceiling")

    result = {
        "schema": "ameba-programdata-observation-chunk-controller-sbf-matrix-v1",
        "generated_at_utc": datetime.now(timezone.utc).isoformat(),
        "base_commit": text(run_root / "git-head.txt").strip(),
        "worktree_status_at_start": text(run_root / "git-status.txt").splitlines(),
        "environment": {
            "rustc": text(run_root / "rustc-version.txt").strip(),
            "cargo_build_sbf": text(run_root / "cargo-build-sbf-version.txt").strip(),
            "program_test": "2.3.13",
            "platform_tools": "v1.53",
            "host": text(run_root / "uname.txt").strip(),
            "network_or_rpc_used": False,
        },
        "benchmark_contract": {
            "production_instruction": "AppendProgramDataObservationChunkV1 (tag 40)",
            "execution": "actual checked controller SBF loaded through Loader-v3 Program/ProgramData accounts",
            "raw_programdata_length": 10_485_760,
            "candidate_chunk_sizes": CANDIDATE_BYTES,
            "measured_step": "full chunk at the highest real index producing the maximum power-of-two frontier merge depth",
            "test_only_feature": "programdata-observation-chunk-matrix",
            "instruction_or_account_abi_changed": False,
            "normal_release_schema_selected_chunk_bytes": SELECTED_BYTES,
        },
        "selection_gates": {
            "conservative_chunk_compute_ceiling": CONSERVATIVE_CEILING,
            "transaction_compute_limit": TRANSACTION_LIMIT,
            "measurement_compute_budget_instruction_limit": TRANSACTION_LIMIT,
            "runtime_default_single_nonbuiltin_instruction_limit": CONSERVATIVE_CEILING,
            "canonical_compute_budget_envelope_units": EXPECTED_ENVELOPE_UNITS,
            "determinism_samples_per_candidate": DETERMINISM_SAMPLES,
            "actual_controller_sbf_required_for": ["v0", "v2"],
            "linked_compiler_frame_or_caller_overlap_allowed": False,
        },
        "architectures": architectures,
        "decision": {
            "selected_release1_chunk_bytes": SELECTED_BYTES,
            "selected_case_passes": selected_passes,
            "max_selected_compute_units": max(int(item["units_consumed"]) for item in selected),
            "min_selected_compute_margin_units": min(int(item["compute_margin"]) for item in selected),
            "selected_runtime_default_margin": {
                arch: {
                    "units": int(item["default_budget_margin_units"]),
                    "basis_points": int(item["runtime_default_margin_basis_points"]),
                }
                for arch, item in selected_by_arch.items()
            },
            "all_candidate_measurements_present": len(all_measurements) == 8,
            "conservative_compute_gate_pass_sizes": sorted(
                {
                    int(item["chunk_size"])
                    for item in all_measurements
                    if int(item["units_consumed"]) <= CONSERVATIVE_CEILING
                }
            ),
            "conservative_compute_gate_rejected_sizes": sorted(
                {
                    int(item["chunk_size"])
                    for item in all_measurements
                    if int(item["units_consumed"]) > CONSERVATIVE_CEILING
                }
            ),
            "nonselected_candidates_remain_rejected": True,
            "current_policy_adjustment_required": False,
            "production_selection_assessment": "conditional_on_exact_pinned_runtime_elf_and_preceremony_remeasurement",
            "reason": "The comparative matrix closes measurement coverage without changing consensus. The selected 16 KiB case fits the pinned runtime's 200,000-CU default on both engines, but the v2 full-transaction margin is narrow and is not characterized as generous. Every larger candidate exceeds the current default and remains rejected by the normal Release 1 capacity-policy validator. No policy adjustment is required for this exact artifact; any controller or runtime drift must be remeasured, and increasing the admitted budget would require a separate reviewed policy decision.",
        },
        "source_sha256": {
            str(path.relative_to(repo_root)).replace("\\", "/"): sha256(path)
            for path in source_files
        },
        "commands": [
            "cargo fmt --all -- --check",
            "cargo clippy --locked -p upgrade_controller --features programdata-observation-chunk-matrix --lib --test programdata_observation_chunk_sbf -- -D warnings",
            "cargo-build-sbf --manifest-path programs/upgrade_controller/Cargo.toml --arch <v0|v2> --tools-version v1.53 --sbf-out-dir <fresh> -- --locked --features programdata-observation-chunk-matrix",
            "python3 scripts/analyze-sbpf-diagnostics.py --arch <v0|v2> --log <fresh>/build.log --symbols <fresh>/linked-symbols.txt",
            "cargo test --locked -p upgrade_controller --features programdata-observation-chunk-matrix --test programdata_observation_chunk_sbf actual_controller_sbf_programdata_observation_chunk_matrix -- --ignored --exact --nocapture --test-threads=1",
        ],
    }
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()
