import { realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

/**
 * Standalone Vitest configuration for the REA standalone service suite.
 *
 * The repository root configuration partitions tests into named projects, and
 * none of those projects owns `tests/service/**`. This config runs the service
 * suite on its own without touching those defaults: `npm run test:service`.
 */
const root = fileURLToPath(new URL("..", import.meta.url));

export default {
  root,
  test: {
    include: ["tests/service/**/*.test.ts"],
    env: { TMPDIR: realpathSync(tmpdir()) },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    retry: 0,
    reporters: ["default"],
  },
};
