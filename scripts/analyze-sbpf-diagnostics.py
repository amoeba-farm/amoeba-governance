#!/usr/bin/env python3
"""Fail closed on controller/reachable SBPF frame diagnostics."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path


EXPECTED_DEPENDENCY_FRAME_DIAGNOSTICS = {"v0": 16, "v2": 0}
ALLOWED_V0_SYMBOL_FRAGMENTS = ("hybrid_array", "crypto_common")
FRAME_DIAGNOSTIC = re.compile(
    r"Error: Function\s+(\S+)\s+overflows the maximum allowed frame space"
)
ANY_FUNCTION_ERROR = re.compile(r"Error: Function\s+(\S+)")
UNSAFE_DIAGNOSTICS = (
    "Stack offset of ",
    "overwrites values in the frame",
    "call overwrites the frame",
)


def fail(message: str) -> None:
    print(f"SBPF diagnostic analysis failed: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--arch", choices=("v0", "v2"), required=True)
    parser.add_argument("--log", type=Path, required=True)
    parser.add_argument("--symbols", type=Path, required=True)
    args = parser.parse_args()

    log = args.log.read_text(encoding="utf-8", errors="replace")
    symbols = args.symbols.read_text(encoding="utf-8", errors="replace")
    frame_symbols = FRAME_DIAGNOSTIC.findall(log)
    all_function_errors = ANY_FUNCTION_ERROR.findall(log)

    if len(all_function_errors) != len(frame_symbols):
        fail("an unclassified `Error: Function` diagnostic was emitted")
    expected = EXPECTED_DEPENDENCY_FRAME_DIAGNOSTICS[args.arch]
    if len(frame_symbols) != expected:
        fail(
            f"{args.arch} emitted {len(frame_symbols)} frame diagnostics; "
            f"expected exactly {expected} under the pinned toolchain"
        )

    for phrase in UNSAFE_DIAGNOSTICS:
        if phrase in log:
            fail(f"unsafe caller/stack diagnostic contains `{phrase}`")

    if args.arch == "v0":
        for symbol in frame_symbols:
            if not any(fragment in symbol for fragment in ALLOWED_V0_SYMBOL_FRAGMENTS):
                fail(f"unexpected v0 frame diagnostic symbol `{symbol}`")
            if symbol in symbols:
                fail(f"diagnostic symbol is present in the final linked ELF: `{symbol}`")

    if any("upgrade_controller" in symbol for symbol in all_function_errors):
        fail("controller-owned function emitted a frame diagnostic")

    print(
        f"SBPF {args.arch} diagnostic analysis passed: "
        f"{len(frame_symbols)} pinned dependency-only frame diagnostics"
    )


if __name__ == "__main__":
    main()
