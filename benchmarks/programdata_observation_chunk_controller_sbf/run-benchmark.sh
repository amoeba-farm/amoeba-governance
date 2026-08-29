#!/usr/bin/env bash
set -euo pipefail

benchmark_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$benchmark_dir/../.." && pwd)"
run_root="$(mktemp -d /tmp/ameba-programdata-observation-chunk-matrix.XXXXXXXX)"
platform_tools="${HOME}/.cache/solana/v1.53/platform-tools/llvm/bin"
evidence_out="${AMOEBA_BENCH_EVIDENCE_OUT:-}"
feature="programdata-observation-chunk-matrix"

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This benchmark must run through the pinned Linux/WSL SBF path." >&2
    exit 1
fi
if [[ ! -x "$platform_tools/llvm-objdump" ]]; then
    echo "Pinned platform-tools v1.53 llvm-objdump is unavailable." >&2
    exit 1
fi

export PATH="${HOME}/.cargo/bin:${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
cd "$repo_root"

if git rev-parse HEAD > "$run_root/git-head.txt" 2>/dev/null; then
    git status --porcelain=v1 > "$run_root/git-status.txt"
elif [[ -n "${AMOEBA_BENCH_BASE_COMMIT:-}" ]]; then
    printf '%s\n' "$AMOEBA_BENCH_BASE_COMMIT" > "$run_root/git-head.txt"
    printf '%s\n' "git status unavailable from WSL Windows-linked worktree" \
        > "$run_root/git-status.txt"
else
    echo "Git metadata is unavailable; set AMOEBA_BENCH_BASE_COMMIT explicitly." >&2
    exit 1
fi
rustc --version > "$run_root/rustc-version.txt"
cargo-build-sbf --version > "$run_root/cargo-build-sbf-version.txt"
uname -a > "$run_root/uname.txt"

cargo fmt --all -- --check
export CARGO_TARGET_DIR="$run_root/host-target"
cargo clippy --locked -p upgrade_controller --features "$feature" \
    --lib --test programdata_observation_chunk_sbf -- -D warnings

for arch in v0 v2; do
    arch_root="$run_root/$arch"
    mkdir -p "$arch_root/sbf-out" "$arch_root/sbf-target"
    export CARGO_TARGET_DIR="$arch_root/sbf-target"
    cargo-build-sbf \
        --manifest-path "$repo_root/programs/upgrade_controller/Cargo.toml" \
        --arch "$arch" \
        --tools-version v1.53 \
        --sbf-out-dir "$arch_root/sbf-out" \
        -- --locked --features "$feature" 2>&1 | tee "$arch_root/build.log"

    mapfile -t linked_candidates < <(
        find "$arch_root/sbf-target" -type f \
            -path '*/release/upgrade_controller.so' -print
    )
    if [[ ${#linked_candidates[@]} -ne 1 ]]; then
        printf 'expected exactly one linked controller ELF, found %s\n' \
            "${#linked_candidates[@]}" >&2
        printf '%s\n' "${linked_candidates[@]}" >&2
        exit 1
    fi
    linked_artifact="${linked_candidates[0]}"
    test -f "$arch_root/sbf-out/upgrade_controller.so"
    cp "$linked_artifact" "$arch_root/unstripped.so"
    "$platform_tools/llvm-objdump" --disassemble --no-show-raw-insn \
        "$arch_root/unstripped.so" > "$arch_root/disassembly.txt"
    readelf --wide --symbols "$linked_artifact" > "$arch_root/linked-symbols.txt"
    python3 "$repo_root/scripts/analyze-sbpf-diagnostics.py" \
        --arch "$arch" \
        --log "$arch_root/build.log" \
        --symbols "$arch_root/linked-symbols.txt" \
        | tee "$arch_root/diagnostic-analysis.txt"

    export CARGO_TARGET_DIR="$run_root/host-target"
    export BPF_OUT_DIR="$arch_root/sbf-out"
    export AMOEBA_SBPF_TARGET="$arch"
    cargo test --locked -p upgrade_controller --features "$feature" \
        --test programdata_observation_chunk_sbf \
        actual_controller_sbf_programdata_observation_chunk_matrix \
        -- --ignored --exact --nocapture --test-threads=1 2>&1 \
        | tee "$arch_root/test.log"
done

python3 "$benchmark_dir/summarize_benchmark.py" "$run_root" "$repo_root" \
    > "$run_root/evidence.json"
python3 -m json.tool "$run_root/evidence.json" > "$run_root/evidence.pretty.json"
if [[ -n "$evidence_out" ]]; then
    mkdir -p "$(dirname "$evidence_out")"
    cp "$run_root/evidence.pretty.json" "$evidence_out"
fi
echo "$run_root/evidence.pretty.json"
