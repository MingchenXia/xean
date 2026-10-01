# Changelog

## Main

The main branch is the current distribution. Existing numbered releases and
tags remain historical archives. Pin the source commit and runtime for each
campaign.

- Record external premises as exact standalone claims before source checking,
  keeping application and validation commentary in reports. Reconstruction
  receives the approved strings unchanged, with explicit source status for its
  judge. Remove extracted premise indices, normalization, and the second stored
  premise list. Statement extraction now returns only the note's claim.
  This changes the persisted solver payload: solver declarations now use
  version 11. Start fresh campaigns with this source and
  retain frozen runtimes for historical campaigns. No migration is provided.
- Enable Gemini model profiles through Pi's native Google provider and
  operator-supplied Gemini API credentials.
- Keep the observer's last successful campaign observation after a read failure,
  with its original timestamp, a stale marker, and current diagnostics. Preserve
  note disclosures by identity during refresh and separate process-read errors
  from the campaign's recorded status.
- Accept CRLF-framed Codex SSE responses, including line endings split across
  network chunks, instead of reporting a JSON parsing error.
- Stop treating JSON `Unterminated string` errors as terminated connections and
  automatically repeating the model call. Genuine connection termination still retries.
- Use Pi's native Anthropic provider for Claude models with subscription OAuth
  or API credentials. Remove the Claude Code provider package, patch, custom
  adapter, and subprocess tests. Research remains Codex-only. Retain historical
  qualification evidence and document the native subscription smoke.
- Reject dangling database symlinks before acquiring campaign ownership.
- Retain SQLite WAL sidecars after writer close so independent read-only
  inspection remains available. Finalize native statements before releasing
  ownership while preserving Pi's transaction and rollback handling.
- Honor cancellation through final stream delivery while retaining provider
  outcomes and measured usage in the journal.
- Enforce ChatGPT Explorer's single attempt with replaced planners and after
  reopening. Validate direct runtime profiles and require explicitly selected
  credential variables. Closed-book runs reject browser-backed retrieval.
- Preserve ChatGPT tool-call and feedback identities through text-only bridges,
  retain malformed replies for diagnosis, and record reported served identities
  without discarding valid replies when they differ from the requested model.
- Verify note summaries against their authoritative mathematics while keeping
  the independent prover blind to original proofs and summaries.
- Reject malformed observer snapshots and heartbeat data without breaking the
  dashboard or discarding available process logs.
- Trust typed role outputs and internal projections, validate model and external
  inputs at their boundaries, and keep current-format rejection without legacy
  readers or fixtures. Recovery scheduling uses Pi's candidate order.

CLI and observer are optional sibling applications over the core library.
Shared inspection reports move from `xean-cli/report` to `xean/report`.
The observer packages its dashboard and theme together and publishes snapshots
through a separate read-only command. Bounded experiments no longer start an
observer publisher. Remote live snapshots require the observer's `--watch`
process. Existing campaign and observation formats are unchanged by this split.

Notes now require `summary`, `detailedSummary`, and authoritative full `text`.
Harmless corrections replace all three together. This changes public note and
correction APIs, CLI input files, and persisted solver inputs. Solver declarations
use version 11 and observer exports use `xean-observe/v2`. Keep historical
campaigns and exports on their matching runtime. No migration is provided.

- Pin all Pi/Chord packages to upstream main commit `8ce69e9d2b17`, preserving the
  frozen model catalog and matching hashes from two clean builds. Register worker
  and Coordinator tasks through Pi's native extension API. This pin uses campaign
  format 10; start fresh campaigns and retain the old runtimes for existing runs.
  Retain the existing admission, shutdown, read-only
  storage, and provider patches, including CRLF response framing.
- Delegate SQL operation ordering, statement caching, asynchronous transactions,
  and read draining to Pi. Return invocation state changes through Pi's native
  task runtime. Retain Xean's admission, atomic failure signals, and shutdown policy.
- Store uses Pi's public commit subscriptions after document adoption, removing
  its Storage proxy. Native Session poisoning determines whether failed
  operations require reopening.
- Pi Harness owns dispatch, invocation cancellation, joining, and whole-worker
  recovery through local admission, pause, recovery, and failure-settlement
  extensions. Xean retains campaign admission and atomic result/signal policy.
  Shutdown drains call accounting before closing storage. Unfinished admissions
  roll back on pause, and interrupted invocations cannot publish late results.
- CLI inspection, accepted-argument export, status, and observer reports share
  solver-campaign recognition for online, closed-book, and direct-library campaigns.
- Bounded experiments export results and the journal without reopening the
  campaign for qualification. Explicit smokes and tests verify unchanged reopening.
- Remote observation selects the newer published snapshot or result export.
  Concurrent publishers use separate temporary files for atomic replacement.
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
- ChatGPT Web uses a user-managed `codex-chatgpt-web` Responses endpoint with a strict generic
  tool envelope and a unique completed final answer. The old `chatgpt-cli` Chat
  Completions path is retired. Browser retries remain disabled and usage unknown.
  A live three-request smoke qualified the generic Pi tool round trip, a
  single-response Explorer submission, and unchanged campaign reopening.
  The documented boundary is one self-contained request returning exact completed
  text or an error. Installation and browser operations stay outside Xean.
- Explicit antecedents in conditional claims remain part of the claim.
  Correctness checks the implication, source checks its external results, and
  requirements decides whether it solves the original task.
- The observer shows detailed summaries before the full-note disclosure.
- Direct `createSolver` campaigns record the solver format version and reject
  reopening historical unversioned campaigns. Note projection requires a current
  solver declaration.
- Installation receipts include the operating system and architecture, so a
  checkout copied across platforms requires a clean setup. Distribution checks
  require enabled dependency patches to match their recorded provenance.
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
