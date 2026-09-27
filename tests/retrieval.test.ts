import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai";
import { getDeclaredTools } from "@earendil-works/pi-ai/utils/transcript";
import type { Execution } from "../packages/core/src/types.ts";
import type { Note } from "../packages/core/src/solve/contracts.ts";
import { createSolver } from "../packages/core/src/solve/solver.ts";
import { fixtureRuntime } from "./fixtures/pi.ts";

const task = { problem: "Exact task", completionCriteria: "Complete proof" };
const execution: Execution = {
  attemptId: "retrieval-fixture",
  recorder: { begin: () => ({ recordRequest() {}, settle() {} }) },
};
const note = (id: string, summary: string): Note => ({
  id,
  summary,
  detailedSummary: `DETAIL-${id}`,
  text: `FULL-${id}`,
  support: [],
  revision: 0,
  imported: true,
  checks: [],
  verified: true,
  dead: false,
  accepted: false,
  candidate: false,
});
const draft = {
  id: "n1",
  summary: "New result",
  detailedSummary: "New result under the live lemma's hypotheses.",
  text: "Apply the live lemma with its hypotheses checked.",
  support: ["live"],
};
const reply = (...calls: ReturnType<typeof fauxToolCall>[]) =>
  fauxAssistantMessage(calls, { stopReason: "toolUse" });

test("both Explorer implementations share the solver boundary and prefilled remains the default", async () => {
  for (const explorer of [undefined, "prefilled", "retrieval"] as const) {
    const notes = [note("live", "Live lemma")];
    const runtime = fixtureRuntime((context) => {
      const input = JSON.parse(
        String(
          context.messages.find((message) => message.role === "user")!.content,
        ),
      );
      const tools = getDeclaredTools(context.messages).map(({ name }) => name);
      expect(input.notes[0]).not.toHaveProperty("text");
      expect(input.notes[0]).not.toHaveProperty("detailedSummary");
      expect(input.support).toEqual(
        explorer === "retrieval"
          ? ["live"]
          : [{ id: "live", text: "FULL-live", support: [] }],
      );
      expect(tools).toEqual(
        explorer === "retrieval"
          ? ["submit_result", "read_notes"]
          : ["submit_result"],
      );
      return reply(
        fauxToolCall("submit_result", { notes: [draft], candidate: true }),
      );
    });
    const solver = createSolver(task, runtime, explorer ? { explorer } : {});
    expect(solver.options.explorer).toBe(explorer ?? "prefilled");
    expect(solver.options.maxExplorerResponses).toBe(
      explorer === "retrieval" ? 16 : 4,
    );
    expect(solver.options.literature).toBe(false);
    expect(
      await solver.functions.explorer(
        { task, notes, support: ["live"], guidance: "Continue" },
        execution,
        BACKGROUND_CONTEXT,
      ),
    ).toEqual({ kind: "notes", notes: [draft], candidate: true });
  }
});

test("retrieval freezes batched reads and rejects invalid IDs and dead dependencies", async () => {
  const notes = [note("live", "Live lemma"), note("dead", "Rejected lemma")];
  notes[1]!.dead = true;
  notes[1]!.verified = false;
  notes[1]!.checks = [
    {
      noteId: "dead",
      correctness: {
        verdict: "FAIL",
        report: "Counterexample at zero.",
        premises: [],
      },
    },
  ];
  let responses = 0;
  const runtime = fixtureRuntime((context) => {
    responses++;
    const result = (id: string) => {
      const message = context.messages.find(
        (message) => message.role === "toolResult" && message.toolCallId === id,
      );
      if (message?.role !== "toolResult")
        throw new Error(`Missing tool result: ${id}`);
      return message;
    };
    const value = (id: string) => {
      const message = result(id);
      expect(message.isError).toBe(false);
      const content = message.content[0];
      if (content?.type !== "text")
        throw new Error("Expected text tool result");
      return JSON.parse(content.text);
    };
    const call = (
      id: string,
      name: string,
      args: Parameters<typeof fauxToolCall>[1],
    ) => fauxToolCall(name, args, { id });
    switch (responses) {
      case 1:
        expect(JSON.stringify(context.messages)).not.toContain("DETAIL-live");
        expect(JSON.stringify(context.messages)).not.toContain("FULL-live");
        notes[0]!.text = "CHANGED-AFTER-START";
        notes[0]!.detailedSummary = "CHANGED-AFTER-START";
        notes[0]!.dead = true;
        notes.push(note("late", "Lemma published after invocation"));
        return reply(
          call("detail", "read_notes", {
            ids: ["live", "dead"],
            level: "detailed",
          }),
        );
      case 2: {
        const details = value("detail");
        expect(
          details.map(({ detailedSummary }: Note) => detailedSummary),
        ).toEqual(["DETAIL-live", "DETAIL-dead"]);
        expect(details[0]).not.toHaveProperty("text");
        expect(details[0]).toMatchObject({ verified: true, dead: false });
        expect(details[1]).toMatchObject({ verified: false, dead: true });
        expect(JSON.stringify(details[1].feedback)).toContain(
          "Counterexample at zero.",
        );
        return reply(
          call("full", "read_notes", { ids: ["live", "dead"], level: "full" }),
          call("unknown", "read_notes", { ids: ["missing"], level: "full" }),
          call("late", "read_notes", { ids: ["late"], level: "full" }),
          call("tooManyIds", "read_notes", {
            ids: Array.from({ length: 21 }, (_, index) => `id-${index}`),
            level: "full",
          }),
        );
      }
      case 3:
        expect(value("full").map(({ text }: Note) => text)).toEqual([
          "FULL-live",
          "FULL-dead",
        ]);
        for (const id of ["unknown", "late", "tooManyIds"])
          expect(result(id).isError).toBe(true);
        expect(JSON.stringify(result("unknown"))).toContain(
          "Unknown note: missing",
        );
        expect(JSON.stringify(result("late"))).toContain("Unknown note: late");
        expect(JSON.stringify(result("tooManyIds"))).not.toContain(
          "Unknown note",
        );
        expect(JSON.stringify(context.messages)).not.toContain(
          "CHANGED-AFTER-START",
        );
        return reply(
          call("deadSupport", "submit_result", {
            notes: [{ ...draft, support: ["dead"] }],
            candidate: false,
          }),
        );
      case 4:
        expect(result("deadSupport").isError).toBe(true);
        expect(JSON.stringify(result("deadSupport"))).toContain(
          "Unknown, dead, or forward support: dead",
        );
        return reply(
          fauxToolCall("submit_result", { notes: [draft], candidate: false }),
        );
      default:
        throw new Error("Retrieval exceeded the four-response allowance");
    }
  });
  const result = await createSolver(task, runtime, {
    explorer: "retrieval",
    maxExplorerResponses: 4,
  }).functions.explorer(
    { task, notes, support: ["live"], guidance: "Continue" },
    execution,
    BACKGROUND_CONTEXT,
  );
  expect(result).toEqual({ kind: "notes", notes: [draft], candidate: false });
  expect(responses).toBe(4);
});

test("retrieval responses consume the default or explicitly configured allowance", async () => {
  for (const maxExplorerResponses of [undefined, 2]) {
    const maximum = maxExplorerResponses ?? 16;
    let responses = 0;
    const runtime = fixtureRuntime(() => {
      if (++responses > maximum)
        throw new Error("Unexpected extra retrieval response");
      return reply(
        fauxToolCall("read_notes", { ids: ["live"], level: "detailed" }),
      );
    });
    const solver = createSolver(task, runtime, {
      explorer: "retrieval",
      ...(maxExplorerResponses === undefined ? {} : { maxExplorerResponses }),
    });
    await expect(
      solver.functions.explorer(
        {
          task,
          notes: [note("live", "Live lemma")],
          support: [],
          guidance: "",
        },
        execution,
        BACKGROUND_CONTEXT,
      ),
    ).rejects.toThrow("exhausted its responses without a valid result");
    expect(responses).toBe(maximum);
  }
});
