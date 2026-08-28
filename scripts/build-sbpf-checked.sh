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
if [[ -n "$(git -C "$repo_root" status --porcelain=v1 --untracked-files=all)" ]]; then
  echo "refusing to attest SBPF from a dirty source worktree" >&2
  exit 64
fi
source_commit="$(git -C "$repo_root" rev-parse HEAD)"
source_tree="$(git -C "$repo_root" rev-parse HEAD^{tree})"
cargo_lock_sha256="$(sha256sum "$repo_root/Cargo.lock" | cut -d ' ' -f 1)"
run_root="$output_root/$arch"
if [[ -e "$run_root" ]]; then
  echo "refusing non-fresh SBPF output path: $run_root" >&2
  exit 64
fi

mkdir -p "$run_root/deploy" "$run_root/target"
export CARGO_TARGET_DIR="$run_root/target"
export CARGO_TERM_COLOR=never

printf 'source_commit=%s\nsource_tree=%s\ncargo_lock_sha256=%s\ncargo_target_dir=%s\ncommand=%s\n' \
  "$source_commit" \
  "$source_tree" \
  "$cargo_lock_sha256" \
  "$CARGO_TARGET_DIR" \
  "cargo-build-sbf --manifest-path programs/upgrade_controller/Cargo.toml --arch $arch --tools-version v1.53 --sbf-out-dir $run_root/deploy -- --locked" \
  | tee "$run_root/command.txt"

set +e
cargo-build-sbf \
  --manifest-path "$repo_root/programs/upgrade_controller/Cargo.toml" \
  --arch "$arch" \
  --tools-version v1.53 \
  --sbf-out-dir "$run_root/deploy" \
  -- --locked \
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

mapfile -t linked_candidates < <(
  find "$run_root/target" -type f -path '*/release/upgrade_controller.so' -print
)
if [[ ${#linked_candidates[@]} -ne 1 ]]; then
  printf 'expected exactly one unstripped linked ELF, found %s\n' "${#linked_candidates[@]}" >&2
  printf '%s\n' "${linked_candidates[@]}" >&2
  exit 1
fi
linked_artifact="${linked_candidates[0]}"

readelf --wide --symbols "$artifact" > "$run_root/deploy-elf-symbols.txt"
readelf --wide --symbols "$linked_artifact" > "$run_root/linked-elf-symbols.txt"
python3 "$repo_root/scripts/analyze-sbpf-diagnostics.py" \
  --arch "$arch" \
  --log "$run_root/build.log" \
  --symbols "$run_root/linked-elf-symbols.txt"

llvm_objcopy="$HOME/.cache/solana/v1.53/platform-tools/llvm/bin/llvm-objcopy"
if [[ ! -x "$llvm_objcopy" ]]; then
  echo "missing pinned SBF llvm-objcopy: $llvm_objcopy" >&2
  exit 1
fi
"$llvm_objcopy" --dump-section .text="$run_root/deploy-text.bin" "$artifact"
"$llvm_objcopy" --dump-section .text="$run_root/linked-text.bin" "$linked_artifact"
if ! cmp --silent "$run_root/deploy-text.bin" "$run_root/linked-text.bin"; then
  echo "deploy and unstripped linked .text sections differ" >&2
  exit 1
fi

artifact_bytes="$(stat --format=%s "$artifact")"
artifact_sha256="$(sha256sum "$artifact" | cut -d ' ' -f 1)"
linked_artifact_bytes="$(stat --format=%s "$linked_artifact")"
linked_artifact_sha256="$(sha256sum "$linked_artifact" | cut -d ' ' -f 1)"
printf 'arch=%s\nsource_commit=%s\nsource_tree=%s\ncargo_lock_sha256=%s\nlocked=true\nartifact=%s\nartifact_bytes=%s\nartifact_sha256=%s\nlinked_artifact=%s\nlinked_artifact_bytes=%s\nlinked_artifact_sha256=%s\ntext_sections_equal=true\n' \
  "$arch" "$source_commit" "$source_tree" "$cargo_lock_sha256" \
  "$artifact" "$artifact_bytes" "$artifact_sha256" \
  "$linked_artifact" "$linked_artifact_bytes" "$linked_artifact_sha256" \
  | tee "$run_root/receipt.txt"
