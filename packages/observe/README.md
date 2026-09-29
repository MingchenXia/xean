# Xean Observe

Xean Observe displays campaign notes, checks, workers, failures, and recorded
usage. It is an optional app in this repository, packaged with its dashboard,
snapshot publisher, and theme assets. It uses Xean's public inspection,
note-projection, and `xean/report` APIs. Core and CLI do not depend on it, and
it does not depend on the CLI.

The dashboard reads local campaigns through `inspectCampaign` and remote runs
through exported JSON. Inspection never starts recovery or calls a model.
The dashboard and publisher run separately from solver execution, including
bounded experiments. Publication uses an atomic file rename.
An observer failure is reported in its own process and does not stop mathematical work.
The file is a disposable view of the campaign, not its authoritative record.

## Snapshot publishing

Local dashboards can read the campaign database directly. For remote artifact
readers, run the publisher on the campaign host after the database exists:

```sh
bun packages/observe/src/publish.ts /absolute/run-directory
bun packages/observe/src/publish.ts /absolute/run-directory --watch
```

The first command writes one `observation.json`. `--watch` refreshes it every
ten seconds and publishes once more on SIGINT or SIGTERM. Each read opens and
closes its own read-only snapshot while the solver retains ownership. Deploy
the watcher as a separate supervised process with access to the run directory.
The solver and experiment runner neither launch nor join it. Without a watcher,
remote artifact readers retain completed exports and process logs.

The workspace binaries are `xean-observe` for the dashboard and
`xean-observe-publish` for snapshots. The commands above retain the selected Bun
runtime. On Fleet, launch either file through the locked `fleet-run` command
shown below.

## Run locally

Create a config file containing the runs to display. Local paths resolve relative
to the config file. Remote paths are absolute and name a provisioned Bun runtime.
For either source, an optional `job` obtains process status and recent logs through
Fleet's Nomad CLI.

```json
[
  { "id": "local-run", "directory": "./my-run" },
  {
    "id": "jupiter-run",
    "host": "jupiter",
    "directory": "/srv/xean-lab/runs/_xean/my-run",
    "runtime": "/srv/xean-lab/runs/_xean/my-run/runtime/bun",
    "job": "xean-my-run"
  }
]
```

From the installed source checkout:

```sh
bun packages/observe/src/server.ts /absolute/config.json
```

Local campaign inspection uses the source checkout and Bun. The optional `job`
field additionally requires Fleet's Nomad tooling. On Fleet, use the locked runtime:

```sh
bin/fleet-nix run .#fleet-run -- ../xean/packages/observe/src/server.ts /absolute/config.json
```

Open <http://127.0.0.1:8797>. The listener is local, with a read-only JSON API at
`/api/runs` and `/api/runs/RUN_ID`. Configured IDs are the only addressable runs.
Collection requests share an in-flight read and a ten-second cache.

The browser pauses polling while hidden and preserves the last received view
when a refresh fails. Each run displays the age and source of its evidence.
Nomad's process status is separate from the campaign's last observed state.
An old snapshot saying `running` alone does not establish process liveness.

Runs launched before snapshot publishing retain their original runner. Observe
shows their task, round markers, and Nomad logs until a result export appears.
Detailed in-flight notes require an owner endpoint or an observation snapshot.
Snapshots use `xean-observe/v2` and include committed index and detailed summaries,
full note text and checks, worker outcomes, and native
usage counts. Private model reasoning and complete request bodies stay in the
campaign journal. Exported results without embedded records show usage as
unavailable. Gateway billing reconciliation remains separate.

Opening a note shows its detailed summary. Full text and checks have separate
disclosures. Historical snapshots require their matching observer version.

## Verify

The workspace's locked `scripts/dev.ts check` covers this package. Browser smoke
artifacts belong under ignored `output/playwright/`.

`web/chao-ui.css` is copied unchanged from chao-ui commit
`52698d2f8a43bc0567fba1ba1b53c6a07635e73e`. Mathematical text uses KaTeX with
untrusted commands disabled. Lit escapes dynamic content. The dashboard has no
campaign mutation controls.
