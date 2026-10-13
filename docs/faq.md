# Frequently asked questions

Xean develops and checks mathematical arguments for one task. These answers
describe this checkout. The [changelog](changelog.md) identifies changes since
the latest release. Proposed changes are in the [milestones](milestones.md).

## Can Xean write and run code?

Explorer and the native Verifier reason about mathematics without shell or
code-execution tools. Configuring `codex` lets Coordinator delegate computation
and select a Codex Verifier:

- **Reasoning without program execution:** leave `codex` unset in settings.
  Explorer develops arguments and Verifier checks them.
- **Reasoning with delegated computation:** configure `codex`. Coordinator can
  assign a concrete implementation or computation to a Codex worker, supplying
  the relevant notes. That worker can write and run programs and returns its
  findings as unverified notes. Coordinator can also select Codex to verify
  claims, write and run checkers, and issue PASS, FAIL, or INCONCLUSIVE directly.
  Programs and outputs remain in retained workspaces.

To enable delegation, install and authenticate the Codex CLI, then add a `codex`
field to your existing settings, for example:

```json
{
  "codex": {
    "model": "gpt-6-astra",
    "reasoning": "max",
    "workspace": "/absolute/path/to/workspaces"
  }
}
```

This is a settings fragment. Choose a model available to your Codex CLI and an
absolute workspace path. Coordinator decides when to use the worker. Selecting
`openai-codex` as a model provider alone does not enable program execution.

The separate `research` setting controls source retrieval and independent review.
Setting `research: false` leaves configured Codex implementation and verification
available. For a closed-book run, the
[bounded runner](../scripts/bounded-solve.ts) provides `--offline` and rejects
enabled literature, Codex implementation and verification, and ChatGPT Web.

## Can I ask for a better bound or a generalization?

Yes. A task has free-form `problem` and `completionCriteria` fields. The task can
ask Explorer to discover an improvement or generalization:

- To improve a lower bound, state the domain, hypotheses, and current bound
  `c0`, then require a proof of an explicit bound `c > c0` under those same
  hypotheses.
- To investigate a generalization, specify the assumption to remove and the
  conclusion to preserve, then ask for a proof or a counterexample.

An accepted improvement satisfies that task. It does not establish the optimal
constant or finish every possible generalization. The current campaign stops
after acceptance. To seek another improvement, start a new task with the updated
target and retain the earlier proof and its assumptions.

For a broader research project, a user or external agent can choose these tasks
and assess their results. Xean currently has no project-wide task hierarchy or
built-in policy for improving a bound indefinitely.

## Can a campaign make useful progress without solving the task?

Yes. Notes can contain partial theorems, constructions, conjectures, observations,
and failed approaches. Mathematical claims can receive correctness and source
checks even when they do not meet the task's completion criteria. Internal
acceptance additionally requires the complete result and its complete support
chain to pass the required checks, including blind reconstruction.

Use `status` for a compact progress report and `inspect` for notes and their
checks. A user or external agent judges whether an update is significant for
the larger project. `export` returns an accepted argument, so use `inspect`
to read partial work.

## Does an accepted result guarantee a correct proof?

Acceptance records that the required model-based checks passed for the exact
task and its supporting argument. Models can make mistakes. Independent review
is a separate result, and neither assessment is a formal proof certificate.
`INCONCLUSIVE` means a check remains unresolved.

Computation also needs mathematical justification. A program's successful exit
does not prove its claim. The Codex Verifier must check that the program covers
the required cases and establishes the exact claim, retaining the checker, inputs,
commands, outputs, and environment. Missing proof steps require repairs to the
authoritative note. Dependency checks and the remaining acceptance stages still
apply. The separate independent reviewer uses `research` and has no execution tool.

## What happens when verification is inconclusive?

Coordinator chooses work from the unfinished obligation. With `codex` configured,
it can select `backend: "codex"` on a Verifier request to reassess an
INCONCLUSIVE correctness, requirements, or reconstruction check. It can also
select Codex initially when computation or artifact access is useful. These are
Coordinator decisions, with no automatic fallback.

Coordinator may select Codex again after an INCONCLUSIVE Codex check when
another attempt could resolve the unfinished obligation. PASS and FAIL checks
stay closed while their inputs are unchanged. Source checks retain their
separate rule: new quotations must match the exact unresolved premises.
Coordinator can instead pursue another approach or leave a peripheral claim
unverified. An unresolved claim cannot support an accepted proof.

## Can computation run in the background while Xean explores?

The current campaign runs Coordinator, one worker, then Coordinator again after
that worker returns. A Codex assignment occupies that worker turn, so other
Explorer or Verifier work does not overlap it. A worker may parallelize its own
work.

Resource-heavy computation needs an operator-provided supervised compute service.
Xean has no built-in asynchronous MCP job workflow that submits a long-running
job, continues exploration, and later collects its result. That behavior is a
proposed 4.0 milestone.

## Can Xean use papers and other external sources?

Source checking and independent review use the configured research backend,
which defaults to the Codex CLI. Literature search is an optional worker enabled
with `literature: true`. `research: false` disables the research backend, while
`literature: false` alone leaves source checking and review available.

State any permitted background results and their exact scope in the task.
External claims that require source checking remain unresolved when retrieval
is unavailable. The [setup instructions](../README.md#run-a-campaign) describe
provider authentication and the separate Codex CLI setup.

## Can I steer Coordinator and Explorer during a campaign?

Yes. Put an approach, diagnostic observation, or suggestion in a text file and
send it with `guide`:

```sh
bun run xean guide .xean/demo/campaign.sqlite guidance.md --id focus-constructions
```

For example, `guidance.md` could contain: "Focus on extremal constructions before
trying to strengthen the bound. Preserve the original hypotheses and record any
failed approaches."

The guidance is saved with the campaign and included in Coordinator's context.
Coordinator chooses the next work and writes an assignment for Explorer.
This is campaign-level guidance, not a direct message to an Explorer
already running. A running worker finishes its current assignment before the
next decision uses the new input. Coordinator chooses how to act on the advice.

Guidance is an append-only sequence. Send new text with a new `--id`. Repeating
the same ID and text is an exact retry, while reusing an ID with different text
is rejected. Earlier guidance remains in the history and Coordinator's input.
There is no command to replace or delete a guidance message. When changing
direction, explicitly state which earlier advice the new message supersedes.
Coordinator interprets that correction alongside the saved history.

Xean manages guidance admission and its inclusion in Coordinator's context.
Pi Durable stores the entries and preserves them across reopening. `inspect`
shows saved inputs and worker assignments. Add `--records` to inspect the model
transcripts when needed. The receipt establishes that guidance was recorded,
while subsequent decisions show how it was used.

Resume a blocked campaign before adding guidance. A paused campaign can retain
guidance for resumption. Accepted and cancelled campaigns are terminal. Guidance
preserves the frozen task and completion criteria, so a changed mathematical
target belongs in a new campaign.

## Should I use guidance or notes for background material?

Use `guide` for short instructions about the next work, such as "Try a geometric
construction using the existing lemmas." Every Coordinator decision receives
the full saved guidance. Pasting a paper into `guide` repeats that paper in each
decision's input.

Use `submit` for initial notes and reference material after `init`, before the
first `run`, or during an ongoing campaign. Each new note has a local `id`
(`n1`, `n2`, and so on), a short `summary`, a `detailedSummary`, full `text`, and a
`support` array of note IDs. Native Coordinator and Explorer receive the short
index and can read the detailed summary or full text as needed. Preserve the
result's hypotheses, proof, and provenance in the note.

New caller notes default to external trust, which grants their mathematical
claims and sources. Set `"trusted": false` on notes that need ordinary
verification, as Explorer notes do. A batch can mix trusted and untrusted notes.

To submit all new notes in `notes.json` without granting their claims, use:

```sh
bun run xean submit .xean/demo/campaign.sqlite notes.json --id initial-notes --untrusted
```

To change an existing note's trust, include `trusted` in an `edits` entry with
its ID and current revision. A changed trust value clears internal checks on
the note and its dependents. Omitting `trusted` preserves the existing grant.

`--untrusted` sets every submitted note and edit's `trusted` field to `false`,
overriding any per-note value. The same JSON fields work through the library
input interface. `inspect` shows the grant as `checks.external`, referencing the
caller's Pi input entry. The grant establishes correctness and sources without
a model call, while declared dependencies must still be verified. Every note
keeps the same final acceptance requirements, including reconstruction.
Exact-statement preparation must receive PASS before reconstruction, checking
statement fidelity without rechecking externally granted truth. It follows the
ordinary retry and reassessment rules.

## Can I supply my own results?

`submit` accepts new `notes` and changes to existing notes through `edits`, using
the same structure as Explorer. To edit a note, get its ID and current revision
from `inspect`, then put the fields to change in a JSON file. For example,
`edit.json` could contain:

```json
{
  "notes": [],
  "edits": [
    {
      "id": "input/lemmas/n1",
      "revision": 42,
      "summary": "A lower bound under the original hypotheses."
    }
  ]
}
```

Replace the example ID and revision with the current values, then run:

```sh
bun run xean submit .xean/demo/campaign.sqlite edit.json --id clarify-lemma
```

Each edit preserves the note's ID and rejects a stale revision. The batch
publishes atomically, and mathematical edits invalidate affected checks.
[External trust](#should-i-use-guidance-or-notes-for-background-material) controls
which claims the caller grants. Keep the proof, hypotheses, and provenance when
reusing a result from another campaign. Set `candidate: true` on a new note or
edit when it claims a complete solution. Candidate status grants no verification
evidence.

To withdraw an unsupported assessment without changing the note, put its current
ID and revision in `recheck.json`:

```json
{
  "notes": [{ "id": "123/n1", "revision": 456 }],
  "reason": "The verifier treated a generated claim as caller-granted."
}
```

Run `bun run xean recheck .xean/demo/campaign.sqlite recheck.json --id audit-1`.
This withdraws checks and external grants on the named notes and invalidates
dependent checks. Dependents retain their own external grants. Note text and
historical evidence remain available. Withdrawal does not declare the claim
false. A paused campaign stays paused. Accepted and cancelled campaigns reject
new inputs.

For an independent assessment, put the task and complete argument, including its
supporting proofs, into a JSON file such as `review.json`:

```json
{
  "task": {
    "problem": "Prove 1 = 1.",
    "completionCriteria": "Give a self-contained proof."
  },
  "argument": "By reflexivity of equality, 1 = 1."
}
```

Use a fresh database and settings with the research backend enabled:

```sh
bun run xean role review review.json .xean/review/campaign.sqlite settings.json
bun run xean inspect .xean/review/campaign.sqlite
```

`role review` returns compact execution status. Read `result.verdict` and
`result.report` in the `inspect` output for the independent assessment.

## Can Xean reorganize a cluttered notebook?

Explorer can revise notes, change dependencies, and retire notes from routine
discovery. Mathematical edits invalidate affected checks. Retirement preserves
historical reads and existing dependencies. Explorer edits and caller commands
share the underlying note-editing path. Callers can additionally grant or
withdraw external trust.

The current system has no automatic phase for reorganizing accumulated knowledge.
Coordinator and Explorer receive every non-retired note's index entry, so the
index grows during long runs. Verification also produces knowledge, including
reconstructed proofs and diagnoses. Those records are retained, but ordinary
note reads do not expose all of that material for reuse.

[M5 / 5.0](milestones.md#m5--50-mathematical-knowledge-and-paper-writing) proposes
better discovery, reuse of verifier findings, and deliberate maintenance through
ordinary edits and checks. Its aim is a notebook that helps further work, with
exact claims and evidence still accessible.

## Can Xean turn its research into a paper?

`export` produces the accepted argument and its supporting notes as Markdown.
The current system has no dedicated paper-writing workflow. A paper still needs
a coherent exposition, consistent hypotheses and notation, accurate attribution,
and review of the assembled argument.

M5 proposes connecting paper writing to the maintained notebook. Writing may
reveal gaps or better arguments that return to research and verification. This
knowledge and writing component could become a separate system, with Xean as
one of its users. Its scope and implementation remain open.

## What happens when a model response reaches a limit or its stream disconnects?

Pi continues the same submission after an output limit or a retryable provider
failure when reusable text, reasoning, or unfinished tool arguments are available.
Tool arguments become unexecuted draft text. These responses do not consume the
role's completed-response allowance, and continuations have no fixed count.
Incomplete tools never execute. Empty limit responses fail explicitly. Retryable
failures without reusable output use Pi's bounded retry policy and backoff.
Authentication, quota, invalid-request failures, context overflow, and cancellation
retain their existing handling. Encrypted OpenAI Responses reasoning from failed
responses needs valid completed-item signatures from the same API, provider, and
model.

The conversation still has context and completed-response limits. Explorer can
hand off its complete submissions when either limit is reached. Coordinator
receives the operational stop reason and chooses the next assignment
using published notes and the remaining gap in the complete task. A new worker
starts from that notebook and assignment.

## Why did the campaign stop without an accepted result?

Read the reported status. `idle` means no work remains scheduled and no result
has been accepted. `blocked` records a failed Coordinator decision or standalone
procedure. An ordinary worker failure can instead lead to another Coordinator
decision. A paused campaign retains its progress. Inspect the reported failures
and verification issues before deciding whether to add guidance or resume.

For standalone procedures run with `role`, `completed` describes execution.
Use `inspect` to read the standalone `result`. An assessment may be FAIL or
INCONCLUSIVE even when execution completed.

The [bounded runner](../scripts/bounded-solve.ts) can stop after a chosen number
of worker admissions. Reaching that allowance does not establish impossibility
or optimality. Resume historical campaigns with their original frozen runtime.
