#!/usr/bin/env bash
# Script 4 - run the service test suite from the deployed release.
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  printf 'rea service: refusing to run as root\n' >&2
  exit 1
fi

REA_RUNTIME_ROOT="${REA_RUNTIME_ROOT:-/mnt/rea}"
case "$REA_RUNTIME_ROOT" in
  /mnt/rea | /mnt/rea/)
    ;;
  *)
    printf 'rea service: refusing runtime root outside /mnt/rea: %s\n' \
      "$REA_RUNTIME_ROOT" >&2
    exit 1
    ;;
esac

ROOT="${REA_RUNTIME_ROOT%/}"
CURRENT="${ROOT}/current"

if [ ! -d "$CURRENT" ]; then
  printf 'rea service: no deployed release at %s\n' "$CURRENT" >&2
  exit 1
fi

if ! node -e 'const v=process.versions.node.split(".").map(Number);const ok=v[0]>22||(v[0]===22&&(v[1]>23||(v[1]===23&&v[2]>=4)))||v[0]===24||v[0]>=26;process.exit(ok?0:1)'; then
  printf 'rea service: node >=22.23.4 is required, found %s\n' \
    "$(node -v)" >&2
  exit 1
fi

cd -- "$CURRENT"
exec npm run test:service
