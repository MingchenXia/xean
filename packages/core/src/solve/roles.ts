import type { Context } from "@earendil-works/chord";
import { isDeepStrictEqual } from "node:util";
import { Assert } from "typebox/value";
import { type Static, type TSchema } from "@earendil-works/pi-ai";
import type { Execution } from "../types.ts";
import { chatGptWebProviderId } from "../providers/chatgpt-web.ts";
import {
  correctnessSchema,
  batchSchema,
  batchResults,
  explorationSchema,
  noteContentSchema,
  planSchema,
  proofSchema,
  statementSchema,
  verdictSchema,
  verificationStageSchema,
  verificationStages,
  verificationTargets,
  type Check,
  type Exploration,
  type ExplorerInput,
  type Note,
  type Plan,
  type SolverResult,
  type Task,
  type VerifierInput,
  type ReviewInput,
  type ReconstructionInput,
  type VerificationStage,
} from "./contracts.ts";
import {
  closure,
  noteInfo,
  refresh,
  requiredStages,
  sourceEvidence,
  stagePassed,
  stagePending,
  stageWithin,
  validateNotes,
  verdict,
} from "./notes.ts";
import { ask, type PiRuntime, type ProfileName } from "./pi.ts";
import { type Research, type LiteratureInput } from "./research.ts";
import type { Settings } from "./config.ts";
import { noteReader } from "./reader.ts";

const mathematicalCheck =
  "Check exact statements and hypotheses. Check both summaries against the authoritative full text: preserve hypotheses, quantitative guarantees, conditionality, negative conclusions, and unresolved gaps. A summary must not strengthen a claim or present an unresolved result as established. PASS requires an established argument. FAIL requires a concrete defect. Use INCONCLUSIVE when you cannot settle a check. On PASS, you may supply correction with the complete text and consistent summary and detailedSummary, changing only harmless typos, formatting, or unambiguous notation. Preserve mathematical meaning and dependencies; never repair a substantive gap this way. A substantial repair requires a new note. Treat established support results as given, but verify their applicability and all new reasoning. Do not infer mathematical truth from an earlier model's confidence.";
const packet = ({ id, text, summary, detailedSummary, support }: Note) => ({
  id,
  text,
  summary,
  detailedSummary,
  support,
});
function checkedPremises(
  original: readonly string[],
  extracted: Static<typeof statementSchema>["premises"],
) {
  const ordered = extracted.toSorted((a, b) => a.premise - b.premise);
  if (
    ordered.length !== original.length ||
    ordered.some(({ premise }, index) => premise !== index)
  )
    throw new Error(
      "Extracted premises must contain exactly one entry per source-checked premise index",
    );
  return ordered;
}
/** Corrections share one policy for standalone reconstruction and verifier batches. */
function recordCheck<Stage extends VerificationStage>(
  note: Note,
  check: Check,
  stage: Stage,
  result: NonNullable<Check[Stage]>,
): void {
  check[stage] = result;
  const correction = result.correction;
  if (
    result.verdict === "PASS" &&
    correction !== undefined &&
    (correction.text !== note.text ||
      correction.summary !== note.summary ||
      correction.detailedSummary !== note.detailedSummary)
  ) {
    Assert(noteContentSchema, correction);
    Object.assign(note, correction);
    check.correction = { revision: note.revision, ...correction };
  }
}

export type CoordinationInput = {
  task: Task;
  notes: Note[];
  failures: { id: string; role: string; error: string | null }[];
  guidance: string[];
  literatureUsed: boolean;
};
export type RoleOptions = Required<
  Pick<Settings, "maxExplorerResponses" | "maxExplorerReads" | "literature">
> & {
  /** ChatGPT Web is a one-shot Explorer and cannot be scheduled again. */
  chatGptSingleShot?: boolean;
};

/** Ordinary functions used by both campaigns and standalone role execution. */
export function createRoles(
  runtime: PiRuntime,
  research: Research,
  options: RoleOptions,
) {
  if (runtime.profiles.explorer.model.provider === chatGptWebProviderId)
    options = { ...options, chatGptSingleShot: true, maxExplorerResponses: 1 };
  const literature = options.literature && research.retrieval;
  const batch = async <S extends TSchema>(
    profile: ProfileName,
    instructions: string,
    input: { notes: { id: string }[]; [key: string]: unknown },
    schema: S,
    execution: Execution,
    context: Context,
    validate?: (result: Static<S>, index: number) => void,
  ): Promise<Static<S>[]> => {
    if (!input.notes.length) return [];
    const ids = input.notes.map((note) => note.id);
    // Keep shared mathematics before stage instructions for provider cache reuse.
    const result = await ask(
      runtime,
      profile,
      "Carry out the mathematical assignment in the top-level instructions field. Return exactly one result per requested noteId, and no others.",
      { ...input, instructions },
      batchSchema(schema),
      execution,
      context,
      {
        submit(value) {
          const results = batchResults(ids, value.results);
          if (validate) results.forEach(validate);
          return { done: true, receipt: { validated: true } };
        },
      },
    );
    return batchResults(ids, result.results);
  };
  const reconstruct = async (
    input: ReconstructionInput,
    execution: Execution,
    context: Context,
  ): Promise<Extract<SolverResult, { kind: "verification" }>> => {
    const chain = closure(input.targets, refresh(structuredClone(input.notes)));
    if (chain.some((note) => !note.verified))
      throw new Error("Reconstruction requires verified notes and support");
    const selected = chain.filter(
      (note) =>
        (!note.imported || input.targets.includes(note.id)) &&
        !stagePassed(note, "reconstruction"),
    );
    if (!selected.length) return { kind: "verification", checks: [] };
    // A previously checked descendant must not become an assumption for its ancestor.
    const notes = closure(
      selected.map((note) => note.id),
      chain,
    );
    const originals = notes.map((note) => {
      const premises = verdict(note, "correctness")?.premises ?? [];
      const source = verdict(note, "source");
      if (
        source &&
        "premises" in source &&
        !isDeepStrictEqual(premises, source.premises)
      )
        throw new Error(
          `Source-checked premises do not match correctness for ${note.id}`,
        );
      return {
        ...packet(note),
        premises,
        source: note.imported
          ? { kind: "caller-import" }
          : {
              kind: "source-check",
              verdict: source!.verdict,
              ...(source && "operationId" in source
                ? { operationId: source.operationId }
                : {}),
            },
      };
    });
    const extract = originals.filter(
      (_, index) => !stagePassed(notes[index]!, "reconstruction"),
    );
    const extracted = await batch(
      "statement",
      "Extract each note's exact mathematical claim for a blind prover. Preserve every hypothesis, quantifier, definition, and conclusion. An explicit hypothetical antecedent belongs in the statement: preserve P implies Q without asserting P or listing P as an external premise. Omit proofs, proof methods, hints, summaries, and verifier opinions. Do not weaken a claim or turn a step needing proof into an assumption. The supplied premise list is authoritative and source-checked. Return exactly one premises entry per supplied zero-based premise index, retaining its identity even when the external theorem is also the note's claim. Normalize each premise to its theorem statement and exact hypotheses, removing process commentary (including stale awaiting-validation prose) and application hints without removing mathematical qualifications or adding, strengthening, or substituting assumptions. Use [] exactly when the supplied list is empty. Supporting note results remain declared dependencies, not external premises. The original task supplies proof rules, but these claims may be supporting lemmas rather than solutions of that task.",
      {
        task: input.task,
        support: originals.filter((note) => !extract.includes(note)),
        notes: extract,
      },
      statementSchema,
      execution,
      context,
      (result, index) =>
        checkedPremises(extract[index]!.premises, result.premises),
    );
    const statements = notes.map((note, index) => {
      const checked = verdict(note, "reconstruction");
      const { statement, premises } =
        checked?.verdict === "PASS"
          ? checked
          : extracted[extract.indexOf(originals[index]!)]!;
      return {
        id: note.id,
        statement,
        premises: checkedPremises(originals[index]!.premises, premises),
        support: note.support,
      };
    });
    const selectedIds = new Set(selected.map((note) => note.id));
    const independent = await batch(
      "proof",
      "Independently prove all requested statements together, returning a proof per note. You have not received their original proofs or methods. Use only each note's declared transitive support, its listed external premises, and background permitted by the task. Each indexed external premise is a permitted assumption: use its exact statement and hypotheses without reproving or retrieving its external source. This permission does not establish stronger variants or their applicability. To prove P implies Q, assume its explicit antecedent P and derive Q; this does not establish P. The support statements are trusted imports or previously reconstructed claims and may be assumed without reproving them. Claims in notes must be proved in dependency order. A conditional proof may use a declared supporting claim being proved in this batch, but never a descendant or unrelated claim. Check hypotheses at every application. Set complete=false and state the gap when a note's own proof is incomplete. Supporting lemmas need not solve the original task.",
      {
        task: input.task,
        support: statements.filter((note) => !selectedIds.has(note.id)),
        notes: statements.filter((note) => selectedIds.has(note.id)),
      },
      proofSchema,
      execution,
      context,
    );
    const compared = await batch(
      "reconstruction",
      `${mathematicalCheck} Compare each original claim and proof with its extracted statement and independent proof. The top-level premises records bind each note's authoritative external premises to its recorded source PASS (or caller import). Those exact external theorems are permitted assumptions for reconstruction; do not demand their proofs or renewed source validation. Historical prose saying awaiting validation cannot override that recorded status. Match every normalized premise by its index to the authoritative text: removing process commentary and application hints must preserve all mathematical qualifications. A source PASS does not validate a stronger or substituted theorem, a new implementation guarantee, an unmet hypothesis, or a new proof step. Check that extracted statements, definitions, and external premises faithfully match the originals, including every assumption used from support. Preserve explicit conditional claims: proving P implies Q may assume P, but does not by itself establish P or an unconditional Q. PASS requires the exact original claim and a correct independent proof, using only declared transitive support, source-checked external premises, and task-permitted background. Judge support proved in this batch conditionally: code separately requires the whole dependency chain. Reject circular or undeclared use of another batch claim. These notes may be supporting lemmas and need not solve the original task. FAIL requires a concrete defect in the original claim or argument. An extraction mismatch, leaked proof method, or a gap, error, or unapproved premise in the independent proof alone gives INCONCLUSIVE, even if it claims to be complete.`,
      {
        task: input.task,
        support: notes.filter((note) => !selectedIds.has(note.id)).map(packet),
        notes: selected.map(packet),
        premises: originals.map(({ id, premises, source }) => ({
          noteId: id,
          premises,
          source,
        })),
        statements,
        independent: selected.map((note, index) => ({
          noteId: note.id,
          result: independent[index]!,
        })),
      },
      verdictSchema,
      execution,
      context,
    );
    return {
      kind: "verification",
      checks: selected.map((note, index) => {
        const proof = independent[index]!;
        const judgment = compared[index]!;
        const { statement, premises } = statements.find(
          (other) => other.id === note.id,
        )!;
        const check: Check = { noteId: note.id };
        recordCheck(note, check, "reconstruction", {
          ...judgment,
          statement,
          premises,
          proof: proof.proof,
          ...(!proof.complete && judgment.verdict === "PASS"
            ? {
                verdict: "INCONCLUSIVE" as const,
                report: `Independent proof was incomplete. ${judgment.report}`,
              }
            : {}),
        });
        return check;
      }),
    };
  };
  return {
    reconstruct,
    async explorer(
      input: ExplorerInput,
      execution: Execution,
      context: Context,
    ): Promise<SolverResult> {
      input = structuredClone(input);
      const index = input.notes.map(noteInfo);
      const accumulated: Exploration["notes"] = [];
      const explorerInstructions = options.chatGptSingleShot
        ? "All note summaries are supplied in the initial context. Do not read notes or request continuation; submit the complete useful result in this one response."
        : "Use read_notes to choose detailed summaries or full arguments from your frozen snapshot, batching independent IDs. Reading is disabled when its allowance is exhausted and on your final response; then work from available context and submit.";
      const result = await ask(
        runtime,
        "explorer",
        `Work on the exact mathematical task. You own the mathematical strategy: choose approaches, change direction, and continue useful work. The preceding messages contain the task and the complete index of note IDs and summaries. The final input supplies note states, feedback, guidance, and your read and response allowances. Guidance is fallible. ${explorerInstructions} Follow support IDs when needed. Every response counts, including reads, rejected submissions, and responses without a submission. Do mathematics without external search. Return self-contained notes with an index summary, detailed summary, and authoritative full text, including useful partial results and failed approaches with their gaps stated. Identify pivotal claims and their unproved assumptions in the notes so Coordinator can arrange appropriate checks. Declare as support every note whose result you use without proving it. Merely reading or discussing a note is not a dependency. Dead notes are diagnostic only; never use them as mathematical support. Existing verified support need not be reproved. Use local IDs n1, n2, ... without reusing one. A note may refer to an earlier note in this invocation or an existing note ID. New notes are private until this worker returns. Set candidate=true only when the last new note claims a complete solution of the exact task. Empty notes end this invocation without a solution.`,
        {
          notes: index.map(({ summary: _summary, ...state }) => state),
          guidance: input.guidance,
          allowance: {
            reads: options.maxExplorerReads,
            responses: options.maxExplorerResponses,
          },
        },
        explorationSchema,
        execution,
        context,
        {
          maxResponses: options.maxExplorerResponses,
          maxReads: options.maxExplorerReads,
          prefix: [
            { task: input.task },
            ...index.map(({ id, summary }) => ({ id, summary })),
          ],
          tools: options.chatGptSingleShot ? [] : [noteReader(input.notes)],
          submit(value) {
            validateNotes([...accumulated, ...value.notes], input.notes);
            if (value.candidate && value.notes.length === 0)
              throw new Error("A solution claim needs a new note");
            accumulated.push(...value.notes);
            const done = value.candidate || value.notes.length === 0;
            return {
              done,
              receipt: {
                privateNotes: value.notes.map((note) => note.id),
                done,
              },
            };
          },
          continuation:
            "Continue mathematical work from your private notes. Address remaining gaps or try a better approach. Submit only new notes; an empty submission hands off.",
        },
      );
      return { kind: "notes", notes: accumulated, candidate: result.candidate };
    },

    async coordinator(
      input: CoordinationInput,
      execution: Execution,
      context: Context,
    ): Promise<Plan> {
      input = structuredClone(input);
      const notes = input.notes;
      const prompt = {
        ...input,
        notes: notes.map(noteInfo),
        capabilities: {
          literature: literature && !input.literatureUsed,
          sourceRetrieval: research.retrieval,
        },
      };
      return ask(
        runtime,
        "coordinator",
        "Schedule work for this mathematical task. You alone create work requests; workers return results. Explorer owns the mathematical strategy. For Explorer, supply only guidance. The library supplies the exact task, every note summary, verification feedback, and a bounded reader. Explorer chooses which notes to read. Continue exploration without prescribing proof steps. Explorer never has external retrieval tools. Follow capabilities: when literature is false, do not request a literature search or delegate external retrieval to Explorer; when sourceRetrieval is false, verification cannot look up sources. Pi mathematical checks remain available. A correctness-only target still requires source checks for its dependencies. If Codex source execution is failing, choose checks whose dependency closure needs no retrieval, or continue independent work. Prioritize checking pivotal claims identified in notes and unverified claims on which further exploration repeatedly relies. Inspect conditional claims and their assumptions before treating them as established support. Do not verify every speculative note or impose a fixed verification quota. Verification runs an ordered prefix: correctness, source, requirements, reconstruction. Use correctness for a mathematical check alone, source to establish support, requirements to check the exact completion criteria, and reconstruction for final acceptance. Dependencies receive correctness and necessary source checks. Final reconstruction also proves every generated claim in the transitive support, in one blinded batch. Imported supporting theorems remain assumptions, with their declared dependencies still checked. Imported notes are trusted for correctness and source when their support is verified. The passed list includes trusted import stages and completed PASS checks. Reuse both. Every committed source verdict is final for its note ID, including INCONCLUSIVE. New evidence requires a new note. Only executions without a committed result may retry source checking. Imported candidates still require requirements and reconstruction. After operational failure, use the reported cause: repeating an unchanged request does not repair a configuration error. Choose a logical retry when there is a reason it can succeed, or continue useful independent work. Explorer may read dead notes for diagnosis, never as mathematical dependencies or verification targets. Avoid requests whose stages and required dependency checks have all passed. A candidate with its own reconstruction PASS may still need reconstruction of unresolved dependencies. Dispatch at most one Explorer, which may run alongside verification or enabled literature. Literature permits at most one completed search; a failed search may be retried when enabled. Availability does not require a search. Request one only for a specific external theorem or source gap relevant to the task, and state that question in query. Task-granted assumptions and self-contained elementary arguments need no survey. Use the supplied summaries and feedback to decide which exact texts affect scheduling. Use read_notes for detailed summaries or full notes, batching independent IDs in one call. Skip reads when the supplied context already supports the decision, then submit your plan. Mathematical notes are the shared memory. Return at least one useful work request. Never declare a solution yourself: code accepts only complete verification evidence.",
        prompt,
        planSchema(prompt.capabilities.literature),
        execution,
        context,
        {
          tools: [noteReader(notes)],
          submit(plan) {
            if (plan.work.filter(({ kind }) => kind === "explorer").length > 1)
              throw new Error("Dispatch at most one Explorer");
            if (
              plan.work.filter(({ kind }) => kind === "literature").length > 1
            )
              throw new Error("Literature already dispatched");
            const find = (id: string) => notes.find((note) => note.id === id);
            const targets = verificationTargets(plan);
            for (const { id } of targets) {
              const note = find(id);
              if (!note || note.dead)
                throw new Error(`Unknown or dead note: ${id}`);
            }
            const useful =
              [...requiredStages(targets, notes)].some(([note, through]) =>
                verificationStages.some(
                  (stage) =>
                    stageWithin(stage, through) && stagePending(note, stage),
                ),
              ) ||
              closure(
                targets
                  .filter((target) => target.through === "reconstruction")
                  .map((target) => target.id),
                notes,
              ).some(
                (note) =>
                  !note.imported && stagePending(note, "reconstruction"),
              );
            if (targets.length && !useful)
              throw new Error("Requested verification has no pending checks");
            return { done: true, receipt: { validated: true } };
          },
        },
      );
    },

    async verifier(
      input: VerifierInput,
      execution: Execution,
      context: Context,
    ): Promise<SolverResult> {
      const notes = structuredClone(input.notes);
      refresh(notes);
      const checks = new Map<Note, Check>();
      for (const target of input.targets)
        Assert(verificationStageSchema, target.through);
      const ordered = requiredStages(input.targets, notes);
      const pending = (stage: VerificationStage) =>
        [...ordered].flatMap(([note, through]) =>
          stageWithin(stage, through) && stagePending(note, stage)
            ? [note]
            : [],
        );
      const record = <Stage extends VerificationStage>(
        note: Note,
        stage: Stage,
        result: NonNullable<Check[Stage]>,
      ) => {
        let check = checks.get(note);
        if (!check) {
          check = { noteId: note.id };
          checks.set(note, check);
          note.checks.push(check);
        }
        recordCheck(note, check, stage, result);
      };
      const assess = async <S extends TSchema>(
        profile: ProfileName,
        selected: Note[],
        instructions: string,
        schema: S,
      ): Promise<Static<S>[]> => {
        const support = closure(
          selected.flatMap((note) => note.support),
          notes,
        ).filter((note) => !selected.includes(note));
        return batch(
          profile,
          `${mathematicalCheck} Check all requested notes together. The verifiedSupport IDs identify established support notes. Judge each note using only its declared transitive support, not unrelated notes in the batch. ${instructions}`,
          {
            task: input.task,
            support: support.map(packet),
            notes: selected.map(packet),
            verifiedSupport: support
              .filter((note) => note.verified)
              .map((note) => note.id),
          },
          schema,
          execution,
          context,
        );
      };
      const correctness = pending("correctness");
      const judgments = await assess(
        "correctness",
        correctness,
        `Judge each note's own claim; supporting lemmas and partial progress need not solve the original task. Only the later requirements check judges the original completion criteria. For an explicit conditional claim P implies Q, check the derivation of Q assuming P. Its hypothetical antecedent P is part of the claim, not an external theorem to establish; omit it from premises. Proving the implication does not establish P. An unstated assumption in an unconditional claim remains a gap: do not silently weaken the claim to an implication or promote a missing proof step to an external theorem. External results actually used to prove an implication still require the normal assessment below. For declared support checked in this batch or not yet verified, judge the dependent reasoning conditionally; code separately requires every dependency to pass before verification or acceptance. Find missing cases, unsupported inferences, and undeclared substantive dependencies. ${research.retrieval ? "A cited theorem note may state an external result without reproving it: assess its statement and application conditionally and list it in premises for source validation. List every directly needed nonroutine external result with exact hypotheses, conclusion, and application, including any invoked without citation." : "This is a closed-book check: source retrieval is disabled. Apply the task's proof rules. When the task permits standard background, check each such result's precise statement, hypotheses, and application from mathematical knowledge and explain that assessment in report. A background result established by this assessment need not be listed in premises. Do not excuse a forbidden black box or an unproved substantive step as background, even if the note calls it standard. A forbidden invocation is a defect. If permission, statement, or applicability is uncertain, retain the claim in premises; source checking will leave it INCONCLUSIVE. List all other unproved external claims with exact hypotheses, conclusion, and application. The steps producing the requested conclusion must satisfy the task's proof requirements."} Results explicitly granted as assumptions or permitted background by the supplied task need no external source check. Check their exact scope and application, and omit them from premises. A note merely claiming that permission is insufficient. Do not relist declared support results; check their applicability. Use [] only when no unresolved external premise remains under these rules. Correctness PASS is conditional on support and listed premises.`,
        correctnessSchema,
      );
      correctness.forEach((note, index) =>
        record(note, "correctness", judgments[index]!),
      );
      refresh(notes);

      const sources = pending("source");
      if (sources.length) {
        const results = batchResults(
          sources.map((note) => note.id),
          await research.source(
            {
              task: input.task,
              notes: sources.map((note) => ({
                id: note.id,
                text: note.text,
                premises: verdict(note, "correctness")!.premises,
              })),
              evidence: sourceEvidence(notes, input.evidence),
            },
            execution,
            context,
          ),
        );
        sources.forEach((note, index) =>
          record(note, "source", results[index]!),
        );
        refresh(notes);
      }
      const requirements = pending("requirements");
      const required = await assess(
        "requirements",
        requirements,
        "Decide whether each note meets every completion criterion of the original task. Check quantifiers, variants, parameters, computational model, and bounds. A proved implication does not establish its antecedent. If the task requires an unconditional conclusion, an extra hypothesis must be discharged by a proof within the note, established support, or the task's assumptions. Sound partial progress fails this check.",
        verdictSchema,
      );
      requirements.forEach((note, index) =>
        record(note, "requirements", required[index]!),
      );

      const reconstructed = await reconstruct(
        {
          task: input.task,
          notes,
          targets: [...ordered].flatMap(([note, through]) =>
            through === "reconstruction" &&
            note.verified &&
            verdict(note, "requirements")?.verdict === "PASS"
              ? [note.id]
              : [],
          ),
        },
        execution,
        context,
      );
      for (const check of reconstructed.checks)
        record(
          notes.find((note) => note.id === check.noteId)!,
          "reconstruction",
          check.reconstruction!,
        );
      return { kind: "verification", checks: [...checks.values()] };
    },

    async literature(
      input: LiteratureInput,
      execution: Execution,
      context: Context,
    ): Promise<SolverResult> {
      if (!literature) throw new Error("Literature is disabled");
      const result = await research.literature(input, execution, context);
      validateNotes(result.notes, input.notes);
      return { kind: "notes", notes: result.notes, candidate: false };
    },

    review(input: ReviewInput, execution: Execution, context: Context) {
      return research.review(input, execution, context);
    },
  };
}
