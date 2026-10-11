# Proposed milestones for Xean 4.0

Xean 4.0 should support sustained mathematical research with checked intermediate
results and external computation while remaining understandable as a whole.
These milestones are proposals. They describe behavior to establish, not
features available in the current release.

Xean 3.1 already preserves partial notes, checks their mathematical claims,
reports progress, delegates implementation to Codex, and supports pause and
resume. Its ordinary verification path ties full reconstruction to task
requirements, and acceptance ends the campaign. The proposed changes separate
checking a useful result from completing or stopping the research task.

Keep one representation for each meaning. Use Pi's native tasks, conversations,
entries, documents, outcomes, and commits before adding application machinery.
Explorer concentrates on mathematical reasoning. Coordinator arranges requested
work. An existing durable external service owns computation and agentic jobs.
Mathematical workers and notebook publication remain sequential.

## M4-01: Fully check intermediate claims

**Status: proposed. Dependencies: none.**

A useful lemma, improved bound, construction, or counterexample can receive full
verification, including blind reconstruction, without claiming to solve the
whole task. The checked statement preserves its exact hypotheses and supporting
claims. Task completion remains a separate judgment.

**Done when:** a partial result passes the complete applicable checks while the
original task remains unresolved. Inspection exposes the exact claim, its
current evidence, and its dependency chain. Revising mathematical content
invalidates affected evidence. Independent review remains separately recorded.

## M4-02: Delegate a precise computation request

**Status: proposed. Dependencies: none.**

Explorer can request a concrete computation or agentic assignment needed for the
current mathematical question. Coordinator dispatches that request through MCP
to an existing durable service, preserving
its inputs, expected output, constraints, and required evidence. The service
chooses and manages its execution. Explorer interprets the returned findings
mathematically, and Verifier checks any resulting claims.

**Done when:** a small assignment completes through the service and returns
usable artifacts with enough provenance to reproduce and assess the result.
The receipt identifies the exact request and input revisions. Retrying the same
request recovers the same job, including after an ambiguous interruption.
Changed assignments receive distinct identities. Service completion alone
establishes no mathematical theorem. Xean gains no separate job manager.

## M4-03: Continue research while external work runs

**Status: proposed. Depends on M4-02.**

Several submitted external jobs can run concurrently, including jobs lasting
hours or days, while Coordinator assigns the next mathematical worker.
Explorer and Verifier continue to run one at a time. External results enter
the notebook through the same sequential publication boundary as other work.

**Done when:** disconnecting and reopening Xean recovers concurrently outstanding
job references without resubmission. Job tracking survives the loss of an MCP
session and does not require a request to remain open for the job's duration.
Results retain their original input revisions, and changed notes
require a fresh applicability check before those results support new claims.
Missed completion notifications are reconciled after reopening. When further
mathematical work depends on a pending result, the campaign waits without
repeated model calls. Pausing stops new admissions while submitted external jobs
remain observable.
Explicit cancellation reaches the service and reports the actual outcome,
including a job that finished before cancellation. A delayed or repeated result
cannot publish twice or silently overwrite newer mathematics.

## M4-04: Improve a bound without declaring optimality

**Status: proposed. Depends on M4-01.**

A task can seek progressively stronger results and continue after a verified
improvement. Significant progress is visible through exact claims and their
evidence. For comparable bounds under the same hypotheses, the user can identify
the best checked result so far. Proposed bounds and checked bounds remain
distinguishable, and incomparable results retain their separate scopes.
Coordinator explains significant updates by referring to the affected claims.
Callers can retrieve those updates without reading the entire transcript.

**Done when:** a campaign records a checked improvement, continues research,
then stops or pauses at the caller's request without labeling the mathematical
objective complete. A proved endpoint can still establish completion. An
exhausted allowance, failed search, or apparent plateau does not establish
optimality. Existing valid results remain available when a stronger result is
found. Task representation and stopping controls will be chosen during design
review, without committing here to a new schema or optimization framework.
Significance remains a mathematical judgment, with no generic numerical score.

## M4-05: Qualify the combined workflow

**Status: proposed. Depends on M4-01 through M4-04.**

Exercise the joined path on a small known mathematical case with independently
checkable answers. The scenario requests an external computation, continues
useful reasoning while it runs, recovers after interruption, and turns the
returned evidence into a checked improvement. It also exercises an input
revision, duplicate delivery, cancellation, and a false or unsupported claim.

**Done when:** the resulting records demonstrate correct recovery, sequential
publication, evidence invalidation, claim checking, and stopping semantics.
Independent review checks the mathematical result. This qualification measures
the implemented workflow, not a guarantee of solving open problems.

## Scope and later ideas

M4-01 and M4-02 can proceed independently. Background work follows the external
service contract, and open-ended improvement follows independent claim checking.
The combined qualification follows both paths.

Project hierarchies, cross-task planning, and shared budgets stay with the user
or an existing external agent. Xean 4.0 adds no Lab work, general parallel
Explorer/Verifier scheduling, separate storage authority, or new execution
service. Historical campaigns retain their frozen runtimes.

The [P21 proof-simplification idea](design-ideas.md#simplifying-accumulated-proofs)
can be explored later through Explorer and ordinary verification. It needs no
new simplifier role and is not a required 4.0 milestone.
