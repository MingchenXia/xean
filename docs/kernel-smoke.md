# Verification

The [development check](../README.md#development-on-fleet) checks types,
formatting, distribution metadata, dependency hashes, documentation links, and
the offline test suite. Run it on the exact source candidate and Bun runtime
intended for distribution. A passing historical run does not qualify later code.

## Offline checks

The suite exercises atomic publication, failed-decision rollback, uncertain
commits, concurrent readers, ownership exclusion, crash recovery, pause,
cancellation, call-cap draining, call grants, and settlement during shutdown.
Solver checks cover dependency ordering, source-verdict finality, trusted
imports, correction races, blinded reconstruction, and exact-task acceptance.
Provider fixtures exercise Pi's native parsers and tools, WebSocket continuation,
retry classification, browser disconnects, and Codex process cleanup.

The [deterministic example](../examples/deterministic.ts) runs without credentials
or model calls. From the source checkout:

```sh
bun examples/deterministic.ts
bun examples/deterministic.ts
```

Both invocations must return `{"status":"completed","result":25}`. The second
invocation reuses committed work. Use an explicit fresh database path when
qualifying a new candidate.

FULL SQLite synchronization is configured and process-crash recovery is tested.
Power-loss durability has not been tested. Installation receipts fingerprint
dependency inputs, Bun version, operating system, and architecture, but do not
attest arbitrary manual edits inside `node_modules`. Use a clean setup for
distribution qualification.

## Live provider checks

For a provider or execution change, smoke-test the affected path with its actual
runtime, model, credentials, and native configuration. Check results and failure
records, then reopen without credentials and verify that committed work and
records are unchanged. Fixtures establish local behavior, while live smokes
establish that the selected deployment can execute it.

On saturn, from Fleet Infra, the maintained gateway and solver smokes are:

```sh
bin/fleet-nix run .#fleet-run -- ../xean/scripts/codex-lb-smoke.ts codex-lb/xean
bin/fleet-nix run .#fleet-run -- ../xean/scripts/solver-smoke.ts codex-lb/xean
```

The gateway smoke checks concurrent workers, native usage, cached WebSocket
continuation, and reopening in another process. The solver smoke checks the
tree task through acceptance and unchanged reopening. Both use Luna at max
reasoning with finite call allowances. The source-checking Codex path and
subscription providers require separate checks when affected. Their setup is
in the [solver guide](solver.md#configuration-and-functions).

Retain source revision, Bun version, frozen task/settings, campaign, result,
and stderr under ignored `runs/`. A snapshot left by a failed assertion is not
a successful smoke. Record provider limitations with the source revision.

Historical provider, benchmark, and memory measurements remain in Git and their
original local run artifacts. Those private artifacts are not part of the source
distribution. Model execution, internal acceptance, independent mathematical
review, and catalog closure remain distinct evidence.
