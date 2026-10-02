import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Execution, JsonValue } from "../packages/core/src/types.ts";
import { createSolver } from "../packages/core/src/solve/solver.ts";
import type { Note, Source } from "../packages/core/src/solve/contracts.ts";
import {
  refresh,
  stagePending,
  verdict,
} from "../packages/core/src/solve/notes.ts";
import { codexResearch } from "../packages/core/src/solve/research.ts";
import { invoke, fixtureRuntime } from "./fixtures/pi.ts";

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
          expect(input.instructions).toContain(
            "A specific unmet completion criterion is a concrete reason for FAIL",
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
          results = [{ noteId: "n1", result: { statement: conditional } }];
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
    const result = await invoke(
      solver.functions.verifier,
      {
        task,
        notes,
        targets: notes.map(({ id }) => ({
          id,
          through: "reconstruction" as const,
        })),
      },
      execution,
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
      {
        id: "n3",
        summary: notes[2]!.summary,
        detailedSummary: notes[2]!.detailedSummary,
        text: notes[2]!.text,
        premises: [external],
      },
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
    const reconstructed = await invoke(
      solver.functions.reconstruct,
      { task, notes, targets: ["n1"] },
      execution,
    );
    expect(reconstructed.checks[0]!.reconstruction).toMatchObject({
      verdict: "PASS",
      statement: conditional,
    });
    expect(calls.slice(2)).toEqual(["statement", "proof", "reconstruction"]);
    expect(sources).toHaveLength(1);
    const lemma = notes[0]!;
    lemma.checks.push(...reconstructed.checks, {
      noteId: lemma.id,
      requirements: {
        verdict: "PASS",
        report: "A later disagreement cannot clear FAIL.",
      },
    });
    lemma.text += "\n";
    lemma.revision++;
    refresh(notes);
    expect(verdict(lemma, "requirements")?.verdict).toBe("FAIL");
    expect(stagePending(lemma, "requirements")).toBe(false);
    expect(lemma).toMatchObject({
      verified: true,
      dead: false,
      accepted: false,
    });
    expect(
      await invoke(
        solver.functions.verifier,
        {
          task,
          notes,
          targets: [{ id: lemma.id, through: "reconstruction" }],
        },
        execution,
      ),
    ).toEqual({ kind: "verification", checks: [] });
    expect(calls).toHaveLength(5);
    // A new note ID can carry independent successful requirements evidence.
    const fresh: Note = {
      ...lemma,
      id: "fresh",
      revision: 0,
      checks: [
        {
          noteId: "fresh",
          correctness: verdict(lemma, "correctness"),
          source: verdict(lemma, "source"),
          requirements: {
            verdict: "INCONCLUSIVE",
            report: "Needs another check.",
          },
          reconstruction: verdict(lemma, "reconstruction"),
        },
      ],
    };
    refresh([fresh]);
    expect(stagePending(fresh, "requirements")).toBe(true);
    fresh.checks.push({
      noteId: fresh.id,
      requirements: { verdict: "PASS", report: "Complete." },
    });
    refresh([fresh]);
    expect(fresh.accepted).toBe(true);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("reconstruction uses unchanged source premises, rejects extractor replacements, and reuses checked statements", async () => {
  const task = {
    problem: "Prove q > 0 whenever q is the square of a nonzero rational.",
    completionCriteria: "Give a complete proof using established theorems.",
  };
  const theorem = "For every nonzero rational x, x squared is positive.";
  const stronger = "Every rational x has a positive square.";
  const pass = { verdict: "PASS" as const, report: "Checked." };
  const source: Source = {
    ...pass,
    kind: "codex-report",
    report: "SECRET-SOURCE-OPINION",
    operationId: "source-operation",
    reportedAt: "2026-10-01T00:00:00.000Z",
    premises: [theorem],
    passages: [
      {
        id: "source-operation/0",
        premise: 0,
        statement: theorem,
        url: "https://example.org/theorem",
        quote: theorem,
      },
    ],
  };
  const note: Note = {
    id: "n1",
    summary: "SECRET-SUMMARY",
    detailedSummary: "SECRET-DETAILED-SUMMARY",
    text: "Claim: q is positive. SECRET-ORIGINAL: apply the theorem to its nonzero rational square root.",
    support: [],
    checks: [],
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
  let mode: "invalid" | "reuse" = "invalid";
  let extractionAttempts = 0;
  const runtime = fixtureRuntime((context, _options, selected) => {
    calls.push(selected.id);
    const input = JSON.parse(
      String(
        context.messages.find((message) => message.role === "user")!.content,
      ),
    );
    let result: JsonValue;
    switch (selected.id) {
      case "correctness":
        result = {
          ...pass,
          report: "SECRET-APPLICATION: substitute the witness defining q.",
          premises: [theorem],
        };
        break;
      case "requirements":
        result = pass;
        break;
      case "statement":
        expect(input.notes.map(({ id }: Note) => id)).toEqual([
          mode === "reuse" ? "n2" : "n1",
        ]);
        result = {
          statement:
            mode === "reuse"
              ? "q + 1 > 1."
              : "q is the square of a nonzero rational; then q > 0.",
        };
        if (mode === "invalid") {
          // Extractors cannot drop or replace the authoritative premises.
          if (extractionAttempts > 0)
            expect(
              context.messages.some(
                (message) => message.role === "toolResult" && message.isError,
              ),
            ).toBe(true);
          expect(extractionAttempts).toBeLessThan(3);
          if (extractionAttempts < 2)
            result = {
              ...result,
              premises: extractionAttempts === 0 ? [] : [stronger],
            };
          extractionAttempts++;
        }
        break;
      case "proof": {
        const payload = JSON.stringify(context.messages);
        expect(payload).not.toContain("SECRET-");
        expect(payload).not.toContain("source-operation");
        expect(payload).not.toContain("source-check");
        const premiseNote =
          mode === "reuse" ? input.support[0] : input.notes[0];
        expect(premiseNote).toMatchObject({ id: "n1", premises: [theorem] });
        result = {
          proof: "Apply the supplied theorem with its hypotheses satisfied.",
          complete: true,
        };
        break;
      }
      case "reconstruction":
        expect(
          input.premises.find(
            ({ noteId }: { noteId: string }) => noteId === "n1",
          ),
        ).toEqual({ noteId: "n1", premises: [theorem], source: metadata });
        expect(
          input.statements.find(({ id }: { id: string }) => id === "n1")
            .premises,
        ).toEqual([theorem]);
        result = pass;
        break;
      default:
        throw new Error(`Unexpected role: ${selected.id}`);
    }
    return fauxAssistantMessage(
      [
        fauxToolCall("submit_result", {
          results: [{ noteId: input.notes[0].id, result }],
        }),
      ],
      { stopReason: "toolUse" },
    );
  });
  const solver = createSolver(
    task,
    runtime,
    {},
    {
      ...codexResearch(),
      async source({ notes }) {
        calls.push("source");
        expect(notes).toEqual([
          {
            id: "n1",
            summary: note.summary,
            detailedSummary: note.detailedSummary,
            text: note.text,
            premises: [theorem],
          },
        ]);
        return [{ noteId: "n1", result: source }];
      },
    },
  );
  const verified = await invoke(solver.functions.verifier, {
    task,
    notes: [note],
    targets: [{ id: "n1", through: "requirements" }],
  });
  if (verified.kind !== "verification")
    throw new Error("Expected verification");
  note.checks.push(...verified.checks);
  expect(calls).toEqual(["correctness", "source", "requirements"]);
  calls.length = 0;
  const reconstruct = (notes: Note[], target = "n1") =>
    invoke(solver.functions.reconstruct, { task, notes, targets: [target] });
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
  expect(result.checks[0]!.reconstruction).toEqual({
    ...pass,
    statement: "q is the square of a nonzero rational; then q > 0.",
    proof: "Apply the supplied theorem with its hypotheses satisfied.",
  });
  expect(calls).toEqual([
    "statement",
    "statement",
    "statement",
    "proof",
    "reconstruction",
  ]);
  const checked = structuredClone(note);
  checked.checks.push(...result.checks);
  expect(refresh([checked])[0]!.accepted).toBe(true);

  mode = "reuse";
  calls.length = 0;
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
  expect(calls).toEqual(["statement", "proof", "reconstruction"]);
});
