# Xean

Xean coordinates durable mathematical work over Pi. The kernel handles campaign
scheduling, atomic publication, limits, and recovery. The solver adds notes,
exploration, verification, and exact-task acceptance. Pi supplies model and tool
execution, storage records, and atomic batches. Chord supplies invocation context
and prepared state changes.

The library lives in `packages/core`. The separate `xean-cli` package in
`packages/cli` exposes campaign operations through public library APIs.
The [observer](packages/observe/README.md) in `packages/observe` reads local
campaigns through the read-only API and displays exported remote snapshots.

- [Philosophy](docs/philosophy.md): mathematical autonomy, shared memory, trust, and evaluation.
- [Kernel contract](docs/kernel.md): execution, publication, limits, and storage.
- [Solver guide](docs/solver.md): roles, verification, CLI commands, and configuration.
- [Glossary](docs/glossary.md): canonical terminology.
- [Pi alignment](docs/pi-alignment.md): native APIs and deferred adoption.
- [Xean comparison](docs/xean-comparison.md): reference snapshot and remaining ideas.
- [Contributor rules](AGENTS.md): design priorities and repository boundaries.

Matching Pi packages are pinned to one tested main commit in `package.json`.
The [artifact record](vendor/pi/provenance.json) records that source revision,
build, frozen model data, and hashes. The `main` branch at https://github.com/chaoxu/xean is the current distribution. Existing numbered releases remain historical archives.

## Install and run

Use a source checkout on Linux or macOS with Bun 1.4.2 or newer. Bun 1.4.2 is
the tested runtime. The checkout includes the pinned Pi packages and patches.

```sh
git clone https://github.com/chaoxu/xean.git
cd xean
bun run setup
bun run xean --help
```

`setup` installs the frozen dependency lockfile without lifecycle scripts and
records the exact installation. Run it again after updating the checkout.
Keep the source commit, lockfile, and runtime version with each campaign. Older
campaigns must use their original checkout because persisted formats can change.

The [example settings](examples/solver-settings.json) use the public OpenAI API
with `gpt-6-astra` at max reasoning. Supply `OPENAI_API_KEY` through your shell
or secret manager. Source checking and independent review use the separately
installed Codex CLI, authenticated with `codex login` or its native provider
configuration. Provider credentials stay outside task and settings files.

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

For supervised deployment, run `bun run xean run /data/campaign.sqlite` with a
persistent writable data directory and the provider's credentials. Use one
owner process per campaign. `SIGINT` and `SIGTERM` close the owner and retain
committed work for recovery. The command prints the campaign state when it
finishes, including paused, blocked, or waiting states. Inspect that state before
deciding whether a supervisor should restart it.

The library, CLI, and observer are distributed together as a source checkout.
Individual workspace packages are private. The [MIT license](LICENSE) covers
Xean, and bundled dependencies retain their own licenses.

## Development on Fleet

Run from the adjacent Fleet Infra checkout. Its `flake.lock` is the Bun runtime
authority, while Xean's `bun.lock` locks JavaScript dependencies.

```sh
cd ~/playground/fleet-infra
bin/fleet-nix run .#fleet-run -- ../xean/scripts/dev.ts install
bin/fleet-nix run .#fleet-run -- ../xean/scripts/dev.ts check
```

`install` requires the existing lockfile, performs a clean frozen installation,
and skips lifecycle scripts. After an intentional dependency edit, use
`install --update-lockfile`. An installation receipt rejects changed dependency
inputs until a clean reinstall. `check` runs typechecking, formatting, and tests
inside a socket-free Nix build. `format` formats project sources and documentation.

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
Luna workers use max reasoning and Pi's cached WebSocket agent loop. The smoke
checks results, usage, connection reuse, delta requests, and unchanged reopening
in a second process without credentials.

Campaigns and records remain under ignored `runs/`. Successful execution prints
`completed` for both phases. JSON snapshots can also exist after assertion
failure, so their presence alone does not establish success.
See [kernel verification](docs/kernel-smoke.md) for observed results and
[solver verification](docs/solver.md#current-verification) for role checks.
