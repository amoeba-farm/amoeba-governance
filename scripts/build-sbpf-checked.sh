#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 2 ]]; then
  echo "usage: $0 <v0|v2> <fresh-output-root>" >&2
  exit 64
fi

arch="$1"
output_root="$2"
if [[ "$arch" != "v0" && "$arch" != "v2" ]]; then
  echo "architecture must be v0 or v2" >&2
  exit 64
fi

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
run_root="$output_root/$arch"
if [[ -e "$run_root" ]]; then
  echo "refusing non-fresh SBPF output path: $run_root" >&2
  exit 64
fi

mkdir -p "$run_root/deploy" "$run_root/target"
export CARGO_TARGET_DIR="$run_root/target"
export CARGO_TERM_COLOR=never

set +e
cargo-build-sbf \
  --manifest-path "$repo_root/programs/upgrade_controller/Cargo.toml" \
  --arch "$arch" \
  --tools-version v1.53 \
  --sbf-out-dir "$run_root/deploy" \
  2>&1 | tee "$run_root/build.log"
build_status=${PIPESTATUS[0]}
set -e
if [[ $build_status -ne 0 ]]; then
  echo "cargo-build-sbf failed for $arch with status $build_status" >&2
  exit "$build_status"
fi

artifact="$run_root/deploy/upgrade_controller.so"
if [[ ! -f "$artifact" ]]; then
  echo "missing SBPF artifact: $artifact" >&2
  exit 1
fi

readelf --wide --symbols "$artifact" > "$run_root/elf-symbols.txt"
python3 "$repo_root/scripts/analyze-sbpf-diagnostics.py" \
  --arch "$arch" \
  --log "$run_root/build.log" \
  --symbols "$run_root/elf-symbols.txt"

artifact_bytes="$(stat --format=%s "$artifact")"
artifact_sha256="$(sha256sum "$artifact" | cut -d ' ' -f 1)"
printf 'arch=%s\nartifact=%s\nartifact_bytes=%s\nartifact_sha256=%s\n' \
  "$arch" "$artifact" "$artifact_bytes" "$artifact_sha256" \
  | tee "$run_root/receipt.txt"
