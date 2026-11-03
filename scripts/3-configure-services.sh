#!/usr/bin/env bash
# Script 3 - write the service environment file under /mnt/ai/rea/env.
# The commit it records is the same recorded service release commit script 2
# deployed; a release that disagrees is refused.
# Loopback only: MCP stays stdio/local and no HTTP MCP binding is written.
set -euo pipefail

REPO_ROOT="$(dirname -- "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)")"

# The one exact pin: the service release commit recorded in
# .datasquiz/service-identity.json, read through the same module script 2 uses.
REA_PIN="$(node --input-type=module -e '
  const [moduleUrl, root] = process.argv.slice(1);
  const { readReleasePin } = await import(moduleUrl);
  process.stdout.write(readReleasePin(root));
' "file://${REPO_ROOT}/api/service.js" "$REPO_ROOT")"

if [ "$(id -u)" -eq 0 ]; then
  printf 'rea service: refusing to run as root\n' >&2
  exit 1
fi

if ! printf '%s' "$REA_PIN" | grep -Eq '^[0-9a-f]{40}$'; then
  printf 'rea service: refusing a non-commit pin: %s\n' "$REA_PIN" >&2
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
ENV_DIR="${ROOT}/env"
ENV_FILE="${ENV_DIR}/rea-service.env"

# The environment must describe the release that is actually deployed: a
# release recording a different commit would report release_pin_mismatch.
CURRENT_IDENTITY="${ROOT}/current/.datasquiz/service-identity.json"
if [ ! -f "$CURRENT_IDENTITY" ]; then
  printf 'rea service: %s is missing; run script 2 before script 3\n' \
    "$CURRENT_IDENTITY" >&2
  exit 1
fi
DEPLOYED_COMMIT="$(node -e '
  const [path] = process.argv.slice(1);
  const { readFileSync } = require("node:fs");
  process.stdout.write(String(JSON.parse(readFileSync(path, "utf8")).commit || ""));
' "$CURRENT_IDENTITY")"
if [ "$DEPLOYED_COMMIT" != "$REA_PIN" ]; then
  printf 'rea service: %s records %s, pin is %s; run script 2 first\n' \
    "$CURRENT_IDENTITY" "$DEPLOYED_COMMIT" "$REA_PIN" >&2
  exit 1
fi

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
