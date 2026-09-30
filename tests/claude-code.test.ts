import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { Type, type JsonValue } from "@earendil-works/pi-ai";
import { piRuntime, readSettings } from "../packages/core/src/solve/config.ts";
import { reportedPiUsage } from "../packages/core/src/pi.ts";
import { ask } from "../packages/core/src/solve/pi.ts";
import type { CallIdentity, CallRecorder } from "../packages/core/src/calls.ts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("Claude subscription profiles keep gateway credentials out and reject unsupported dispatch before launch", async () => {
  const profile = {
    provider: "claude-code",
    model: "claude-opus-5-5",
    reasoning: "max",
  };
  const settings = {
    profiles: {
      default: { provider: "openai", model: "gpt-6-astra" },
      explorer: profile,
      correctness: profile,
    },
  };
  for (const override of [
    { baseUrl: "https://gateway.invalid/v1" },
    { apiKeyEnv: "UNRELATED_GATEWAY_KEY" },
    { transport: "sse" },
  ])
    expect(() =>
      readSettings({
        profiles: { default: { ...profile, ...override } },
      }),
    ).toThrow("local subscription auth");

  const runtime = piRuntime(readSettings(settings), "unrelated-gateway-key");
  for (const name of ["explorer", "correctness"] as const) {
    const selected = runtime.profiles[name];
    expect(selected.model.id).toBe("claude-opus-5-5");
    expect(selected.model.provider).toBe("claude-code");
    expect(selected.options?.apiKey).toBeUndefined();
    expect(selected.options?.reasoning).toBe("max");
  }
  const controller = new AbortController();
  controller.abort();
  for (const options of [
    { apiKey: "must-not-be-forwarded" },
    { transport: "sse" as const },
    { reasoning: "minimal" as const },
    { signal: controller.signal },
  ]) {
    const result = await runtime.models.completeSimple(
      runtime.profiles.correctness.model,
      {
        messages: [{ role: "user", content: "Answer", timestamp: 0 }],
      },
      options,
    );
    expect(["error", "aborted"]).toContain(result.stopReason);
    if ("reasoning" in options)
      expect(result.errorMessage).toContain("minimal is unsupported");
    expect(result.content).toEqual([]);
    expect(reportedPiUsage(result)).toBeNull();
  }
});

test("Anthropic API and Claude subscription profiles remain distinct", () => {
  const variable = "XEAN_TEST_ANTHROPIC_KEY";
  const previous = process.env[variable];
  process.env[variable] = "fixture-anthropic-key";
  try {
    const api = piRuntime(
      readSettings({
        profiles: {
          default: {
            provider: "anthropic",
            model: "claude-opus-5-5",
            apiKeyEnv: variable,
            reasoning: "max",
          },
        },
      }),
    ).profiles.explorer;
    expect(api.model.provider).toBe("anthropic");
    expect(api.model.api).toBe("anthropic-messages");
    expect(api.options?.apiKey).toBe("fixture-anthropic-key");

    const subscription = piRuntime(
      readSettings({
        profiles: {
          default: {
            provider: "claude-code",
            model: "claude-opus-5-5",
            reasoning: "max",
          },
        },
      }),
      "must-not-be-used-by-subscription",
    ).profiles.explorer;
    expect(subscription.model.provider).toBe("claude-code");
    expect(subscription.model.api).toBe("claude-code");
    expect(subscription.options?.apiKey).toBeUndefined();
  } finally {
    if (previous === undefined) delete process.env[variable];
    else process.env[variable] = previous;
  }
});

test("Claude cancellation joins its resistant process before returning", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-claude-test-"));
  const command = join(directory, "claude");
  const pidPath = join(directory, "pid");
  const authModule = resolve(
    import.meta.dir,
    "../packages/core/node_modules/pi-claude-code-provider/src/auth.ts",
  );
  await writeFile(
    command,
    `#!${process.execPath}\nimport { REQUIRED_HEADLESS_FLAGS } from ${JSON.stringify(authModule)};
if (process.argv.includes("--version")) console.log("2.1.281");
else if (process.argv.includes("--help")) console.log(REQUIRED_HEADLESS_FLAGS.join(" "));
else if (process.argv.includes("auth")) console.log(JSON.stringify({loggedIn:true,authMethod:"claude.ai",apiProvider:"firstParty",subscriptionType:"max"}));
else {
  process.on("SIGTERM", () => {});
  await Bun.stdin.text();
  await Bun.write(${JSON.stringify(pidPath)}, String(process.pid));
  setInterval(() => {}, 1000);
}\n`,
    { mode: 0o700 },
  );
  const previous = process.env.PI_CLAUDE_CODE_PROVIDER_PATH;
  process.env.PI_CLAUDE_CODE_PROVIDER_PATH = command;
  const controller = new AbortController();
  let pid: number | undefined;
  const alive = () => {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  try {
    const runtime = piRuntime(
      readSettings({
        profiles: {
          default: { provider: "claude-code", model: "claude-opus-5-5" },
        },
      }),
    );
    const result = runtime.models.completeSimple(
      runtime.profiles.explorer.model,
      { messages: [{ role: "user", content: "Wait", timestamp: 0 }] },
      { signal: controller.signal, reasoning: "max" },
    );
    const deadline = Date.now() + 3000;
    while (!(await Bun.file(pidPath).exists()) && Date.now() < deadline)
      await Bun.sleep(5);
    pid = Number(await readFile(pidPath, "utf8"));
    expect(Number.isSafeInteger(pid) && pid > 0).toBeTrue();
    controller.abort();
    expect((await result).stopReason).toBe("aborted");
    expect(alive()).toBeFalse();
  } finally {
    controller.abort();
    if (alive()) process.kill(pid!, "SIGKILL");
    const deadline = Date.now() + 3000;
    while (alive() && Date.now() < deadline) await Bun.sleep(5);
    if (previous === undefined) delete process.env.PI_CLAUDE_CODE_PROVIDER_PATH;
    else process.env.PI_CLAUDE_CODE_PROVIDER_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}, 10_000);

test("Claude Code fixture hands a Pi submission through its tool bridge", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-claude-submit-"));
  const command = join(directory, "claude");
  const authModule = resolve(
    import.meta.dir,
    "../packages/core/node_modules/pi-claude-code-provider/src/auth.ts",
  );
  await writeFile(
    command,
    `#!${process.execPath}
import { REQUIRED_HEADLESS_FLAGS } from ${JSON.stringify(authModule)};
if (process.argv.includes("--version")) console.log("2.1.281");
else if (process.argv.includes("--help")) console.log(REQUIRED_HEADLESS_FLAGS.join(" "));
else if (process.argv.includes("auth")) console.log(JSON.stringify({loggedIn:true,authMethod:"claude.ai",apiProvider:"firstParty",subscriptionType:"max"}));
else {
  const config = JSON.parse(process.argv[process.argv.indexOf("--mcp-config") + 1]);
  const ready = config.mcpServers?.pi?.env?.PI_CLAUDE_TOOL_READY;
  if (typeof ready === "string") await Bun.write(ready, "ready");
  // Let the provider's readiness poll observe the marker before the handoff.
  await Bun.sleep(100);
  const catalogPath = process.env.PI_CLAUDE_TOOL_CATALOG;
  const catalog = catalogPath ? await Bun.file(catalogPath).json() : [];
  const tool = catalog[0]?.name;
  if (typeof tool !== "string") throw new Error("fixture did not receive a Pi tool catalog");
  const transport = "mcp__pi__" + tool;
  console.log(JSON.stringify({type:"system",subtype:"init",tools:[transport],permissionMode:"dontAsk",slash_commands:[],skills:[],plugins:[],apiKeySource:"none",mcp_server_errors:[],mcp_servers:[{name:"pi",status:"connected"}],model:"claude-opus-5-5"}));
  console.log(JSON.stringify({type:"stream_event",event:{type:"message_start",message:{id:"fixture-message",model:"claude-opus-5-5",usage:{input_tokens:5,output_tokens:0}}}}));
  console.log(JSON.stringify({type:"stream_event",event:{type:"content_block_start",index:0,content_block:{type:"tool_use",id:"fixture-call",name:transport,input:{answer:7}}}}));
  console.log(JSON.stringify({type:"stream_event",event:{type:"content_block_stop",index:0}}));
  console.log(JSON.stringify({type:"stream_event",event:{type:"message_delta",delta:{stop_reason:"tool_use"},usage:{output_tokens:1}}}));
  console.log(JSON.stringify({type:"stream_event",event:{type:"message_stop"}}));
  process.on("SIGTERM", () => process.exit(143));
  await Bun.stdin.text();
  setInterval(() => {}, 1000);
}
`,
    { mode: 0o700 },
  );
  const previous = process.env.PI_CLAUDE_CODE_PROVIDER_PATH;
  process.env.PI_CLAUDE_CODE_PROVIDER_PATH = command;
  const calls: CallIdentity[] = [];
  const recorder: CallRecorder = {
    begin(identity) {
      calls.push(identity);
      return {
        recordRequest(_payload: JsonValue) {},
        settle(_message: unknown, _usage: unknown | null) {},
      };
    },
  };
  try {
    const runtime = piRuntime(
      readSettings({
        profiles: {
          default: { provider: "claude-code", model: "claude-opus-5-5" },
        },
      }),
    );
    const answer = await ask(
      runtime,
      "explorer",
      "Return the answer through submit_result.",
      {},
      Type.Object({ answer: Type.Number() }),
      { attemptId: "claude-submit-fixture", attempt: 1, recorder },
      BACKGROUND_CONTEXT,
    );
    expect(answer).toEqual({ answer: 7 });
    expect(calls).toEqual([
      { provider: "claude-code", id: "claude-opus-5-5", api: "claude-code" },
    ]);
  } finally {
    if (previous === undefined) delete process.env.PI_CLAUDE_CODE_PROVIDER_PATH;
    else process.env.PI_CLAUDE_CODE_PROVIDER_PATH = previous;
    await rm(directory, { recursive: true, force: true });
  }
}, 15_000);
