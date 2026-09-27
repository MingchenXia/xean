import { resolve } from "node:path";
import { smokeSetup } from "./smoke.ts";

const { root, bun, env, credential, runId, directory } =
  await smokeSetup("codex-lb");
for (const mode of ["live", "resume"]) {
  const child = Bun.spawn(
    [
      ...bun,
      resolve(root, "examples/codex-lb-smoke.ts"),
      mode,
      directory,
      runId,
    ],
    {
      env,
      stdin: mode === "live" ? credential : "ignore",
      stdout: "inherit",
      stderr: "inherit",
    },
  );
  const code = await child.exited;
  if (code !== 0)
    throw new Error(
      `${mode} smoke failed with exit ${code}; evidence: ${directory}`,
    );
}
console.log(JSON.stringify({ directory, runId }));
