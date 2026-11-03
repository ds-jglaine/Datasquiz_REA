import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  readReleasePin,
  resolveServiceConfig,
  stampServiceIdentity,
} from "../../api/service.js";
import type { ServiceIdentity } from "../../api/service.js";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** The PR #1 merge: the first commit whose tree carries the service scaffold. */
const MERGE_COMMIT = "b9d20a3b678881089a8adf6c75ff2dfb0695a6f7";
/** The upstream base of the fork: the pin that deployed an unusable release. */
const LEGACY_PIN = "c3647ade1e557c4179a8b825a37e0c2193cd2526";

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(join(REPO_ROOT, relativePath), "utf8")) as T;

const git = (...args: string[]): string =>
  execFileSync("git", args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

const identityAt = (commit: string): ServiceIdentity =>
  JSON.parse(
    git("show", `${commit}:.datasquiz/service-identity.json`),
  ) as ServiceIdentity;

const SCRIPTS = [
  "0-complete-cleanup.sh",
  "1-setup-system.sh",
  "2-deploy-services.sh",
  "3-configure-services.sh",
  "4-run-tests.sh",
];

const scriptPath = (name: string): string => join(REPO_ROOT, "scripts", name);

const readScript = (name: string): string =>
  readFileSync(scriptPath(name), "utf8");

const runBash = (
  args: string[],
  env: Record<string, string | undefined> = {},
): { status: number; stdout: string; stderr: string } => {
  try {
    const stdout = execFileSync("bash", args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as {
      status?: number;
      stdout?: string;
      stderr?: string;
    };
    return {
      status: failure.status ?? 1,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
    };
  }
};

const ABSOLUTE_PATH = /(?<![\w$<{}/.:-])(\/[A-Za-z0-9._-][A-Za-z0-9._/-]*)/gu;
const ALLOWED_ABSOLUTE_PATHS = new Set([
  "/bin/bash",
  "/bin/sh",
  "/usr/bin/env",
  "/usr/bin/bash",
  "/dev/null",
  "/mnt/rea",
]);

const absolutePaths = (source: string): string[] =>
  [...source.matchAll(ABSOLUTE_PATH)]
    .map((match) => match[1])
    .filter((value): value is string => typeof value === "string")
    .filter(
      (value) =>
        !value.startsWith("/mnt/rea") && !ALLOWED_ABSOLUTE_PATHS.has(value),
    );

describe("REA-SERVICE-SCAFFOLD-01: scripts 0-4 are non-root and script 0 is wipe-safe in dry-run", () => {
  it("ships all five scripts executable with a bash shebang", () => {
    for (const name of SCRIPTS) {
      const path = scriptPath(name);
      expect(existsSync(path)).toBe(true);
      expect(statSync(path).mode & 0o111).not.toBe(0);
      expect(readScript(name).startsWith("#!/usr/bin/env bash\n")).toBe(true);
    }
  });

  it("passes bash -n for every script", () => {
    for (const name of SCRIPTS) {
      const result = runBash(["-n", scriptPath(name)]);
      expect({ name, stderr: result.stderr, status: result.status }).toEqual({
        name,
        stderr: "",
        status: 0,
      });
    }
  });

  it("refuses privileged execution and privileged helpers", () => {
    for (const name of SCRIPTS) {
      const source = readScript(name);
      expect(source).not.toMatch(/(^|\s)sudo(\s|$)/u);
      expect(source).not.toMatch(/(^|\s)(su|doas)(\s|$)/u);
      expect(source).not.toMatch(/chown\s+root/u);
      expect(source).toMatch(/id -u/u);
    }
  });

  it("writes nothing outside the /mnt/rea runtime root", () => {
    for (const name of SCRIPTS) {
      const source = readScript(name);
      expect({ name, paths: absolutePaths(source) }).toEqual({
        name,
        paths: [],
      });
      expect(source).not.toMatch(/\$HOME/u);
    }
  });

  it("keeps credentials out of the service scripts", () => {
    const credentialNames = [
      "PLANE_API_KEY",
      "PLANE_API_URL",
      "DATASQUIZ_TEST",
      "TEST_API_KEY",
      "ANTHROPIC_API_KEY",
      "OPENAI_API_KEY",
      "GEMINI_API_KEY",
      "NODE_TLS_REJECT_UNAUTHORIZED",
    ];
    for (const name of SCRIPTS) {
      const source = readScript(name);
      for (const credentialName of credentialNames)
        expect({ credentialName, name }).toEqual({
          credentialName,
          name,
        });
    }
  });

  it("prints the /mnt/rea targets in dry-run and removes nothing", () => {
    const existedBefore = existsSync("/mnt/rea");
    const result = runBash([scriptPath("0-complete-cleanup.sh"), "--dry-run"], {
      REA_RUNTIME_ROOT: undefined,
    });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/dry run/iu);
    for (const target of [
      "/mnt/rea/releases",
      "/mnt/rea/current",
      "/mnt/rea/env",
      "/mnt/rea/state",
    ])
      expect(result.stdout).toContain(target);
    expect(existsSync("/mnt/rea")).toBe(existedBefore);
  });

  it("refuses a runtime root outside /mnt/rea", () => {
    const result = runBash([scriptPath("0-complete-cleanup.sh"), "--dry-run"], {
      REA_RUNTIME_ROOT: "/tmp/rea-outside-root",
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain("/mnt/rea");
  });

  it("has script 4 run the service suite and script 2 verify the checkout", () => {
    const suite = readScript("4-run-tests.sh");
    expect(suite).toContain("npm run test:service");
    expect(readScript("../api/vitest.service.config.mjs")).toContain(
      "tests/service/**/*.test.ts",
    );
    const deploy = readScript("2-deploy-services.sh");
    expect(deploy).toContain("rev-parse");
  });
});

describe("REA-SERVICE-SCAFFOLD-01: the deploy pin is a scaffold-containing commit and the release commit reads back", () => {
  it("pins one exact recorded commit, shared by scripts 2 and 3", () => {
    const identity = readJson<ServiceIdentity>(
      ".datasquiz/service-identity.json",
    );
    const pin = readReleasePin(REPO_ROOT);
    expect(pin).toBe(identity.commit);
    expect(pin).toMatch(/^[0-9a-f]{40}$/u);
    expect(pin).not.toBe(LEGACY_PIN);
    for (const name of ["2-deploy-services.sh", "3-configure-services.sh"]) {
      const source = readScript(name);
      expect({ name, pin: /REA_PIN="\$/u.test(source) }).toEqual({
        name,
        pin: true,
      });
      expect({
        name,
        reader: source.includes("readReleasePin"),
        floating: /REA_PIN=["']?[0-9a-f]{8}/u.test(source),
      }).toEqual({ name, reader: true, floating: false });
    }
  });

  it("pins a commit at or after the PR #1 merge whose tree carries the scaffold", () => {
    const pin = readJson<ServiceIdentity>(".datasquiz/service-identity.json")
      .commit;
    expect(() =>
      git("merge-base", "--is-ancestor", MERGE_COMMIT, pin),
    ).not.toThrow();
    expect(() => git("cat-file", "-e", `${pin}:server.js`)).not.toThrow();
    const serviceTests = git("ls-tree", "-r", "--name-only", pin, "--", "tests/service")
      .trim()
      .split("\n")
      .filter(Boolean);
    expect(serviceTests).toContain(
      "tests/service/rea-service-scaffold.test.ts",
    );
    expect(serviceTests).toContain("tests/service/rea-service-scripts.test.ts");
    expect(
      (
        JSON.parse(git("show", `${pin}:package.json`)) as { version: string }
      ).version,
    ).toBe("6.8.0");
    const identityAtPin = identityAt(pin);
    expect(identityAtPin.version).toBe("6.8.0");
    expect(identityAtPin.commit).not.toBe(pin);
    expect(() => git("cat-file", "-e", `${LEGACY_PIN}:server.js`)).toThrow();
  });

  it("records 6.8.0 plus the upstream base and the release commit in every contract file", () => {
    const identity = readJson<ServiceIdentity & { upstreamCommit?: string }>(
      ".datasquiz/service-identity.json",
    );
    expect(identity.commit).toBe(readReleasePin(REPO_ROOT));
    expect(identity.upstreamCommit).toBe(LEGACY_PIN);
    expect(identity.version).toBe("6.8.0");

    const documentation = readJson<Record<string, unknown>>(
      ".datasquiz/documentation.json",
    );
    expect(documentation.commit).toBe(identity.commit);
    expect(documentation.revision).toBe("rea-service-scaffold-01-v1");

    const operations = readJson<{
      release: { commit: string; version: string };
    }>("deployment/operations.json");
    expect(operations.release.commit).toBe(identity.commit);
    expect(operations.release.version).toBe("6.8.0");

    const docs = readScript("../docs/rea-service.md");
    expect(docs).toContain(identity.commit);
    expect(docs).toContain(LEGACY_PIN);
    expect(docs).toContain("6.8.0");
  });

  it("accepts the environment script 3 writes for the release script 2 stamps", () => {
    const identity = readJson<ServiceIdentity>(".datasquiz/service-identity.json");
    const pin = identity.commit;

    const configure = readScript("3-configure-services.sh");
    expect(configure).toMatch(
      /printf 'REA_RELEASE_COMMIT=%s\\n' "\$REA_PIN"/u,
    );
    expect(configure).toContain("DEPLOYED_COMMIT");
    expect(configure).toContain("run script 2 first");

    const deploy = readScript("2-deploy-services.sh");
    expect(deploy).toContain("stampServiceIdentity");
    expect(deploy).toMatch(/server\.js/u);
    expect(deploy).toMatch(/tests\/service/u);

    const atPin = identityAt(pin);
    const stamped = stampServiceIdentity(atPin, pin);
    const config = resolveServiceConfig({ REA_RELEASE_COMMIT: pin }, stamped);
    expect(config.pinMatched).toBe(true);
    expect(config.commit).toBe(pin);
    expect(config.expectedCommit).toBe(pin);
    expect(config.version).toBe("6.8.0");

    const unstamped = resolveServiceConfig({ REA_RELEASE_COMMIT: pin }, atPin);
    expect(unstamped.pinMatched).toBe(false);
    expect(unstamped.expectedCommit).toBe(pin);

    const drift = resolveServiceConfig(
      { REA_RELEASE_COMMIT: LEGACY_PIN },
      stamped,
    );
    expect(drift.pinMatched).toBe(false);
  });
});
