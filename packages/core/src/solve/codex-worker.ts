import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import type { Context } from "@earendil-works/chord";
import type { Execution } from "../types.ts";
import { askCodex, type CodexOptions } from "./codex.ts";
import {
  explorationSchema,
  type CodexInput,
  type SolverResult,
} from "./contracts.ts";
import { validateNotes } from "./notes.ts";

/** Codex owns implementation and tool use; Xean publishes its notes as one result. */
export function codexWorker(
  options: CodexOptions & { workspace: string },
  usagePrefix?: string,
) {
  if (!isAbsolute(options.workspace))
    throw new Error("codex.workspace must be an absolute directory");
  return async (
    input: CodexInput,
    execution: Execution,
    context: Context,
  ): Promise<SolverResult> => {
    input = structuredClone(input);
    context.abortSignal?.throwIfAborted();
    await mkdir(options.workspace, { recursive: true });
    const workspace = await mkdtemp(join(options.workspace, "codex-"));
    await writeFile(
      join(workspace, "input.json"),
      JSON.stringify(input) + "\n",
    );
    const { value } = await askCodex(
      { ...options, workspace },
      explorationSchema,
      "Complete the supplied assignment for the exact mathematical task. You may write and run programs in your working directory. Choose your own implementation and tools. Follow the task's proof rules and the operator's execution configuration. For resource-heavy work use an operator-provided supervised compute service; if none is available, report what is needed instead of launching it locally. Keep programs, inputs, commands, outputs, and environment details in this directory so the work can be rerun. Return useful findings or failed approaches as ordinary notes with local IDs n1, n2, ... . Each note has summary, detailedSummary, text, and support. Put artifact filenames and rerun commands in text, never support. Include the claims, relevant program/output evidence, reasoning, and limitations needed to check the note without opening artifact files. Distinguish observations, exhaustive finite results, and mathematical proofs. Declare as support every supplied or earlier local note whose result you use without proving it. Dead notes are diagnostic only. These are unverified drafts; execution success does not establish mathematical correctness. Set candidate=true only when the last note claims a complete solution of the exact task. Return notes=[] and candidate=false if no useful finding was obtained.",
      { ...input, workspace },
      execution,
      context,
      usagePrefix,
    );
    validateNotes(value.notes, input.notes);
    if (value.candidate && value.notes.length === 0)
      throw new Error("A solution claim needs a new note");
    return {
      kind: "notes",
      ...value,
      workspace,
      notes: value.notes.map((note) => ({
        ...note,
        text: `${note.text}\n\nArtifacts: ${workspace}`,
      })),
    };
  };
}
