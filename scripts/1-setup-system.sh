#!/usr/bin/env bash
# Script 1 - create the user-owned REA runtime tree under /mnt/ai/rea.
# Never runs as root, uses no privileged wrapper, and creates only paths inside
# the runtime root the service declares.
set -euo pipefail

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
for directory in releases current env state logs; do
  target="${ROOT}/${directory}"
  mkdir -p -- "$target"
  chmod 750 -- "$target"
  printf 'rea service: ready %s\n' "$target"
done

printf 'rea service: runtime tree under %s is owned by %s\n' \
  "$ROOT" "$(id -un)"
