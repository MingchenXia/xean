import { expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { recordInstall, verifyInstall } from "../scripts/dependencies.ts";

test("install receipts reject missing evidence and changed dependency inputs", async () => {
  const root = await mkdtemp(join(tmpdir(), "xean-dependencies-"));
  const inputs = {
    "package.json": JSON.stringify({
      workspaces: ["packages/*"],
      catalog: {
        fixture: "1.0.0",
        vendored: "file:vendor/fixture.tgz",
      },
      patchedDependencies: { "fixture@1.0.0": "fixture.patch" },
    }),
    "bun.lock": '{"lockfileVersion": 1}',
    "fixture.patch": "original patch bytes",
    "vendor/fixture.tgz": "original package artifact bytes",
    "packages/cli/package.json": '{"name":"xean-cli"}',
  };
  try {
    await mkdir(join(root, "node_modules"));
    await mkdir(join(root, "packages/cli"), { recursive: true });
    await mkdir(join(root, "vendor"));
    await Promise.all(
      Object.entries(inputs).map(([path, content]) =>
        writeFile(join(root, path), content),
      ),
    );
    await expect(verifyInstall(root)).rejects.toThrow(
      "Dependencies or patches changed",
    );
    await recordInstall(root);
    await expect(verifyInstall(root)).resolves.toBeUndefined();
    for (const field of ["platform", "arch"]) {
      const foreign = Bun.spawnSync(
        [
          process.execPath,
          "--no-install",
          "--no-env-file",
          "--eval",
          `import { verifyInstall } from ${JSON.stringify(
            new URL("../scripts/dependencies.ts", import.meta.url).href,
          )};
           Object.defineProperty(process, ${JSON.stringify(field)}, { value: "different" });
           await verifyInstall(${JSON.stringify(root)});`,
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      expect(foreign.exitCode).not.toBe(0);
      expect(foreign.stderr.toString()).toContain(
        "Dependencies or patches changed",
      );
    }
    for (const [path, original] of Object.entries(inputs)) {
      const changed =
        path === "package.json"
          ? original.replace('"1.0.0"', '"2.0.0"')
          : original + "\nchanged";
      await writeFile(join(root, path), changed);
      await expect(verifyInstall(root)).rejects.toThrow(
        "Dependencies or patches changed",
      );
      await writeFile(join(root, path), original);
      await expect(verifyInstall(root)).resolves.toBeUndefined();
    }
  } finally {
    await rm(root, { recursive: true });
  }
});
