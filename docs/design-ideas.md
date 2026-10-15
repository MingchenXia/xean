# Design ideas

## Concurrent outer workers

Outer concurrency is deferred. The current contract is Coordinator, one worker,
then Coordinator again after that worker's complete result or failure commits.
A worker may parallelize its internal work. Reconsider overlapping outer workers
only after the sequential workflow is stable, with evidence that the benefit
justifies the additional scheduling and consistency rules.

## Verified exploration

Consider exposing exploration and verification as one operation to Coordinator.
The operation would return exploration together with verification results,
potentially simplifying scheduling. It may cost more if it verifies more notes
than Coordinator would otherwise select.

Which notes it verifies, how verification overlaps exploration, and what it
returns when checks fail remain open. This is an unimplemented idea.

## Simplifying accumulated proofs

Long campaigns can retain overlapping lemmas and unnecessary dependencies in
their final proof chain. In the P21 golden run, a strengthened orientation lemma
coexisted with its earlier version because a supporting note bundled a general
stability theorem with a consequence that used the earlier lemma. Later work
needed only the general theorem but inherited the whole note's dependencies.

This is a concrete case for
[M5 knowledge maintenance](milestones.md#m5--50-mathematical-knowledge-and-paper-writing).
Explorer could split the bundled claims and revise the affected dependencies
through ordinary notebook edits and verification. Historical notes and checks
remain accessible. Automatic maintenance is unimplemented, and its benefit
must be assessed through later reuse.
