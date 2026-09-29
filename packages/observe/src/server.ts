#!/usr/bin/env bun
import { resolve, dirname, basename } from "node:path";
import { parseArgs } from "node:util";
import { readRun, type Source, type Run } from "./read.ts";
import { verifyInstall } from "../../../scripts/dependencies.ts";

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
        saved = runs;
        readAt = Date.now();
        return runs;
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
    const runs = await read();
    const id = url.pathname.startsWith("/api/runs/")
      ? decodeURIComponent(url.pathname.slice("/api/runs/".length))
      : undefined;
    const value = id
      ? runs.find((run) => run.id === id)
      : url.pathname === "/api/runs"
        ? runs
        : undefined;
    return value
      ? Response.json(value, { headers: { "cache-control": "no-store" } })
      : new Response("Not found", { status: 404 });
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
  const built = await Bun.build({
    entrypoints: [resolve(import.meta.dir, "../web/app.ts")],
    target: "browser",
    conditions: ["browser", "production"],
    define: { "process.env.NODE_ENV": '"production"' },
    publicPath: "/assets/",
    naming: {
      entry: "[name].[ext]",
      chunk: "[name]-[hash].[ext]",
      asset: "[name]-[hash].[ext]",
    },
    minify: true,
  });
  if (!built.success)
    throw new AggregateError(built.logs, "Observer build failed");
  const assets = new Map<string, Blob>(
    built.outputs.map((file) => [`/assets/${basename(file.path)}`, file]),
  );
  for (const name of ["chao-ui.css", "site.css"])
    assets.set(`/${name}`, Bun.file(resolve(import.meta.dir, "../web", name)));
  assets.set("/", Bun.file(resolve(import.meta.dir, "../web/index.html")));
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: Number(values.port),
    routes: { "/api/*": api(sources, values.fleet!) },
    fetch(request) {
      if (request.method !== "GET")
        return new Response("Read-only", { status: 405 });
      const file = assets.get(new URL(request.url).pathname);
      return file
        ? new Response(file)
        : new Response("Not found", { status: 404 });
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
