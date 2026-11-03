#!/usr/bin/env bash
# Script 2 - deploy the REA release at the exact pinned commit.
# The pin is a full 40 character commit; tags and branches are refused.
set -euo pipefail

REA_PIN="c3647ade1e557c4179a8b825a37e0c2193cd2526"
REA_REPOSITORY="git@github.com:ds-jglaine/Datasquiz_REA.git"

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
RELEASE_DIR="${ROOT}/releases/${REA_PIN}"

if [ ! -d "$RELEASE_DIR" ]; then
  mkdir -p -- "${ROOT}/releases"
  git clone --no-checkout "$REA_REPOSITORY" "$RELEASE_DIR"
fi

git -C "$RELEASE_DIR" fetch --depth 1 origin "$REA_PIN"
git -C "$RELEASE_DIR" -c advice.detachedHead=false checkout --detach "$REA_PIN"

HEAD_SHA="$(git -C "$RELEASE_DIR" rev-parse HEAD)"
if [ "$HEAD_SHA" != "$REA_PIN" ]; then
  printf 'rea service: pinned commit mismatch: %s is %s\n' \
    "$REA_PIN" "$HEAD_SHA" >&2
  exit 1
fi

if [ -L "${ROOT}/current" ] || [ -e "${ROOT}/current" ]; then
  rm -rf -- "${ROOT}/current"
fi
ln -s -- "$RELEASE_DIR" "${ROOT}/current"

printf 'rea service: deployed %s at %s\n' "$RELEASE_DIR" "$HEAD_SHA"
