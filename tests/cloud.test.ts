import { expect, test } from "bun:test";
import { accessSync, constants, existsSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const wrapper = join(root, "scripts/cloud-codex.sh");
const readonlyAuth = ["/sys", "/nix/store", "/System"].find((path) => {
  if (!existsSync(path)) return false;
  try {
    accessSync(path, constants.W_OK);
    return false;
  } catch {
    return true;
  }
});
const bootstrapAvailable =
  process.platform === "linux" &&
  process.arch === "x64" &&
  ["node", "npm", "curl", "tar"].every((tool) => Bun.which(tool));

test("cloud Codex uses each invocation's native account and preserves output and exit status", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-cloud-account-"));
  const executable = join(directory, "codex-fixture");
  const receipt = join(directory, "receipt.json");
  // This stub records selectors only. It never reads authentication files.
  await writeFile(
    executable,
    `#!${process.execPath}
const fs = require('node:fs');
fs.writeFileSync(process.env.XEAN_CLOUD_RECEIPT, JSON.stringify({
  args: process.argv.slice(2), home: process.env.HOME,
  codexHome: process.env.CODEX_HOME, proxy: process.env.HTTPS_PROXY,
  ca: process.env.NODE_EXTRA_CA_CERTS
}));
process.stdout.write('native stdout\\n');
process.stderr.write('native stderr\\n');
process.exit(Number(process.env.XEAN_CLOUD_FIXTURE_EXIT || 0));
`,
  );
  await chmod(executable, 0o755);
  try {
    for (const account of ["first", "second"]) {
      const auth = join(directory, account);
      await mkdir(auth);
      const cloud = join(directory, 'cloud "with spaces"');
      const home = join(directory, "native-home");
      const env = {
        ...process.env,
        XEAN_CODEX_COMMAND: executable,
        XEAN_CLOUD_DIR: cloud,
        XEAN_CLOUD_RECEIPT: receipt,
        XEAN_CLOUD_FIXTURE_EXIT: account === "first" ? "0" : "23",
        HOME: home,
        CODEX_HOME: auth,
        HTTPS_PROXY: "http://fixture-proxy:8080",
        NODE_EXTRA_CA_CERTS: "",
      };
      // Synthetic selectors apply only to the fixture, not real native login.
      const args =
        account === "first"
          ? [
              "exec",
              "--sandbox",
              "workspace-write",
              "--model",
              "gpt-6.1-sol",
              "-",
            ]
          : ["login", "--device-auth"];
      const result = Bun.spawnSync(["bash", wrapper, ...args], {
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(account === "first" ? 0 : 23);
      expect(result.stdout.toString()).toBe("native stdout\n");
      expect(result.stderr.toString()).toBe("native stderr\n");
      const observed = JSON.parse(await readFile(receipt, "utf8"));
      expect(observed.codexHome).toBe(auth);
      expect(observed.home).toBe(home);
      expect(observed.proxy).toBe(env.HTTPS_PROXY);
      expect(observed.ca).toBe(env.NODE_EXTRA_CA_CERTS);
      expect(observed.args).toEqual([
        "-c",
        `sqlite_home=${JSON.stringify(join(cloud, "state"))}`,
        "-c",
        `log_dir=${JSON.stringify(join(cloud, "log"))}`,
        ...args,
      ]);
      expect((await readdir(cloud)).sort()).toEqual(["log", "state"]);
      expect(await readdir(auth)).toEqual([]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test.skipIf(!readonlyAuth)(
  "read-only native initialization is diagnosed without launching Codex",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "xean-cloud-readonly-"));
    try {
      const result = Bun.spawnSync(["bash", wrapper, "exec", "--json"], {
        env: {
          ...process.env,
          XEAN_CODEX_COMMAND: process.execPath,
          XEAN_CLOUD_DIR: directory,
          CODEX_HOME: readonlyAuth!,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(result.exitCode).toBe(73);
      expect(result.stdout.toString()).toBe("");
      expect(result.stderr.toString()).toContain(
        "sandbox_permissions=require_escalated",
      );
      expect(result.stderr.toString()).toContain("Do not move or copy");
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test.skipIf(!bootstrapAvailable)(
  "Linux x86_64 cloud bootstrap rejects corrupt Bun before extraction or installation",
  async () => {
    const directory = await mkdtemp(join(tmpdir(), "xean-cloud-integrity-"));
    try {
      await mkdir(join(directory, "cache"));
      await writeFile(
        join(directory, "cache/oven-bun-linux-x64-1.4.2.tgz"),
        "corrupt archive",
      );
      const result = Bun.spawnSync(
        ["bash", join(root, "scripts/cloud.sh"), "setup"],
        {
          env: { ...process.env, XEAN_CLOUD_DIR: directory },
          stdout: "pipe",
          stderr: "pipe",
        },
      );
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr.toString()).toContain("archive integrity mismatch");
      expect(result.stdout.toString()).toBe("");
      expect(await Bun.file(join(directory, "bun/bin/bun")).exists()).toBe(
        false,
      );
      expect(
        await Bun.file(join(directory, "codex-settings.json")).exists(),
      ).toBe(false);
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test("cloud implementation uses the current role module and reopens without a new Codex call", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-cloud-role-"));
  try {
    const executable = join(directory, "codex-fixture");
    const receipt = join(directory, "receipt.json");
    const settings = join(directory, "settings.json");
    const database = join(directory, "campaign.sqlite");
    const auth = join(directory, "fixture-auth");
    await mkdir(auth);
    await writeFile(
      executable,
      `#!${process.execPath}
const input = JSON.parse(await Bun.stdin.text());
await Bun.write(process.env.XEAN_CLOUD_RECEIPT, JSON.stringify({
  args: process.argv.slice(2), workspace: process.cwd()
}));
const result = { notes: [{
  id: input.noteIdPrefix + "implementation", summary: "Fixture implementation",
  detailedSummary: "Checks the cloud role integration without model calls.",
  text: "Scripted backend result; no mathematical claim.", support: [], candidate: false
}] };
console.log(JSON.stringify({ type: "item.completed", item: {
  type: "agent_message", text: JSON.stringify(result)
} }));
console.log(JSON.stringify({ type: "turn.completed", usage: { output_tokens: 7 } }));
`,
    );
    await chmod(executable, 0o700);
    const env = {
      ...process.env,
      XEAN_CODEX_COMMAND: executable,
      XEAN_CLOUD_DIR: join(directory, "cloud"),
      XEAN_CLOUD_RECEIPT: receipt,
      CODEX_HOME: auth,
    };
    async function run(...args: string[]) {
      const child = Bun.spawn([process.execPath, "--no-env-file", ...args], {
        cwd: root,
        env,
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exit] = await Promise.all([
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
        child.exited,
      ]);
      expect(exit, stderr).toBe(0);
      return stdout;
    }
    await run("scripts/cloud-settings.ts", settings);
    await run(
      "apps/cli/index.ts",
      "init",
      "examples/task.json",
      join(directory, "native.sqlite"),
      settings,
    );
    const flags = ["apps/cli/index.ts", "--roles", "scripts/cloud-roles.ts"];
    const result = JSON.parse(
      await run(
        ...flags,
        "role",
        "implementation",
        "examples/codex-worker-input.json",
        database,
        settings,
      ),
    );
    expect(result.status).toBe("completed");
    const call = JSON.parse(await readFile(receipt, "utf8"));
    expect(call.args).toContain("workspace-write");
    expect(call.args).toContain("gpt-6.1-sol");
    expect(call.args).toContain('model_reasoning_effort="xhigh"');
    expect(
      call.workspace.startsWith(join(root, "runs/cloud-codex/artifacts/")),
    ).toBe(true);
    expect(await readdir(auth)).toEqual([]);
    await rm(executable);
    const reopened = JSON.parse(await run(...flags, "run", database));
    expect(reopened.status).toBe("completed");
    expect(await readFile(receipt, "utf8")).toBe(JSON.stringify(call));
    await rm(call.workspace, { recursive: true });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
