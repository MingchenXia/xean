import { appendFile, lstat, readlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const args = process.argv.slice(2);
const input = await Bun.stdin.json();
const schema = await Bun.file(
  args[args.indexOf("--output-schema") + 1]!,
).json();
const home = process.env.CODEX_HOME!;
await appendFile(
  process.env.XEAN_TEST_CODEX_LOG!,
  JSON.stringify({
    args,
    input,
    schema,
    home,
    auth: (await lstat(join(home, "auth.json"))).isSymbolicLink()
      ? await readlink(join(home, "auth.json"))
      : "native",
    profile: (await lstat(join(home, "cloud.config.toml"))).isSymbolicLink(),
    proxyPresent: Boolean(process.env.HTTPS_PROXY),
    usageTag: process.env.XEAN_CODEX_USAGE_TAG,
  }) + "\n",
);
const mode = process.env.XEAN_TEST_CODEX_MODE;
const read = input.messages.some(
  (message: { role: string }) => message.role === "toolResult",
);
const value = {
  text: "",
  calls: [
    {
      name:
        mode === "unknown"
          ? "unavailable"
          : mode === "role" && !read
            ? "lookup"
            : "submit_result",
      arguments:
        mode === "arguments"
          ? "[]"
          : JSON.stringify(
              mode === "role" && !read ? { value: 5 } : { answer: 25 },
            ),
    },
  ],
};
const event = (value: unknown) => console.log(JSON.stringify(value));
if (mode !== "wait")
  event({
    type: "item.completed",
    item: {
      type: "agent_message",
      text: mode === "invalid" ? "not JSON" : JSON.stringify(value),
    },
  });
event({
  type: "turn.completed",
  usage: { input_tokens: 11, cached_input_tokens: 3, output_tokens: 5 },
});
if (mode === "wait") {
  await writeFile(process.env.XEAN_TEST_CODEX_READY!, "ready");
  setInterval(() => {}, 1000);
}
if (mode === "failed") {
  console.error("Fixture failed after reporting usage");
  process.exitCode = 7;
}
