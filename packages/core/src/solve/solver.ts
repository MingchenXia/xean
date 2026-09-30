import { isDeepStrictEqual } from "node:util";
import { Check } from "typebox/value";
import { positiveIntegerSchema } from "../types.ts";
import type { Role, WorkRequest, XeanOptions } from "../types.ts";
import {
  closure,
  completion,
  noteInfo,
  project,
  sourceEvidence,
} from "./notes.ts";
import {
  decode,
  declarationVersion,
  taskSchema,
  verificationTargets,
  type ExplorerInput,
  type Task,
  type VerifierInput,
} from "./contracts.ts";
import {
  createRoles,
  type CoordinationInput,
  type RoleOptions,
} from "./roles.ts";
import { type PiRuntime } from "./pi.ts";
import { createResearch, type Research } from "./research.ts";
import { guidance, validateCommand } from "./commands.ts";
import { chatGptWebProviderId } from "../providers/chatgpt-web.ts";

export function createSolver(
  taskValue: Task,
  runtime: PiRuntime | (() => PiRuntime),
  settings: Partial<RoleOptions> = {},
  research?: Research | ((runtime: PiRuntime) => Research),
) {
  const task = decode(taskSchema, taskValue);
  const maxExplorerReads = settings.maxExplorerReads ?? 4;
  const options: RoleOptions = {
    maxExplorerResponses: maxExplorerReads + 4,
    literature: false,
    maxExplorerReads,
    chatGptSingleShot: false,
    ...settings,
  };
  const requestedExplorerResponses = settings.maxExplorerResponses;
  if (!Check(positiveIntegerSchema, options.maxExplorerResponses))
    throw new Error("maxExplorerResponses must be a positive integer");
  if (!Check(positiveIntegerSchema, options.maxExplorerReads))
    throw new Error("maxExplorerReads must be a positive integer");
  let implementation: ReturnType<typeof createRoles> | undefined;
  const load = () => {
    if (!implementation) {
      const ready = typeof runtime === "function" ? runtime() : runtime;
      if (ready.profiles.explorer.model.provider === chatGptWebProviderId) {
        if (
          requestedExplorerResponses !== undefined &&
          requestedExplorerResponses !== 1
        )
          throw new Error(
            "ChatGPT Web Explorer requires maxExplorerResponses=1; each browser response consumes scarce subscription capacity",
          );
        options.maxExplorerResponses = 1;
        options.chatGptSingleShot = true;
      }
      implementation = createRoles(
        ready,
        typeof research === "function"
          ? research(ready)
          : (research ?? createResearch(undefined, ready.usagePrefix)),
        options,
      );
    }
    return implementation;
  };
  const functions: ReturnType<typeof createRoles> = {
    explorer: async (...args) => load().explorer(...args),
    coordinator: async (...args) => load().coordinator(...args),
    verifier: async (...args) => load().verifier(...args),
    reconstruct: async (...args) => load().reconstruct(...args),
    literature: async (...args) => load().literature(...args),
    review: async (...args) => load().review(...args),
  };
  const builtInExplorer = functions.explorer;
  const roles: Role[] = (["explorer", "verifier", "literature"] as const).map(
    (name) => ({
      name: `xean.${name}`,
      run: (input, execution, context) =>
        functions[name](input as never, execution, context),
    }),
  );
  const coordinator: XeanOptions["coordinator"] = {
    name: "xean.coordinator",
    async run(signal, view, execution, context) {
      const notes = project(view);
      const result = completion(task, notes);
      if (result !== undefined)
        return { state: view.state, completion: result };
      if (
        view.callLimitReached ||
        view.work.some(
          (work) => work.status === "active" || work.status === "queued",
        )
      )
        return { state: view.state };
      const literatureUsed = view.work.some(
        (work) =>
          work.role === "xean.literature" && work.status === "completed",
      );
      const input: CoordinationInput = {
        task,
        notes,
        guidance: guidance(view),
        literatureUsed,
        failures: view.work
          .filter((work) => work.status === "failed")
          .map(({ id, role, error }) => ({ id, role, error })),
      };
      const plan = await functions.coordinator(input, execution, context);
      // A replaced planner need not initialize Pi. Resolve the built-in
      // Explorer's quota policy before dispatch, including after reopening.
      if (
        functions.explorer === builtInExplorer &&
        plan.work.some((request) => request.kind === "explorer")
      )
        load();
      const common = { task, notes: notes.map(noteInfo) };
      // Explorer workers may run alongside the single verification batch.
      const targets = verificationTargets(plan);
      let explorerUsed =
        options.chatGptSingleShot === true &&
        view.work.some((work) => work.role === "xean.explorer");
      const dispatch: WorkRequest[] = [];
      for (const request of plan.work) {
        if (request.kind === "verifier") continue;
        if (request.kind === "explorer") {
          if (explorerUsed) continue;
          explorerUsed = options.chatGptSingleShot === true;
          dispatch.push({
            id: `w${signal.id}-${dispatch.length + 1}`,
            role: "xean.explorer",
            input: {
              task,
              notes,
              guidance: request.guidance,
            } satisfies ExplorerInput,
          });
        } else
          dispatch.push({
            id: `w${signal.id}-${dispatch.length + 1}`,
            role: "xean.literature",
            input: { ...common, query: request.query },
          });
      }
      if (targets.length)
        dispatch.push({
          id: `w${signal.id}-${dispatch.length + 1}`,
          role: "xean.verifier",
          input: {
            task,
            notes: closure(
              targets.map((target) => target.id),
              notes,
            ),
            targets,
            evidence: sourceEvidence(notes),
          } satisfies VerifierInput,
        });
      return { state: view.state, dispatch };
    },
  };
  const accept: NonNullable<XeanOptions["accept"]> = (candidate, view) => {
    // Acceptance is reconstructed from committed worker evidence, never a Coordinator claim.
    const expected = completion(task, project(view));
    return expected !== undefined && isDeepStrictEqual(candidate, expected);
  };
  return {
    task: { kind: "xean.solve.library", version: declarationVersion, task },
    roles,
    coordinator,
    accept,
    validateInput: validateCommand,
    functions,
    options,
  };
}
