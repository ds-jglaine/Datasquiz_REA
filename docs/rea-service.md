# REA standalone service

The Datasquiz fork of REA (`ds-jglaine/Datasquiz_REA`, upstream `morluto/rea`,
MIT) is consumed unchanged. This service adds a thin, non-root HTTP shell around
the packaged CLI/MCP entry point `scripts/rea.mjs` so the AI stack can verify
readiness before the node is admitted.

## Pinned release

| Item                   | Value                                                          |
| ---------------------- | -------------------------------------------------------------- |
| Package                | `rea-agents`                                                   |
| Version                | `6.8.0`                                                        |
| Service release commit | `3aead6e91abe181e8df1ecb5da368031c50654f5`                     |
| Upstream base commit   | `c3647ade1e557c4179a8b825a37e0c2193cd2526`                     |
| Authority checkout     | `/mnt/ai/source/Datasquiz_REA` on `gpu2.datasquiz.net`         |
| Repository             | `ds-jglaine/Datasquiz_REA`                                     |
| Upstream               | `morluto/rea`                                                  |
| Node engines floor     | `^22.23.4 \|\| ^24.22.1 \|\| >=26.12.1`                        |
| Runtime root           | `/mnt/ai/rea` (the only accepted root)                         |
| Public host            | `rea.ai.datasquiz.net` (tenant AI Caddy, owned by DE-450)      |
| Scope                  | `ai_node`                                                      |
| Transport              | `stdio`                                                        |
| Listen address         | `127.0.0.1:4380` (loopback only)                               |
| Readiness              | `GET /health`                                                  |
| Splash                 | `GET /`                                                        |
| Dev page               | `/platform/rea-service/`                                       |
| Test runtime image     | `node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914` (node `22.23.4`) |

The service runs as a container in the AI stack; the tenant Caddy route and the
compose service are DE-450's, and this repository never installs a unit or
opens the public edge. The suite runs on the same runtime as the service: the
pinned `node:22-alpine` digest above resolves to node `22.23.4`, which satisfies
the packaged `^22.23.4` engine, so a release test never fails on `EBADENGINE`.
Because the image is named by digest, a refreshed tag cannot change what the
release was tested on.

The pin is one full 40 character service release commit, recorded once in
`.datasquiz/service-identity.json` (`commit`) and mirrored in
`.datasquiz/documentation.json`, `deployment/operations.json` and this page.
Scripts 2 and 3 do not carry their own copy: both read the recorded commit
through `readReleasePin` in `api/service.js`, so the checkout and the
environment they write cannot drift apart. The recorded commit is the re-target
commit itself, so its tree already carries `/mnt/ai/rea` in
`api/service.js`; the upstream base commit
`c3647ade1e557c4179a8b825a37e0c2193cd2526` predates the scaffold (its tree has
no `server.js` and no `tests/service`) and is recorded only as the base the fork
was built on. No tag or branch is used anywhere.

## Surface

`server.js` starts the service through `api/service.js`. The router answers
exactly two paths:

- `GET /health` returns readiness JSON:
  `{ ok, service, version, commit, runtimeRoot, host, port, mcp }`. When
  `REA_RELEASE_COMMIT` differs from the packaged commit the payload reports
  `ok: false` with `reason: "release_pin_mismatch"`; the HTTP status stays 200
  so a prober can read the reason.
- `GET /` returns a minimal pre-admission splash with no admission data.

Every other path and method, including `/mcp`, answers 404 from the same
router. No MCP handler is registered.

### Environment inputs

| Variable             | Unset or empty                                   | Invalid                                                                                      |
| -------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------- |
| `REA_SERVICE_PORT`   | `4380`, reported by `/health`                    | non-integer or outside 1-65535 fails startup with a bounded message and a non-zero exit      |
| `REA_SERVICE_HOST`   | `127.0.0.1`                                      | an address the host does not own fails the listen with a bounded message and a non-zero exit |
| `REA_RUNTIME_ROOT`   | `/mnt/ai/rea`                                    | any other path, including a subdirectory or the scrapped placement, fails startup            |
| `REA_RELEASE_COMMIT` | the commit in `.datasquiz/service-identity.json` | a different value makes `/health` report `ok: false` with `release_pin_mismatch`             |

## MCP policy

MCP stays on the upstream **stdio/local** transport. The service never spawns
`rea mcp --http`, writes no MCP port, and the environment file written by
script 3 binds only loopback. There is no public or unauthenticated HTTP MCP
listener, and none may be added without a new qualified story.

## Scripts

Run in order, as the non-root tenant user, from the repository checkout:

| Script                            | Purpose                                                                                                                                                               |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/0-complete-cleanup.sh`   | Wipes the service runtime directories. Inspect with `--dry-run` first; it removes nothing and exits 0. Refuses any target outside `/mnt/ai/rea`.                       |
| `scripts/1-setup-system.sh`       | Creates the user-owned tree `/mnt/ai/rea/{releases,current,env,state,logs}` with mode 750.                                                                             |
| `scripts/2-deploy-services.sh`    | Reads the recorded pin, clones or updates `/mnt/ai/rea/releases/<commit>`, checks out the pinned commit detached, verifies `rev-parse HEAD` equals the pin, refuses a release without `server.js`, `tests/service` and the packaged identity, records the deployed commit in that release identity, and points `/mnt/ai/rea/current` at it. |
| `scripts/3-configure-services.sh` | Refuses a deployed release whose identity records a different commit, then writes `/mnt/ai/rea/env/rea-service.env` (mode 600) with the loopback host, port, runtime root, the same recorded commit and the stdio MCP transport.    |
| `scripts/4-run-tests.sh`          | Uses a host node that satisfies the packaged engines floor, otherwise runs `npm ci` and `npm run test:service` in the pinned container image; prints the image digest. |

Every script passes `bash -n`, refuses to run as root and accepts only
`/mnt/ai/rea` as the runtime root. No credentials of any kind are written to the
service environment. Script 4 maps the invoking user into the ephemeral
container and mounts only the deployed release there, so no root-owned file is
written to the runtime tree.

## Tests

```bash
npx vitest run tests/service   # root vitest.config.ts, the `service` project
npm run test:service           # vitest run --config api/vitest.service.config.mjs
node scripts/verify-test-discovery.mjs
```

The repository root `vitest.config.ts` partitions the suite into named projects
(`domain`, `services`, `adapters`, `boundary`, ...). The additive `service`
project, declared in `scripts/lib/test-projects.mjs` with its runner policy in
`vitest.config.ts`, owns `tests/service/**`, so `npx vitest run tests/service`
collects both files and `node scripts/verify-test-discovery.mjs` reports every
tracked test file discovered exactly once. The existing projects and their
defaults are unchanged. `api/vitest.service.config.mjs` remains for the deployed
release, where `scripts/4-run-tests.sh` runs `npm run test:service` without the
full project graph.

### Container gate

The host node on the AI node is not the service runtime, so the suite is proven
on the image the release runs on:

```bash
docker run --rm \
  --volume "$PWD:/w" --workdir /w \
  --env "REA_TEST_UID=$(id -u)" --env "REA_TEST_GID=$(id -g)" \
  node:22-alpine@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914 \
  sh -c 'apk add --no-cache git bash >/dev/null && npm ci --no-audit --no-fund && npm run test:service'
```

`scripts/4-run-tests.sh` performs the same run against the deployed release and
prints the image digest. The image reports node `22.23.4`, which satisfies the
packaged `^22.23.4` engine floor, so a release test cannot fail on
`EBADENGINE`. `npm ci` installs exactly the lockfile inside the mount; the
container's home and npm cache are ephemeral and removed with `--rm`. A linked
worktree needs its authority git directory mounted at the same absolute path for
the pin assertions to read history.

The six criteria map to the tests as follows:

| Criterion                                                        | Test                                         |
| ---------------------------------------------------------------- | -------------------------------------------- |
| Readiness and splash are the only routes                         | `tests/service/rea-service-scaffold.test.ts` |
| Contract files declare the AI-stack root, host and Dev page      | `tests/service/rea-service-scaffold.test.ts` |
| Scripts 0-4 are non-root and script 0 is wipe-safe in dry-run    | `tests/service/rea-service-scripts.test.ts`  |
| No scrapped path or hostname survives anywhere                   | `tests/service/rea-service-scripts.test.ts`  |
| No HTTP MCP listener is created                                  | `tests/service/rea-service-scaffold.test.ts` |
| The runtime pin is exact and reversible                          | `tests/service/rea-service-scaffold.test.ts` |
| The deploy pin contains the re-target and the release commit reads back | `tests/service/rea-service-scripts.test.ts` |

## Release commit readback

The pin must name a commit whose tree actually carries the service: `server.js`,
`tests/service` and `.datasquiz/service-identity.json`. Script 2 checks those
three paths after the detached checkout and exits non-zero instead of reporting
success for a release it cannot run.

That commit was authored before the identity could name it, so script 2 then
records the deployed commit in the release copy of
`.datasquiz/service-identity.json` (the stamp). The identity shipped inside
`/mnt/ai/rea/releases/<commit>`, the identity checked into the repository and
the `REA_RELEASE_COMMIT` script 3 writes therefore name the same commit, and
`/health` answers `ok: true` with no `release_pin_mismatch`. The readiness check
still reports `release_pin_mismatch` when the environment names any other
commit, so real drift is still visible. Script 3 refuses to write an environment
for a release whose identity records a different commit; run script 2 first.

## Update procedure (upstream sync)

1. Fetch the upstream release in a checkout of the fork and merge it on `main`:
   `git fetch upstream --tags`, `git merge <upstream-commit>`.
2. Run the packaged tests and the service suite in the pinned container image
   and confirm both are green.
3. Record the new service release commit after that merge, in `commit` of
   `.datasquiz/service-identity.json`; mirror it in `release.commit` of
   `deployment/operations.json`, in `.datasquiz/documentation.json` and in this
   page, and keep the upstream base commit beside it.
4. Bump `version` in `package.json` only through the upstream release, never by
   hand; keep the engines floor at `^22.23.4 || ^24.22.1 || >=26.12.1` and the
test image digest pointing at a node release that satisfies it.
5. Deploy with script 2, reconfigure with script 3, run script 4, then verify
   `GET /health` reports the new version and commit and `GET /mcp` still
   answers 404.
6. Update the Dev page revision in `.datasquiz/documentation.json`; the page
   itself is `/platform/rea-service/` and its publication is owned by Dev.

## Rollback procedure

1. Read the previous pin from `git log` of the contract files, or from the
   release directory still present under `/mnt/ai/rea/releases`.
2. Set `commit` in `.datasquiz/service-identity.json` back to that 40 character
   commit and mirror it in `deployment/operations.json`,
   `.datasquiz/documentation.json` and this page. Both scripts read the identity
   file, so no script constant is left behind.
3. Run script 2 (it checks out the older release, verifies its scaffold and
   stamps its identity), then script 3, then script 4.
4. Confirm `/health` reports the restored commit and version. If a release
   directory is corrupt, run script 0 with `--dry-run`, then without, and
   redeploy.

Because every durable path is under `/mnt/ai/rea`, a rollback is a checkout plus
a symlink swap; nothing lives in the repository tree and nothing is owned by
root.
