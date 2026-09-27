import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

async function fingerprint(root: string): Promise<string> {
  const manifest = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ) as {
    catalog?: Record<string, string>;
    patchedDependencies?: Record<string, string>;
    workspaces?: string[];
  };
  const workspaces = new Set<string>();
  for (const pattern of manifest.workspaces ?? []) {
    let found = false;
    for await (const path of new Bun.Glob(`${pattern}/package.json`).scan({
      cwd: root,
      onlyFiles: true,
    })) {
      workspaces.add(path);
      found = true;
    }
    if (!found) throw new Error(`Missing workspace manifest: ${pattern}`);
  }
  const hash = createHash("sha256").update(Bun.version);
  for (const file of [
    "package.json",
    "bun.lock",
    ...[...workspaces].sort(),
    ...Object.values(manifest.patchedDependencies ?? {}).sort(),
    ...Object.values(manifest.catalog ?? {})
      .filter((specifier) => specifier.startsWith("file:"))
      .map((specifier) => specifier.slice("file:".length))
      .sort(),
  ]) {
    hash
      .update(file)
      .update("\0")
      .update(await readFile(resolve(root, file)));
  }
  return hash.digest("hex");
}

const receipt = (root: string) => resolve(root, "node_modules/.xean-install");

export async function recordInstall(root: string): Promise<void> {
  await writeFile(receipt(root), await fingerprint(root));
}

export async function verifyInstall(root: string): Promise<void> {
  const installed = await readFile(receipt(root), "utf8").catch(() => "");
  if (installed !== (await fingerprint(root))) {
    throw new Error(
      "Dependencies or patches changed. Run bun run setup with the intended Bun runtime before checking.",
    );
  }
}
