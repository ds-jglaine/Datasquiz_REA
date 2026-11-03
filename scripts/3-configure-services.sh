#!/usr/bin/env bash
# Script 3 - write the service environment file under /mnt/rea/env.
# Loopback only: MCP stays stdio/local and no HTTP MCP binding is written.
set -euo pipefail

REA_PIN="c3647ade1e557c4179a8b825a37e0c2193cd2526"

if [ "$(id -u)" -eq 0 ]; then
  printf 'rea service: refusing to run as root\n' >&2
  exit 1
fi

if ! printf '%s' "$REA_PIN" | grep -Eq '^[0-9a-f]{40}$'; then
  printf 'rea service: refusing a non-commit pin: %s\n' "$REA_PIN" >&2
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
ENV_DIR="${ROOT}/env"
ENV_FILE="${ENV_DIR}/rea-service.env"
mkdir -p -- "$ENV_DIR"

umask 077
{
  printf 'REA_SERVICE_HOST=127.0.0.1\n'
  printf 'REA_SERVICE_PORT=4380\n'
  printf 'REA_RUNTIME_ROOT=%s\n' "$ROOT"
  printf 'REA_RELEASE_COMMIT=%s\n' "$REA_PIN"
  printf 'REA_MCP_TRANSPORT=stdio\n'
  printf 'MCP_HOST=127.0.0.1\n'
} > "$ENV_FILE"
chmod 600 -- "$ENV_FILE"

printf 'rea service: wrote %s\n' "$ENV_FILE"
