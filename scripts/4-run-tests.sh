#!/usr/bin/env bash
# Script 4 - run the service test suite from the deployed release.
# The service runs in a container in the AI stack, so the suite runs on that
# same runtime: node 22.23.4 from the pinned image below, named by digest and
# never by a floating tag. A host node that already satisfies the packaged
# engines floor is used directly; anything else runs in the pinned image so a
# release test never fails on EBADENGINE.
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
CURRENT="${ROOT}/current"

if [ ! -d "$CURRENT" ]; then
  printf 'rea service: no deployed release at %s\n' "$CURRENT" >&2
  exit 1
fi

# The pinned test image resolves to node v22.23.4, which satisfies ^22.23.4 in
# package.json engines. The sha256 digest makes the image immutable; the
# printed digest is the readback evidence for the release.
REA_TEST_IMAGE="${REA_TEST_IMAGE:-node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914}"
REA_TEST_MOUNT="/w"
REA_TEST_ENGINE="${REA_TEST_ENGINE:-}"

# Match the packaged engines range exactly:
# ^22.23.4 || ^24.22.1 || >=26.12.1.
node_satisfies_floor() {
  node -e '
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    const atLeast = (wantMajor, wantMinor, wantPatch) =>
      major > wantMajor ||
      (major === wantMajor &&
        (minor > wantMinor ||
          (minor === wantMinor && patch >= wantPatch)));
    const ok =
      (major === 22 && atLeast(22, 23, 4)) ||
      (major === 24 && atLeast(24, 22, 1)) ||
      atLeast(26, 12, 1);
    process.exit(ok ? 0 : 1);
  '
}

if node_satisfies_floor; then
  cd -- "$CURRENT"
  exec npm run test:service
fi

if [ -z "$REA_TEST_ENGINE" ]; then
  for candidate in docker podman; do
    if command -v "$candidate" >/dev/null 2>&1; then
      REA_TEST_ENGINE="$candidate"
      break
    fi
  done
fi

if [ -z "$REA_TEST_ENGINE" ]; then
  printf 'rea service: host node %s does not satisfy the packaged engines floor and no container engine is available; provide docker or podman and the pinned image %s\n' \
    "$(node -v 2>/dev/null || printf 'missing')" "$REA_TEST_IMAGE" >&2
  exit 1
fi

printf 'rea service: host node %s does not satisfy the engines floor; running the suite in %s\n' \
  "$(node -v 2>/dev/null || printf 'missing')" "$REA_TEST_IMAGE"
printf 'rea service: image digest %s\n' "${REA_TEST_IMAGE##*@}"

# The suite's pin assertions read Git history and the scripts need bash; the
# image ships neither, so the ephemeral container installs both and then runs
# the install and the suite as the invoking user. Only the release mount is
# persistent; the home and npm cache live in the container and disappear with
# --rm.
"$REA_TEST_ENGINE" run --rm \
  --volume "${CURRENT}:${REA_TEST_MOUNT}" \
  --workdir "$REA_TEST_MOUNT" \
  --env "REA_TEST_UID=$(id -u)" \
  --env "REA_TEST_GID=$(id -g)" \
  "$REA_TEST_IMAGE" sh -s <<'CONTAINER'
set -eu
apk add --no-cache git bash >/dev/null 2>&1
addgroup -g "$REA_TEST_GID" rea-host 2>/dev/null || true
adduser -D -u "$REA_TEST_UID" -G rea-host rea-host 2>/dev/null || true
su rea-host -s /bin/sh -c 'cd /w && HOME=/tmp npm ci --no-audit --no-fund && npm run test:service'
CONTAINER
