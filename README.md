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

Matching Pi packages are pinned to one exact source commit in `package.json`.
The [artifact record](vendor/pi/provenance.json) records that source revision,
build, frozen model data, and hashes. The `main` branch contains the unreleased
3.0 candidate. New campaigns use campaign format 11 and solver declaration
version 12. Observer snapshots use `xean-observe/v4`. Historical campaigns require
their original source revision and runtime, and historical snapshots require
their matching observer. No migration is provided. Existing releases and tags
remain historical archives.

## Install and run

Use Bun 1.4.2 on Linux or macOS. Use the complete prepared source archive or clone
`main` and install its locked dependencies. The distribution includes the library,
CLI, observer, pinned Pi packages, patches, and dependency lockfile.
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

### Managed cloud and account changes

On Linux x86_64 cloud machines with Node, npm, curl, and tar already installed,
the repository can bootstrap its own tools from any checkout path:

```sh
bash scripts/cloud.sh setup
bash scripts/cloud.sh check
bash scripts/cloud.sh xean --help
```

The entry point installs Bun 1.4.2 and Tini 0.19.0 with pinned checksums, verifies
bundled dependency provenance, and repairs a missing or stale installation through
the frozen `setup` command. Repeated setup reuses a valid dependency receipt.
Tini reaps orphaned Codex processes even when the container's PID 1 does not.
Other commands also prepare missing tools and dependencies before running.
Local tools, caches, and generated Codex settings live under ignored `.xean/cloud/`;
set `XEAN_CLOUD_DIR` to select another writable directory. No model call or login
occurs during setup, checks, or completed-campaign reopening.

Authentication always comes from the executing account's native Codex CLI and
inherited environment. This setup never reads, copies, or saves credentials and
does not set `HOME` or `CODEX_HOME`. It preserves proxy and CA configuration.
Use the platform Codex CLI; `XEAN_CODEX_COMMAND` can select another installed
native executable. If it is unavailable, install the official CLI separately.

After switching ChatGPT accounts, explicitly authorize the intended account:

```sh
bash scripts/cloud.sh login
bash scripts/cloud.sh doctor
```

`login` runs official `codex login --device-auth`. Complete its browser authorization
with the new account and wait for successful login. `doctor` checks the local
installation and native login status without spending a model call. A local
"logged in" result does not establish remote authorization; inspect a real
completed turn. If an actual request returns 401 or cannot refresh authentication,
use `login` again. Browser consent cannot be automated by repository configuration.
Do not put tokens into Git, task/settings files, snapshots, or cloud setup scripts.

Some managed execution sandboxes mount the native Codex directory read-only.
Codex still writes initialization files there even with redirected logs and
ephemeral execution. The wrapper diagnoses this before a live invocation.
An agent must use its supported `exec_command` `require_escalated` review for
the exact login/worker command. Keep the native coding session's `workspace-write`
sandbox and research session's `read-only` sandbox. Shell scripts cannot grant
that platform permission.

The generated `.xean/cloud/codex-settings.json` follows the current checkout path
and selects `gpt-6.1-sol` with `xhigh` for a standalone implementation worker.
It is regenerated; copy it before customizing settings. Its Pi profile is unused
by standalone Codex and does not configure the mathematical solver's credentials.
Run the example only when you intend to make a real model call, using a new database:

```sh
bash scripts/cloud.sh xean --records role codex examples/codex-worker-input.json runs/my-coding-task/campaign.sqlite .xean/cloud/codex-settings.json
bash scripts/cloud.sh xean status runs/my-coding-task/campaign.sqlite
```

Keep the database, artifacts, frozen inputs, matching source revision and Bun
together. Reopen completed work with `xean run` without another model call. After
a standalone worker fails terminally, repair its cause and create a new campaign;
`resume` does not rerun failed workers. The example permits one attempt and one
provider call. Choose explicit limits for new work instead of silently retrying
or removing caps. Native token counts do not reconcile subscription credits or bills.

For cloud environment settings, use `bash scripts/cloud.sh setup` as the install
command and the startup guidance in [AGENTS.md](AGENTS.md). Publication restores
filesystem state, not guaranteed runtime login. Recheck credentials in each new
task and use official login recovery when necessary.

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

The prepared 3.0.0 candidate uses aligned package versions. Its
[verification record](docs/kernel-smoke.md) identifies the tested platforms,
provider paths, and limitations. Retain the exact source commit, dependency
lockfile, and Bun version. Run ongoing campaigns with their original source
revision and frozen settings. Existing releases and tags remain historical archives.

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
