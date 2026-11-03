#!/usr/bin/env node
// Standalone REA service entry point. It serves readiness and the
// pre-admission splash only; MCP stays on the upstream stdio transport and is
// never started here.
import { startService } from "./api/service.js";

const server = startService();

const shutdown = (signal) => {
  server.close(() => {
    process.exitCode = 0;
  });
  process.once("exit", () => {
    process.stderr.write(`rea service: stopped on ${signal}\n`);
  });
};

process.once("SIGTERM", () => {
  shutdown("SIGTERM");
});
process.once("SIGINT", () => {
  shutdown("SIGINT");
});
