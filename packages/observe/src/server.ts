#!/usr/bin/env bun
import { resolve, dirname } from "node:path";
import { parseArgs } from "node:util";
import { readRun, type Source, type Run } from "./read.ts";
import { verifyInstall } from "../../../scripts/dependencies.ts";
import index from "../web/index.html";

export function readSources(value: unknown, directory: string): Source[] {
  if (!Array.isArray(value) || value.length === 0)
    throw new Error("Config must be a nonempty list of runs");
  const ids = new Set<string>();
  return value.map((source: Source) => {
    if (
      !source ||
      typeof source.id !== "string" ||
      !/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(source.id) ||
      ids.has(source.id)
    )
      throw new Error("Invalid or duplicate run ID");
    ids.add(source.id);
    if (typeof source.directory !== "string" || !source.directory)
      throw new Error("Run directory is required");
    if (
      source.host &&
      (!/^[a-z][a-z0-9-]*$/.test(source.host) ||
        !/^\/[a-zA-Z0-9/_.-]+$/.test(source.runtime ?? "") ||
        !source.directory.startsWith("/"))
    )
      throw new Error(
        "Remote runs require a host, absolute directory, and absolute runtime path",
      );
    return {
      ...source,
      directory: source.host
        ? source.directory
        : resolve(directory, source.directory),
    };
  });
}

export function api(sources: Source[], fleet: string) {
  let saved: Run[] | undefined;
  let readAt = 0;
  let pending: Promise<Run[]> | undefined;
  const read = async () => {
    if (pending) return pending;
    if (saved && Date.now() - readAt < 10_000) return saved;
    pending = Promise.all(sources.map((source) => readRun(source, fleet)))
      .then((runs) => {
        saved = runs.map((run, index) => {
          const previous = saved?.[index];
          if (
            run.error &&
            !run.snapshot &&
            !run.heartbeat &&
            (previous?.snapshot || previous?.heartbeat)
          )
            return {
              ...run,
              kind: previous.kind,
              observedAt: previous.observedAt,
              snapshot: previous.snapshot,
              heartbeat: previous.heartbeat,
              stale: true,
            };
          return run;
        });
        readAt = Date.now();
        return saved;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
      (request.headers.has("origin") &&
        request.headers.get("origin") !== url.origin)
    )
      return new Response("Forbidden", { status: 403 });
    if (request.method !== "GET")
      return new Response("Read-only", { status: 405 });
    let id: string | undefined;
    if (url.pathname !== "/api/runs") {
      if (!url.pathname.startsWith("/api/runs/"))
        return new Response("Not found", { status: 404 });
      try {
        id = decodeURIComponent(url.pathname.slice("/api/runs/".length));
      } catch {
        return new Response("Invalid run ID", { status: 400 });
      }
      if (!sources.some((source) => source.id === id))
        return new Response("Not found", { status: 404 });
    }
    const runs = await read();
    return Response.json(
      id === undefined ? runs : runs.find((run) => run.id === id),
      { headers: { "cache-control": "no-store" } },
    );
  };
}

if (import.meta.main) {
  await verifyInstall(resolve(import.meta.dir, "../../.."));
  const { values, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      port: { type: "string", default: "8797" },
      fleet: {
        type: "string",
        default: resolve(import.meta.dir, "../../../../fleet-infra"),
      },
    },
  });
  if (positionals.length !== 1)
    throw new Error(
      "Usage: server.ts CONFIG.json [--port 8797] [--fleet FLEET_INFRA]",
    );
  const config = resolve(positionals[0]!);
  const sources = readSources(await Bun.file(config).json(), dirname(config));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(values.port),
    routes: { "/": index, "/api/*": api(sources, values.fleet!) },
    fetch(request) {
      if (request.method !== "GET")
        return new Response("Read-only", { status: 405 });
      return new Response("Not found", { status: 404 });
    },
    development: false,
  });
  console.log(`Xean Observe: ${server.url}`);
  const close = () => {
    void server.stop(true);
  };
  process.once("SIGINT", close);
  process.once("SIGTERM", close);
}
