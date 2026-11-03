#!/usr/bin/env bash
# Script 2 - deploy the REA release at the exact pinned commit.
# The pin is the full 40 character service release commit recorded once in
# .datasquiz/service-identity.json; tags, branches and loose copies are refused.
set -euo pipefail

REPO_ROOT="$(dirname -- "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)")"
REA_REPOSITORY="git@github.com:ds-jglaine/Datasquiz_REA.git"
REQUIRED_RELEASE_PATHS=(
  server.js
  tests/service
  .datasquiz/service-identity.json
)

# The one exact pin. Scripts 2 and 3 read it from the same recorded release
# commit through the same module, so the checkout and the environment cannot
# drift apart.
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

# Refuse to report success for a release that cannot run the service: this is
# the check that the c3647ade pin skipped while script 2 exited 0.
for required in "${REQUIRED_RELEASE_PATHS[@]}"; do
  if [ ! -e "${RELEASE_DIR}/${required}" ]; then
    printf 'rea service: pinned release %s has no %s; refusing an unusable release\n' \
      "$HEAD_SHA" "$required" >&2
    exit 1
  fi
done
if [ -z "$(find "${RELEASE_DIR}/tests/service" -type f -name '*.test.ts' -print -quit)" ]; then
  printf 'rea service: pinned release %s carries no tests/service suite\n' \
    "$HEAD_SHA" >&2
  exit 1
fi

# Record the commit this deploy checked out in the packaged identity, so the
# release, the checked-in contract and the script 3 environment name the same
# service release commit and readiness does not report release_pin_mismatch.
RELEASE_IDENTITY="${RELEASE_DIR}/.datasquiz/service-identity.json"
STAMPED_COMMIT="$(node --input-type=module -e '
  const [moduleUrl, path, commit] = process.argv.slice(1);
  const { readFileSync, writeFileSync } = await import("node:fs");
  const { stampServiceIdentity } = await import(moduleUrl);
  const identity = JSON.parse(readFileSync(path, "utf8"));
  const next = stampServiceIdentity(identity, commit);
  writeFileSync(path, JSON.stringify(next, null, 2) + "\n");
  process.stdout.write(next.commit);
' "file://${REPO_ROOT}/api/service.js" "$RELEASE_IDENTITY" "$HEAD_SHA")"

if [ "$STAMPED_COMMIT" != "$HEAD_SHA" ]; then
  printf 'rea service: could not record %s in %s\n' \
    "$HEAD_SHA" "$RELEASE_IDENTITY" >&2
  exit 1
fi

if [ -L "${ROOT}/current" ] || [ -e "${ROOT}/current" ]; then
  rm -rf -- "${ROOT}/current"
fi
ln -s -- "$RELEASE_DIR" "${ROOT}/current"

printf 'rea service: deployed %s at %s\n' "$RELEASE_DIR" "$HEAD_SHA"
