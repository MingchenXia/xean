import { existsSync, realpathSync, statSync } from "node:fs";
import { rm } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { recordInstall, verifyInstall } from "./dependencies.ts";

const root = resolve(import.meta.dir, "..");
const fleet = resolve(
  process.env.XEAN_FLEET_INFRA ?? resolve(root, "../fleet-infra"),
);
const command = process.argv[2];
const args = process.argv.slice(3);
const updateLockfile = command === "install" && args[0] === "--update-lockfile";
const usage =
  "Usage: scripts/dev.ts <install [--update-lockfile]|format|check|test tests/FILE.test.ts ...>";
if (
  command === "test"
    ? args.length === 0
    : args.length !== Number(updateLockfile)
)
  throw new Error(usage);
const testFiles =
  command === "test"
    ? args.map((file) => {
        const path = realpathSync(resolve(root, file));
        const name = relative(realpathSync(root), path);
        if (
          !name.startsWith("tests/") ||
          !name.endsWith(".test.ts") ||
          !statSync(path).isFile()
        )
          throw new Error(`Expected a test file inside tests/: ${file}`);
        return name;
      })
    : [];

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
  case "test":
    await verifyInstall(root);
    if (!existsSync(resolve(fleet, "flake.lock"))) {
      throw new Error(
        `Fleet runtime authority is missing: ${fleet}/flake.lock`,
      );
    }
    run(
      [
        resolve(fleet, "bin/fleet-nix"),
        "--read-only-dir",
        root,
        "build",
        "--file",
        resolve(root, "nix/check.nix"),
        "--impure",
        "--no-link",
        "--print-build-logs",
        "--argstr",
        "fleetRoot",
        fleet,
        "--argstr",
        "projectRoot",
        root,
        "--argstr",
        "testFilesJson",
        JSON.stringify(testFiles),
      ],
      {
        ...process.env,
        DOCKER_DEFAULT_PLATFORM: undefined,
        FLEET_INFRA_ROOT: fleet,
      },
      fleet,
    );
    break;
  default:
    throw new Error(usage);
}
