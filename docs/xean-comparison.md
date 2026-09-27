# Historical comparison

This review predates the replacement. Yean below denotes the implementation now
published as Xean. Historical names, commits, and measurements are preserved.

The September 26, 2026 review compares Xean `8a846d3` with Yean's tested snapshot
`20deb329` and local working tree. Current Yean behavior belongs in the [kernel](kernel.md)
and [solver](solver.md) guides. Frozen campaigns retain their launch code.

## Interrupted responses

Yean now uses Pi's `retryAssistantCall` to recover a transient response failure
within the same role invocation. Successful prior turns and private submissions
survive. Each retry needs fresh call admission, and each failed response settles
before the next attempt. Tools from the failed response are never executed.
The solver's bounds and publication rules are in [Research](solver.md#research).

Yean now also captures completed encrypted reasoning from interrupted OpenAI
Responses and Codex Responses, following Xean's
[reasoning recovery](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/src/pi-recovery.ts). It snapshots completed
items, checks model identity, deduplicates IDs, and excludes failed text and
tools. Pi serializes the replay. This requires endpoint support and compatible
account routing, and remains local to the live invocation.

## Useful remaining differences

| Xean capability                                                                         | Current Yean behavior                                                                                                               | Recommendation                                                                                                                |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Handling of `incomplete.max_messages`                                                   | Completed reasoning replay is implemented, with Pi's transient-error classifier                                                     | Add message-limit continuation only when needed. See [Pi alignment](pi-alignment.md#next-adoption-opportunities).             |
| Bounded continuation of length-truncated output                                         | A truncated response fails the worker, and its tools cannot execute                                                                 | Add only after an observed length failure. Keep it separate from transport recovery and never execute partial tool arguments. |
| Saved Explorer submissions and completed verifier subcalls survive process interruption | Live response recovery preserves private work, but process-death recovery repeats the whole worker                                  | Remains deferred until suitable Pi support or a concrete workload justifies it. Preserve atomic shared publication.           |
| Call start/settlement times, per-role cost, and explicit accounting completeness        | Native usage and unknown/unsettled counts are retained, but call records lack explicit timestamps and the CLI omits price estimates | A useful small follow-up for run audits. Keep unpriced Codex calls and missing usage visible.                                 |
| Content-addressed payloads, integrity checks, and lazy response/transcript loading      | Native paginated scans and bounded projections, with inline request/response payloads                                               | Adopt native Pi attachment storage if payload size becomes a measured problem. Avoid a second storage subsystem.              |
| Individually replaceable correctness, statement, proof, and judgment functions          | Replaceable kernel roles and model profiles, with fixed procedures within the built-in verifier                                     | Add finer replacement only for a concrete role experiment.                                                                    |
| Mature Lab/Observe integration and distribution                                         | A checkout-based CLI and observer, with frozen Nomad experiments launched by per-experiment scripts                                 | Consolidate supervised launch and remote allocation routing outside the solver.                                               |

The next small reporting opportunity is explicit call timing and accounting.
Xean's broader local mathematical correction
policy is a separate research choice. Yean keeps harmless corrections and new
notes for mathematical changes, and reconstructs the generated dependency chain
in one blinded batch.

For new research campaigns, Yean already supplies initialization, model selection,
trusted note imports, guidance, harmless corrections, independent inspection,
pause/resume/cancellation, call grants, accepted-proof export, and independent
review. Changes to mathematical strategy can usually use the existing guidance
input. Guidance goes to Coordinator for its next decision, and running workers
keep their frozen inputs. It does not replace kernel invariants or guarantee that
Coordinator follows a suggested approach.

The remaining operational gap is a reusable Fleet launcher. The normal CLI and
`scripts/bounded-solve.ts` both serve live owner control. Remote operators still
need a consistent route into the owning allocation and usage-tag reconciliation.
These concerns belong in the CLI and operational tooling. Existing source-frozen
Xean and older Yean campaigns retain their matching runtimes and artifacts when
new runs move to Yean.

## Gaps already closed

Yean now has Coordinator note-reading tools, verification stopping stages,
batched judgments, context-capacity handoff, imported notes and guidance,
harmless corrections, source-passage reuse, independent review, call grants,
and concurrent read-only inspection. Completed reasoning replay and shared
verifier prompt prefixes are also implemented. Stable cache routing is separate
from transport sessions. Different model/tool schemas and changed support limit
reuse, so the layout enables caching without promising measured savings.
These appeared as gaps in the earlier
comparison and should not be proposed again as missing features.

Both systems use Pi's model and tool loops. Yean also delegates SQLite schemas,
IDs, document reconstruction, and atomic batches to pi-durable. Neither system
resumes an interrupted provider stream after process death. Xean's saved logical
work and its live reasoning recovery are separate capabilities.

## Sources and historical size

The reviewed Xean sources are its [Pi runner](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/src/pi.ts),
[reasoning recovery](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/src/pi-recovery.ts),
[kernel contract](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/SPEC.md),
[solver contract](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/packages/solve/docs/role-runner.md),
[verifier prompts](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/packages/solve/pi-roles.ts),
[accounting](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/packages/solve/accounting.ts),
[call inspection](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/src/observe.ts), and
[payload storage](https://github.com/chaoxu/xean/blob/8a846d36f300de1a5b37f5cbeb46fb0a4a1659ab/src/db.ts).

The September 23 comparison inspected Xean `34c0126` and Yean `2d1e086`.
Physical production TypeScript, including comments and blank lines, was 8,971
lines for Xean and 2,781 for Yean, or 3,003 including Yean's user CLI. Tests,
dependencies, development scripts, examples, run artifacts, Xean Lab, and the
separate Observe website were excluded. These are historical counts.

Optional role experiments remain an Explorer with note retrieval and a
[Jev Coordinator](https://docs.typesafe.ai/introduction). Compare strategies by
checked solutions and total spending, preserving the current Explorer's use of
selected context for sustained reasoning.
