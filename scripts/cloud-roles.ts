import { resolve } from "node:path";
import { codex } from "xean/plugins/codex";

const root = resolve(import.meta.dir, "..");
export default codex({
  implementation: {
    model: "gpt-6.1-sol",
    reasoning: "xhigh",
    command: resolve(root, "scripts/cloud-codex.sh"),
    workspace: resolve(root, "runs/cloud-codex/artifacts"),
  },
});
