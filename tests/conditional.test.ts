import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import type { Execution, JsonValue } from "../packages/core/src/types.ts";
import { createSolver } from "../packages/core/src/solve/solver.ts";
import type { Note } from "../packages/core/src/solve/contracts.ts";
import { refresh } from "../packages/core/src/solve/notes.ts";
import { createResearch } from "../packages/core/src/solve/research.ts";
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
          expect(input.premises).toEqual([{ noteId: "n1", premises: [] }]);
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
      createResearch({
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
