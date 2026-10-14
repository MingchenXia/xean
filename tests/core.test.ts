import { expect, test } from "bun:test";
import { $ } from "bun";
import { cp, mkdir, symlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { temporaryDirectory } from "./directory.ts";

test("custom roles publish and recover with only core files present", async () => {
  const directory = await temporaryDirectory("xean-core-");
  const root = resolve(import.meta.dir, "..");
  await mkdir(join(directory, "tests/fixtures"), { recursive: true });
  await cp(join(root, "src/core"), join(directory, "src/core"), {
    recursive: true,
  });
  await cp(
    join(root, "tests/fixtures/core.ts"),
    join(directory, "tests/fixtures/core.ts"),
  );
  await symlink(join(root, "node_modules"), join(directory, "node_modules"));
  const result =
    await $`${process.execPath} --no-install --no-env-file tests/fixtures/core.ts`
      .cwd(directory)
      .quiet()
      .nothrow();
  expect({ code: result.exitCode, stderr: result.stderr.toString() }).toEqual({
    code: 0,
    stderr: "",
  });
  expect(result.stdout.toString().trim()).toBe(
    "Core publication, recovery, and acceptance passed.",
  );
});
