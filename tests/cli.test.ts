import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

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
        notes: [{ id: "n1", text: "Note", summary: "Summary", support: [] }],
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
