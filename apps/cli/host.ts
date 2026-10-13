import { mkdir, readdir, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { acquireOwnership, open, type OpenOptions } from "../../src/host.ts";
import { serveControl } from "./control.ts";
import { cliModels } from "./models.ts";
import { controlCommand } from "./lifecycle.ts";

export type HostCommand = { kind: "attach" | "detach"; database: string };
export const hostPath = (directory: string) => join(directory, ".host");

/** Own independent Pi Harnesses; the databases supply all durable state. */
export async function serveHost(
  directory: string,
  options: Pick<OpenOptions, "models" | "roles" | "key" | "usagePrefix"> & {
    ownerId?: string;
    onError?: (database: string, error: unknown) => void;
  } = {},
) {
  await mkdir(directory, { recursive: true });
  directory = await realpath(directory);
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
  let stopping = false;
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
      } finally {
        owners.delete(path);
      }
    })());
  };
  const close = () =>
    (closing ??= (async () => {
      stopping = true;
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
    const models = options.models ?? (await cliModels());
    const execute = async (command: HostCommand) => {
      if (stopping) throw new Error("Host is stopping");
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
      if (stopping) throw new Error("Host is stopping");
      if (command.kind === "detach") {
        await detach(path);
        return { database: path, attached: false };
      }
      if (!owners.has(path)) {
        const ready = (async () => {
          const owner = await open(path, { ...options, models });
          let control: Attached["control"] | undefined;
          try {
            control = await serveControl(
              path,
              (command) => controlCommand(owner, command),
              options.ownerId,
            );
            void owner.harness.closed
              .then(() => detach(path))
              .catch((error) => report(path, error));
            owner.harness.resume();
            return { owner, control };
          } catch (error) {
            await Promise.allSettled([control?.close(true), owner.close()]);
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
    const campaigns = (
      await readdir(directory, { withFileTypes: true })
    ).filter((item) => item.isDirectory());
    await Promise.all(
      campaigns.map(async ({ name }) => {
        const database = join(directory, name, "campaign.sqlite");
        if (await Bun.file(database).exists())
          await execute({ kind: "attach", database }).catch((error) =>
            report(database, error),
          );
      }),
    );
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
  const stop = Promise.withResolvers<void>();
  const interrupt = () => stop.resolve();
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", interrupt);
  try {
    const host = await serveHost(directory, options);
    try {
      await stop.promise;
    } finally {
      await host.close();
    }
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", interrupt);
  }
}
