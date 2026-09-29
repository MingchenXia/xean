# Changelog

## 3.0.0 — Unreleased

CLI and observer are optional sibling applications over the core library.
Shared inspection reports move from `xean-cli/report` to `xean/report`.
The observer packages its dashboard and theme together and publishes snapshots
through a separate read-only command. Bounded experiments no longer start an
observer publisher. Remote live snapshots require the observer's `--watch`
process. Existing campaign and observation formats are unchanged by this split.

Notes now require `summary`, `detailedSummary`, and authoritative full `text`.
Harmless corrections replace all three together. This changes public note and
correction APIs, CLI input files, and persisted solver inputs. Solver declarations
use version 9 and observer exports use `xean-observe/v2`. Keep historical
campaigns and exports on their matching runtime. No migration is provided.

- Pin all Pi/Chord packages to upstream main commit `312184edb68c`, with a fresh
  frozen model catalog and matching hashes from two clean builds. The changed
  Pi SQLite schema and Harness checkpoints require campaign format 8 and fresh campaigns.
- Store uses Pi's public commit subscriptions after document adoption, removing
  its Storage proxy. Native Session poisoning determines whether failed
  operations require reopening.
- Pi Harness owns dispatch, invocation cancellation, joining, and whole-worker
  recovery through local admission, pause, recovery, and failure-settlement
  extensions. Xean retains campaign admission and atomic result/signal policy.
  Shutdown drains call accounting before closing storage. Unfinished admissions
  roll back on pause, and interrupted invocations cannot publish late results.
- Status and observer exports share solver-campaign recognition, so closed-book
  and direct-library campaigns also report their notes.
- Claude Code profiles now use the pinned local subscription transport, while
  Anthropic API profiles keep separate credentials and usage accounting. The
  Claude tool bridge and cancellation paths have deterministic coverage.
- Explorer always starts with the task, all note IDs and summaries, and current
  feedback. Coordinator supplies only guidance. Explorer selects frozen detailed
  summaries or full notes through `read_notes`. `maxExplorerReads` defaults to four
  batched calls per invocation and must be at least one. Except for the one-response
  ChatGPT profile, `maxExplorerResponses` defaults to that allowance plus four.
  An explicit response limit overrides the default.
  Reading is disabled at its cap and on the final response, with tool definitions
  kept stable. The `explorer` mode setting and Explorer-input `support` selection
  are removed. Mathematical note dependencies remain unchanged.
- ChatGPT Web is now an explicit Explorer-only, one-response profile. It cannot
  be the default or a verifier profile, and built-in campaigns admit no additional
  ChatGPT Explorer work. Recovered browser workers fail before another request,
  using the new one-based `Execution.attempt` ordinal. Xean cannot account for usage
  outside the campaign or enforce an account-wide subscription quota.
  Direct role construction also enforces one response and disables note reads.
- ChatGPT Web uses the bridge's text-only Chat Completions endpoint with a
  validated generic tool envelope. Browser retries are disabled and usage stays
  unknown; no live Pro request is part of this qualification.
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
