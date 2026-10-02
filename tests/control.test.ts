import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID } from "@earendil-works/pi-durable";
import { Xean, inspectCampaign, openXeanStorage } from "xean";
import { serveControl } from "../packages/cli/src/control.ts";

async function cli(...args: string[]) {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-install",
      "--no-env-file",
      resolve(import.meta.dir, "../packages/cli/src/index.ts"),
      ...args,
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

test("conditional controls reject a successor or missing owner before mutation", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-control-"));
  const database = join(directory, "campaign.sqlite");
  const ownerId = " successor/数学 ";
  const engine = await Xean.open(await openXeanStorage(database), {
    task: null,
    roles: [],
    coordinator: { name: "fixture", run: () => ({ state: null }) },
  });
  const server = await serveControl(await realpath(database), engine, ownerId);
  try {
    const rejected = await cli(
      "pause",
      database,
      "--expected-owner-id",
      "predecessor",
    );
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("Campaign owner changed");
    expect((await engine.inspect()).status).toBe("running");
    expect(
      (await cli("pause", database, "--expected-owner-id", ownerId)).code,
    ).toBe(0);
    expect((await engine.inspect()).status).toBe("paused");
    await server.close();
    await engine.close();
    const missing = await cli(
      "cancel",
      database,
      "--expected-owner-id",
      ownerId,
    );
    expect(missing.code).not.toBe(0);
    expect(missing.stderr).toContain("Expected campaign owner is unavailable");
    expect((await inspectCampaign(database)).campaign.status).toBe("paused");
  } finally {
    await server.close();
    await engine.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("inspection distinguishes interrupted initialization from foreign or unreadable databases", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-uninitialized-"));
  const database = join(directory, "campaign.sqlite");
  const inspect = () => cli("inspect", database, "--allow-uninitialized");
  try {
    const empty = new Database(database, { create: true });
    empty.run("VACUUM");
    empty.close();
    const bytes = await readFile(database);
    expect((await cli("inspect", database)).code).not.toBe(0);
    expect(JSON.parse((await inspect()).stdout)).toEqual({ campaign: null });
    expect(await readFile(database)).toEqual(bytes);
    const storage = await openXeanStorage(database);
    await storage.close(BACKGROUND_CONTEXT);
    expect(JSON.parse((await inspect()).stdout)).toEqual({ campaign: null });
    const foreign = await openXeanStorage(database);
    await foreign.commit(
      [{ type: "conversation", value: { id: ROOT_CONVERSATION_ID } }],
      BACKGROUND_CONTEXT,
    );
    await foreign.close(BACKGROUND_CONTEXT);
    expect((await inspect()).code).not.toBe(0);
    expect(
      (
        await cli(
          "inspect",
          join(directory, "missing.sqlite"),
          "--allow-uninitialized",
        )
      ).code,
    ).not.toBe(0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
