import type { IncomingMessage, Server, ServerResponse } from "node:http";

export type ServiceIdentity = {
  service: string;
  owner: string;
  repository: string;
  commit: string;
  upstreamCommit: string;
  version: string;
  scope: string;
  transport: string;
  runtimeRoot: string;
  upstream: string;
};

export type ServiceConfig = {
  service: string;
  version: string;
  commit: string;
  packagedVersion: string;
  expectedCommit: string;
  pinMatched: boolean;
  host: string;
  port: number;
  runtimeRoot: string;
};

export type ServiceEnvironment = Record<string, string | undefined>;

export declare const SERVICE_NAME: "rea";
export declare const DEFAULT_PORT: 4380;
export declare const DEFAULT_HOST: "127.0.0.1";
export declare const DEFAULT_RUNTIME_ROOT: "/mnt/rea";
export declare const SERVICE_ROUTES: readonly ["/health", "/"];

export declare class ServiceConfigError extends Error {}

export declare function loadServiceIdentity(rootDir: string): ServiceIdentity;

export declare function readReleasePin(rootDir: string): string;

export declare function stampServiceIdentity<T extends { commit: string }>(
  identity: T,
  commit: string,
): T;

export declare function resolveServiceConfig(
  env?: ServiceEnvironment,
  identity?: ServiceIdentity,
): ServiceConfig;

export declare function createRequestHandler(options?: {
  config?: ServiceConfig;
}): (request: IncomingMessage, response: ServerResponse) => void;

export declare function createServiceServer(options?: {
  identity?: ServiceIdentity;
  env?: ServiceEnvironment;
}): Server;

export declare function startService(options?: {
  identity?: ServiceIdentity;
  env?: ServiceEnvironment;
  logger?: { log: (line: string) => void; error: (line: string) => void };
}): Server;
