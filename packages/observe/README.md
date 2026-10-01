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
A run manager such as Xean Lab may start and join this process for each attempt.
The solver remains independent of the publisher. Without a watcher,
remote artifact readers retain completed exports and process logs.
Artifact readers choose the newer snapshot or result export by file modification
time, preferring the snapshot on ties. A stopped publisher cannot hide a later
completed result.

The workspace binaries are `xean-observe` for the dashboard and
`xean-observe-publish` for snapshots. The commands above retain the selected Bun
runtime. On Fleet, launch either file through the locked `fleet-run` command
shown below.

Library callers use `snapshot(inspection)` from `xean-observe`. Callers that
already have a `campaignReport` and its `statusReport` can pass
`{ ...report, status }` to `snapshotFromReport` to reuse the prepared notes and
usage totals. Both reports must come from the same inspection.

## Run locally

Create a config file containing the runs to display. Local paths resolve relative
to the config file. Remote paths are absolute and name a provisioned Bun runtime.
For either source, an optional `job` obtains process status and recent logs through
Fleet's Nomad CLI. `task` selects the Nomad task and defaults to `solver`.
Xean Lab uses `worker`. The process panel identifies a sampled pool allocation
and its job and task. Its logs may include other campaigns. Pool status and
heartbeat counts never substitute for an individual campaign's state or usage.

```json
[
  {
    "id": "local-run",
    "directory": "./my-run",
    "review": "review/receipt.json"
  },
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
Collection requests share an in-flight read and a ten-second cache. The server
reloads the configuration on refresh, so updating the source list requires no
restart. Invalid configuration leaves the browser's last received view visible
with an error. Removing a selected run makes its URL unavailable.
Within each refresh, runs with the same Nomad job and task share one process
observation. Failed process reads are retried on the next refresh.

The browser pauses polling while hidden and preserves the last received view
when a refresh fails. After an individual run read fails, the API retains its
last successful campaign observation in memory, marks it `stale`, and returns
the new diagnostic and current process observation. The evidence timestamp stays
unchanged; a successful read replaces it and clears the stale marker. An initial
failure has no cached evidence. The reader never substitutes an older disk artifact
for a malformed selected artifact. Each run displays the age and source of its evidence.
Nomad's process status is separate from the campaign's last observed state.
An old snapshot saying `running` alone does not establish process liveness.

Runs launched before snapshot publishing retain their original runner. Observe
shows their task, round markers, and Nomad logs until a result export appears.
Detailed in-flight notes require an owner endpoint or an observation snapshot.
Snapshots use `xean-observe/v3` and include committed index and detailed summaries,
full note text and checks, worker outcomes and note links, and native
usage counts. Private model reasoning and complete request bodies stay in the
campaign journal. Exported results without embedded records show usage as
unavailable. Gateway billing reconciliation remains separate.

Run search filters the configured source list. Notes can be searched and filtered
by status, with paged lists to keep large corpora readable. Run, note, and work
URLs support browser history and direct links. A note shows its detailed summary,
supporting notes, and dependents. Full text and structured checks render when
opened. Refresh preserves the selected view and open disclosures. Historical
snapshots require their matching observer version.

An optional `review` source field names a receipt file relative to the run
directory. The same contract works locally and over SSH:

```json
{
  "reviewer": "independent-reviewer",
  "reviewedAt": "2026-10-01T12:00:00Z",
  "verdict": "PASS",
  "report": "The exact statement and proof were checked independently."
}
```

`verdict` is `PASS`, `FAIL`, or `INCONCLUSIVE`. A missing receipt is reported as
missing. An unreadable or malformed receipt has its own diagnostic and does not
erase campaign evidence. Independent review appears separately from solver
acceptance. Lab supplies this path through its public discovery output.
Computational artifact browsing is deferred with the computational Codex role.

## Verify

The workspace's locked `scripts/dev.ts check` covers this package. Browser smoke
artifacts belong under ignored `output/playwright/`.

`web/chao-ui.css` is copied unchanged from chao-ui commit
`52698d2f8a43bc0567fba1ba1b53c6a07635e73e`. Mathematical text uses KaTeX with
untrusted commands disabled. Lit escapes dynamic content. The dashboard has no
campaign mutation controls.
