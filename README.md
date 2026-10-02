# Xean

Xean coordinates durable mathematical work over Pi. The kernel handles campaign
admission, atomic publication, limits, and recovery policy. The solver adds notes,
exploration, verification, and exact-task acceptance. Pi supplies model and tool
execution, private conversation recovery, task dispatch, storage records, and
atomic batches. Built-in model roles retain completed reads and submissions
across restarts, while shared notes publish only with a complete worker result. Chord supplies
invocation context and prepared state changes. Harness execution uses the
local controls documented in [Pi alignment](docs/pi-alignment.md#durable-integration).

The repository contains a core library and two optional applications:

| Package        | Location           | Responsibility                                                        |
| -------------- | ------------------ | --------------------------------------------------------------------- |
| `xean`         | `packages/core`    | Kernel, mathematical solver, providers, and shared inspection reports |
| `xean-cli`     | `packages/cli`     | Command parsing, terminal output, and live owner control              |
| `xean-observe` | `packages/observe` | Read-only dashboard, snapshot publisher, and bundled theme assets     |

Both applications depend on core's public APIs. Core depends on neither app,
and the apps do not depend on each other. Library callers can use `xean`,
`xean/solve`, `xean/pi`, and `xean/report` directly. Shared status projection
belongs to `xean/report`; command transport and presentation belong to the apps.
Repository checks enforce these dependency directions and public imports.

The CLI runs only when invoked. The [observer](packages/observe/README.md) runs
as a separate process and reads local campaigns or exported snapshots. Its
dashboard, publisher, HTML, CSS, and shared theme form one app. Solver execution
does not start or wait for it. The source archive and development setup include
all three packages, with one dependency lock and aligned package versions.

- [Philosophy](docs/philosophy.md): mathematical autonomy, shared memory, trust, and evaluation.
- [Kernel contract](docs/kernel.md): execution, publication, limits, and storage.
- [Solver guide](docs/solver.md): roles, verification, CLI commands, and configuration.
- [Glossary](docs/glossary.md): canonical terminology.
- [Pi alignment](docs/pi-alignment.md): native APIs and deferred adoption.
- [Verification](docs/kernel-smoke.md): checks and provider smoke procedures.
- [Changelog](CHANGELOG.md): changes and compatibility.
- [Contributor rules](AGENTS.md): design priorities and repository boundaries.

Matching Pi packages are pinned to the Pi 1.0.0 release commit in `package.json`.
The [artifact record](vendor/pi/provenance.json) records that source revision,
build, frozen model data, and hashes. The `main` branch is the current
distribution. Its three-view note format, updated Pi storage schema, and Harness
checkpoints require new campaigns. Historical campaigns require their original
source revision and runtime. Existing releases and tags remain historical archives.

## Install and run

Use Bun 1.4.2 on Linux or macOS. Clone `main` and install its locked dependencies.
The checkout includes the library, CLI, observer, pinned Pi packages, and patches.
Individual workspace packages are private and are not installed from npm.

```sh
git clone --branch main https://github.com/chaoxu/xean.git
cd xean
bun run setup
bun run xean --help
```

`setup` installs the frozen dependency lockfile without lifecycle scripts and
records the installation's dependency inputs, Bun version, operating system,
and architecture. Run it again after changing those inputs or copying a checkout
to another platform. `bun run xean --version` reports the package version.
Keep the exact source commit, lockfile, and runtime version with each campaign.
Package versions alone do not identify a `main` revision.

Check the installation without credentials or model calls:

```sh
bun run check
bun examples/deterministic.ts
```

The deterministic example returns `{"status":"completed","result":25}`.
Repeating it reopens the same committed result.

The [example settings](examples/solver-settings.json) use the public OpenAI API
with `gpt-6-astra` at max reasoning. Supply `OPENAI_API_KEY` through your shell
or secret manager. Source checking and independent review use the separately
installed Codex CLI, authenticated with `codex login` or its native provider
configuration. [Claude settings](examples/claude-settings.json) use Pi's native
Anthropic provider with an operator-supplied subscription OAuth token in
`ANTHROPIC_OAUTH_TOKEN`. The [provider guide](docs/solver.md#configuration-and-functions)
also covers mixed providers and Anthropic API credentials. Provider credentials
stay outside task and settings files.

The optional [Codex worker](docs/solver.md#codex-worker) implements assignments
with native shell and file tools in a retained workspace. Enable it through
`settings.codex`. Its findings enter the ordinary note verification process.

ChatGPT Web uses a separately managed browser service. Supply its endpoint and
optional service credential through the [solver settings](docs/solver.md#configuration-and-functions).
Xean owns the Pi adapter and research workflow. The service operator owns browser
login, installation, patches, and process management.

```sh
bun run xean init examples/tree-task.json tree examples/solver-settings.json
bun run xean run tree
bun run xean status tree
bun run xean export tree
```

Campaigns live under `.xean/` by default. Only `campaign.status: "completed"`
establishes an accepted argument. `export` requires that accepted result.
See the [solver guide](docs/solver.md#running) for live guidance, pause/resume,
cancellation, explicit database paths, and other model providers.

For a status request, use the campaign's matching source checkout and runtime:

```sh
bun run xean status /absolute/run-directory/campaign.sqlite
```

This reads committed state without model calls or recovery. The compact report
omits proofs and transcripts. See [checking status](docs/solver.md#checking-status)
for frozen and remote runs, verification progress, and observation freshness.

For supervised deployment, run `bun run xean run /data/campaign.sqlite` with a
persistent writable data directory and the provider's credentials. Use one
owner process per campaign. `SIGINT` and `SIGTERM` close the owner and retain
committed work for recovery. The command prints the campaign state when it
finishes, including paused, blocked, or waiting states. Inspect that state before
deciding whether a supervisor should restart it.

The [MIT license](LICENSE) covers Xean. Bundled dependencies retain their own
licenses.

## Distribution

Distribute checked source commits from `main`. APIs, CLI contracts, and campaign
formats may change. Run ongoing campaigns with their original source revision
and frozen settings. Preserve existing releases and tags, and do not create
new numbered releases or release tags.

Before distributing a source revision:

1. Describe changes and compatibility in [CHANGELOG.md](CHANGELOG.md). Keep root
   and workspace package versions aligned and install the frozen lockfile cleanly.
2. Run the development check below. It checks types, formatting, tests, matching
   versions, bundled dependency hashes, and local documentation links.
3. Verify a clean source archive on Linux and macOS: run setup, check, CLI help
   and version, the deterministic example twice, and the README's initialization
   and status commands. Check the observer in a browser. Exercise affected model
   providers using the [smoke procedure](docs/kernel-smoke.md#live-provider-checks).
4. Record the exact source commit, tested Bun version, platforms, smoke results,
   and any provider limitations. When sharing a source archive, include its
   SHA-256 checksum.

The [historical comparison](docs/xean-comparison.md) describes the implementation
replaced by 2.0.0. Earlier tags and campaign artifacts retain their original names
and formats.

## Development on Fleet

Run from the adjacent Fleet Infra checkout. Its `flake.lock` is the Bun runtime
authority, while Xean's `bun.lock` locks JavaScript dependencies.

```sh
cd ~/playground/fleet-infra
bin/fleet-nix run .#fleet-run -- ../xean/scripts/dev.ts install
bin/fleet-nix run .#fleet-run -- ../xean/scripts/dev.ts check
bin/fleet-nix run .#fleet-run -- ../xean/scripts/dev.ts test tests/observe.test.ts tests/report.test.ts
```

`install` requires the existing lockfile, performs a clean frozen installation,
and skips lifecycle scripts. After an intentional dependency edit, use
`install --update-lockfile`. An installation receipt rejects changed dependency
inputs until a clean reinstall. `check` runs typechecking, formatting, distribution checks, and tests
inside a socket-free Nix build. `format` formats project sources and documentation.
`test` runs only the named test files in that same sandbox. Pass existing files
under `tests/`. Set `XEAN_FLEET_INFRA` when Fleet Infra is elsewhere.

Use the same locked runtime for local CLI work:

```sh
bin/fleet-nix run .#fleet-run -- ../xean/packages/cli/src/index.ts --help
```

Closed-book experiments use the
[bounded runner](docs/solver.md#closed-book-experiments).

The [deterministic kernel example](examples/deterministic.ts) makes no model calls:

```sh
bin/fleet-nix run .#fleet-run -- ../xean/examples/deterministic.ts
```

It runs two workers concurrently and accepts their sum of squares, writing
`runs/deterministic.sqlite`. Repeating it reopens the committed result.
Pass another database path to start fresh. `run()` can return while waiting for
input, so only `status: "completed"` establishes accepted completion.

## Live kernel smoke

On `saturn`, run from Fleet Infra:

```sh
bin/fleet-nix run .#fleet-run -- ../xean/scripts/codex-lb-smoke.ts codex-lb/xean
```

The launcher verifies dependencies, reads the gateway key from OpenBao into
memory, and passes it over stdin with the provisioned lab CA. Two concurrent
Luna workers use max reasoning and Pi Durable conversations over cached
WebSocket transport. The smoke checks results, usage, connection reuse, delta
requests, and unchanged reopening in a second process without credentials.
This Durable smoke still requires live qualification. Historical gateway receipts
retain their recorded scope.

Campaigns and records remain under ignored `runs/`. Successful execution prints
`completed` for both phases. JSON snapshots can also exist after assertion
failure, so their presence alone does not establish success.
See [kernel verification](docs/kernel-smoke.md) for observed results and
[solver verification](docs/solver.md#current-verification) for role checks.
