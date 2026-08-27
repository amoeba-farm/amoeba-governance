#!/usr/bin/env bash
set -euo pipefail

benchmark_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$benchmark_dir/../.." && pwd)"
run_root="$(mktemp -d /tmp/ameba-guardian-raw-hash-sbf.XXXXXXXX)"
elf_name="ameba_guardian_raw_hash_sbf_benchmark.so"
platform_tools="${HOME}/.cache/solana/v1.53/platform-tools/llvm/bin"
evidence_out="${AMOEBA_BENCH_EVIDENCE_OUT:-}"

if [[ "$(uname -s)" != "Linux" ]]; then
    echo "This benchmark must run through the pinned Linux/WSL SBF path." >&2
    exit 1
fi
if [[ ! -x "$platform_tools/llvm-objdump" ]]; then
    echo "Pinned platform-tools v1.53 llvm-objdump is unavailable." >&2
    exit 1
fi

export PATH="${HOME}/.cargo/bin:${HOME}/.local/share/solana/install/active_release/bin:${PATH}"
export CARGO_NET_OFFLINE=true
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

cargo fmt --manifest-path "$benchmark_dir/Cargo.toml" -- --check
export CARGO_TARGET_DIR="$run_root/host-target"
cargo clippy \
    --manifest-path "$benchmark_dir/Cargo.toml" \
    --locked \
    --offline \
    --lib \
    --tests \
    -- \
    -D warnings

for arch in v0 v2; do
    arch_root="$run_root/$arch"
    mkdir -p "$arch_root/sbf-out" "$arch_root/sbf-target"
    export CARGO_TARGET_DIR="$arch_root/sbf-target"
    cargo-build-sbf \
        --manifest-path "$benchmark_dir/Cargo.toml" \
        --arch "$arch" \
        --tools-version v1.53 \
        --sbf-out-dir "$arch_root/sbf-out" \
        -- --locked --offline 2>&1 | tee "$arch_root/build.log"

    if [[ "$arch" == "v0" ]]; then
        unstripped="$arch_root/sbf-target/sbpf-solana-solana/release/$elf_name"
    else
        unstripped="$arch_root/sbf-target/sbpfv2-solana-solana/release/$elf_name"
    fi
    test -f "$unstripped"
    test -f "$arch_root/sbf-out/$elf_name"
    cp "$unstripped" "$arch_root/unstripped.so"
    "$platform_tools/llvm-objdump" \
        --disassemble \
        --no-show-raw-insn \
        "$arch_root/unstripped.so" > "$arch_root/disassembly.txt"
    readelf --wide --symbols "$arch_root/sbf-out/$elf_name" > "$arch_root/symbols.txt"

    export CARGO_TARGET_DIR="$run_root/host-target"
    export BPF_OUT_DIR="$arch_root/sbf-out"
    export SBF_OUT_DIR="$arch_root/sbf-out"
    export AMOEBA_BENCH_ARCH="$arch"
    cargo test \
        --manifest-path "$benchmark_dir/Cargo.toml" \
        --locked \
        --offline \
        --test actual_sbf \
        -- --nocapture --test-threads=1 2>&1 | tee "$arch_root/test.log"
done

python3 "$benchmark_dir/summarize_benchmark.py" "$run_root" "$repo_root" \
    > "$run_root/evidence.json"
python3 -m json.tool "$run_root/evidence.json" > "$run_root/evidence.pretty.json"
if [[ -n "$evidence_out" ]]; then
    mkdir -p "$(dirname "$evidence_out")"
    cp "$run_root/evidence.pretty.json" "$evidence_out"
fi
echo "$run_root/evidence.pretty.json"
