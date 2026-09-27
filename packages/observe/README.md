# Xean Observe

Xean Observe displays campaign notes, checks, workers, failures, and recorded
usage. It is a separate workspace package. It uses Xean's public inspection and
note-projection APIs, plus the existing CLI reporting.

The dashboard reads local campaigns through `inspectCampaign` and remote runs
through exported JSON. Inspection never starts recovery or calls a model. The bounded
experiment runner publishes `observation.json` every ten seconds and at shutdown
through `observe(engine, directory)`. Publication uses an atomic file rename.
An observer failure is reported on stderr and does not stop mathematical work.
The file is a disposable view of the campaign, not its authoritative record.

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
Snapshots include committed note text and checks, worker outcomes, and native
usage counts. Private model reasoning and complete request bodies stay in the
campaign journal. Exported results without embedded records show usage as
unavailable. Gateway billing reconciliation remains separate.

## Verify

The workspace's locked `scripts/dev.ts check` covers this package. Browser smoke
artifacts belong under ignored `output/playwright/`.

`web/chao-ui.css` is copied unchanged from chao-ui commit
`52698d2f8a43bc0567fba1ba1b53c6a07635e73e`. Mathematical text uses KaTeX with
untrusted commands disabled. Lit escapes dynamic content. The dashboard has no
campaign mutation controls.
