import { execa } from "execa";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import type { JsonValue } from "@earendil-works/chord";
import {
  validateToolArguments,
  type Static,
  type ThinkingLevel,
  type Tool,
} from "@earendil-works/pi-ai";
import type { EntryId } from "@earendil-works/pi-durable";
import {
  ExternalLog,
  ExternalRequest,
  type ExternalAnswer,
  type ExternalCall,
} from "../../roles/backend.ts";
import { RoleFailure } from "../../roles/types.ts";
import { externalResearch } from "../../roles/research.ts";
import type { Roles } from "../../workflow.ts";

export type CliOptions = {
  model: string;
  command?: string;
  reasoning?: ThinkingLevel;
  environment?: NodeJS.ProcessEnv;
  workspace?: string;
};
export type CliRoleOptions<S extends CliOptions> = {
  implementation?: S & { workspace: string };
  verifier?: S & { workspace: string };
  explorer?: S & { workspace: string };
  research?: S;
  usagePrefix?: string;
};
export type CliTranscript = {
  value?: JsonValue;
  error?: Error;
  usage: Record<string, number> | null;
  searches: number;
};
/** Register explicit CLI options through the existing role hook. */
export function cliRoles<S extends CliOptions>(
  options: CliRoleOptions<S>,
  call: (settings: S, usagePrefix?: string) => ExternalCall,
) {
  return (builtins: Roles): Partial<Roles> => {
    const external = { ...builtins.external };
    for (const role of ["implementation", "verifier", "explorer"] as const) {
      const settings = options[role];
      if (settings) external[role] = call(settings, options.usagePrefix);
    }
    if (options.research)
      external.research = externalResearch(
        call(options.research, options.usagePrefix),
      );
    return { external };
  };
}

export function tokenUsage(value: unknown, cost?: unknown) {
  const usage = Object.fromEntries(
    Object.entries(value && typeof value === "object" ? value : {}).filter(
      (entry): entry is [string, number] =>
        entry[0].endsWith("_tokens") &&
        typeof entry[1] === "number" &&
        Number.isFinite(entry[1]) &&
        entry[1] >= 0,
    ),
  );
  if (typeof cost === "number" && Number.isFinite(cost) && cost >= 0)
    usage.cost_usd = cost;
  return Object.keys(usage).length ? usage : null;
}

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Pi journals results; incomplete invocations restart in a fresh workspace. Execa owns processes. */
export function cliCall(
  settings: CliOptions & { profile?: string },
  adapter: {
    name: string;
    provider: string;
    api: string;
    command: string;
    usagePrefix?: string;
    arguments(
      mode: "worker" | "research",
      tool: Tool,
      instructions: string,
      workspace: string,
      operationId: string,
    ): Promise<string[]> | string[];
    parse(stdout: string): CliTranscript;
  },
): ExternalCall {
  return async (mode, schema, instructions, input, runtime, context) => {
    const key = `external.${hash([mode, schema, instructions, input])}`;
    // Persist only a digest: executable configuration may contain credentials.
    const identity = hash([
      adapter.provider,
      adapter.api,
      settings.model,
      settings.command ?? adapter.command,
      settings.reasoning ?? "max",
      settings.workspace,
      settings.profile,
      settings.environment &&
        Object.entries(settings.environment).sort(([a], [b]) =>
          a.localeCompare(b),
        ),
      adapter.usagePrefix,
    ]);
    if (
      (await runtime.memo(`external.${mode}.backend`, identity, context)) !==
      identity
    )
      throw new Error(
        "External backend configuration changed during task recovery",
      );
    const cached = await runtime.memo<ExternalAnswer<typeof schema>>(
      key,
      context,
    );
    if (cached !== undefined) return structuredClone(cached);
    const shell = mode === "worker";
    const tool = {
      name: "external_output",
      description: "External result",
      parameters: schema,
    };
    const parent = shell ? settings.workspace : tmpdir();
    if (!parent || !isAbsolute(parent))
      throw new Error(
        `${adapter.name.toLowerCase()}.workspace must be an absolute directory`,
      );
    if (shell) await mkdir(parent, { recursive: true });
    const workspace = await mkdtemp(
      join(
        parent,
        shell ? `${adapter.command}-` : `pi-research-${adapter.command}-`,
      ),
    );
    const operationId = crypto.randomUUID();
    let requestEntry: EntryId | undefined;
    let completion = "Completion unrecorded; execution may have occurred.";
    try {
      if (shell)
        await writeFile(
          join(workspace, "input.json"),
          JSON.stringify(input) + "\n",
        );
      const args = await adapter.arguments(
        mode,
        tool,
        instructions,
        workspace,
        operationId,
      );
      const environment = settings.environment ?? process.env;
      const usageTag = adapter.usagePrefix
        ? `${adapter.usagePrefix}/${runtime.taskId}`
        : environment.XEAN_CODEX_USAGE_TAG;
      let entry: EntryId | undefined;
      await runtime.commit(async (tx) => {
        entry = (
          await tx.appendEntry(ExternalRequest, runtime.conversationId, {
            data: {
              provider: adapter.provider,
              api: adapter.api,
              operationId,
              model: settings.model,
              workspace,
              reasoning: settings.reasoning ?? "max",
              profile: settings.profile ?? null,
              usageTag: usageTag ?? null,
            },
          })
        ).id;
      }, context);
      requestEntry = entry;
      const executable = settings.command ?? adapter.command;
      context.abortSignal?.throwIfAborted();
      const child = execa(
        executable.includes("/") ? resolve(executable) : executable,
        args,
        {
          cwd: workspace,
          env: {
            ...environment,
            ...(usageTag ? { XEAN_CODEX_USAGE_TAG: usageTag } : {}),
          },
          extendEnv: false,
          input: JSON.stringify(
            shell ? { ...(input as object), workspace } : input,
          ),
          cancelSignal: context.abortSignal,
          killSignal: "SIGKILL",
          killDescendants: true,
          reject: false,
          // Execa measures decoded output in characters, separately per stream.
          maxBuffer: { stdout: 16 * 1024 * 1024, stderr: 1024 * 1024 },
          stripFinalNewline: false,
        },
      );
      // Execa destroys an overflowing pipe but waits for process exit.
      for (const stream of [child.stdout, child.stderr])
        stream?.once("close", () => {
          if (!stream.readableEnded) child.kill();
        });
      const run = await child;
      context.abortSignal?.throwIfAborted();
      const transcript = adapter.parse(run.stdout);
      let log: EntryId | undefined;
      await runtime.commit(async (tx) => {
        log = (
          await tx.appendEntry(ExternalLog, runtime.conversationId, {
            data: {
              operationId,
              stdout: run.stdout,
              stderr: run.stderr,
              exitCode: run.exitCode ?? null,
              usage: transcript.usage,
              ...(run.isMaxBuffer ? { outputTruncated: true } : {}),
            },
          })
        ).id;
      }, context);
      completion = `${adapter.name} log entry: ${log}; exit code: ${run.exitCode ?? "unknown"}; output truncated: ${Boolean(run.isMaxBuffer)}.`;
      if (run.isMaxBuffer)
        throw new RoleFailure(
          `${adapter.name} exceeded its output capture limit (16 Mi characters stdout, 1 Mi stderr); recorded output is truncated`,
        );
      const failure =
        transcript.error instanceof RoleFailure ? transcript.error : undefined;
      if (run.failed || failure)
        throw new RoleFailure(
          failure?.message ||
            run.stderr.trim() ||
            (failure
              ? `${adapter.name} reported a failed turn`
              : run.shortMessage) ||
            `${adapter.name} process failed`,
        );
      if (transcript.error) throw transcript.error;
      const value: Static<typeof schema> = validateToolArguments(tool, {
        type: "toolCall",
        id: operationId,
        name: tool.name,
        arguments: transcript.value as Record<string, JsonValue>,
      });
      const answer = {
        value,
        workspace,
        operationId,
        searches: transcript.searches,
        reportedAt: new Date().toISOString(),
      };
      return structuredClone(await runtime.memo(key, answer, context));
    } catch (error) {
      context.abortSignal?.throwIfAborted();
      if (error instanceof Error) {
        const primary =
          error.message.length > 4096
            ? `${error.message.slice(0, 4096)}… [see ${adapter.name} log]`
            : error.message;
        error.message = `${primary}\n\n${requestEntry ? "Execution receipt" : `${adapter.name} operation`}: ${operationId}\nRequest entry: ${requestEntry ?? "unrecorded"}\n${completion}\n${shell ? "Retained" : "Temporary research"} workspace: ${workspace}\nFailure does not imply that no commands ran.`;
      }
      throw error;
    } finally {
      if (!shell)
        await rm(workspace, { recursive: true, force: true }).catch((error) =>
          runtime.report(error),
        );
    }
  };
}
