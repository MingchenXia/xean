# Xean's philosophy

Xean helps strong models solve difficult mathematical problems. Explorer develops
mathematics, verifiers assess its claims, and durable notes preserve the results
and obstacles for later work. Pi supplies standard execution and storage behavior.

1. **Let Explorer choose the mathematics.** Explorer chooses subproblems,
   proposes lemmas, searches for counterexamples, and changes methods.
   Coordinator schedules work and selects relevant notes and feedback. People
   and other agents can supply guidance, which Explorer may question or move
   beyond. The exact task, hypotheses, and completion criteria remain fixed.
   A useful intermediate result is progress toward that task.

2. **Give exploration and verification distinct jobs.** Exploration can produce
   a complete argument, a partial result with stated gaps, or a failed approach
   with its reason. Correctness assesses the claim a note makes. Source checking
   establishes external premises and their hypotheses. Requirements assesses
   whether the result completes the exact task. Blind reconstruction proves a
   set of exact statements together before comparing arguments. Final acceptance
   requires this check for the result and every generated supporting claim.
   Uncertainty stays unresolved, and a sound partial result remains useful
   even when it fails the completion criteria.

3. **Build on established mathematics.** Notes declare the earlier results they
   use. Reuse established supporting results and successful checks, while
   checking the hypotheses of each new application. A caller who imports a note
   supplies it as verified mathematics: its correctness and sources are trusted.
   Imported supporting theorems remain assumptions during reconstruction.
   Their declared dependencies still need the same checks as other dependencies.
   Imported solution candidates still need requirements and reconstruction
   checks for acceptance. Explorer
   and literature notes establish correctness and sources through verification.
   A failed claim invalidates dependent claims, and the record preserves the
   failure for diagnosis.

4. **Make notes sufficient to continue the task.** Notes and their summaries
   are the shared mathematical memory. Record useful results, limitations,
   counterexamples, and failed approaches there. A new invocation starts from
   the task and selected recorded mathematics, with room to reconsider the
   method. Guidance directs work, and the journal retains execution evidence
   for inspection. Harmless corrections preserve a note's mathematical meaning
   and checks. Changes to its mathematics require a new note with explicit
   dependencies.

5. **Preserve work with clear publication boundaries.** Committed notes, checks,
   inputs, and execution records survive interruptions. A worker publishes its
   complete result together with the signal that tells Coordinator it is ready.
   Failures also reach Coordinator, which decides what work to request next.
   Running workers retain their frozen inputs. Current recovery repeats an
   interrupted worker as a whole. Resuming private progress remains deferred,
   and any future implementation must preserve atomic shared publication.

6. **Keep the framework small and judge it by mathematical results.** Pi and
   maintained libraries supply standard runtime behavior. Xean supplies campaign
   policy and the mathematical workflow, with a kernel that treats roles as
   callable functions. Add a mechanism when a concrete workload or measured
   failure justifies it. Evaluate methods through independent review of the
   complete argument and its supporting proofs, without giving reviewers the
   solver's verdicts. Compare checked solutions on held-out problems at
   comparable total cost. Keep reference answers outside the run when diagnosing
   failures. Internal acceptance, independent review, and catalog closure are
   distinct records.

The [solver guide](solver.md) defines verification, imported notes, and acceptance.
The [kernel contract](kernel.md) defines publication and recovery.
[Pi alignment](pi-alignment.md) separates available runtime capabilities from
deferred designs. [Xean's philosophy](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/docs/philosophy.md) is the
starting point for these research principles.
