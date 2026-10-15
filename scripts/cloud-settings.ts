import { rename, rm, writeFile } from "node:fs/promises";
import { readSettings } from "xean/roles";

const path = process.argv[2];
if (!path) throw new Error("Expected generated cloud settings path");
const settings = readSettings({
  // Standalone Codex does not use or authenticate this Pi profile.
  profiles: {
    default: {
      provider: "openai-codex",
      model: "gpt-6.1-sol",
      reasoning: "xhigh",
    },
  },
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
