# Pi artifacts

Xean consumes the five packages listed in [provenance.json](provenance.json)
from Pi commit `1ff5b6fddf69c322c6937781a720f97e87c93774`.
The tarballs contain upstream build output. The root
catalog selects them, and dependency overrides apply the same selections to
Pi's internal dependencies. Their upstream package version remains `0.87.1`.
The commit and artifact hashes identify this build.

Normal installation uses Xean's existing locked Bun command, documented in the
[root README](../../README.md). Bun installs the artifacts selected by the
lockfile and applies the retained Pi AI and durable patches.
The install receipt also fingerprints
the local tarball bytes, workspace manifests, lockfile, and patch bytes.

## Rebuilding

Check out the exact upstream commit and use its `package-lock.json` with
`npm ci --ignore-scripts --no-audit --no-fund`. The upstream Node/npm build is
an explicit external-package exception to the Fleet Bun policy: Pi's official
workspace scripts, compiler, and npm lock define this build contract. Xean's
installation, orchestration, and tests continue to use Fleet's locked Bun.
The Node/npm versions used for these artifacts are recorded in the provenance.

Pi's model values are a second build input. They were hydrated once with the
upstream `npm run hydrate:model-data` command and are frozen in the AI tarball
under `package/dist/providers/data/`. This upgrade refreshes the snapshot because
the new provider factories require classifier catalogs absent from the previous
data. To rebuild, extract that directory,
including `.manifest.json`, into the checkout's `packages/ai/src/providers/data/`.
Check the manifest SHA-256 against the provenance. Rehydrating queries live
catalogs and creates a new snapshot.

Run the upstream builds in this order from the Pi checkout:

```sh
npm --prefix packages/chord run build
npm --prefix packages/telemetry run build
npm --prefix packages/ai run build:offline
npm --prefix packages/durable run build
npm --prefix packages/agent run build
```

In each package directory, run
`npm pack --ignore-scripts --pack-destination <absolute-output-directory>`.
Compare the resulting SHA-256 values with `provenance.json`.
The recorded hashes matched across two builds, each starting with empty package
output directories and the same frozen model data.
The tarballs retain the upstream manifests, exports, documentation, and source
maps. The checkout, build dependencies, and expanded generated files stay outside
the committed artifact set.

## Patch maintenance

The tarballs contain unpatched upstream output. Xean's patches live
in `patches/` and are applied during Bun installation. Each key in
`patchedDependencies` uses the exact tarball resolution, without the `file:`
prefix. A `name@0.87.1` key does not match these local artifacts.

The AI patch retains measured usage on failed and zero-token
responses, custom Codex authentication and credential-specific connection
identity, deferred body serialization, session debug cleanup, and JSON repair
allocation reduction. Retry listener cleanup covers both the Codex transport
and `retryAssistantCall` backoffs. The assistant retry classifier also treats
authentication, invalid-request, and explicit context-limit errors as terminal
when their detail contains transient-looking text.
Codex failures retain structured status, type, and code for the same native
retry classifier. This permits bounded recovery for new server-error codes and
activates the existing HTTP fallback after transient typed WebSocket failures.
Quota and billing exhaustion remain terminal, including HTTP 429 responses.
Related upstream reports are [#7444](https://github.com/earendil-works/pi/issues/7444)
for WebSocket recovery and [#9702](https://github.com/earendil-works/pi/issues/9702)
for preserving structured failure metadata.
When updating Pi or a patch, review each change and adjust hunks where needed.
Compare every installed patched file with a separately extracted tarball after
applying the patch with `git apply`.
A patch accepted by Bun alone does not verify correct placement.

The Pi durable patch adds `SqliteStorage.open(db, {readOnly: true})`. It checks
the existing schema instead of running migrations, and rejects `commit` and
`mintId`. All record decoding, document reconstruction, and scans remain native.
Xean supplies the read-only SQLite connection and its snapshot transaction.
It also exposes native `Tx.setTask()` and record-only task creation to Xean's
external scheduler, and preserves explicit entry `byTaskId` outside a Harness
invocation. These use the existing native validation and transaction paths.
Remove each extension when upstream supplies the corresponding guarantee.
The [alignment notes](../../docs/pi-alignment.md#durable-integration) record the
Harness admission, terminal settlement, and shutdown gaps that require external
scheduling.
