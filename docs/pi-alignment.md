# Aligning Xean with Pi

Pi supplies model execution, durable transactions, and task execution. Xean supplies campaign
policy and the mathematical workflow. The [kernel contract](kernel.md) defines
publication and recovery, and the [solver guide](solver.md) defines mathematical
acceptance. This document records native API ownership and the gaps that still
prevent further delegation.

## Sources and availability

All five Pi/Chord packages are pinned to
[`8ce69e9d2b17`](https://github.com/earendil-works/pi/tree/8ce69e9d2b171d173fe4b6b2b6256f1f4411e69d),
the upstream main revision checked on 2026-10-01.
Their upstream manifests say `0.99.2`. The
[artifact record](../vendor/pi/provenance.json) identifies the source, frozen
model catalog, reproducible builds, and retained patches.

The [public durable types][types] and [Session implementation][session] supply
transactions, documents, records, typed IDs, snapshots, conversation forks, and
public commit subscriptions. Pi implements a [durable task scheduler][scheduler],
Harness, persistent model/tool turns, task ownership, structured concurrency,
conversation views, and compaction. Their contracts are in the [Pico5 specification][spec].
Xean adopts Harness with local admission, pause, recovery, and failure-settlement
extensions described below. These extensions are not upstream APIs.
The existing `pi-agent-core.AgentHarness` is a different API.

The registry installs named extensions. Xean registers its worker and Coordinator
tasks together in one extension. Pi now resolves models, tools, prompt sections,
hooks, and environments per conversation through `pi.agent`. These APIs support
future role-specific tools and environments. Opaque Xean roles retain their own
model loops and frozen inputs. This pin uses campaign format 10; start fresh
campaigns and retain old runtimes for existing runs. Anthropic OAuth also supports
a copy-code login method through Pi's credential APIs.

## API ownership

| Responsibility             | Current implementation and reason                                                                                                                                                                     |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Models and transport       | Pi catalogs, provider factories, auth helpers, conversion, and streaming. Xean profiles select models and endpoints.                                                                                  |
| Role execution             | Pi `runAgentLoop` owns the transcript, tools, argument validation, and turns. Xean hooks enforce submission and invocation limits.                                                                    |
| Turn state                 | Pi's completed `toolResults` determine whether submission succeeded and whether to continue. Xean retains the last valid value, response count, and one-reminder policy.                              |
| Context capacity           | Pi's estimator runs in `prepareRequest`. Xean reserves answer space and hands off prior valid submissions. Compaction is outside the solver contract.                                                 |
| Provider recovery          | Pi `retryAssistantCall` owns classification, backoff, and bounds. Xean records each admitted call and selectively retains completed reasoning.                                                        |
| Transactions               | Native Session owns serialization, document caching, draft preparation, rollback, atomic storage, and adoption.                                                                                       |
| Record identities          | Native `TaskId`, `EntryId`, `DocumentId`, and `Seq` identify tasks, entries, documents, and commits. Task creation returns the native ID.                                                             |
| Storage                    | Pi's SQLite adapter supplies statements, transactions, and records over Bun's native connection. Xean configures persistent WAL, ownership, and read snapshots.                                       |
| Cancellation and telemetry | Harness owns invocation cancellation and joining; Chord contexts carry the signal. Pi's telemetry context carries attempt spans.                                                                      |
| Scheduling and publication | Harness dispatches admitted tasks and recovers interrupted work. Xean admission policy enforces concurrency, Coordinator serialization, and limits. Xean publishes each whole result with its signal. |
| Mathematical state         | Xean owns dependency closure, verification stages, corrections, evidence binding, and exact acceptance. Notes derive from immutable results and input receipts.                                       |
| CLI and observation        | Optional sibling apps use public core APIs, including `xean/report`. Core depends on neither app. Read-only inspection uses Pi scans. Live mutations reach the active owner through a local socket.   |

A kernel role needs only its name and `run(input, execution, context)`. Tool
descriptions belong to Pi's tools. Solver and standalone execution call the same
functions, with lazy runtime construction. Research invokes Codex through Execa,
whose argv, stdin, process cancellation, and separate-output contract remains
necessary. Pi's shell surface does not supply that contract.

## Durable integration

Store opens Harness for the campaign owner and `createSession` for inspection.
It validates campaign format, task, limits, Coordinator identity, and required
roles before Harness recovery can write. Its typed campaign document uses full bases
through `checkpointWhen`. Native transactions validate task conversation
membership and ownership. Xean detaches values at external boundaries because
native records and drafts can be Session-owned. Coordinator copies its callable
input once and derives its prompt and note reader from that frozen copy.

Store uses public `Session.subscribeCommits()` to update its task projection
after document adoption. The Storage proxy and wakeup revision are removed. Pi owns
commit observation and poisoning. After a rejected operation, an empty Session
commit checks whether the instance remains usable without a Storage write.
The task projection avoids repeated full scans. Completed Coordinator payloads
stay durable but leave the resident cache.
`StorageRejected` guarantees a failed batch made no durable change and leaves
the instance usable. Unknown commit outcomes and post-storage adoption failures
stop the instance.

The durable patch adds the following generic Harness controls. The unpatched
revision reserves every eligible task, has no domain failure hook, and seals
Session writes before joining on close.

- `admitTasks` selects a batch and its checkpoints on the Session transaction
  line. Xean uses it for concurrency, sequential Coordinator invocations, pause,
  call-cap draining, and attempt-start records. A pause during an unfinished
  admission rolls back the batch and its records.
- `onTaskFailure` can replace a runtime-generated `faulted` or `orphaned` outcome
  and stage domain records in the same transaction. Xean publishes a worker's
  failure signal or blocks a failed Coordinator without losing its signal.
- `pause({interrupt: true})` cancels invocations and rejects their late runtime
  commits while keeping Session writes open. `waitForQuiescence()` joins admitted
  invocations and their final transactions, including when admission holds queued
  work. Xean waits for call settlements before closing the Session.
- `onTaskRecovery` writes interruption history in the transaction that resets
  running tasks to pending. Recovery still repeats the whole worker.

Harness owns the invocation map, dispatch, cancellation, joining, and recovery.
Its pause state also gates execution between explicit Xean `run()` calls.
Invocations return terminal outcomes through native `runtime.commit()`, alongside
the result and Coordinator signal. Pi owns transition validation and retirement.
Xean uses conversation-owned tasks because workers are opaque functions and
Coordinator schedules their work independently.
Its scheduler yields between passes so synchronous work cannot starve external
cancellation. A pending checkpoint yields a logical retry back to admission.
Xean registers executable task definitions and uses native task creation.
The patch exposes existing `Tx.setTask()` for external campaign transitions,
such as cancellation, blocked-signal resumption, and admission failure. It
preserves explicit entry attribution outside an invocation. Native validation,
transaction assembly, retirement, and publication own these operations.
Reassess these local extensions when equivalent upstream controls become available.

The separate owner lock protects Pi's ID allocator and Harness execution while
allowing independent readers. Xean selects FULL synchronization. Read-only
transactions give inspection coherent snapshots. The upstream opener always
runs migrations, so the read-only patch skips writes, validates the schema, and
rejects mutation and ID allocation. Reader cleanup avoids a writer checkpoint.
SQL remains the backend direction.

Pi owns asynchronous SQL execution, operation ordering, statement caching,
transaction handles, rollback, read draining, and close. The adapter patch
accepts Bun's structural connection and normalizes missing-row `null` to Pi's
`undefined`. Read-only document loading uses the already pinned snapshot,
avoiding a nested write transaction, and reader close skips the writer checkpoint.
Bun's public `fileControl` enables
`SQLITE_FCNTL_PERSIST_WAL` on writers. Without retained WAL sidecars, the locked
runtime can fail read-only reopening with `SQLITE_CANTOPEN` after writer close.
The Node connection API does not expose this setting. Native `close(true)`
finalizes prepared statements before ownership is released. Reassess this patch
when Pi supports Bun connections or upstream provides the required WAL control.

Native paging bounds each read, but consumers must also bound retained data.
Status projects call metadata per page. Exports reverse Pi's newest-first scans
to retain chronological order. Native scans lack entry-kind and field projection.
Historical worker inputs/results stay in immutable task records. Coordinator
attempt entries freeze mutable view fields and reference those records. Session
documents are current-only, and `task(id)` returns current state, so native
snapshots cannot reconstruct a past Coordinator view. Task documents retire at
completion and cannot hold permanent notes. Coalescing Chord watches cannot
replace durable signals, receipts, or history.

Xean's JSON boundary keeps Chord's strict-value check followed by serialization.
Native `copyJson` preserves negative zero and null prototypes, whereas SQLite's
encoded representation normalizes them. The boundary keeps live, reopened, and
idempotency-comparison values consistent.

## Provider integration

`auditedStream` uses Pi's awaited `onPayload` hook to record the effective request
before dispatch, then settles accounting before terminal delivery. Cancellation
during settlement preserves the recorded provider outcome and usage while
returning an aborted stream. Admission and
accounting failures remain terminal. `onResponse` runs at HTTP headers and does
not cover Codex WebSockets. Telemetry cannot replace durable admission or
settlement. Context capacity belongs in `prepareRequest`, since Pi's
`convertToLlm` and `transformContext` contracts forbid throwing.

The Pi AI patch preserves failed-response usage, typed provider errors, explicit
zero counts, retry-listener cleanup, cache-session isolation, and the existing
JSON/serialization allocation fixes. Authentication, invalid requests, context
limits, and quota failures remain terminal even when their details resemble
transport errors. Retryable typed WebSocket failures use Pi's HTTP fallback.
The retry pattern matches `terminated` as a word so JSON `Unterminated string`
errors do not trigger transport retries. Remove that change when upstream narrows
the pattern or uses an equivalent classification.
Patch hashes and build qualification remain in the artifact provenance.
The upstream changes leave all retained patch guarantees unresolved. Deferred
request-body serialization and JSON repair allocation are performance patches,
separate from transport correctness, authentication, and accounting.
The Codex SSE patch normalizes CRLF framing after joining incoming chunks.
Remove it when the native parser handles CRLF, including split line endings.

Pi drops failed messages from normal input. Xean retains only completed
encrypted reasoning items, checks identity and capacity, and preserves original
call records. Failed text, unfinished reasoning, and tool calls remain excluded.
Pi also derives OpenAI's prompt cache key from its transport session ID. Xean
replaces only that generated default with a model/system/tools hash, preserving
caller keys and disabled caching. Native selective replay and an independent
cache-key option would remove these integrations.

Explorer supplies the task and each index entry as separate user messages,
followed by mutable note states, feedback, guidance, and allowances. Pi preserves
those message boundaries during Responses conversion. Xean keeps tool definitions
stable when the read allowance is exhausted. Its `beforeToolCall` hook runs after
native schema validation and reserves each admitted read before execution.
Pi prepares calls sequentially even when it executes a batch in parallel, so the
guard also bounds several calls in one response. Unknown IDs consume an admitted
read. Schema-invalid arguments do not. Pi owns the transcript and blocked-tool
results, while Xean owns the allowance and final-response restriction.

For public OpenAI Responses models that advertise explicit cache support, the
payload hook marks stable prefix messages as cache boundaries. It preserves
`cacheRetention: "none"` and caller-supplied explicit cache policy. When reading
ends, `allowed_tools` restricts calls to the remaining tools without changing
their definitions. These controls are covered through Pi's native request
conversion with a local transport fixture. They have not been live-qualified on
the public API. Codex Responses currently uses local read enforcement without
these payload additions. Pi exposes neither a provider-neutral tool allowlist
nor per-message cache boundaries; native equivalents would remove these hooks.

Role calls use Pi's `createInitialSystemMessage` to declare their complete tool
catalog, while retaining executable tools in the agent context. This keeps the provider request's
top-level `tools` array present when a structured submission is required,
including after Pi retries a rejected submission; a later-only declaration can
leave Codex with `tool_choice: required` but no tools and is rejected by the
provider.

ChatGPT Web's [service boundary and role policy](solver.md#configuration-and-functions)
live in the solver guide. The adapter uses Pi's `createProvider`, `lazyStream`,
Responses transport, and transcript conversion. The tested wire contract is:

- `POST {baseUrl}/responses` accepts the complete Responses input, including
  native function-call/result items, the model and reasoning setting, and
  `stream: true`. When tools are declared, `text.format` with `type: "json_schema"`
  carries the strict schema for the `text` and `calls` envelope. Native tool declarations
  are omitted.
  Error results include failure text because Responses has no error flag.
- The adapter supplies thread/turn identity in
  `client_metadata["x-codex-turn-metadata"]` and the matching current-user
  `internal_chat_message_metadata_passthrough.turn_id`. These are transport
  fields, not a requirement for Xean to manage browser sessions.
- Responses SSE's terminal `response.completed` must contain exactly one
  assistant message with `phase: "final_answer"` and the original `output_text`.
  Commentary, incomplete output, and ambiguous final answers cannot become
  submissions. Token-by-token streaming is unnecessary.

The provider's custom API identity excludes browser answers from OpenAI reasoning
replay. Transport retries, solver response retries, and recovered browser-worker
sends remain disabled. Client cancellation prevents late publication but does not
establish that remote generation stopped. `/healthz`, `/v1/models`, and setup or
browser-control APIs are outside Xean's required interface. The old `chatgpt-cli`
Chat Completions path is retired, with no fallback.

The [live qualification](kernel-smoke.md#chatgpt-web) records the tested external
runtime, its answer-preservation patch, and the exercised paths. That deployment
is evidence for the contract, not a required installation layout.

The official [Workspace Agents API](https://developers.openai.com/workspace-agents/trigger-runs)
can trigger a workspace agent and report its status, but cannot currently retrieve its
answer. It therefore cannot supply Pi model responses. Its workspace-scoped
authentication does not establish personal Pro availability.

Claude uses Pi's native `anthropicProvider`, backed by `@anthropic-ai/sdk`.
Pi owns API-key and Pro/Max OAuth authentication, message conversion, tool calls,
streaming, and usage. Xean uses the same profile and call recorder as other models.
The CLI accepts an operator-supplied token through `apiKeyEnv`; library callers
can supply Pi's credential store for OAuth refresh. Native OAuth qualification
is recorded in [verification](kernel-smoke.md#native-anthropic).
The separate Claude Code provider, subprocess bridge, and provider patch are removed.

## Completed private work

Pi's durable tool task now persists validated arguments and replay intent before
execution, then commits the result and terminal task state together. An
interrupted tool reruns only when both its recorded and current replay policies
are `safe`. Native ownership waits for child tasks and aborts them from the
leaves upward. These mechanisms can support private resumption.

Xean still executes model roles through `runAgentLoop`. Its valid submissions
survive retries inside a live invocation, while interruption recovers the whole
worker. Moving roles to durable generation would also need persisted response
and read allowances, accepted mathematical submissions, frozen inputs and model
identity, and the original call ledger. Shared notes must still publish only
when the whole worker succeeds.

Native generation hooks do not yet replace Xean's guards: hook failures are
reported, cancellation can bypass `afterResponse`, and there is no durable
effective-request admission/settlement contract. Native usage totals and event
watches cannot replace call admission or durable Coordinator signals. A role
migration must also disable automatic compaction and preserve full mathematical
tool results. Private-progress recovery remains deferred until these boundaries
can be preserved with a smaller implementation.

## Next adoption opportunities

- **Durable execution:** replace the local Harness extensions with upstream
  admission, domain settlement, and pause controls when available. Preserve
  atomic whole-worker publication and durable failure delivery.
- **Session health:** replace the empty-commit check when Session exposes fatal
  state directly. Public commit observation is already adopted. Document watches
  alone do not replace the scheduling projection or durable signals.
- **Accounting and patches:** adopt native awaited admission and settlement
  when late accounting survives cancellation. Remove the read-only opener and
  provider patches as equivalent upstream guarantees become available.
- **Forks:** native `Tx.forkConversation()` copies conversation documents using
  their `asOf`, `current`, or `initial` policy. A whole-campaign branch also needs
  session state and a concrete publication/ownership contract for the experiment.
- **Continuation:** `incomplete.max_messages` and length-truncated output are
  separate from transient retries. Add either for a demonstrated workload need.

Private-progress recovery, hot extension registries, alternate storage, and a
second task framework remain deferred. Current validation is recorded in
[kernel verification](kernel-smoke.md).

[types]: https://github.com/earendil-works/pi/blob/8ce69e9d2b171d173fe4b6b2b6256f1f4411e69d/packages/durable/src/types.ts
[session]: https://github.com/earendil-works/pi/blob/8ce69e9d2b171d173fe4b6b2b6256f1f4411e69d/packages/durable/src/session/session.ts
[scheduler]: https://github.com/earendil-works/pi/blob/8ce69e9d2b171d173fe4b6b2b6256f1f4411e69d/packages/durable/src/harness/scheduler.ts
[spec]: https://github.com/earendil-works/pi/blob/8ce69e9d2b171d173fe4b6b2b6256f1f4411e69d/packages/durable/docs/pico-v5.md
