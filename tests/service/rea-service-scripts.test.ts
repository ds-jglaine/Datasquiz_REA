import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));

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

  it("has script 4 run the service suite and script 2 pin an exact commit", () => {
    const suite = readScript("4-run-tests.sh");
    expect(suite).toContain("npm run test:service");
    expect(readScript("../api/vitest.service.config.mjs")).toContain(
      "tests/service/**/*.test.ts",
    );
    const deploy = readScript("2-deploy-services.sh");
    expect(deploy).toMatch(/REA_PIN=["']?[0-9a-f]{40}["']?/u);
    expect(deploy).toContain("rev-parse");
  });
});
