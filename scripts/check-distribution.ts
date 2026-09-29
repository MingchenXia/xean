import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import manifest from "../package.json";
import provenance from "../vendor/pi/provenance.json";

const root = resolve(import.meta.dir, "..");
const workspaces = new Map<
  string,
  {
    directory: string;
    exports?: Record<string, string>;
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }
>();
for await (const file of new Bun.Glob("packages/*/package.json").scan(root)) {
  const workspace = await Bun.file(resolve(root, file)).json();
  assert.equal(
    workspace.version,
    manifest.version,
    `${file}: release version drift`,
  );
  workspaces.set(workspace.name, {
    ...workspace,
    directory: dirname(resolve(root, file)),
  });
}
// The CLI and observer are sibling clients. Cross-package imports use public APIs.
const parser = new Bun.Transpiler({ loader: "ts" });
for (const [name, workspace] of workspaces) {
  const allowed = (target: string) =>
    target === name || (name !== "xean" && target === "xean");
  for (const target of Object.keys({
    ...workspace.dependencies,
    ...workspace.optionalDependencies,
    ...workspace.peerDependencies,
    ...workspace.devDependencies,
  }))
    if (workspaces.has(target))
      assert.ok(allowed(target), `${name} must not depend on ${target}`);
  for await (const path of new Bun.Glob("{src,web}/**/*.ts").scan(
    workspace.directory,
  )) {
    const file = resolve(workspace.directory, path);
    for (const { path: imported } of parser.scanImports(
      (await Bun.file(file).text()).replace(/^#![^\n]*\n/, ""),
    )) {
      for (const [target, dependency] of workspaces) {
        if (imported === target || imported.startsWith(`${target}/`)) {
          assert.ok(allowed(target), `${file}: forbidden import ${imported}`);
          const entry =
            imported === target ? "." : `.${imported.slice(target.length)}`;
          assert.ok(
            Object.hasOwn(dependency.exports ?? {}, entry),
            `${file}: ${imported} is not a public export`,
          );
        } else if (imported.startsWith(".") && target !== name) {
          const destination = resolve(dirname(file), imported);
          assert.ok(
            !destination.startsWith(`${dependency.directory}/`),
            `${file}: use a public package import for ${imported}`,
          );
        }
      }
    }
  }
}
for (const record of [...provenance.artifacts, ...provenance.patches]) {
  const bytes = await readFile(resolve(root, record.path));
  assert.equal(
    createHash("sha256").update(bytes).digest("hex"),
    record.sha256,
    `${record.path}: provenance hash mismatch`,
  );
  if ("bytes" in record) assert.equal(bytes.length, record.bytes, record.path);
}
for (const artifact of provenance.artifacts) {
  assert.equal(
    manifest.catalog[artifact.name as keyof typeof manifest.catalog],
    `file:${artifact.path}`,
    `${artifact.name}: catalog drift`,
  );
  const installed = await Bun.file(
    resolve(root, "node_modules", artifact.name, "package.json"),
  ).json();
  assert.equal(
    installed.version,
    artifact.version,
    `${artifact.name}: installed version drift`,
  );
}

// Bun parses Markdown, including reference links and fenced code blocks.
const documents = new Map<string, { anchors: Set<string>; links: string[] }>();
const files = ["README.md", "AGENTS.md", "CHANGELOG.md"];
for await (const file of new Bun.Glob("{docs,packages,vendor}/**/*.md").scan(
  root,
))
  files.push(file);
for (const file of files) {
  const links: string[] = [];
  const anchors = new Set<string>();
  Bun.markdown.render(
    await Bun.file(resolve(root, file)).text(),
    {
      heading(children, { id }) {
        if (id) anchors.add(id);
        return children;
      },
      link(children, { href }) {
        links.push(href);
        return children;
      },
      image(children, { src }) {
        links.push(src);
        return children;
      },
    },
    { headings: { ids: true } },
  );
  documents.set(resolve(root, file), { links, anchors });
}
const failures: string[] = [];
for (const [file, { links }] of documents) {
  for (const link of links) {
    const url = new URL(link, pathToFileURL(file));
    if (url.protocol !== "file:") continue;
    const target = fileURLToPath(url);
    try {
      assert.ok(
        !relative(root, target).startsWith(".."),
        "target leaves the distribution",
      );
      await access(target);
      if (url.hash && documents.has(target))
        assert.ok(
          documents
            .get(target)!
            .anchors.has(decodeURIComponent(url.hash.slice(1))),
          "missing heading",
        );
    } catch (error) {
      failures.push(`${relative(root, file)}: ${link}: ${String(error)}`);
    }
  }
}
assert.deepEqual(failures, [], "Broken documentation links");
console.log(
  `Distribution ${manifest.version}: dependency provenance and ${documents.size} Markdown files checked`,
);
