import type { Context } from "@earendil-works/chord";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import { defineEntry } from "@earendil-works/pi-durable";
import type { RoleRuntime } from "./types.ts";
import type { Research } from "./research.ts";

export type ExternalAnswer<S extends TSchema> = {
  value: Static<S>;
  workspace: string;
  operationId: string;
  searches: number;
  reportedAt: string;
};
export type ExternalCall = <S extends TSchema>(
  mode: "worker" | "research",
  schema: S,
  instructions: string,
  input: unknown,
  runtime: RoleRuntime,
  context: Context,
) => Promise<ExternalAnswer<S>>;
export type ExternalRoles = {
  implementation?: ExternalCall;
  verifier?: ExternalCall;
  explorer?: ExternalCall;
  explorerOnce?: boolean;
  research?: Research;
};
export const externalEvidence = (answer: {
  workspace: string;
  operationId: string;
}) =>
  `\n\nArtifacts: ${answer.workspace}\nExecution receipt: ${answer.operationId}`;
export const ExternalLog = defineEntry<{
  operationId: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  usage: Record<string, number> | null;
  outputTruncated?: boolean;
}>("research.external-call");
export const ExternalRequest = defineEntry<{
  provider: string;
  api: string;
  operationId: string;
  model: string;
  workspace: string;
  reasoning: string;
  profile: string | null;
  usageTag: string | null;
}>("research.external-request");
