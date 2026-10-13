import { execa } from "execa";
import { constants } from "node:fs";
import { access, mkdir, readdir, symlink, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { JsonValue } from "@earendil-works/chord";
import type { SimpleStreamOptions } from "@earendil-works/pi-ai";

export interface CodexTranscript {
  value?: JsonValue;
  text?: string;
  error?: string;
  /** Native token-count names and values, including explicitly reported zero. */
  usage: Record<string, number> | null;
  /** Completed native web_search items, including page operations. */
  searches: number;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

/** Parse observations even when the final answer is absent or malformed. */
export function codexTranscript(stdout: string): CodexTranscript {
  const result: CodexTranscript = { usage: null, searches: 0 };
  let completed = false;
  let message: string | undefined;
  for (const [line] of stdout.matchAll(/[^\n]+/g)) {
    if (!line.trim()) continue;
    let event: Record<string, unknown> | undefined;
    try {
      event = record(JSON.parse(line));
      if (!event) throw new Error("not an object");
    } catch {
      result.error ??= "Codex emitted malformed JSONL";
      continue;
    }
    if (event.type === "turn.failed")
      result.error ??= "Codex reported a failed turn";
    if (event.type === "turn.completed") {
      completed = true;
      const counts = Object.fromEntries(
        Object.entries(record(event.usage) ?? {}).filter(
          (entry): entry is [string, number] =>
            entry[0].endsWith("_tokens") &&
            typeof entry[1] === "number" &&
            Number.isFinite(entry[1]) &&
            entry[1] >= 0,
        ),
      );
      if (Object.keys(counts).length) result.usage = counts;
    }
    if (event.type !== "item.completed") continue;
    const item = record(event.item);
    if (item?.type === "agent_message" && typeof item.text === "string")
      message = item.text;
    if (item?.type === "web_search") result.searches++;
  }
  if (!completed) result.error ??= "Codex emitted no completed turn";
  if (message === undefined) result.error ??= "Codex emitted no final answer";
  else {
    result.text = message;
    try {
      result.value = JSON.parse(message) as JsonValue;
    } catch {
      result.error ??= "Codex final answer was not JSON";
    }
  }
  return result;
}

export interface CodexCommand {
  model: string;
  reasoning?: SimpleStreamOptions["reasoning"];
  command?: string;
  profile?: string;
  environment?: NodeJS.ProcessEnv;
  workspace?: string;
}

/** Keep native authentication in place while giving a read-only cloud home writable state. */
async function commandEnvironment(
  environment: NodeJS.ProcessEnv,
  directory: string,
): Promise<NodeJS.ProcessEnv> {
  const original = resolve(
    environment.CODEX_HOME ?? join(environment.HOME ?? homedir(), ".codex"),
  );
  try {
    await access(original, constants.W_OK);
    return environment;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return environment;
    if (
      !["EACCES", "EROFS"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      throw error;
  }
  const home = join(directory, "codex-home");
  await mkdir(home, { mode: 0o700 });
  for (const name of await readdir(original)) {
    if (
      [
        "auth.json",
        "config.toml",
        "AGENTS.md",
        "rules",
        "skills",
        "plugins",
      ].includes(name) ||
      name.endsWith(".config.toml")
    )
      // Link existing bindings; never read, copy, persist, or replace credential values.
      await symlink(join(original, name), join(home, name));
  }
  return { ...environment, CODEX_HOME: home };
}

/** One noninteractive native invocation. The caller owns accounting and temporary-file cleanup. */
export async function runCodex(
  options: CodexCommand,
  request: { instructions: string; prompt: string; schema: unknown },
  directory: string,
  signal?: AbortSignal,
  webSearch = options.workspace === undefined,
) {
  signal?.throwIfAborted();
  const command = options.command ?? "codex";
  const shell = options.workspace !== undefined;
  const schemaPath = join(directory, "output.schema.json");
  await writeFile(schemaPath, JSON.stringify(request.schema), { mode: 0o600 });
  const environment = await commandEnvironment(
    options.environment ?? process.env,
    directory,
  );
  const overrides = {
    web_search: webSearch ? "live" : "disabled",
    "features.shell_tool": shell,
    approval_policy: "never",
    developer_instructions: request.instructions,
    ...(!shell ? { project_doc_max_bytes: 0 } : {}),
    model_reasoning_effort: options.reasoning ?? "max",
    sqlite_home: join(directory, "sqlite"),
    log_dir: join(directory, "logs"),
  };
  signal?.throwIfAborted();
  return execa(
    command.includes("/") ? resolve(command) : command,
    [
      "exec",
      "--model",
      options.model,
      ...(options.profile ? ["--profile", options.profile] : []),
      ...Object.entries(overrides).flatMap(([key, value]) => [
        "-c",
        `${key}=${JSON.stringify(value)}`,
      ]),
      "--ephemeral",
      "--skip-git-repo-check",
      "--sandbox",
      shell ? "workspace-write" : "read-only",
      "--json",
      "--color",
      "never",
      "--output-schema",
      schemaPath,
      "-",
    ],
    {
      cwd: resolve(options.workspace ?? directory),
      env: environment,
      extendEnv: false,
      input: request.prompt,
      cancelSignal: signal,
      // Cancellation abandons private work, including a launcher's descendants.
      killDescendants: true,
      killSignal: "SIGKILL",
      reject: false,
      stripFinalNewline: false,
    },
  );
}
