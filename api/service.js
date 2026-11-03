import { accessSync, constants, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { isAbsolute, join, resolve } from "node:path";

/** Service name reported by readiness and the contract files. */
export const SERVICE_NAME = "rea";

/** Default listen port for the standalone REA service. */
export const DEFAULT_PORT = 4380;

/** Default bind address: loopback only. */
export const DEFAULT_HOST = "127.0.0.1";

/** Default durable runtime root for the service. */
export const DEFAULT_RUNTIME_ROOT = "/mnt/rea";

/**
 * The complete service route inventory. Readiness and the pre-admission splash
 * are the only paths this service serves; everything else, including any MCP
 * path, answers 404 from the same router.
 */
export const SERVICE_ROUTES = Object.freeze(["/health", "/"]);

const PACKAGE_PATH = new URL("../package.json", import.meta.url);
const IDENTITY_RELATIVE_PATH = join(".datasquiz", "service-identity.json");
const PIN_PATTERN = /^[0-9a-f]{40}$/u;
const HOST_PATTERN = /^[A-Za-z0-9._:-]+$/u;

/** Bounded configuration failure raised before the service starts listening. */
export class ServiceConfigError extends Error {
  /**
   * @param {string} message
   */
  constructor(message) {
    super(`rea service: ${message}`);
    this.name = "ServiceConfigError";
  }
}

/**
 * Read the packaged version banner. The service reports exactly the version
 * that ships in package.json, never a runtime probe.
 *
 * @returns {{ version: string }}
 */
const readPackage = () => {
  try {
    const parsed = JSON.parse(readFileSync(PACKAGE_PATH, "utf8"));
    if (typeof parsed.version !== "string" || parsed.version.length === 0)
      throw new Error("package.json carries no version");
    return { version: parsed.version };
  } catch (error) {
    throw new ServiceConfigError(
      `cannot read the packaged version: ${String(
        error instanceof Error ? error.message : error,
      ).slice(0, 160)}`,
    );
  }
};

/**
 * Load and validate the packaged service identity document.
 *
 * @param {string} rootDir repository root that holds .datasquiz/
 * @returns {{
 *   service: string,
 *   owner: string,
 *   repository: string,
 *   commit: string,
 *   version: string,
 *   scope: string,
 *   transport: string,
 *   runtimeRoot: string,
 *   upstream: string,
 * }}
 */
export function loadServiceIdentity(rootDir) {
  const path = join(rootDir, IDENTITY_RELATIVE_PATH);
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ServiceConfigError(
      `cannot read ${IDENTITY_RELATIVE_PATH}: ${String(
        error instanceof Error ? error.message : error,
      ).slice(0, 160)}`,
    );
  }
  const required = [
    "service",
    "owner",
    "repository",
    "commit",
    "version",
    "scope",
    "runtimeRoot",
  ];
  for (const key of required) {
    const value = parsed[key];
    if (typeof value !== "string" || value.length === 0)
      throw new ServiceConfigError(`${IDENTITY_RELATIVE_PATH} is missing ${key}`);
  }
  if (!PIN_PATTERN.test(parsed.commit))
    throw new ServiceConfigError(
      `${IDENTITY_RELATIVE_PATH} must pin a full 40 character commit`,
    );
  if (parsed.audited !== undefined && typeof parsed.audited !== "boolean")
    throw new ServiceConfigError(
      `${IDENTITY_RELATIVE_PATH} carries a non-boolean audited flag`,
    );
  return {
    service: parsed.service,
    owner: parsed.owner,
    repository: parsed.repository,
    commit: parsed.commit,
    version: parsed.version,
    scope: parsed.scope,
    transport: typeof parsed.transport === "string" ? parsed.transport : "stdio",
    runtimeRoot: parsed.runtimeRoot,
    upstream: typeof parsed.upstream === "string" ? parsed.upstream : "",
  };
}

/**
 * Empty means "unset" for every input; whitespace only is invalid.
 *
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
const option = (value) => {
  if (value === undefined || value === "") return undefined;
  return value;
};

/**
 * @param {string | undefined} value
 * @returns {number}
 */
const parsePort = (value) => {
  const raw = option(value);
  if (raw === undefined) return DEFAULT_PORT;
  if (!/^[0-9]+$/u.test(raw))
    throw new ServiceConfigError(
      "REA_SERVICE_PORT must be an integer between 1 and 65535",
    );
  const port = Number.parseInt(raw, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new ServiceConfigError(
      "REA_SERVICE_PORT must be an integer between 1 and 65535",
    );
  return port;
};

/**
 * @param {string | undefined} value
 * @returns {string}
 */
const parseHost = (value) => {
  const raw = option(value);
  if (raw === undefined) return DEFAULT_HOST;
  if (!HOST_PATTERN.test(raw))
    throw new ServiceConfigError(
      "REA_SERVICE_HOST must be a single address without whitespace",
    );
  return raw;
};

/**
 * The runtime root must be absolute, and outside /mnt it must already be a
 * writable directory owned by the invoking user.
 *
 * @param {string | undefined} value
 * @returns {string}
 */
const parseRuntimeRoot = (value) => {
  const raw = option(value);
  if (raw === undefined) return DEFAULT_RUNTIME_ROOT;
  if (!isAbsolute(raw))
    throw new ServiceConfigError("REA_RUNTIME_ROOT must be an absolute path");
  const resolved = resolve(raw);
  if (resolved === "/mnt" || resolved.startsWith("/mnt/")) return resolved;
  try {
    if (!statSync(resolved).isDirectory())
      throw new Error("not a directory");
    accessSync(resolved, constants.W_OK);
  } catch {
    throw new ServiceConfigError(
      `REA_RUNTIME_ROOT ${resolved} is outside /mnt and is not a writable directory`,
    );
  }
  return resolved;
};

/**
 * Resolve the complete service configuration from the environment.
 *
 * @param {Record<string, string | undefined>} [env]
 * @param {ReturnType<typeof loadServiceIdentity>} [identity]
 */
export function resolveServiceConfig(env = process.env, identity) {
  const { version } = readPackage();
  const packaged = identity ?? loadServiceIdentity(new URL("..", import.meta.url).pathname);
  const requested = option(env.REA_RELEASE_COMMIT) ?? packaged.commit;
  const port = parsePort(env.REA_SERVICE_PORT);
  const host = parseHost(env.REA_SERVICE_HOST);
  const runtimeRoot = parseRuntimeRoot(env.REA_RUNTIME_ROOT);
  return {
    service: SERVICE_NAME,
    version,
    commit: packaged.commit,
    packagedVersion: packaged.version,
    expectedCommit: requested,
    pinMatched: requested === packaged.commit,
    host,
    port,
    runtimeRoot,
  };
}

/**
 * @param {ReturnType<typeof resolveServiceConfig>} config
 */
const readinessPayload = (config) => ({
  ok: config.pinMatched,
  service: config.service,
  version: config.version,
  commit: config.commit,
  runtimeRoot: config.runtimeRoot,
  host: config.host,
  port: config.port,
  mcp: "stdio",
  ...(config.pinMatched
    ? {}
    : { reason: "release_pin_mismatch", expectedCommit: config.expectedCommit }),
});

/**
 * Minimal pre-admission splash. It carries no admission data by design.
 *
 * @param {ReturnType<typeof resolveServiceConfig>} config
 */
const splashPage = (config) =>
  [
    "<!doctype html>",
    '<html lang="en">',
    "<head><meta charset=\"utf-8\"><title>REA service</title></head>",
    "<body>",
    "<h1>REA service</h1>",
    "<p>This node is not yet in service.</p>",
    `<p>Readiness is published at <a href="/health">/health</a>.</p>`,
    "<p>MCP is stdio-only and local; this service exposes no HTTP MCP endpoint.</p>",
    `<p>Version ${config.version}, commit ${config.commit}.</p>`,
    "</body>",
    "</html>",
    "",
  ].join("\n");

/**
 * @param {import("node:http").ServerResponse} response
 * @param {number} status
 * @param {string} contentType
 * @param {string} body
 */
const send = (response, status, contentType, body) => {
  response.statusCode = status;
  response.setHeader("content-type", contentType);
  response.setHeader("cache-control", "no-store");
  response.end(body);
};

/**
 * Build the request handler. Only the declared route inventory is served;
 * every other path, method combination answers 404.
 *
 * @param {{ config?: ReturnType<typeof resolveServiceConfig> }} [options]
 */
export function createRequestHandler(options = {}) {
  const config = options.config ?? resolveServiceConfig();
  return (request, response) => {
    const method = request.method ?? "GET";
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (method === "GET" && path === "/health") {
      send(
        response,
        200,
        "application/json; charset=utf-8",
        `${JSON.stringify(readinessPayload(config))}\n`,
      );
      return;
    }
    if (method === "GET" && path === "/") {
      send(response, 200, "text/html; charset=utf-8", splashPage(config));
      return;
    }
    send(response, 404, "text/plain; charset=utf-8", "not found\n");
  };
}

/**
 * Create the service server without listening. The caller owns the socket.
 *
 * @param {{
 *   identity?: ReturnType<typeof loadServiceIdentity>,
 *   env?: Record<string, string | undefined>,
 * }} [options]
 */
export function createServiceServer(options = {}) {
  const config = resolveServiceConfig(
    options.env ?? process.env,
    options.identity,
  );
  const server = createServer(createRequestHandler({ config }));
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  return server;
}

/**
 * Start the service and report readiness through the logger.
 *
 * @param {{
 *   identity?: ReturnType<typeof loadServiceIdentity>,
 *   env?: Record<string, string | undefined>,
 *   logger?: { log: (line: string) => void, error: (line: string) => void },
 * }} [options]
 */
export function startService(options = {}) {
  const logger = options.logger ?? console;
  const config = resolveServiceConfig(
    options.env ?? process.env,
    options.identity,
  );
  const server = createServiceServer({
    env: options.env,
    identity: options.identity,
  });
  server.on("error", (error) => {
    const code =
      typeof error === "object" && error !== null && "code" in error
        ? String(error.code)
        : "error";
    logger.error(
      `rea service: cannot listen on ${config.host}:${String(
        config.port,
      )} (${code.slice(0, 40)})`,
    );
    process.exitCode = 1;
    server.close();
  });
  server.listen(config.port, config.host, () => {
    const address = server.address();
    const bound =
      address === null || typeof address === "string"
        ? String(config.port)
        : String(address.port);
    logger.log(
      `rea service: listening on http://${config.host}:${bound} (version ${config.version}, commit ${config.commit}, root ${config.runtimeRoot})`,
    );
  });
  return server;
}
