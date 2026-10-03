import { rename, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { readSettings } from "xean/solve";

const root = resolve(import.meta.dir, "..");
const path = process.argv[2];
if (!path) throw new Error("Expected generated cloud settings path");
const settings = readSettings({
  // Standalone Codex does not construct a Pi runtime or authenticate this profile.
  profiles: {
    default: {
      provider: "openai-codex",
      model: "gpt-6.1-sol",
      reasoning: "xhigh",
    },
  },
  codex: {
    model: "gpt-6.1-sol",
    reasoning: "xhigh",
    command: resolve(root, "scripts/cloud-codex.sh"),
    workspace: resolve(root, "runs/cloud-codex/artifacts"),
  },
  limits: { concurrency: 1, attempts: 1, providerCalls: 1 },
});
const staged = `${path}.${crypto.randomUUID()}.tmp`;
try {
  await writeFile(staged, JSON.stringify(settings, null, 2) + "\n", {
    mode: 0o600,
    flag: "wx",
  });
  await rename(staged, path);
} finally {
  await rm(staged, { force: true });
}
