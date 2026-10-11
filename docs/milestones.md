# Xean milestones

M4 (4.0) should support sustained mathematical research with checked intermediate
results and external computation. M5 (5.0) should keep accumulated mathematical
knowledge useful for further research and paper writing. These milestones are
proposals, not features available in the current release. The [FAQ](faq.md)
describes current behavior.

Keep Xean understandable as a whole. Equivalent concepts should share a name,
representation, and implementation unless a concrete requirement justifies a
difference. Use Pi's native tasks, conversations, entries, documents, outcomes,
and commits before adding application machinery.

## M4 / 4.0: Continued research and external computation

Xean 3.1 already preserves partial notes, checks their mathematical claims,
reports progress, delegates implementation to Codex, and supports pause and
resume. Its ordinary verification path ties full reconstruction to task
requirements, and acceptance ends the campaign. The proposed changes separate
checking a useful result from completing or stopping the research task.

Explorer concentrates on mathematical reasoning. Coordinator arranges requested
work. An existing durable external service owns computation and agentic jobs.
Mathematical workers and notebook publication remain sequential.

### M4-01: Fully check intermediate claims

**Status: proposed. Dependencies: none.**

A useful lemma, improved bound, construction, or counterexample can receive full
verification, including blind reconstruction, without claiming to solve the
whole task. The checked statement preserves its exact hypotheses and supporting
claims. Task completion remains a separate judgment.

**Done when:** a partial result passes the complete applicable checks while the
original task remains unresolved. Inspection exposes the exact claim, its
current evidence, and its dependency chain. Revising mathematical content
invalidates affected evidence. Independent review remains separately recorded.

### M4-02: Delegate a precise computation request

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

### M4-03: Continue research while external work runs

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

### M4-04: Improve a bound without declaring optimality

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

### M4-05: Qualify the combined workflow

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

### M4 scope

M4-01 and M4-02 can proceed independently. Background work follows the external
service contract, and open-ended improvement follows independent claim checking.
The combined qualification follows both paths.

Project hierarchies, cross-task planning, and shared budgets stay with the user
or an existing external agent. Xean 4.0 adds no Lab work, general parallel
Explorer/Verifier scheduling, separate storage authority, or new execution
service. Historical campaigns retain their frozen runtimes.

Knowledge maintenance and paper writing belong to M5 and are outside M4's
completion criteria.

## M5 / 5.0: Mathematical knowledge and paper writing

Long research sessions should leave an organized mathematical notebook that
people and agents can use to continue research and write a good paper. Exploration
and verification both produce knowledge. Maintaining that knowledge includes
finding reusable results, separating claims, simplifying arguments, and retaining
useful failed approaches. The long-term direction is a mathematical workspace
connecting research, knowledge, and exposition.

The current notebook already shares an edit path between Explorer, `submit`,
and `correct`. Caller imports carry a distinct trust grant. Verifier records
exact statements, source evidence, diagnoses, and reconstructed proofs, but can
edit only note summaries. Useful mathematics inside those records is not fully
exposed by the ordinary note-reading tools. Coordinator and Explorer receive
the entire non-retired note index, which grows during a long campaign. These
are organization and discovery limitations. Their performance cost remains
unmeasured.

### M5-01: Make contributions discoverable and reusable

**Status: proposed. Full checking of intermediate claims depends on M4-01.**

Expose useful mathematical contributions from exploration, verification, and
caller input through the same notebook. Keep a claim distinct from its evidence
and from any caller-granted assumptions. A verifier's counterexample, missing
hypothesis, or reconstructed argument can guide later work and become a reusable
note, with references to the original finding and its scope.

**Done when:** later work can find and reuse a useful verifier discovery through
ordinary notebook reads. An extracted claim receives the applicable checks
before serving as checked support. Original assessments remain bound to the
revisions they judged. Reuse across tasks preserves hypotheses, permitted
premises, source provenance, and the scope of prior checks.

### M5-02: Organize the notebook and simplify its arguments

**Status: proposed. Fully checking reorganized intermediate claims uses M4-01.**

Provide useful entry points to related results, open questions, and failed
approaches. Start with existing summaries, references, edits, and retirement.
Explorer can separate bundled claims, consolidate equivalent material, and
remove unnecessary proof dependencies. Retain stable IDs when revising the same
claim and create distinct notes for distinct claims. Navigation links identify
related material. Proof dependencies identify premises an argument uses.

**Done when:** a cluttered example becomes easier to navigate and an identified
duplication or unnecessary dependency is removed. Exact hypotheses, proofs,
sources, and useful failure reasons remain accessible. Mathematical changes
invalidate affected checks, including checks on dependent claims. The affected
claims undergo the required verification. Retirement preserves history and
existing dependencies. Splits and merges cannot silently transfer old PASS
evidence to changed mathematics.

### M5-03: Choose maintenance when the notebook needs it

**Status: proposed. Depends on M5-02.**

Coordinator can choose a bounded Explorer maintenance assignment at the next
worker boundary, then decide whether to resume exploration or continue organizing.
Signals include repeated rediscovery, difficult retrieval, contradictory
summaries, and bundled claims that retain unnecessary dependencies. A large
note count can prompt inspection. The trigger policy should follow evidence
from long runs, since useful reorganization can increase the number of notes.

**Done when:** a campaign identifies a concrete organization problem, publishes
a maintenance result, and resumes useful research. Interrupted maintenance
recovers without partial publication. Pi retains the tasks, snapshots, and
atomic commits. This behavior uses the existing sequential worker lifecycle.

### M5-04: Develop a paper from the mathematical knowledge

**Status: proposed. Uses M5-01 and M5-02.**

Support writing a coherent paper from selected results: explain the contribution,
choose theorem and lemma boundaries, organize proofs, establish notation, and
give exact source attribution. Paper structure follows the mathematical argument
and intended audience. Claims and proofs remain traceable to the notebook's
exact statements and evidence. A draft identifies its source revisions, and
later mathematical edits identify affected passages for review. Published
artifacts retain their original source snapshots.

Writing can reveal a missing premise, a stronger statement, or a simpler proof.
Those discoveries return to research and verification through ordinary note
edits. Drafting and knowledge maintenance should improve each other while
sharing the mathematical record. The choice of writing tools and interface
remains open.

**Done when:** a retained research example yields a coherent paper draft that
an independent mathematical and editorial review can follow. Review checks the
assembled argument as well as its component results. Its claims, hypotheses,
dependencies, and citations match the underlying knowledge. A
substantive revision found during writing is checked and reflected in both the
notebook and draft. Unresolved claims remain explicit, and a paper draft alone
does not establish correctness, novelty, or publication readiness.

### M5-05: Qualify knowledge maintenance through reuse

**Status: proposed. Depends on M5-01 through M5-04.**

Use a saved long-run notebook containing overlapping lemmas, a bundled claim,
useful verifier findings, and an unsuccessful approach. The
[P21 dependency example](design-ideas.md#simplifying-accumulated-proofs) supplies
a concrete simplification case. Compare the original and reorganized notebooks
on locating an exact result, continuing research, and developing an exposition.

**Done when:** independent readers can find and reuse the relevant mathematics
and its evidence, while affected claims pass their checks and historical
snapshots remain reproducible. Report retrieval effort, index size, and repeated
checking before claiming efficiency gains. Fewer notes alone do not establish
a better knowledge system.

### Possible standalone knowledge system

M5 may become a separate project serving Xean, paper writing, and other
mathematical work. Establish its boundary through concrete consumers and shared
needs. Extraction should simplify those consumers while preserving a single
authority for mathematical content and evidence. Begin with Pi's existing
Documents, Entries, and commits. A separate service, graph database, or
synchronization layer needs a demonstrated requirement.

The milestone is useful knowledge across research and exposition. Whether that
lives inside Xean or becomes a standalone component remains a design decision.
A broader mathematical workspace is a direction for later development, with
each added capability justified by a concrete mathematical workflow.
