#!/usr/bin/env bun
import { resolve, dirname, isAbsolute } from "node:path";
import { parseArgs } from "node:util";
import { readProcess, readRun, type Source, type Run } from "./read.ts";
import { verifyInstall } from "../../../scripts/dependencies.ts";
import index from "../web/index.html";

export function readSources(value: unknown, directory: string): Source[] {
  if (!Array.isArray(value)) throw new Error("Config must be a list of runs");
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
      source.task !== undefined &&
      (typeof source.task !== "string" || !source.task.trim())
    )
      throw new Error("Nomad task must be a nonempty string");
    if (
      source.review !== undefined &&
      (typeof source.review !== "string" ||
        !source.review.trim() ||
        isAbsolute(source.review))
    )
      throw new Error("Review receipt must be a nonempty relative path");
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

export function api(
  sources: Source[] | (() => Promise<Source[]>),
  fleet: string,
) {
  type Refresh = {
    sources: Promise<Source[]>;
    runs?: Promise<Run[]>;
    expiresAt: number;
  };
  let current: Refresh | undefined;
  let previous = new Map<string, Run>();
  const refresh = () => {
    if (current && Date.now() < current.expiresAt) return current;
    const batch: Refresh = {
      sources: Promise.resolve().then(() =>
        Array.isArray(sources) ? sources : sources(),
      ),
      expiresAt: Infinity,
    };
    current = batch;
    void batch.sources.then(
      () => {
        batch.expiresAt = Date.now() + 10_000;
      },
      () => {
        if (current === batch) current = undefined;
      },
    );
    return batch;
  };
  const read = async (configured: Source[]): Promise<Run[]> => {
    const processes = new Map<string, ReturnType<typeof readProcess>>();
    const entries = await Promise.all(
      configured.map(async (source) => {
        const identity = JSON.stringify([
          source.id,
          source.host ?? null,
          source.directory,
        ]);
        let observation;
        if (source.job) {
          const key = JSON.stringify([source.job, source.task ?? "solver"]);
          observation = processes.get(key) ?? readProcess(source, fleet);
          processes.set(key, observation);
        }
        const run = await readRun(source, fleet, observation);
        const retained = previous.get(identity);
        return [
          identity,
          run.error &&
          !run.snapshot &&
          !run.heartbeat &&
          (retained?.snapshot || retained?.heartbeat)
            ? {
                ...run,
                kind: retained.kind,
                observedAt: retained.observedAt,
                snapshot: retained.snapshot,
                heartbeat: retained.heartbeat,
                stale: true,
              }
            : run,
        ] as const;
      }),
    );
    previous = new Map(entries);
    return [...previous.values()];
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
    }
    const batch = refresh();
    let configured: Source[];
    try {
      configured = await batch.sources;
    } catch (error) {
      return new Response(
        `Source configuration unavailable: ${String(error)}`,
        { status: 500 },
      );
    }
    if (id !== undefined && !configured.some((source) => source.id === id))
      return new Response("Not found", { status: 404 });
    if (!batch.runs) {
      batch.expiresAt = Infinity;
      batch.runs = read(configured).finally(() => {
        batch.expiresAt = Date.now() + 10_000;
      });
    }
    const runs = await batch.runs;
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
  const sources = () =>
    Bun.file(config)
      .json()
      .then((value) => readSources(value, dirname(config)));
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
