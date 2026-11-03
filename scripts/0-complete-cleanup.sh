#!/usr/bin/env bash
# Script 0 - complete cleanup of the REA standalone service runtime tree.
# Wipes only the declared service runtime directories under /mnt/ai/rea.
# Refuses to run as root and refuses any target outside /mnt/ai/rea.
# Always inspect the plan with --dry-run first.
set -euo pipefail

DRY_RUN=0
case "${1:-}" in
  --dry-run)
    DRY_RUN=1
    ;;
  "")
    ;;
  *)
    printf 'rea service: usage: %s [--dry-run]\n' "$0" >&2
    exit 2
    ;;
esac

if [ "$(id -u)" -eq 0 ]; then
  printf 'rea service: refusing to run as root\n' >&2
  exit 1
fi

REA_RUNTIME_ROOT="${REA_RUNTIME_ROOT:-/mnt/ai/rea}"
case "$REA_RUNTIME_ROOT" in
  /mnt/ai/rea | /mnt/ai/rea/)
    ;;
  *)
    printf 'rea service: refusing runtime root outside /mnt/ai/rea: %s\n' \
      "$REA_RUNTIME_ROOT" >&2
    exit 1
    ;;
esac

ROOT="${REA_RUNTIME_ROOT%/}"
TARGETS=(
  "${ROOT}/releases"
  "${ROOT}/current"
  "${ROOT}/env"
  "${ROOT}/state"
)

for target in "${TARGETS[@]}"; do
  case "$target" in
    /mnt/ai/rea/*)
      ;;
    *)
      printf 'rea service: refusing target outside /mnt/ai/rea: %s\n' "$target" >&2
      exit 1
      ;;
  esac
  if [ "$DRY_RUN" -eq 1 ]; then
    printf 'rea service: dry run, would remove %s\n' "$target"
    continue
  fi
  if [ -e "$target" ] || [ -L "$target" ]; then
    rm -rf -- "$target"
    printf 'rea service: removed %s\n' "$target"
  fi
done

if [ "$DRY_RUN" -eq 1 ]; then
  printf 'rea service: cleanup dry run complete, nothing was removed\n'
else
  printf 'rea service: cleanup complete\n'
fi
