import { once } from "node:events";
import { mkdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { acquireOwnership, open, type OpenOptions } from "../../src/host.ts";
import { serveControl } from "./control.ts";
import { controlCommand } from "./lifecycle.ts";

export type HostCommand = { kind: "attach" | "detach"; database: string };
export const hostPath = (directory: string) => join(directory, ".host");

/** Own independent Pi Harnesses; the databases supply all durable state. */
export async function serveHost(
  directory: string,
  options: Pick<OpenOptions, "roles" | "key" | "usagePrefix"> & {
    models: NonNullable<OpenOptions["models"]>;
    ownerId?: string;
    onError?: (database: string, error: unknown) => void;
    signal?: AbortSignal;
  },
) {
  const abort = new AbortController();
  const signal = options.signal
    ? AbortSignal.any([abort.signal, options.signal])
    : abort.signal;
  signal.throwIfAborted();
  await mkdir(directory, { recursive: true });
  directory = await realpath(directory);
  signal.throwIfAborted();
  const release = acquireOwnership(hostPath(directory));
  const report =
    options.onError ?? ((path, error) => console.error(path, error));
  type Attached = {
    owner: Awaited<ReturnType<typeof open>>;
    control: Awaited<ReturnType<typeof serveControl>>;
  };
  const owners = new Map<
    string,
    { ready: Promise<Attached>; closing?: Promise<void> }
  >();
  let control: Awaited<ReturnType<typeof serveControl>> | undefined;
  let closing: Promise<void> | undefined;
  const detach = async (path: string) => {
    const entry = owners.get(path);
    if (!entry) return;
    return (entry.closing ??= (async () => {
      try {
        const { owner, control } = await entry.ready;
        try {
          await control.close(true);
        } finally {
          await owner.close();
        }
      } catch (error) {
        if (error !== signal.reason) throw error;
      } finally {
        owners.delete(path);
      }
    })());
  };
  const close = () =>
    (closing ??= (async () => {
      abort.abort(new Error("Host is stopping"));
      try {
        const results = await Promise.allSettled([
          control?.close(true),
          ...Array.from(owners.keys(), detach),
        ]);
        for (const result of results)
          if (result.status === "rejected") throw result.reason;
      } finally {
        release();
      }
    })());
  try {
    const execute = async (command: HostCommand) => {
      signal.throwIfAborted();
      if (command.kind !== "attach" && command.kind !== "detach")
        throw new Error("Expected attach or detach");
      const path = await realpath(command.database);
      if (
        dirname(dirname(path)) !== directory ||
        basename(path) !== "campaign.sqlite"
      )
        throw new Error(
          "Shared host requires CAMPAIGN_DIR/NAME/campaign.sqlite",
        );
      signal.throwIfAborted();
      if (command.kind === "detach") {
        await detach(path);
        return { database: path, attached: false };
      }
      if (!owners.has(path)) {
        const ready = (async () => {
          const owner = await open(path, options);
          let control: Attached["control"] | undefined;
          try {
            signal.throwIfAborted();
            control = await serveControl(
              path,
              (command) => controlCommand(owner, command),
              options.ownerId,
            );
            signal.throwIfAborted();
            void owner.harness.closed
              .then(() => detach(path))
              .catch((error) => report(path, error));
            owner.harness.resume();
            return { owner, control };
          } catch (error) {
            await control?.close(true).catch(() => {});
            await owner.close().catch(() => {});
            throw error;
          }
        })();
        owners.set(path, { ready });
        void ready.catch(() => owners.delete(path));
      }
      const entry = owners.get(path)!;
      if (entry.closing) throw new Error("Campaign is closing; retry attach");
      await entry.ready;
      return { database: path, attached: true };
    };
    control = await serveControl(hostPath(directory), execute, options.ownerId);
    for await (const database of new Bun.Glob("*/campaign.sqlite").scan({
      cwd: directory,
      dot: true,
      absolute: true,
    })) {
      signal.throwIfAborted();
      await execute({ kind: "attach", database }).catch((error) => {
        if (error === signal.reason) throw error;
        report(database, error);
      });
    }
    return { close, execute };
  } catch (error) {
    await close().catch(() => {});
    throw error;
  }
}

/** One signal handler per host; campaign cancellation stays in Pi. */
export async function runHost(
  directory: string,
  options: Parameters<typeof serveHost>[1],
) {
  const abort = new AbortController();
  const stop = once(abort.signal, "abort");
  const interrupt = () => abort.abort();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const host = await serveHost(directory, {
      ...options,
      signal: abort.signal,
    });
    try {
      await stop;
    } finally {
      await host.close();
    }
  } catch (error) {
    if (!abort.signal.aborted || error !== abort.signal.reason) throw error;
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
