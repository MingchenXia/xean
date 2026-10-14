import { expect, spyOn, test } from "bun:test";
import { mkdir, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { awaitWithContext } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { defaultSettings } from "../src/roles/config.ts";
import { open, inspect, ResearchOwnedError } from "../src/host.ts";
import { readStatus } from "../src/report.ts";
import { hostPath, serveHost, type HostCommand } from "../apps/cli/host.ts";
import { requestOwner, socketPath } from "../apps/cli/control.ts";
import { temporaryDirectory } from "./directory.ts";

const root = resolve(import.meta.dir, "..");
const spawn = (...args: string[]) =>
  Bun.spawn([process.execPath, ...args], { stdout: "pipe", stderr: "pipe" });
const command = (...args: string[]) =>
  spawn(join(root, "apps/cli/index.ts"), ...args);

async function output(child: ReturnType<typeof spawn>) {
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  expect(stderr).toBe("");
  expect(code).toBe(0);
  return stdout;
}

async function initialize(directory: string, name: string) {
  const path = join(directory, name, "campaign.sqlite");
  const owner = await open(path, {
    create: {
      task: { problem: name, completionCriteria: "A complete proof." },
      settings: defaultSettings,
    },
  });
  await owner.close();
  return realpath(path);
}

const hostCommand = (
  directory: string,
  kind: HostCommand["kind"],
  database: string,
) => requestOwner(hostPath(directory), { kind, database });

test("shared owners suspend independently and recover Pi checkpoints after detach and host restart", async () => {
  const directory = await realpath(
    await temporaryDirectory("xean-shared-recovery-"),
  );
  const first = await initialize(directory, "first");
  const second = await initialize(directory, "second");
  const started = new Map(
    ["first", "second"].map((name) => [name, Promise.withResolvers<void>()]),
  );
  const checkpoints = new Map<string, number>();
  const blocked = new Promise<never>(() => {});
  const models = createModels();
  const options: Parameters<typeof serveHost>[1] = {
    models,
    ownerId: "shared-test",
    roles: () => ({
      coordinator: async (input, runtime, ctx) => {
        const name = input.task.problem;
        if (!(await runtime.memo<string>("test.checkpoint", ctx))) {
          checkpoints.set(name, (checkpoints.get(name) ?? 0) + 1);
          await runtime.memo("test.checkpoint", name, ctx);
        }
        started.get(name)!.resolve();
        await awaitWithContext(blocked, ctx);
      },
    }),
  };
  let host = await serveHost(directory, options);
  try {
    await Promise.all(Array.from(started.values(), ({ promise }) => promise));
    expect(await hostCommand(directory, "detach", first)).toMatchObject({
      attached: false,
    });
    expect(await Bun.file(socketPath(first)).exists()).toBe(false);
    const detached = await open(first, { models });
    await detached.close();
    await expect(open(second, { models })).rejects.toBeInstanceOf(
      ResearchOwnedError,
    );
    expect(
      await requestOwner(
        second,
        { kind: "guide", id: "while-first-closed", text: "Continue." },
        "shared-test",
      ),
    ).toHaveProperty("id");
    started.set("first", Promise.withResolvers<void>());
    await Promise.all([
      hostCommand(directory, "attach", first),
      hostCommand(directory, "attach", first),
    ]);
    await started.get("first")!.promise;
    expect(checkpoints.get("first")).toBe(1);
    await host.close();
    for (const path of [first, second]) {
      expect(await Bun.file(socketPath(path)).exists()).toBe(false);
      expect(await Bun.file(`${path}.owner.sqlite`).exists()).toBe(true);
    }
    for (const name of started.keys())
      started.set(name, Promise.withResolvers<void>());
    host = await serveHost(directory, options);
    await Promise.all(Array.from(started.values(), ({ promise }) => promise));
    expect(Object.fromEntries(checkpoints)).toEqual({ first: 1, second: 1 });
    expect(await requestOwner(second, { kind: "cancel" })).toMatchObject({
      status: "cancelled",
    });
    expect((await inspect(first, readStatus)).status).not.toBe("cancelled");
  } finally {
    await host.close();
  }
});

test("shared host isolates invalid databases, excludes another host, and attaches newly initialized campaigns", async () => {
  const directory = await realpath(
    await temporaryDirectory("xean-shared-startup-"),
  );
  const good = await initialize(directory, "good");
  await mkdir(join(directory, "bad"));
  await Bun.write(
    join(directory, "bad", "campaign.sqlite"),
    "invalid database",
  );
  const errors: unknown[] = [];
  const options = {
    models: createModels(),
    roles: () => ({ coordinator: async () => ({ work: null }) }),
    onError: (_database: string, error: unknown) => errors.push(error),
  };
  const host = await serveHost(directory, options);
  try {
    expect(errors).toHaveLength(1);
    await expect(serveHost(directory, options)).rejects.toBeInstanceOf(
      ResearchOwnedError,
    );
    expect(await requestOwner(good, { kind: "pause" })).toMatchObject({
      status: "paused",
    });
    const later = await initialize(directory, "later");
    expect(await hostCommand(directory, "attach", later)).toMatchObject({
      attached: true,
    });
    expect(await requestOwner(later, { kind: "pause" })).toMatchObject({
      status: "paused",
    });
    await hostCommand(directory, "detach", later);
    await hostCommand(directory, "attach", later);
    expect((await inspect(later, readStatus)).status).toBe("paused");
    const outside = await initialize(
      await temporaryDirectory("xean-outside-host-"),
      "outside",
    );
    await expect(hostCommand(directory, "attach", outside)).rejects.toThrow(
      "CAMPAIGN_DIR/NAME/campaign.sqlite",
    );
  } finally {
    await host.close();
  }
  expect(await Bun.file(socketPath(hostPath(directory))).exists()).toBe(false);
  const nextHost = await serveHost(directory, options);
  await nextHost.close();
});

test("detaching interrupts an awaiting resume request and releases ownership", async () => {
  const directory = await realpath(
    await temporaryDirectory("xean-shared-resume-"),
  );
  const path = await initialize(directory, "pending");
  const started = Promise.withResolvers<void>();
  let runWorker = false;
  const host = await serveHost(directory, {
    models: createModels(),
    roles: () => ({
      coordinator: async () => ({
        work: runWorker
          ? { kind: "explorer", assignment: "Wait for cancellation." }
          : null,
      }),
      explorer: async (_input, _runtime, ctx) => {
        started.resolve();
        await awaitWithContext(new Promise<never>(() => {}), ctx);
      },
    }),
  });
  try {
    await requestOwner(path, { kind: "pause" });
    runWorker = true;
    const resume = requestOwner(path, { kind: "resume" }).then(
      () => ({ interrupted: false }),
      () => ({ interrupted: true }),
    );
    await started.promise;
    expect(await hostCommand(directory, "detach", path)).toMatchObject({
      attached: false,
    });
    expect(await resume).toEqual({ interrupted: true });
    const owner = await open(path, { models: createModels() });
    await owner.close();
  } finally {
    await host.close();
  }
});

test.each(["SIGINT", "SIGTERM"])(
  "%s during shared host startup does not start campaigns",
  async (signal) => {
    const directory = await realpath(
      await temporaryDirectory("xean-shared-startup-signal-"),
    );
    const paths = await Promise.all([
      initialize(directory, "first"),
      initialize(directory, "second"),
    ]);
    const source = `
import { runHost } from ${JSON.stringify(join(root, "apps/cli/host.ts"))};
import { createModels } from ${JSON.stringify(import.meta.resolve("@earendil-works/pi-ai"))};
let opened = 0, ran = 0;
const errors = [];
await runHost(${JSON.stringify(directory)}, {
  models: createModels(),
  roles: () => {
    if (++opened === 1) process.emit(${JSON.stringify(signal)});
    return { coordinator: async () => { ran++; return { work: null }; } };
  },
  onError: (_database, error) => errors.push(String(error)),
});
console.log(JSON.stringify({ ran, errors, listeners: ["SIGINT", "SIGTERM"].map(signal => process.listenerCount(signal)) }));
`;
    const result = await output(spawn("--eval", source));
    expect(JSON.parse(result)).toEqual({
      ran: 0,
      errors: [],
      listeners: [0, 0],
    });
    for (const path of paths) {
      const owner = await open(path, { models: createModels() });
      await owner.close();
      expect(await Bun.file(socketPath(path)).exists()).toBe(false);
    }
    const host = await serveHost(directory, {
      models: createModels(),
      roles: () => ({ coordinator: async () => ({ work: null }) }),
    });
    await host.close();
  },
);

test("closing a host while an attachment opens prevents dispatch", async () => {
  const directory = await realpath(
    await temporaryDirectory("xean-shared-closing-"),
  );
  let ran = 0;
  const host = await serveHost(directory, {
    models: createModels(),
    roles: () => {
      void host.close();
      return {
        coordinator: async () => {
          ran++;
          return { work: null };
        },
      };
    },
  });
  const database = await initialize(directory, "late");
  try {
    await expect(host.execute({ kind: "attach", database })).rejects.toThrow(
      "Host is stopping",
    );
  } finally {
    await host.close();
  }
  expect(ran).toBe(0);
  expect(await Bun.file(socketPath(database)).exists()).toBe(false);
  const owner = await open(database, { models: createModels() });
  await owner.close();
});

test("failed native storage releases one campaign without stopping other owners", async () => {
  const directory = await realpath(
    await temporaryDirectory("xean-shared-failure-"),
  );
  const first = await initialize(directory, "first");
  const second = await initialize(directory, "second");
  const started = Promise.withResolvers<void>();
  const fail = Promise.withResolvers<void>();
  const reported = Promise.withResolvers<unknown>();
  const commits = spyOn(SqliteStorage.prototype, "commit");
  const diagnostics = spyOn(console, "error").mockImplementation(() => {});
  const host = await serveHost(directory, {
    models: createModels(),
    roles: () => ({
      coordinator: async (input, runtime, ctx) => {
        if (input.task.problem === "first") {
          started.resolve();
          await awaitWithContext(fail.promise, ctx);
          commits.mockImplementationOnce(async () => {
            throw new Error("storage failed");
          });
          await runtime.commit(() => {}, ctx);
        }
        return { work: null };
      },
    }),
    onError: (_database, error) => reported.resolve(error),
  });
  try {
    await started.promise;
    await requestOwner(second, { kind: "pause" });
    fail.resolve();
    expect(String(await reported.promise)).toContain("storage failed");
    expect(await Bun.file(socketPath(first)).exists()).toBe(false);
    const recovered = await open(first, { models: createModels() });
    await recovered.close();
    expect(await requestOwner(second, { kind: "resume" })).toMatchObject({
      status: "idle",
    });
  } finally {
    commits.mockRestore();
    diagnostics.mockRestore();
    await host.close();
  }
});

test("CLI role modules and shared control work without installing signal handlers per campaign", async () => {
  const directory = await realpath(
    await temporaryDirectory("xean-shared-cli-"),
  );
  const first = await initialize(directory, "first");
  const module = join(directory, "roles.ts");
  await initialize(directory, "second");
  await Bun.write(
    module,
    "export default () => ({ coordinator: async () => ({ work: null }) });",
  );
  const source = `
import { runHost } from ${JSON.stringify(join(root, "apps/cli/host.ts"))};
import { cliModels } from ${JSON.stringify(join(root, "apps/cli/models.ts"))};
const models = await cliModels();
const signals = ["SIGINT", "SIGTERM"];
const baseline = signals.map(signal => process.listenerCount(signal));
const listeners = () => signals.map((signal, index) => process.listenerCount(signal) - baseline[index]);
const running = runHost(${JSON.stringify(directory)}, { models, roles: (await import(${JSON.stringify(module)})).default });
const { requestOwner } = await import(${JSON.stringify(join(root, "apps/cli/control.ts"))});
while (await requestOwner(${JSON.stringify(first)}, {kind:"pause"}) === undefined) await Bun.sleep(10);
console.log(JSON.stringify(listeners()));
process.emit("SIGTERM");
await running;
console.log(JSON.stringify(listeners()));
`;
  const listeners = await output(spawn("--eval", source));
  expect(
    listeners
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line)),
  ).toEqual([
    [1, 1],
    [0, 0],
  ]);
  const resumed = await output(command("--roles", module, "resume", first));
  expect(JSON.parse(resumed).status).toBe("idle");
  const prefix = ["--campaign-dir", directory];
  const hosted = command(
    ...prefix,
    "--roles",
    module,
    "--owner-id",
    "cli-host",
    "host",
  );
  try {
    while ((await requestOwner(first, { kind: "pause" })) === undefined) {
      if (hosted.exitCode !== null)
        throw new Error("CLI host exited during startup");
      await Bun.sleep(10);
    }
    for (const kind of ["detach", "attach"] as const) {
      const child = command(
        ...prefix,
        "--expected-owner-id",
        "cli-host",
        kind,
        "first",
      );
      const receipt = JSON.parse(await output(child));
      expect(receipt).toMatchObject({ attached: kind === "attach" });
    }
    expect(
      await requestOwner(first, { kind: "resume" }, "cli-host"),
    ).toMatchObject({ status: "idle" });
  } finally {
    hosted.kill("SIGTERM");
    expect(await hosted.exited).toBe(0);
    expect(await new Response(hosted.stderr).text()).toBe("");
  }
  const reopened = await open(first, { models: createModels() });
  await reopened.close();
});
