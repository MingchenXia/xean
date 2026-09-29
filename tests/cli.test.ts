import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { version } from "../package.json";
import { declarationVersion } from "xean/solve";

test("CLI metadata stays model-free, shares flags, and releases ownership after failures", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-cli-"));
  const entry = resolve(import.meta.dir, "../packages/cli/src/index.ts");
  const run = (...args: string[]) => {
    const result = Bun.spawnSync(
      [process.execPath, "--no-install", "--no-env-file", entry, ...args],
      { cwd: directory, timeout: 5000 },
    );
    return {
      code: result.exitCode,
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  };
  try {
    // Package scripts must keep the invoking Bun even when PATH finds an older one.
    await writeFile(join(directory, "bun"), "#!/bin/sh\nexit 99\n", {
      mode: 0o755,
    });
    const packageRun = Bun.spawnSync(
      [process.execPath, "run", "xean", "--version"],
      {
        cwd: resolve(import.meta.dir, ".."),
        env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
        timeout: 5000,
      },
    );
    expect(packageRun.exitCode).toBe(0);
    expect(packageRun.stdout.toString().trim()).toBe(version);
    const versionResult = run("--version");
    expect(versionResult.code).toBe(0);
    expect(versionResult.stdout.trim()).toBe(version);
    const task = { problem: "P", completionCriteria: "Prove P" };
    await writeFile(join(directory, "task.json"), JSON.stringify(task));
    await writeFile(
      join(directory, "settings.json"),
      JSON.stringify({
        profiles: { default: { provider: "openai", model: "unavailable" } },
        limits: { providerCalls: 0 },
      }),
    );
    const init = ["init", "task.json", "example", "settings.json"];
    for (const args of [
      ["--records", ...init],
      [...init, "--records"],
    ]) {
      const result = run(...args);
      expect(result.code).toBe(0);
      const report = JSON.parse(result.stdout);
      expect(Array.isArray(report.records)).toBe(true);
      expect(report.campaign.providerCalls).toBe(0);
    }
    const plain = run(...init);
    expect(plain.code).toBe(0);
    expect(JSON.parse(plain.stdout).records).toBeUndefined();

    await writeFile(
      join(directory, "notes.json"),
      JSON.stringify({
        candidate: false,
        notes: [
          {
            id: "n1",
            text: "Note",
            summary: "Summary",
            detailedSummary: "Note",
            support: [],
          },
        ],
      }),
    );
    for (const args of [
      ["submit", "example", "notes.json", "--id", "import"],
      ["extend", "example", "1", "--id", "grant"],
    ])
      expect(run(...args).code).toBe(0);
    const report = JSON.parse(run("inspect", "example").stdout);
    expect(report.campaign).toMatchObject({
      providerCalls: 0,
      callAllowance: 1,
    });
    expect(report.notes[0].text).toBe("Note");

    const rejected = run("export", "example");
    expect(rejected.code).not.toBe(0);
    expect(rejected.stderr).toContain("No accepted argument");
    await writeFile(
      join(directory, "task.json"),
      JSON.stringify({ ...task, problem: "Different task" }),
    );
    const mismatch = run(...init);
    expect(mismatch.code).not.toBe(0);
    expect(mismatch.stderr).toContain("Task differs");
    await writeFile(join(directory, "task.json"), JSON.stringify(task));
    expect(run(...init).code).toBe(0);

    const help = run("run", "--help");
    expect(help.code).toBe(0);
    expect(help.stdout).toContain("--records");
    expect(help.stdout).toContain("--key-stdin");
  } finally {
    await rm(directory, { recursive: true });
  }
});

test("CLI inspects solver campaign kinds, drains large output, and restricts execution declarations", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-cli-output-"));
  const entry = resolve(import.meta.dir, "../packages/cli/src/index.ts");
  const kinds = ["xean.solve", "xean.solve.offline", "xean.solve.library"];
  const argument = "For every integer n, 2n is even.\n".repeat(65_536);
  try {
    // Isolate the large SQLite fixture from native handles retained by earlier tests.
    const initializing = Bun.spawn(
      [
        process.execPath,
        "--no-install",
        "--no-env-file",
        "--eval",
        `import { Xean, openXeanStorage } from "xean";
import { join } from "node:path";
const { directory, kinds, argument, version } = await Bun.stdin.json();
for (const kind of kinds) {
const engine = await Xean.open(await openXeanStorage(join(directory, kind + ".sqlite")), {
  task: { kind, version,
    task: { problem: "Even integers", completionCriteria: "Prove 2n is even" },
    settings: { profiles: { default: { provider: "openai", model: "unavailable" } } },
  }, roles: [],
  coordinator: { name: "output-fixture", run: () => ({ state: null, completion: { argument } }) },
  accept: () => true,
});
try {
  await engine.input({ kind: "submit", id: "fixture", candidate: false,
    notes: [{ id: "n1", text: "2n is even.", summary: "Even", detailedSummary: "Even integer", support: [] }],
  });
  await engine.run();
} finally { await engine.close(); }
}`,
      ],
      {
        cwd: resolve(import.meta.dir, ".."),
        stdin: Buffer.from(
          JSON.stringify({
            directory,
            kinds,
            argument,
            version: declarationVersion,
          }),
        ),
        stdout: "ignore",
        stderr: "pipe",
      },
    );
    const [initialError, initialCode] = await Promise.all([
      new Response(initializing.stderr).text(),
      initializing.exited,
    ]);
    expect(initialError).toBe("");
    expect(initialCode).toBe(0);
    for (const kind of kinds) {
      const database = join(directory, `${kind}.sqlite`);
      if (kind !== "xean.solve") {
        const rejected = Bun.spawnSync([
          process.execPath,
          "--no-install",
          "--no-env-file",
          entry,
          "run",
          database,
        ]);
        expect(rejected.exitCode).not.toBe(0);
        expect(rejected.stderr.toString()).toContain("Invalid value");
      }
      for (const command of ["inspect", "export"]) {
        const child = Bun.spawn(
          [
            process.execPath,
            "--no-install",
            "--no-env-file",
            entry,
            command,
            database,
          ],
          { stdout: "pipe", stderr: "pipe" },
        );
        // Let the producer fill its pipe before the consumer starts reading.
        await Bun.sleep(100);
        const [stdout, stderr, code] = await Promise.all([
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
          child.exited,
        ]);
        expect(stderr).toBe("");
        expect(code).toBe(0);
        if (command === "inspect") {
          const report = JSON.parse(stdout);
          expect(report.campaign.providerCalls).toBe(0);
          expect(report.notes[0].text).toBe("2n is even.");
          expect(report.campaign.result.argument).toBe(argument);
        } else expect(stdout).toBe(argument + "\n");
      }
    }
  } finally {
    await rm(directory, { recursive: true });
  }
});
