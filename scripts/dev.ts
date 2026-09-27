import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import { recordInstall, verifyInstall } from "./dependencies.ts";

const root = resolve(import.meta.dir, "..");
const fleet = resolve(root, "../fleet-infra");
const command = process.argv[2];
const updateLockfile = process.argv[3] === "--update-lockfile";
if (
  process.argv.length > 4 ||
  (process.argv.length === 4 && (command !== "install" || !updateLockfile))
) {
  throw new Error("Only install accepts --update-lockfile.");
}

function run(argv: string[], env = process.env, cwd = root): void {
  const result = Bun.spawnSync(argv, {
    cwd,
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode !== 0) process.exit(result.exitCode ?? 1);
}

switch (command) {
  case "install":
    if (!updateLockfile && !existsSync(resolve(root, "bun.lock"))) {
      throw new Error(
        "bun.lock is missing. Restore it or explicitly use install --update-lockfile.",
      );
    }
    // A clean frozen installation qualifies the exact patch bytes we test.
    await rm(resolve(root, "node_modules"), { recursive: true, force: true });
    run([
      process.execPath,
      "install",
      "--ignore-scripts",
      ...(updateLockfile ? [] : ["--frozen-lockfile"]),
    ]);
    await recordInstall(root);
    break;
  case "format":
    run([process.execPath, "scripts/check.ts", "--write"]);
    break;
  case "check":
    await verifyInstall(root);
    if (!existsSync(resolve(fleet, "flake.lock"))) {
      throw new Error(
        `Fleet runtime authority is missing: ${fleet}/flake.lock`,
      );
    }
    run(
      [
        resolve(fleet, "bin/fleet-nix"),
        "flake",
        "check",
        "--impure",
        "--no-write-lock-file",
        "--print-build-logs",
        `path:${resolve(root, "nix")}`,
      ],
      {
        ...process.env,
        XEAN_SOURCE: root,
        XEAN_FLEET_INFRA: fleet,
      },
      fleet,
    );
    break;
  default:
    throw new Error(
      "Usage: scripts/dev.ts <install [--update-lockfile]|format|check>",
    );
}
