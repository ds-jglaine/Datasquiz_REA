import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import {
  SERVICE_NAME,
  SERVICE_ROUTES,
  ServiceConfigError,
  createRequestHandler,
  createServiceServer,
  loadServiceIdentity,
  resolveServiceConfig,
} from "../../api/service.js";
import type { ServiceIdentity } from "../../api/service.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(join(REPO_ROOT, relativePath), "utf8")) as T;

const readSource = (relativePath: string): string =>
  readFileSync(join(REPO_ROOT, relativePath), "utf8");

const packageJson = readJson<Record<string, unknown>>("package.json");
const identity = readJson<ServiceIdentity>(".datasquiz/service-identity.json");
const identityCommit = identity.commit;

const openServers: Array<{ close: () => Promise<void> }> = [];

const startService = async (
  env: Record<string, string | undefined> = {},
): Promise<{ base: string }> => {
  const server = createServiceServer({ identity, env });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new Error("expected a TCP address");
  openServers.push({
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      }),
  });
  return { base: `http://127.0.0.1:${String(address.port)}` };
};

afterEach(async () => {
  while (openServers.length > 0) {
    const entry = openServers.pop();
    if (entry) await entry.close();
  }
});

describe("REA-SERVICE-SCAFFOLD-01: readiness and splash are the only routes", () => {
  it("declares exactly the readiness and splash routes", () => {
    expect(SERVICE_NAME).toBe("rea");
    expect([...SERVICE_ROUTES]).toEqual(["/health", "/"]);
    expect(
      readdirSync(join(REPO_ROOT, "api")).filter(
        (name) => name.endsWith(".js") && !name.endsWith(".mjs"),
      ),
    ).toEqual(["service.js"]);
  });

  it("answers /health with the pinned identity and / with a splash", async () => {
    const { base } = await startService();
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    expect(health.headers.get("content-type")).toContain("application/json");
    const payload = (await health.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(true);
    expect(payload.service).toBe("rea");
    expect(payload.version).toBe(packageJson.version);
    expect(payload.commit).toBe(identityCommit);
    expect(payload.runtimeRoot).toBe("/mnt/rea");
    expect(payload.port).toBe(4380);
    expect(payload.mcp).toBe("stdio");

    const splash = await fetch(`${base}/`);
    expect(splash.status).toBe(200);
    expect(splash.headers.get("content-type")).toContain("text/html");
    const html = await splash.text();
    expect(html.toLowerCase()).toContain("<!doctype html>");
    expect(html).toContain("/health");
    for (const admissionKey of [
      "serviceHosts",
      "admittedService",
      "admittedAt",
      "admissionToken",
      "admitted",
    ])
      expect(html).not.toContain(admissionKey);
  });

  it("answers 404 for every other path including MCP", async () => {
    const { base } = await startService();
    for (const path of ["/mcp", "/health/", "/unknown", "/api/health"]) {
      const response = await fetch(`${base}${path}`);
      expect(response.status).toBe(404);
    }
    const post = await fetch(`${base}/mcp`, {
      body: "{}",
      headers: { "content-type": "application/json" },
      method: "POST",
    });
    expect(post.status).toBe(404);
  });

  it("reports a pin mismatch without failing the readiness probe", async () => {
    const { base } = await startService({
      REA_RELEASE_COMMIT: "0".repeat(40),
    });
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.ok).toBe(false);
    expect(payload.reason).toBe("release_pin_mismatch");
    expect(payload.commit).toBe(identityCommit);
  });
});

describe("REA-SERVICE-SCAFFOLD-01: contract files declare service, runtime root, scope and revision", () => {
  it("operations.json declares the /mnt/rea layout, non-root user and readiness path", () => {
    const operations = readJson<Record<string, unknown>>(
      "deployment/operations.json",
    );
    expect(operations.service).toBe("rea");
    expect(operations.runtimeRoot).toBe("/mnt/rea");
    const execution = operations.execution as Record<string, unknown>;
    expect(execution.user).toBe("ds-operator");
    expect(execution.user).not.toBe("root");
    expect(execution.privileged).toBe(false);
    const network = operations.network as Record<string, unknown>;
    expect(network.port).toBe(4380);
    expect(network.host).toBe("127.0.0.1");
    expect(network.publicHost).toBe("rea.datasquiz.com");
    const readiness = operations.readiness as Record<string, unknown>;
    expect(readiness.path).toBe("/health");
    expect(operations.mcp).toEqual({ transport: "stdio", http: false });
  });

  it("service-identity.json pins the service, owner, repository, commit and scope", () => {
    expect(identity.service).toBe("rea");
    expect(typeof identity.owner).toBe("string");
    expect(String(identity.owner).length).toBeGreaterThan(0);
    expect(identity.repository).toBe("ds-jglaine/Datasquiz_REA");
    expect(identityCommit).toMatch(/^[0-9a-f]{40}$/);
    expect(identity.commit).toBe("c3647ade1e557c4179a8b825a37e0c2193cd2526");
    expect(identity.version).toBe(packageJson.version);
    expect(identity.scope).toBe("ai_node");
    expect(identity.transport).toBe("stdio");
    expect(identity.runtimeRoot).toBe("/mnt/rea");
  });

  it("documentation.json names the Dev page and the revision", () => {
    const documentation = readJson<Record<string, unknown>>(
      ".datasquiz/documentation.json",
    );
    expect(documentation.service).toBe("rea");
    expect(String(documentation.devPage)).toMatch(/^\/[a-z0-9/-]+\/$/);
    expect(documentation.revision).toBe("rea-service-scaffold-01-v1");
    expect(documentation.documents).toContain("docs/rea-service.md");
  });

  it("loads the packaged identity and rejects a missing one", () => {
    expect(loadServiceIdentity(REPO_ROOT).commit).toBe(identityCommit);
    expect(() => loadServiceIdentity(join(REPO_ROOT, "api"))).toThrow(
      ServiceConfigError,
    );
  });

  it("validates the environment inputs with bounded errors", () => {
    expect(resolveServiceConfig({}, identity).port).toBe(4380);
    expect(resolveServiceConfig({ REA_SERVICE_PORT: "" }, identity).port).toBe(
      4380,
    );
    expect(resolveServiceConfig({}, identity).host).toBe("127.0.0.1");
    expect(resolveServiceConfig({}, identity).runtimeRoot).toBe("/mnt/rea");
    expect(resolveServiceConfig({}, identity).commit).toBe(identityCommit);

    for (const port of ["0", "65536", "abc", "80.5"])
      expect(() =>
        resolveServiceConfig({ REA_SERVICE_PORT: port }, identity),
      ).toThrow(ServiceConfigError);
    expect(() =>
      resolveServiceConfig({ REA_RUNTIME_ROOT: "mnt/rea" }, identity),
    ).toThrow(ServiceConfigError);
    expect(() =>
      resolveServiceConfig({ REA_RUNTIME_ROOT: "/proc/rea" }, identity),
    ).toThrow(ServiceConfigError);
    expect(() =>
      resolveServiceConfig({ REA_SERVICE_HOST: " " }, identity),
    ).toThrow(ServiceConfigError);
  });

  it("exits non-zero with a bounded message when the host cannot be bound", () => {
    let status = 0;
    let output = "";
    try {
      output = String(
        execFileSync(process.execPath, [join(REPO_ROOT, "server.js")], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: {
            ...process.env,
            REA_SERVICE_HOST: "192.0.2.1",
            REA_SERVICE_PORT: "4571",
          },
          stdio: ["ignore", "pipe", "pipe"],
          timeout: 20_000,
        }),
      );
    } catch (error) {
      const failure = error as {
        status?: number;
        stdout?: string;
        stderr?: string;
      };
      status = failure.status ?? 1;
      output = `${String(failure.stdout ?? "")}${String(failure.stderr ?? "")}`;
    }
    expect(status).not.toBe(0);
    expect(output.length).toBeLessThan(2000);
    expect(output).toContain("rea service:");
  });
});

describe("REA-SERVICE-SCAFFOLD-01: no HTTP MCP listener is created", () => {
  it("never spawns the MCP HTTP transport from the service shell", () => {
    const sources = [
      "server.js",
      "api/service.js",
      "scripts/3-configure-services.sh",
      "scripts/2-deploy-services.sh",
      "deployment/operations.json",
      ".datasquiz/service-identity.json",
    ].map((relativePath) => readSource(relativePath).replaceAll(/\s+/g, " "));
    for (const source of sources) {
      expect(source).not.toContain("mcp --http");
      expect(source).not.toContain('"--http"');
      expect(source).not.toContain("MCP_PORT");
    }
    expect(readSource("server.js")).not.toContain("child_process");
    expect(readSource("api/service.js")).not.toContain("child_process");
  });

  it("writes no non-loopback MCP binding in the service environment", () => {
    const script = readSource("scripts/3-configure-services.sh");
    const bindings = [...script.matchAll(/MCP_HOST=([0-9A-Za-z._:]+)/gu)].map(
      (match) => match[1],
    );
    expect(bindings.length).toBeGreaterThan(0);
    for (const binding of bindings) expect(binding).toBe("127.0.0.1");
    expect(script).toContain("REA_MCP_TRANSPORT=stdio");
    expect(script).not.toMatch(/MCP_PORT/u);
    expect(script).not.toMatch(/0\.0\.0\.0/u);
  });

  it("registers no MCP route or handler on the service router", () => {
    expect([...SERVICE_ROUTES]).not.toContain("/mcp");
    const handler = createRequestHandler({
      config: resolveServiceConfig({}, identity),
    });
    expect(typeof handler).toBe("function");
    const server = createServer(handler);
    expect(server.listenerCount("request")).toBe(1);
  });
});

describe("REA-SERVICE-SCAFFOLD-01: the runtime pin is exact and reversible", () => {
  it("keeps the engines floor at node 22.23.4", () => {
    const engines = packageJson.engines as Record<string, string>;
    expect(engines.node).toBe("^22.23.4 || ^24.22.1 || >=26.12.1");
  });

  it("reports the same version and commit from package, identity and docs", () => {
    const config = resolveServiceConfig({}, identity);
    expect(config.version).toBe(packageJson.version);
    expect(config.commit).toBe(identityCommit);
    const docs = readSource("docs/rea-service.md");
    expect(docs).toContain(identityCommit);
    expect(docs).toContain(String(packageJson.version));
    expect(docs).toMatch(/rollback/iu);
    expect(docs).toMatch(/upstream syn/iu);
  });

  it("pins an exact commit in every deployment script", () => {
    const deploy = readSource("scripts/2-deploy-services.sh");
    const pin = /REA_PIN=["']?([0-9a-f]{40})["']?/u.exec(deploy);
    expect(pin?.[1]).toBe(identityCommit);
    for (const relativePath of [
      "scripts/2-deploy-services.sh",
      "scripts/3-configure-services.sh",
    ]) {
      const source = readSource(relativePath);
      expect(source).not.toMatch(/origin\/main/u);
      expect(source).not.toMatch(/--branch/u);
      expect(source).not.toMatch(/checkout main\b/u);
    }
  });

  it("has no floating tag or branch in the deployment declarations", () => {
    const operations = readSource("deployment/operations.json");
    expect(operations).toContain(identityCommit);
    expect(operations).not.toMatch(/"(?:tag|branch)"\s*:/u);
    expect(existsSync(join(REPO_ROOT, "deployment/operations.json"))).toBe(
      true,
    );
  });
});
