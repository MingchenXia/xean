# Aligning Xean with Pi

Pi supplies model execution and durable transactions. Xean supplies campaign
policy and the mathematical workflow. The [kernel contract](kernel.md) defines
publication and recovery, and the [solver guide](solver.md) defines mathematical
acceptance. This document records native API ownership and the gaps that still
prevent further delegation.

## Sources and availability

All five Pi/Chord packages are pinned to
[`1ff5b6fddf69`](https://github.com/earendil-works/pi/tree/1ff5b6fddf69c322c6937781a720f97e87c93774),
the upstream main revision checked on 2026-09-29.
Their upstream manifests say `0.87.1`. The
[artifact record](../vendor/pi/provenance.json) identifies the source, frozen
model catalog, reproducible builds, and retained patches.

The [public durable types][types] and [Session implementation][session] supply
transactions, documents, records, typed IDs, snapshots, conversation forks, and
public commit subscriptions. Pi now implements a [durable task scheduler][scheduler],
Harness, document watches, and the first durable chat generation. Tool turns
and live run controls remain later milestones in the [Pico5 specification][spec].
The existing `pi-agent-core.AgentHarness` is a different API.

## API ownership

| Responsibility             | Current implementation and reason                                                                                                                                        |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Models and transport       | Pi catalogs, provider factories, auth helpers, conversion, and streaming. Xean profiles select models and endpoints.                                                     |
| Role execution             | Pi `runAgentLoop` owns the transcript, tools, argument validation, and turns. Xean hooks enforce submission and invocation limits.                                       |
| Turn state                 | Pi's completed `toolResults` determine whether submission succeeded and whether to continue. Xean retains the last valid value, response count, and one-reminder policy. |
| Context capacity           | Pi's estimator runs in `prepareRequest`. Xean reserves answer space and hands off prior valid submissions. Compaction is outside the solver contract.                    |
| Provider recovery          | Pi `retryAssistantCall` owns classification, backoff, and bounds. Xean records each admitted call and selectively retains completed reasoning.                           |
| Transactions               | Native Session owns serialization, document caching, draft preparation, rollback, atomic storage, and adoption.                                                          |
| Record identities          | Native `TaskId`, `EntryId`, `DocumentId`, and `Seq` identify tasks, entries, documents, and commits. Task creation returns the native ID.                                |
| Storage                    | Pi's Node SQLite adapter supplies WAL, statements, transactions, and records on locked Bun. Xean adds campaign ownership and read snapshots.                             |
| Cancellation and telemetry | Chord `Context` and `withCancel` carry cancellation. Pi's telemetry context carries attempt spans. Xean joins admitted work before closing.                              |
| Scheduling and publication | Xean admits workers, serializes Coordinator decisions, enforces limits, and publishes each whole result with its signal. Native Harness lacks the controls listed below. |
| Mathematical state         | Xean owns dependency closure, verification stages, corrections, evidence binding, and exact acceptance. Notes derive from immutable results and input receipts.          |
| CLI and observation        | Separate packages use public library APIs. Read-only inspection uses Pi scans. Live mutations reach the active owner through a local socket.                             |

A kernel role needs only its name and `run(input, execution, context)`. Tool
descriptions belong to Pi's tools. Solver and standalone execution call the same
functions, with lazy runtime construction. Built-in research invokes Codex
through Execa. Codex's argv, stdin, process cancellation, and separate-output
contract remain necessary for that path; Pi's shell surface does not supply
that contract. Library callers can provide another `Research` implementation
explicitly.

## Durable integration

Store adapts native `createSession`. Its typed campaign document uses full bases
through `checkpointWhen`. Native transactions validate task conversation
membership and ownership. Xean detaches values at external boundaries because
native records and drafts can be Session-owned. Coordinator copies its callable
input once and derives its prompt and note reader from that frozen copy.

Store uses public `Session.subscribeCommits()` to update its task projection and
wakeup revision after document adoption. The Storage proxy is removed. Pi owns
commit observation and poisoning. After a rejected operation, an empty Session
commit checks whether the instance remains usable without a Storage write.
The task projection avoids repeated full scans. Completed Coordinator payloads
stay durable but leave the resident cache.
`StorageRejected` guarantees a failed batch made no durable change and leaves
the instance usable. Unknown commit outcomes and post-storage adoption failures
stop the instance.

The durable patch exposes the existing native task-record replacement method
through `Tx`, permits record creation without executable phase handlers, and
preserves caller-supplied entry attribution outside a native task invocation.
Native validation, transaction assembly, retirement, and publication still own
these operations. This extension supports Xean's external scheduler. Remove it
when Harness can own the following contracts:

- Admission must respect concurrency, sequential Coordinator invocations,
  persistent pause, and call-cap draining. Harness currently reserves every
  eligible task and exposes `resume()` without a public pause or admission hook.
- Runtime-written `faulted` and `orphaned` outcomes must atomically publish
  Xean's failure signal. Harness has internal settlement for its own generation
  task, but no public domain settlement hook.
- Close must join admitted call accounting before sealing storage writes.
  Harness seals Session admission before joining invocations, so late accounting
  cannot use the same Session during shutdown.

Moving scheduling now would require additional admission and settlement
machinery around Harness. Xean retains whole-worker recovery while these native
controls are incomplete.

The separate owner lock protects Pi's ID allocator and Xean's scheduler while
allowing independent readers. Xean selects FULL synchronization. Read-only
transactions give inspection coherent snapshots. The upstream opener always
runs migrations, so the read-only patch skips writes, validates the schema, and
rejects mutation and ID allocation. Reader cleanup avoids a writer checkpoint.
SQL remains the backend direction.

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
before dispatch, then settles accounting before terminal delivery. Admission and
accounting failures remain terminal. `onResponse` runs at HTTP headers and does
not cover Codex WebSockets. Telemetry cannot replace durable admission or
settlement. Context capacity belongs in `prepareRequest`, since Pi's
`convertToLlm` and `transformContext` contracts forbid throwing.

The Pi AI patch preserves failed-response usage, typed provider errors, explicit
zero counts, retry-listener cleanup, cache-session isolation, and the existing
JSON/serialization allocation fixes. Authentication, invalid requests, context
limits, and quota failures remain terminal even when their details resemble
transport errors. Retryable typed WebSocket failures use Pi's HTTP fallback.
Patch hashes and build qualification remain in the artifact provenance.

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

Role calls declare their complete tool catalog in the initial system message as
well as retaining it in the agent context. This keeps the provider request's
top-level `tools` array present when a structured submission is required,
including after Pi retries a rejected submission; a later-only declaration can
leave Codex with `tool_choice: required` but no tools and is rejected by the
provider.

ChatGPT Web uses native `createProvider`, `lazyStream`, the OpenAI-compatible
Chat Completions transport, and transcript conversion. Pi owns asynchronous
setup, event delivery, and stream completion. The bridge returns text only, so
the adapter places a generic typed JSON envelope in the prompt, removes native
tool fields before dispatch, validates the envelope against the current Pi tool
names and argument schemas, and emits native tool calls and optional text. Pi
owns execution and continuation. An empty call list permits final text. It
retains response metadata on failure and marks browser usage unmeasured. The
custom API identity excludes it from OpenAI reasoning replay. Both the
underlying transport and the solver disable automatic request retries for this
provider because an interrupted browser request may already have been
submitted. The adapter contains no role-specific tool names. Browser tool calls
are structured proposals executed locally by Pi, including submission. The
transport fixtures cover multiple tools, multiple calls, validation, result
feedback, and cancellation; they do not constitute live Pro qualification.

Claude subscription transport uses `pi-claude-code-provider` pinned to `0.5.0`
([source](https://github.com/chem/pi-claude-code-provider/tree/a87b98539f57945b8a6df8c26db4cdcf3ed38a7a)).
Pi supplies the Opus model definition, provider registration, and lazy stream.
The package owns CLI authentication, serialization, process termination,
temporary files, and usage parsing. Xean owns the request's image-store lifetime
and holds terminal events until process and image cleanup settle. A small patch
exposes the finalization callback and resolves strict TypeScript issues. Existing
dependency timeouts remain in place. Tune them from measured durations and
inactivity for the relevant provider, without adding a separate role deadline. Its
source imports are version-specific and need review on upgrade. Both subscription
transports remain model providers used by ordinary roles.

## Completed private work

Completed private submissions survive Pi's retries within a live invocation.
Durable resumption also needs the validated tool outcome, role state, response
allowance, frozen input and model identity, and original call accounting.
`runAgentLoopContinue` accepts restored context but supplies none of that
persistence. Native Session can store task checkpoints atomically. Harness now
executes checkpoint phases and persists generation attempts, retry delays, and
partial-response presentation. Tool execution and validated submission recovery
remain outside that implementation. Its scheduling and shutdown gaps above also
prevent adopting it for Xean's private work. AgentHarness and experimental Pico3
use different session and storage contracts.

The archived Explorer `w110-1` retained its completed `n1` and `n2` submissions
in both failed continuations, then terminated without publication. Provider
settlement alone does not prove that the submission tool was accepted. The next
requests in this case contain the successful tool receipt. Exhausted Pi recovery
throws an ordinary error and terminalizes the worker, so checkpoint-only reopening
would not repair this failure path. The predecessor reused completed calls, but
its incremental publication model differs from current whole-worker publication.

Private-progress recovery remains deferred. Future support needs accepted
submissions or completed verifier stages in the existing Session, guarded by
attempt identity and cancellation. It also needs explicitly classified retries
before terminalization, within existing attempt and call limits and provider
replay-safety rules. Reuse must preserve completed-response counts, frozen inputs,
model identity, and original usage records. The resumed worker must succeed
before its complete result and completion signal become shared state.

## Next adoption opportunities

- **Durable execution:** adopt Harness when public admission, domain terminal
  settlement, and shutdown accounting satisfy the contracts above. Preserve
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

[types]: https://github.com/earendil-works/pi/blob/1ff5b6fddf69c322c6937781a720f97e87c93774/packages/durable/src/types.ts
[session]: https://github.com/earendil-works/pi/blob/1ff5b6fddf69c322c6937781a720f97e87c93774/packages/durable/src/session/session.ts
[scheduler]: https://github.com/earendil-works/pi/blob/1ff5b6fddf69c322c6937781a720f97e87c93774/packages/durable/src/harness/scheduler.ts
[spec]: https://github.com/earendil-works/pi/blob/1ff5b6fddf69c322c6937781a720f97e87c93774/packages/durable/docs/pico-v5.md
