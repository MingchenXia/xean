import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Execution, JsonValue } from "../packages/core/src/types.ts";
import { createSolver } from "../packages/core/src/solve/solver.ts";
import type { Note, Source } from "../packages/core/src/solve/contracts.ts";
import { refresh } from "../packages/core/src/solve/notes.ts";
import { codexResearch } from "../packages/core/src/solve/research.ts";
import { fixtureRuntime } from "./fixtures/pi.ts";

test("conditional hypotheses remain claims while external results require sources and acceptance requires the exact task", async () => {
  const directory = await mkdtemp(join(tmpdir(), "xean-conditional-"));
  try {
    const command = join(directory, "codex");
    await writeFile(
      command,
      `#!${process.execPath}\nimport ${JSON.stringify(join(import.meta.dir, "fixtures/codex.ts"))};\n`,
      { mode: 0o700 },
    );
    const task = {
      problem:
        "Prove that every finite nonempty connected graph has a spanning tree.",
      completionCriteria:
        "Give a complete proof without assuming a Hamiltonian cycle.",
    };
    const conditional =
      "If a finite graph G has a Hamiltonian cycle, then G is connected.";
    const external =
      "For every prime p and integer a not divisible by p, a^(p-1) is congruent to 1 modulo p.";
    const notes: Note[] = [
      {
        id: "n1",
        summary: "A conditional connectivity lemma.",
        detailedSummary:
          "Assuming a Hamiltonian cycle, its paths connect every pair of vertices; existence of such a cycle is unresolved.",
        text: `${conditional} Proof: the cycle contains every vertex, and its arcs connect every pair. This does not establish that G has such a cycle.`,
      },
      {
        id: "n2",
        summary: "An unconditional connectivity claim with a gap.",
        detailedSummary:
          "The argument assumes a Hamiltonian cycle without establishing one.",
        text: "Every finite nonempty graph is connected. Proof: choose a Hamiltonian cycle and use its arcs to connect the vertices.",
      },
      {
        id: "n3",
        summary: "Fermat congruence for base two.",
        detailedSummary:
          "For prime p greater than 2, Fermat's little theorem yields 2^(p-1) congruent to 1 modulo p.",
        text: "If p > 2 is prime, then 2^(p-1) is congruent to 1 modulo p. By Fermat's little theorem, with a=2, since p does not divide 2.",
      },
    ].map((note) => ({
      ...note,
      support: [],
      checks: [],
      revision: 0,
      imported: false,
      verified: false,
      accepted: false,
      dead: false,
      candidate: false,
    }));
    const calls: string[] = [];
    const sources: { instructions: string; prompt: string }[] = [];
    const execution: Execution = {
      attemptId: "conditional-check",
      attempt: 1,
      recorder: {
        begin: () => ({
          recordRequest(request) {
            if (
              request &&
              typeof request === "object" &&
              !Array.isArray(request) &&
              request.kind === "codex-exec"
            )
              sources.push(JSON.parse(JSON.stringify(request)));
          },
          settle() {},
        }),
      },
    };
    const runtime = fixtureRuntime((context, _options, selected) => {
      calls.push(selected.id);
      const input = JSON.parse(
        String(
          context.messages.find((message) => message.role === "user")!.content,
        ),
      );
      let results: { noteId: string; result: JsonValue }[];
      switch (selected.id) {
        case "correctness":
          expect(input.instructions).toContain(
            "For an explicit conditional claim P implies Q",
          );
          expect(input.instructions).toContain(
            "An unstated assumption in an unconditional claim remains a gap",
          );
          expect(input.notes).toEqual(
            notes.map(({ id, text, summary, detailedSummary, support }) => ({
              id,
              text,
              summary,
              detailedSummary,
              support,
            })),
          );
          results = input.notes.map(({ id }: Note) => ({
            noteId: id,
            result: {
              verdict: id === "n2" ? "FAIL" : "PASS",
              report:
                id === "n2"
                  ? "Two isolated vertices are a counterexample; the assumed cycle is unproved."
                  : "The implication follows under its explicit hypotheses.",
              premises: id === "n3" ? [external] : [],
            },
          }));
          break;
        case "requirements":
          expect(input.instructions).toContain(
            "A proved implication does not establish its antecedent",
          );
          expect(input.notes.map(({ id }: Note) => id)).toEqual(["n1", "n3"]);
          results = input.notes.map(({ id }: Note) => ({
            noteId: id,
            result: {
              verdict: "FAIL",
              report:
                "This lemma does not prove the original spanning-tree task.",
            },
          }));
          break;
        case "statement":
          expect(input.instructions).toContain(
            "hypothetical antecedent belongs in the statement",
          );
          expect(input.notes[0].premises).toEqual([]);
          results = [
            { noteId: "n1", result: { statement: conditional, premises: [] } },
          ];
          break;
        case "proof":
          expect(input.notes).toEqual([
            { id: "n1", statement: conditional, premises: [], support: [] },
          ]);
          expect(JSON.stringify(input)).not.toContain(notes[0]!.text);
          expect(JSON.stringify(input)).not.toContain(
            notes[0]!.detailedSummary,
          );
          results = [
            {
              noteId: "n1",
              result: {
                proof:
                  "Assume G has a Hamiltonian cycle. Its arcs give paths between any two vertices, so G is connected.",
                complete: true,
              },
            },
          ];
          break;
        case "reconstruction":
          expect(input.statements[0].statement).toBe(conditional);
          expect(input.premises).toEqual([
            {
              noteId: "n1",
              premises: [],
              source: { kind: "source-check", verdict: "PASS" },
            },
          ]);
          results = [
            {
              noteId: "n1",
              result: {
                verdict: "PASS",
                report:
                  "Both proofs establish the same conditional claim, with no assertion that the antecedent holds.",
              },
            },
          ];
          break;
        default:
          throw new Error(`Unexpected role: ${selected.id}`);
      }
      return fauxAssistantMessage(
        [fauxToolCall("submit_result", { results })],
        { stopReason: "toolUse" },
      );
    });
    const solver = createSolver(
      task,
      runtime,
      {},
      codexResearch({
        model: "xean-fixture",
        command,
        environment: { HOME: directory, PATH: process.env.PATH },
      }),
    );
    const result = await solver.functions.verifier(
      {
        task,
        notes,
        targets: notes.map(({ id }) => ({ id, through: "reconstruction" })),
      },
      execution,
      BACKGROUND_CONTEXT,
    );
    if (result.kind !== "verification")
      throw new Error("Expected verification");
    for (const check of result.checks)
      notes.find((note) => note.id === check.noteId)!.checks.push(check);
    refresh(notes);
    expect(calls).toEqual(["correctness", "requirements"]);
    expect(sources).toHaveLength(1);
    expect(sources[0]!.instructions).toContain(
      "completion criteria belongs to the separate requirements check",
    );
    expect(JSON.parse(sources[0]!.prompt).notes).toEqual([
      { id: "n3", text: notes[2]!.text, premises: [external] },
    ]);
    expect(
      notes.map(({ verified, dead, accepted }) => ({
        verified,
        dead,
        accepted,
      })),
    ).toEqual([
      { verified: true, dead: false, accepted: false },
      { verified: false, dead: true, accepted: false },
      { verified: true, dead: false, accepted: false },
    ]);
    const reconstructed = await solver.functions.reconstruct(
      { task, notes, targets: ["n1"] },
      execution,
      BACKGROUND_CONTEXT,
    );
    expect(reconstructed.checks[0]!.reconstruction).toMatchObject({
      verdict: "PASS",
      statement: conditional,
      premises: [],
    });
    expect(calls.slice(2)).toEqual(["statement", "proof", "reconstruction"]);
    expect(sources).toHaveLength(1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconstruction retains source-bound assumptions, blinds their commentary, and reuses checked statements", async () => {
  const task = {
    problem: "Prove q > 0 whenever q is the square of a nonzero rational.",
    completionCriteria: "Give a complete proof using established theorems.",
  };
  const theorem = "For every nonzero rational x, x squared is positive.";
  const raw = `${theorem} This assertion remains for source validation. SECRET-APPLICATION: substitute the witness defining q.`;
  const normalized = [{ premise: 0, statement: theorem }];
  const pass = { verdict: "PASS" as const, report: "Checked." };
  const source: Source = {
    ...pass,
    kind: "codex-report",
    report: "SECRET-SOURCE-OPINION",
    operationId: "source-operation",
    reportedAt: "2026-10-01T00:00:00.000Z",
    premises: [raw],
    passages: [
      {
        id: "source-operation/0",
        premise: 0,
        statement: raw,
        url: "https://example.org/theorem",
        quote: theorem,
      },
    ],
  };
  const note: Note = {
    id: "n1",
    summary: "SECRET-SUMMARY",
    detailedSummary: "SECRET-DETAILED-SUMMARY",
    text: `Claim: q is positive. SECRET-ORIGINAL: apply the theorem to its nonzero rational square root.`,
    support: [],
    checks: [
      {
        noteId: "n1",
        correctness: { ...pass, premises: [raw] },
        source,
        requirements: pass,
      },
    ],
    revision: 0,
    imported: false,
    verified: false,
    accepted: false,
    dead: false,
    candidate: true,
  };
  const metadata = {
    kind: "source-check",
    verdict: "PASS",
    operationId: source.operationId,
  };
  const calls: string[] = [];
  let mode: "valid" | "reuse" | "stronger" | "invalid" = "valid";
  let invalidAttempts = 0;
  const stronger = "Every rational x has a positive square.";
  const runtime = fixtureRuntime((context, _options, selected) => {
    calls.push(selected.id);
    const input = JSON.parse(
      String(
        context.messages.find((message) => message.role === "user")!.content,
      ),
    );
    let result: JsonValue;
    if (selected.id === "statement") {
      if (mode === "reuse") {
        expect(input.notes.map(({ id }: Note) => id)).toEqual(["n2"]);
        result = { statement: "q + 1 > 1.", premises: [] };
      } else {
        expect(input.notes[0].premises).toEqual([raw]);
        expect(input.notes[0].source).toEqual(metadata);
        let premises =
          mode === "stronger"
            ? [{ premise: 0, statement: stronger }]
            : normalized;
        if (mode === "invalid") {
          // Each malformed submission must be rejected before the next role.
          if (invalidAttempts > 0)
            expect(
              context.messages.some(
                (message) => message.role === "toolResult" && message.isError,
              ),
            ).toBe(true);
          expect(invalidAttempts).toBeLessThan(4);
          premises = [
            [],
            [...normalized, ...normalized],
            [{ premise: 1, statement: theorem }],
            normalized,
          ][invalidAttempts++]!;
        }
        result = {
          statement: "q is the square of a nonzero rational; then q > 0.",
          premises,
        };
      }
    } else if (selected.id === "proof") {
      const payload = JSON.stringify(context.messages);
      expect(payload).not.toContain("SECRET-");
      expect(payload).not.toContain("remains for source validation");
      expect(payload).not.toContain("source-operation");
      expect(payload).not.toContain("source-check");
      const premiseNote = mode === "reuse" ? input.support[0] : input.notes[0];
      expect(premiseNote.premises).toEqual(
        mode === "stronger"
          ? [{ premise: 0, statement: stronger }]
          : normalized,
      );
      if (mode === "reuse") expect(premiseNote.id).toBe("n1");
      result = {
        proof: "Apply the supplied theorem with its hypotheses satisfied.",
        complete: true,
      };
    } else if (selected.id === "reconstruction") {
      expect(
        input.premises.find(
          ({ noteId }: { noteId: string }) => noteId === "n1",
        ),
      ).toEqual({ noteId: "n1", premises: [raw], source: metadata });
      result =
        mode === "stronger"
          ? {
              verdict: "INCONCLUSIVE",
              report:
                "The normalization strengthened the allowed theorem by removing nonzero; zero is not covered.",
            }
          : pass;
    } else throw new Error(`Unexpected role: ${selected.id}`);
    return fauxAssistantMessage(
      [
        fauxToolCall("submit_result", {
          results: [{ noteId: input.notes[0].id, result }],
        }),
      ],
      { stopReason: "toolUse" },
    );
  });
  const solver = createSolver(task, runtime);
  const execution: Execution = {
    attemptId: "source-reconstruction",
    attempt: 1,
    recorder: { begin: () => ({ recordRequest() {}, settle() {} }) },
  };
  const reconstruct = (notes: Note[], target = "n1") =>
    solver.functions.reconstruct(
      { task, notes, targets: [target] },
      execution,
      BACKGROUND_CONTEXT,
    );

  for (const verdict of [undefined, "FAIL", "INCONCLUSIVE"] as const) {
    const blocked = structuredClone(note);
    blocked.checks[0]!.source = verdict ? { ...source, verdict } : undefined;
    await expect(reconstruct([blocked])).rejects.toThrow(
      "Reconstruction requires verified notes and support",
    );
  }
  const wrongBinding = structuredClone(note);
  wrongBinding.checks[0]!.correctness!.premises = [stronger];
  await expect(reconstruct([wrongBinding])).rejects.toThrow(
    "Source-checked premises do not match correctness",
  );
  expect(calls).toEqual([]);
  const result = await reconstruct([note]);
  expect(result.checks[0]!.reconstruction).toMatchObject({
    verdict: "PASS",
    premises: normalized,
  });
  const checked = structuredClone(note);
  checked.checks.push(...result.checks);
  expect(refresh([checked])[0]!.accepted).toBe(true);

  mode = "reuse";
  const dependent = {
    ...structuredClone(note),
    id: "n2",
    support: ["n1"],
    checks: [
      {
        noteId: "n2",
        correctness: { ...pass, premises: [] },
        source: pass,
        requirements: pass,
      },
    ],
  };
  const reused = await reconstruct([checked, dependent], "n2");
  expect(reused.checks.map(({ noteId }) => noteId)).toEqual(["n2"]);
  expect(calls).toEqual([
    "statement",
    "proof",
    "reconstruction",
    "statement",
    "proof",
    "reconstruction",
  ]);

  const wrongReuse = structuredClone(checked);
  wrongReuse.checks.at(-1)!.reconstruction!.premises = [];
  calls.length = 0;
  await expect(reconstruct([wrongReuse, dependent], "n2")).rejects.toThrow(
    "exactly one entry per source-checked premise index",
  );
  expect(calls).toEqual(["statement"]);

  mode = "stronger";
  const mismatch = await reconstruct([note]);
  const unaccepted = structuredClone(note);
  unaccepted.checks.push(...mismatch.checks);
  expect(mismatch.checks[0]!.reconstruction!.verdict).toBe("INCONCLUSIVE");
  expect(refresh([unaccepted])[0]!.accepted).toBe(false);

  mode = "invalid";
  calls.length = 0;
  const recovered = await reconstruct([note]);
  expect(recovered.checks[0]!.reconstruction!.premises).toEqual(normalized);
  expect(calls).toEqual([
    "statement",
    "statement",
    "statement",
    "statement",
    "proof",
    "reconstruction",
  ]);
});
