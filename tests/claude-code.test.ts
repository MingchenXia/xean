import { expect, test } from "bun:test";
import { piRuntime, readSettings } from "../packages/core/src/solve/config.ts";
import { reportedPiUsage } from "../packages/core/src/pi.ts";
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
    expect(result.content).toEqual([]);
    expect(reportedPiUsage(result)).toBeNull();
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
