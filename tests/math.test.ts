import { expect, test } from "bun:test";
import {
  batchResults,
  decode,
  noteContentSchema,
  type Note,
  type Plan,
  type SourceEvidence,
  type SolverResult,
} from "../src/math/contracts.ts";
import { readCommand } from "../src/math/commands.ts";
import { bindCodex } from "../src/math/evidence.ts";
import {
  refresh,
  noteInfo,
  pendingChecks,
  stagePassed,
  sourceEvidence,
  stagePending,
  validateNotes,
  validatePlan,
  validateResult,
} from "../src/math/notes.ts";
import { acceptedArgument, closure } from "../src/math/argument.ts";
import { mergeExploration } from "../src/math/results.ts";
import type { NoteEdit } from "../src/math/contracts.ts";

test.each([
  [[{ text: "formatted", cosmetic: true }, { text: "new proof" }], false],
  [[{ text: "new proof" }, { text: "formatted", cosmetic: true }], false],
  [[{ text: "formatted", cosmetic: true }, { summary: "shorter" }], true],
  [
    [
      { text: "formatted", cosmetic: true },
      { text: "formatted again", cosmetic: true },
    ],
    true,
  ],
  [[{ text: "new proof" }, { cosmetic: true }], false],
  [[{ summary: "shorter" }, { text: "formatted", cosmetic: true }], true],
] as [Partial<NoteEdit>[], boolean][])(
  "private edit merging preserves mathematical changes: %j",
  (edits, cosmetic) => {
    const result = mergeExploration(
      edits.map((edit) => ({
        notes: [],
        edits: [{ id: "n1", revision: 1, ...edit }],
      })),
    );
    expect(result.edits).toEqual([
      {
        id: "n1",
        revision: 1,
        ...Object.assign({}, ...edits),
        cosmetic,
      },
    ]);
  },
);

const pass = { verdict: "PASS" as const, report: "Checked exact statement." };
const content = (claim: string) => ({
  summary: claim,
  detailedSummary: claim,
  text: `${claim}\n\nProof of ${claim}.`,
});
const note = (id: string, support: string[] = [], imported = false): Note => ({
  id,
  ...content(id),
  support,
  imported,
  revision: 0,
  retired: false,
  candidate: false,
  checks: {
    correctness: { ...pass, statement: id, premises: [] },
    ...(imported ? {} : { source: pass }),
  },
  verified: false,
  accepted: false,
  dead: false,
});
const capabilities = { explorer: true, literature: false, codex: false };

test("caller edits reject the removed correct command", () => {
  expect(() =>
    readCommand({
      kind: "correct",
      id: "obsolete",
      note: "input/seed/n1",
      revision: 1,
      ...content("Revised"),
    }),
  ).toThrow("Invalid value");
});

test("caller and worker submissions reject batch-level candidate flags", () => {
  const notes = [{ id: "n1", ...content("Claim"), support: [] }];
  for (const candidate of [false, true]) {
    expect(() =>
      readCommand({ kind: "submit", id: "old", notes, candidate }),
    ).toThrow("Invalid value");
    expect(() =>
      validateResult({ kind: "notes", notes, candidate }, []),
    ).toThrow("Invalid value");
  }
});

test("completed uncertain checks stay closed on unchanged inputs", () => {
  const candidate = refresh([note("candidate")])[0]!;
  const report = "The completion criterion is not established.";
  candidate.checks.requirements = { verdict: "INCONCLUSIVE", report };
  expect(stagePending(candidate, "requirements")).toBe(false);
  expect(noteInfo(candidate).feedback).toEqual([
    `requirements INCONCLUSIVE: ${report}`,
  ]);
  candidate.checks.requirements = { verdict: "FAIL", report };
  expect(stagePending(candidate, "requirements")).toBe(false);
  expect(noteInfo(candidate).feedback).toEqual([
    `requirements FAIL: ${report}`,
  ]);
});

test.each(["correctness", "reconstruction"] as const)(
  "%s uncertainty blocks unchanged verification requests",
  (stage) => {
    const target = note("target");
    const uncertain = {
      verdict: "INCONCLUSIVE" as const,
      report: "Unresolved.",
    };
    if (stage === "correctness")
      target.checks = {
        correctness: { ...uncertain, statement: target.id, premises: [] },
      };
    else
      Object.assign(target.checks, {
        requirements: pass,
        reconstruction: { ...uncertain, proof: "Partial proof." },
      });
    const notes = refresh([target]);
    const plan: Plan = {
      work: { kind: "verifier", notes: [target.id], through: stage },
    };
    expect(() => validatePlan(plan, notes, capabilities)).toThrow(
      "no pending checks",
    );
    expect(target.dead).toBe(false);
    expect(target.accepted).toBe(false);
  },
);

test("Coordinator plans contain one worker or an intentional wait", () => {
  const plan: Plan = {
    work: { kind: "explorer", assignment: "Explore the combinatorial route" },
  };
  expect(validatePlan(plan, [], capabilities)).toEqual(plan);
  expect(() =>
    validatePlan({ work: [plan.work, plan.work] }, [], capabilities),
  ).toThrow("Invalid value");
  expect(validatePlan({ work: null }, [], capabilities)).toEqual({
    work: null,
  });
  for (const work of [
    { kind: "explorer", guidance: "Explore" },
    { kind: "literature", query: "Find the theorem" },
  ])
    expect(() =>
      validatePlan({ work }, [], { ...capabilities, literature: true }),
    ).toThrow("Invalid value");
});

test("correctness targets still establish sources when they support another target", () => {
  const base = note("base");
  delete base.checks.source;
  const target = note("target", [base.id]);
  const notes = refresh([base, target]);
  expect(notes.map((note) => note.verified)).toEqual([false, false]);
  const request = {
    targets: [base.id, target.id],
    through: "correctness" as const,
  };
  const pending = pendingChecks(request.targets, request.through, notes);
  expect(pending("source").map((note) => note.id)).toEqual([base.id]);
  expect(pending("requirements")).toEqual([]);
  expect(pending("reconstruction")).toEqual([]);
  const plan = {
    work: {
      kind: "verifier",
      notes: request.targets,
      through: request.through,
    },
  };
  expect(validatePlan(plan, notes, capabilities).work).not.toBeNull();
  base.checks.source = pass;
  refresh(notes);
  expect(notes.map((note) => note.verified)).toEqual([true, true]);
  expect(() => validatePlan(plan, notes, capabilities)).toThrow(
    "no pending checks",
  );
});

test("acceptance reconstructs generated dependencies beneath trusted imports and preserves useful requirements failures", () => {
  const base = note("base");
  const imported = note("import", ["base"], true);
  const target = note("solution", ["import"]);
  base.checks.requirements = {
    verdict: "FAIL",
    report: "Supporting lemma only.",
  };
  Object.assign(target.checks, {
    requirements: pass,
    reconstruction: {
      ...pass,
      proof: "Independent proof",
    },
  });
  const notes = refresh([target, imported, base]);
  const request = {
    work: { kind: "verifier", notes: [target.id], through: "reconstruction" },
  };
  expect(notes.every((entry) => entry.verified)).toBe(true);
  expect(notes.some((note) => note.accepted)).toBe(false);
  expect(() => acceptedArgument(notes, target.id)).toThrow(
    "No accepted argument",
  );
  expect(validatePlan(request, notes, capabilities).work).toMatchObject({
    kind: "verifier",
    notes: [target.id],
  });
  base.checks.reconstruction = {
    ...pass,
    proof: "Independent lemma proof",
  };
  refresh(notes);
  expect(target.accepted).toBe(true);
  expect(acceptedArgument(notes, target.id)).toBe(
    "## base\n\nbase\n\nProof of base.\n\n## import\n\nimport\n\nProof of import.\n\n## solution\n\nsolution\n\nProof of solution.",
  );
  expect(base.dead).toBe(false);
  expect(base.accepted).toBe(false);
  expect(() => validatePlan(request, notes, capabilities)).toThrow(
    "no pending checks",
  );
  base.checks.correctness = {
    verdict: "FAIL",
    report: "Concrete defect",
    statement: base.id,
    premises: [],
  };
  refresh(notes);
  expect(notes.every((entry) => entry.dead)).toBe(true);
  expect(notes.some((note) => note.accepted)).toBe(false);
});

test("correctness PASS freezes the claim without suppressing later FAIL", () => {
  const established = note("established");
  delete established.checks.source;
  const dependent = note("dependent", [established.id]);
  const binding = established.checks.correctness!;
  const late: SolverResult = {
    kind: "verification",
    checks: [
      {
        noteId: established.id,
        correctness: {
          ...binding,
          premises: ["Previously unchecked premise"],
        },
      },
    ],
  };
  const check = late.checks[0]!.correctness!;
  expect(() => validateResult(late, [established])).toThrow(
    "Correctness premises are final",
  );
  check.premises = [];
  expect(validateResult(late, [established])).toEqual(late);
  check.statement = "A stronger unchecked claim";
  expect(() => validateResult(late, [established])).toThrow(
    "Correctness statement is final",
  );
  established.checks.correctness = {
    ...binding,
    verdict: "INCONCLUSIVE",
    statement: null,
  };
  expect(() => validateResult(late, [established])).toThrow(
    "Correctness statement is final",
  );
  check.verdict = "INCONCLUSIVE";
  expect(() => validateResult(late, [established])).toThrow(
    "Correctness statement is final",
  );
  established.checks.correctness = binding;
  check.statement = binding.statement;
  check.verdict = "FAIL";
  check.report = "The argument has an unsupported step.";
  check.premises = ["Different unresolved premise"];
  expect(validateResult(late, [established])).toEqual(late);
  established.checks.correctness = check;
  expect(refresh([established, dependent]).every((note) => note.dead)).toBe(
    true,
  );
});

test("a null checked statement cannot establish support or acceptance even with PASS records", () => {
  const question = note("question", [], true);
  question.text = "Could an exchange argument settle the conjecture?";
  question.checks.correctness!.statement = null;
  const candidate = note("candidate", [question.id]);
  for (const entry of [question, candidate])
    Object.assign(entry.checks, {
      requirements: pass,
      reconstruction: { ...pass, proof: "Depends on the unresolved question." },
    });
  for (const entry of refresh([candidate, question]))
    expect(entry).toMatchObject({
      verified: false,
      accepted: false,
      dead: false,
    });
  expect(stagePassed(question, "source")).toBe(false);
  expect(stagePending(question, "correctness")).toBe(false);
});

test("completed source judgments close retries and unresolved premises remain frozen", () => {
  for (const verdict of ["PASS", "FAIL", "INCONCLUSIVE"] as const) {
    const frozen = note("frozen");
    frozen.checks = {
      correctness: {
        ...pass,
        statement: frozen.id,
        premises: ["Exact frozen premise"],
      },
      source: { verdict, report: "Judged the frozen external claim" },
      reconstruction: { ...pass, proof: "Independent supporting proof" },
    };
    const dependent = note("dependent", [frozen.id]);
    Object.assign(dependent.checks, {
      requirements: pass,
      reconstruction: { ...pass, proof: "Independent proof" },
    });
    refresh([frozen, dependent]);
    expect(frozen.dead).toBe(false);
    expect(dependent.dead).toBe(false);
    expect(frozen.verified).toBe(verdict === "PASS");
    expect(dependent.verified).toBe(verdict === "PASS");
    expect(dependent.accepted).toBe(verdict === "PASS");
    expect(stagePending(frozen, "source")).toBe(false);
    expect(() =>
      validatePlan(
        { work: { kind: "verifier", notes: [frozen.id], through: "source" } },
        [frozen],
        capabilities,
      ),
    ).toThrow("no pending checks");
    frozen.checks.correctness!.verdict = "INCONCLUSIVE";
    expect(() =>
      validateResult(
        {
          kind: "verification",
          checks: [
            {
              noteId: frozen.id,
              correctness: {
                ...pass,
                statement: frozen.id,
                premises: ["Repaired premise"],
              },
            },
          ],
        },
        [frozen],
      ),
    ).toThrow("Correctness premises are final");
  }
});

test("source evidence reuse preserves immutable original bindings", () => {
  const evidence: SourceEvidence = {
    id: "source/0",
    statement: "Original exact premise",
    url: "https://example.org/theorem",
    quote: "Original quotation",
  };
  const claimed = {
    operationId: "source",
    reportedAt: "2026-10-05T00:00:00Z",
    searches: 0,
    value: {
      ...pass,
      passages: [{ premise: 0, url: evidence.url, quote: evidence.quote }],
    },
  };
  expect(bindCodex(claimed, [evidence.statement]).verdict).toBe("INCONCLUSIVE");
  const task = {
    problem: "Prove the half-weight cut guarantee.",
    completionCriteria:
      "Elementary arithmetic and basic finite graph definitions may be used.",
  };
  const selfContained = bindCodex(
    {
      ...claimed,
      value: {
        ...claimed.value,
        passages: [
          { premise: 0, url: "urn:xean:task", quote: task.completionCriteria },
        ],
      },
    },
    [],
    [],
    "review",
    task,
  );
  expect(selfContained.verdict).toBe("PASS");
  expect(selfContained.passages).toEqual([]);
  expect(
    bindCodex(
      {
        ...claimed,
        value: {
          ...claimed.value,
          passages: [{ premise: 0, passageId: evidence.id }],
        },
      },
      [evidence.statement],
      [evidence],
    ).verdict,
  ).toBe("PASS");
  const established = note("established");
  established.checks = {
    correctness: {
      ...pass,
      statement: established.id,
      premises: [evidence.statement],
    },
    source: {
      ...pass,
      kind: "codex-report",
      operationId: "source",
      reportedAt: "2026-10-04T00:00:00Z",
      premises: [evidence.statement],
      passages: [{ ...evidence, premise: 0 }],
    },
  };
  refresh([established]);
  expect(sourceEvidence([established], [evidence])).toEqual([evidence]);
  const priorApplications = [
    { ...evidence, premise: 0 },
    { ...evidence, premise: 1 },
  ];
  expect(sourceEvidence([established], priorApplications)).toEqual([evidence]);
  expect(() =>
    sourceEvidence(
      [established],
      [{ ...evidence, statement: "Substituted premise" }],
    ),
  ).toThrow("Conflicting source evidence");
  const unchecked = note("unchecked");
  unchecked.checks = {
    correctness: {
      ...pass,
      statement: unchecked.id,
      premises: ["Different exact premise"],
    },
  };
  expect(() =>
    validateResult(
      {
        kind: "verification",
        checks: [{ noteId: unchecked.id, source: established.checks.source }],
      },
      [unchecked],
    ),
  ).toThrow("Source-checked premises do not match");
});

test("batch results require each requested identity exactly once", () => {
  expect(
    batchResults(
      ["a", "b"],
      [
        { noteId: "b", value: 2 },
        { noteId: "a", value: 1 },
      ],
    ),
  ).toEqual([{ value: 1 }, { value: 2 }]);
  for (const results of [
    [{ noteId: "a", value: 1 }],
    [
      { noteId: "a", value: 1 },
      { noteId: "a", value: 2 },
    ],
    [
      { noteId: "a", value: 1 },
      { noteId: "b", value: 2 },
      { noteId: "c", value: 3 },
    ],
  ])
    expect(() => batchResults(["a", "b"], results)).toThrow(
      "exactly one result per requested note",
    );
  expect(() =>
    batchResults(
      ["a", "a"],
      [
        { noteId: "a", value: 1 },
        { noteId: "b", value: 2 },
      ],
    ),
  ).toThrow("exactly one result per requested note");
});

test("note text rejects blank and control characters but preserves mathematical notation", () => {
  for (const text of [" ", "claim\u0000", "claim\u001b"])
    expect(() =>
      decode(noteContentSchema, { ...content("claim"), text }),
    ).toThrow();
  expect(decode(noteContentSchema, content("$x \\to 0$\n")).text).toBe(
    content("$x \\to 0$\n").text,
  );
});

test("note graphs allow forward references but reject retired support and cycles", () => {
  const draft = (id: string, support: string[]) => ({
    id,
    ...content(id),
    support,
  });
  expect(() =>
    validateNotes([draft("n1", ["n2"]), draft("n2", [])], []),
  ).not.toThrow();
  expect(() =>
    validateNotes(
      [draft("n1", ["retired"])],
      [{ id: "retired", support: [], dead: false, retired: true }],
    ),
  ).toThrow("retired");
  expect(() =>
    closure(
      ["a"],
      [
        { id: "a", support: ["b"] },
        { id: "b", support: ["a"] },
      ],
    ),
  ).toThrow("Cyclic support");
});
