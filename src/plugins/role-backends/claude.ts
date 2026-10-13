import type { JsonValue } from "@earendil-works/chord";
import { getJsonSchemaToolParameters } from "@earendil-works/pi-ai/api/constrained-sampling";
import { RoleFailure } from "../../roles/types.ts";
import {
  cliCall,
  cliRoles,
  tokenUsage,
  type CliOptions,
  type CliRoleOptions,
  type CliTranscript,
} from "./process.ts";

export type ClaudeOptions = CliOptions;

/** Claude's native structured-output result, including provider failures and accounting. */
export function claudeTranscript(stdout: string): CliTranscript {
  const result: CliTranscript = { usage: null, searches: 0 };
  try {
    const event = JSON.parse(stdout);
    if (!event || event.type !== "result")
      throw new Error("Claude emitted no completed result");
    result.usage = tokenUsage(event.usage, event.total_cost_usd);
    if (event.is_error || event.subtype !== "success") {
      result.error = new RoleFailure(
        typeof event.result === "string"
          ? event.result
          : event.errors?.join("\n") || `Claude ${event.subtype}`,
      );
    } else if (event.structured_output === undefined) {
      result.error = new Error("Claude emitted no structured output");
    } else result.value = event.structured_output as JsonValue;
  } catch (error) {
    result.error =
      error instanceof SyntaxError
        ? new Error("Claude emitted malformed JSON")
        : (error as Error);
  }
  return result;
}

export function claudeCall(settings: ClaudeOptions, usagePrefix?: string) {
  return cliCall(settings, {
    name: "Claude",
    provider: "claude-cli",
    api: "claude-print",
    command: "claude",
    usagePrefix,
    parse: claudeTranscript,
    arguments(_mode, tool, instructions) {
      return [
        "--print",
        "--model",
        settings.model,
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(getJsonSchemaToolParameters(tool, false)),
        "--system-prompt",
        instructions,
        "--effort",
        settings.reasoning === "minimal"
          ? "low"
          : (settings.reasoning ?? "max"),
        "--no-session-persistence",
        "--permission-mode",
        "dontAsk",
        "--permission-prompts",
        "none",
        "--safe-mode",
        "--restricted",
        "--settings",
        JSON.stringify({
          sandbox: {
            enabled: true,
            allowUnsandboxedCommands: false,
            failIfUnavailable: true,
          },
        }),
        "--strict-mcp-config",
        "--tools",
        "Read,Write,Edit,Bash,Glob,Grep",
        "--allowedTools",
        "Read,Write,Edit,Bash,Glob,Grep",
      ];
    },
  });
}

export function claude(
  options: Omit<CliRoleOptions<ClaudeOptions>, "research">,
) {
  return cliRoles(options, claudeCall);
}
