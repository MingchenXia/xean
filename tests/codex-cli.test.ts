import { expect, test } from "bun:test";
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-durable";
import {
  Xean,
  openXeanStorage,
  type XeanOptions,
} from "../packages/core/src/index.ts";
import { piRuntime, readSettings } from "../packages/core/src/solve/config.ts";
import { ask } from "../packages/core/src/solve/pi.ts";
import { auditedStream } from "../packages/core/src/pi.ts";
import type { CallRecorder } from "../packages/core/src/calls.ts";

async function fixture(mode: string) {
  const directory = await mkdtemp(join(tmpdir(), "xean-codex-cli-"));
  const home = join(directory, "native-home");
  await mkdir(home);
  await writeFile(join(home, "auth.json"), "native-auth-fixture");
  await writeFile(join(home, "cloud.config.toml"), "");
  await chmod(home, 0o500);
  const command = join(directory, "codex");
  await writeFile(
    command,
    `#!${process.execPath}\n${await Bun.file(new URL("./fixtures/codex-cli.ts", import.meta.url)).text()}`,
    { mode: 0o700 },
  );
  const log = join(directory, "invocations.jsonl");
  const ready = join(directory, "ready");
  const runtime = piRuntime(
    readSettings({
      usagePrefix: "fixture",
      profiles: {
        default: {
          provider: "codex-cli",
          model: "gpt-6-astra",
          command,
          profile: "cloud",
        },
      },
    }),
    "unused-shared-key",
  );
  for (const profile of Object.values(runtime.profiles))
    profile.options = {
      ...profile.options,
      env: {
        CODEX_HOME: home,
        XEAN_TEST_CODEX_LOG: log,
        XEAN_TEST_CODEX_MODE: mode,
        XEAN_TEST_CODEX_READY: ready,
      },
    };
  return {
    directory,
    home,
    log,
    ready,
    runtime,
    async close() {
      await chmod(home, 0o700);
      await rm(directory, { recursive: true, force: true });
    },
  };
}

test("Codex CLI reuses read-only native auth, executes Pi tools, and reopens without another call", async () => {
  const f = await fixture("role");
  let reads = 0;
  const options: XeanOptions = {
    task: null,
    roles: [],
    accept: () => true,
    coordinator: {
      name: "fixture",
      async run(_signal, _view, execution, context) {
        const result = await ask(
          f.runtime,
          "coordinator",
          "Read the number, square it, and submit the result.",
          null,
          Type.Object({ answer: Type.Number() }),
          execution,
          context,
          {
            tools: [
              defineTool({
                name: "lookup",
                description: "Read a number",
                parameters: Type.Object({ value: Type.Number() }),
                replay: "safe",
                async execute(value) {
                  reads++;
                  return {
                    content: [
                      { type: "text", text: JSON.stringify(value.value) },
                    ],
                  };
                },
              }),
            ],
          },
        );
        return { state: null, completion: result };
      },
    },
  };
  const path = join(f.directory, "campaign.sqlite");
  let engine = await Xean.open(await openXeanStorage(path), options);
  try {
    expect(await engine.run()).toMatchObject({
      status: "completed",
      result: { answer: 25 },
      providerCalls: 2,
    });
    expect(reads).toBe(1);
    const records = await engine.records();
    const settlements = records.filter(
      (record) => record.kind === "xean.call.settled",
    );
    expect(settlements).toHaveLength(2);
    expect(settlements[0]!.data).toMatchObject({
      message: { codexCli: { failed: false, exitCode: 0 } },
      usage: { input: 8, cacheRead: 3, output: 5, totalTokens: 16 },
    });
    const calls = (await readFile(f.log, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls).toHaveLength(2);
    for (const call of calls) {
      expect(call.auth).toBe(join(f.home, "auth.json"));
      expect(call.profile).toBe(true);
      expect(call.home).not.toBe(f.home);
      expect(call.args).toContain("cloud");
      expect(call.args).toContain('model_reasoning_effort="max"');
      expect(call.args).toContain("features.shell_tool=false");
      expect(call.args).toContain('web_search="disabled"');
      expect(call.args).not.toContain("login");
      expect(call.usageTag).toStartWith("fixture/");
      await expect(access(call.home)).rejects.toThrow();
    }
    expect(
      calls[1]!.input.messages.some(
        (message: { role: string }) => message.role === "toolResult",
      ),
    ).toBe(true);
    expect(
      calls[1]!.input.messages.every(
        (message: Record<string, unknown>) =>
          !("codexCli" in message) && !("usage" in message),
      ),
    ).toBe(true);
    expect(JSON.stringify(records)).not.toContain("native-auth-fixture");
    expect(await readFile(join(f.home, "auth.json"), "utf8")).toBe(
      "native-auth-fixture",
    );
    await engine.close();
    engine = await Xean.open(await openXeanStorage(path), options);
    expect(await engine.run()).toMatchObject({
      status: "completed",
      result: { answer: 25 },
      providerCalls: 2,
    });
    expect((await readFile(f.log, "utf8")).trim().split("\n")).toHaveLength(2);
  } finally {
    await engine.close();
    await f.close();
  }
});

test("Codex CLI completion and failures retain usage and finish authentication cleanup", async () => {
  for (const [mode, error] of [
    ["complete", ""],
    ["invalid", "Codex final answer was not JSON"],
    ["unknown", "invalid tool selection"],
    ["arguments", "JSON object"],
    ["failed", "Fixture failed after reporting usage"],
  ]) {
    const f = await fixture(mode!);
    try {
      const profile = f.runtime.profiles.explorer;
      const stream = f.runtime.models.streamSimple(
        profile.model,
        {
          messages: [{ role: "user", content: "Submit", timestamp: 0 }],
          tools: [
            {
              name: "submit_result",
              description: "Submit",
              parameters: Type.Object({ answer: Type.Number() }),
            },
          ],
        },
        profile.options,
      );
      const result = await stream.result();
      expect(result.stopReason).toBe(error ? "error" : "toolUse");
      if (error) {
        expect(result.errorMessage).toContain(error);
        expect(result.content).toEqual([]);
      } else
        expect(result.content).toMatchObject([
          { name: "submit_result", arguments: { answer: 25 } },
        ]);
      expect(result.usageReported).toBe(true);
      expect(result.usage).toMatchObject({
        input: 8,
        cacheRead: 3,
        output: 5,
        totalTokens: 16,
      });
      const call = JSON.parse((await readFile(f.log, "utf8")).trim());
      await expect(access(call.home)).rejects.toThrow();
    } finally {
      await f.close();
    }
  }
});

test("Codex CLI cancellation settles usage and removes its temporary authenticated runtime", async () => {
  const f = await fixture("wait");
  const controller = new AbortController();
  let settlement: unknown;
  let requests = 0;
  const recorder: CallRecorder = {
    async begin() {
      return {
        async recordRequest() {
          requests++;
        },
        async settle(message, usage) {
          settlement = { message, usage };
        },
      };
    },
  };
  const profile = f.runtime.profiles.explorer;
  const stream = auditedStream(f.runtime.models, recorder)(
    profile.model,
    {
      messages: [{ role: "user", content: "Wait", timestamp: 0 }],
    },
    { ...profile.options, signal: controller.signal },
  );
  try {
    for (
      const deadline = Date.now() + 3000;
      !(await Bun.file(f.ready).exists());
    ) {
      if (Date.now() > deadline) throw new Error("Codex fixture did not start");
      await Bun.sleep(10);
    }
    controller.abort();
    const result = await stream.result();
    expect(result.stopReason).toBe("aborted");
    expect(requests).toBe(1);
    expect(settlement).toMatchObject({
      message: { stopReason: "aborted" },
      usage: { input: 8, cacheRead: 3, output: 5 },
    });
    const call = JSON.parse((await readFile(f.log, "utf8")).trim());
    await expect(access(call.home)).rejects.toThrow();
    await access(join(f.home, "auth.json"));
  } finally {
    controller.abort();
    await stream.result();
    await f.close();
  }
});
