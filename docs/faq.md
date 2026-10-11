# Frequently asked questions

Xean develops and checks mathematical arguments for one task. These answers
describe Xean 3.1. Proposed changes are in the [4.0 milestones](milestones-4.0.md).

## Can Xean write and run code?

The built-in Explorer and Verifier reason about mathematics and read notes.
They have no shell or code-execution tools. Xean supports two ways to work:

- **Reasoning without program execution:** leave `codex` unset in settings.
  Explorer develops arguments and Verifier checks them.
- **Reasoning with delegated computation:** configure `codex`. Coordinator can
  assign a concrete implementation or computation to a Codex worker, supplying
  the relevant notes. That worker can write and run programs and returns its
  findings as unverified notes. Programs and outputs remain in its workspace.

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
Setting `research: false` does not disable a configured `codex` worker. For a
closed-book run, the [bounded runner](../scripts/bounded-solve.ts) provides
`--offline` and rejects coding and ChatGPT Web settings.

## Can I ask for a better bound or a generalization?

Yes. A task has free-form `problem` and `completionCriteria` fields. The endpoint
can leave the result for Explorer to discover:

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
acceptance additionally requires the complete result and its generated support
to pass the required checks, including blind reconstruction.

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
does not prove its claim. Include the inputs, method, relevant outputs, and
reproduction information in the returned notes. The current independent reviewer
has no execution tool. Essential finite checks need analytical justification or
matching execution evidence, and unsupported checks remain inconclusive.

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
Coordinator chooses the next work and writes guidance for each Explorer
assignment. This is campaign-level guidance, not a direct message to an Explorer
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

## Can I supply my own results?

`submit` imports notes and `correct` revises them. Imported notes carry caller
trust for correctness and sources. Use imports for premises you intend to grant,
rather than as a way to validate unchecked computational output. Keep the proof,
hypotheses, and provenance when reusing a result from another campaign.
Use `review` for an independent assessment of a supplied argument and its
supporting proofs.

## Why did the campaign stop without an accepted result?

Read the reported status. `idle` means no work remains scheduled and no result
has been accepted. `blocked` records a failed Coordinator decision or standalone
procedure. An ordinary worker failure can instead lead to another Coordinator
decision. A paused campaign retains its progress. Inspect the reported failures
and verification issues before deciding whether to add guidance or resume.

For standalone procedures such as `role` and `review`, `completed` describes
execution. Read the returned assessment separately: it may be FAIL or
INCONCLUSIVE.

The [bounded runner](../scripts/bounded-solve.ts) can stop after a chosen number
of worker admissions. Reaching that allowance does not establish impossibility
or optimality. Resume historical campaigns with their original frozen runtime.
