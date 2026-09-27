# Changelog

## 3.0.0 — Unreleased

Notes now require `summary`, `detailedSummary`, and authoritative full `text`.
Harmless corrections replace all three together. This changes public note and
correction APIs, CLI input files, and persisted solver inputs. Solver declarations
use version 8 and observer exports use `xean-observe/v2`. Keep historical
campaigns and exports on their matching runtime. No migration is provided.

- Select `explorer: "retrieval"` to query an invocation's frozen notes through
  bounded search and batched detailed/full reads. The default `prefilled` Explorer
  retains selected full context upfront. Both use the same verification and
  four-response allowance, including retrieval responses.
- Explicit antecedents in conditional claims remain part of the claim.
  Correctness checks the implication, source checks its external results, and
  requirements decides whether it solves the original task.
- The observer shows detailed summaries before the full-note disclosure.
- Direct `createSolver` campaigns record the solver format version and reject
  reopening historical unversioned campaigns. Note projection requires a current
  solver declaration.
- Completed private-work recovery was investigated against Pi and the predecessor.
  Whole-worker recovery remains in place. The missing durable integration is
  documented in Pi alignment.

## 2.0.0 — 2026-09-27

Xean now uses Pi's durable storage and agent loop, with a smaller campaign kernel,
a separate CLI, and a read-only observer. The public APIs, CLI, and persisted
campaign formats replace the 1.x implementation. Keep earlier campaigns on their
original release. No migration is provided.

- Workers publish their complete result and Coordinator signal atomically.
  Independent readers can inspect a running campaign without taking ownership.
  Pause, cancellation, whole-worker recovery, and keyed call grants retain
  committed work.
- The solver checks declared dependencies, exact completion criteria, and blind
  reconstruction of generated supporting claims. Source verdicts are final for
  each note ID. Trusted imports, guidance, and harmless corrections have durable
  command receipts.
- Distribution uses a complete source checkout with pinned Pi artifacts and
  patches. `xean --version` identifies the release. Checks cover version
  consistency, dependency provenance, documentation links, and offline behavior.
- Package scripts retain the invoking Bun runtime even when `PATH` contains an
  older installation.
- ChatGPT Web requests are excluded from automatic solver retries after a
  disconnect. A request already running in the browser must not be duplicated.
- The closed-book runner accepts the default disabled literature setting.
  The observer and bounded runner verify the dependency installation before use.
- Call grants preserve blocked Coordinator failures for explicit recovery when
  a concurrent worker exhausts the call allowance.
- Local observer reads include configured process status and logs. Missing
  observations no longer imply that a campaign is still running. Process status
  remains visible when snapshots or logs cannot be read, and remote snapshots
  finish writing before their helper exits.
- The CLI waits for large inspection reports and exported arguments to finish
  writing through pipes before exiting.
- Coordinator instructions clarify that exploration can start with no existing
  notes and distinguish context notes from mathematical dependencies.

Model judgments remain fallible. Solver acceptance, independent mathematical
review, and catalog closure remain separate. Provider availability and native
CLI authentication must be verified in the executing environment.

Earlier source versions remain available under the
[historical tags](https://github.com/chaoxu/xean/tags).
