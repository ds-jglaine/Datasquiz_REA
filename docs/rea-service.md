# REA standalone service

The Datasquiz fork of REA (`ds-jglaine/Datasquiz_REA`, upstream `morluto/rea`,
MIT) is consumed unchanged. This service adds a thin, non-root HTTP shell around
the packaged CLI/MCP entry point `scripts/rea.mjs` so a bootstrap can verify
readiness before the node is admitted.

## Pinned release

| Item           | Value                                      |
| -------------- | ------------------------------------------ |
| Package        | `rea-agents`                               |
| Version        | `6.8.0`                                    |
| Commit         | `c3647ade1e557c4179a8b825a37e0c2193cd2526` |
| Repository     | `ds-jglaine/Datasquiz_REA`                 |
| Upstream       | `morluto/rea`                              |
| Node floor     | `>=22.23.4`                                |
| Runtime root   | `/mnt/rea`                                 |
| Listen address | `127.0.0.1:4380` (loopback only)           |
| Readiness      | `GET /health`                              |
| Splash         | `GET /`                                    |

The pin is a full 40 character commit in `scripts/2-deploy-services.sh`,
`.datasquiz/service-identity.json`, `.datasquiz/documentation.json` and
`deployment/operations.json`. No tag or branch is used anywhere.

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
| `REA_RUNTIME_ROOT`   | `/mnt/rea`                                       | a relative path, or a path outside `/mnt` that is not a writable directory, fails startup    |
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
| `scripts/0-complete-cleanup.sh`   | Wipes the service runtime directories. Inspect with `--dry-run` first; it removes nothing and exits 0. Refuses any target outside `/mnt/rea`.                         |
| `scripts/1-setup-system.sh`       | Creates the user-owned tree `/mnt/rea/{releases,current,env,state,logs}` with mode 750.                                                                               |
| `scripts/2-deploy-services.sh`    | Clones or updates `/mnt/rea/releases/<commit>`, checks out the pinned commit detached, verifies `rev-parse HEAD` equals the pin, and points `/mnt/rea/current` at it. |
| `scripts/3-configure-services.sh` | Writes `/mnt/rea/env/rea-service.env` (mode 600) with the loopback host, port, runtime root, pinned commit and stdio MCP transport.                                   |
| `scripts/4-run-tests.sh`          | Verifies the Node floor, then runs `npm run test:service` in the deployed release.                                                                                    |

Every script passes `bash -n`, refuses to run as root, and writes only inside
`/mnt/rea`. No credentials of any kind are written to the service environment.

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
full project graph. The five acceptance criteria map to the tests as follows:

| Criterion                                                        | Test                                         |
| ---------------------------------------------------------------- | -------------------------------------------- |
| Readiness and splash are the only routes                         | `tests/service/rea-service-scaffold.test.ts` |
| Contract files declare service, runtime root, scope and revision | `tests/service/rea-service-scaffold.test.ts` |
| Scripts 0-4 are non-root and script 0 is wipe-safe in dry-run    | `tests/service/rea-service-scripts.test.ts`  |
| No HTTP MCP listener is created                                  | `tests/service/rea-service-scaffold.test.ts` |
| The runtime pin is exact and reversible                          | `tests/service/rea-service-scaffold.test.ts` |

## Update procedure (upstream sync)

1. Fetch the upstream release in a checkout of the fork and merge it on `main`:
   `git fetch upstream --tags`, `git merge <upstream-commit>`.
2. Run the packaged tests and the service suite and confirm both are green.
3. Record the new commit in all four pin locations: `.datasquiz/service-identity.json`,
   `.datasquiz/documentation.json`, `deployment/operations.json` and the
   `REA_PIN` constant in `scripts/2-deploy-services.sh` and
   `scripts/3-configure-services.sh`.
4. Bump `version` in `package.json` only through the upstream release, never by
   hand.
5. Deploy with script 2, reconfigure with script 3, run script 4, then verify
   `GET /health` reports the new version and commit and `GET /mcp` still
   answers 404.
6. Update the Dev page revision in `.datasquiz/documentation.json`.

## Rollback procedure

1. Read the previous pin from `git log` of the contract files, or from the
   release directory still present under `/mnt/rea/releases`.
2. Set `REA_PIN` in `scripts/2-deploy-services.sh` and
   `scripts/3-configure-services.sh` back to that 40 character commit, and
   restore the same commit in the two `.datasquiz` files plus
   `deployment/operations.json`.
3. Run script 2 (it checks out the older release and repoints
   `/mnt/rea/current`), then script 3, then script 4.
4. Confirm `/health` reports the restored commit and version. If a release
   directory is corrupt, run script 0 with `--dry-run`, then without, and
   redeploy.

Because every durable path is under `/mnt/rea`, a rollback is a checkout plus a
symlink swap; nothing lives in `/tmp` and nothing is owned by root.
