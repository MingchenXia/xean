import {
  createModels,
  envApiKeyAuth,
  StringEnum,
  Type,
  type Static,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { googleProvider } from "@earendil-works/pi-ai/providers/google";
import {
  chatGptWebProvider,
  chatGptWebProviderId,
} from "../providers/chatgpt-web.ts";
import { limitsSchema, positiveIntegerSchema } from "../types.ts";
import {
  chatGptResponseLimit,
  decode,
  defaultReasoning,
  object,
} from "./contracts.ts";
import {
  assertProfileProvider,
  profileNames,
  type PiRuntime,
  type Profile,
  type ProfileName,
} from "./pi.ts";
import { isAbsolute } from "node:path";
const reasoning = Type.Optional(
  StringEnum(["minimal", "low", "medium", "high", "xhigh", "max"] as const),
);
const researchSchema = object({
  model: Type.String({ minLength: 1 }),
  reasoning,
  command: Type.Optional(Type.String({ minLength: 1 })),
  profile: Type.Optional(Type.String({ minLength: 1 })),
});

const profile = object({
  provider: StringEnum([
    "openai",
    "openai-codex",
    "anthropic",
    "google",
    chatGptWebProviderId,
  ] as const),
  model: Type.String({ minLength: 1 }),
  reasoning,
  baseUrl: Type.Optional(Type.String({ minLength: 1 })),
  apiKeyEnv: Type.Optional(Type.String({ minLength: 1 })),
  transport: Type.Optional(
    StringEnum(["sse", "websocket", "websocket-cached"] as const),
  ),
});
export const settingsSchema = object({
  profiles: object({
    default: profile,
    ...Type.Record(Type.Enum(profileNames), Type.Optional(profile)).properties,
  }),
  maxExplorerResponses: Type.Optional(positiveIntegerSchema),
  maxExplorerReads: Type.Optional(positiveIntegerSchema),
  literature: Type.Optional(Type.Boolean()),
  research: Type.Optional(researchSchema),
  codex: Type.Optional(
    object({
      ...researchSchema.properties,
      workspace: Type.String({ minLength: 1 }),
    }),
  ),
  usagePrefix: Type.Optional(
    Type.String({
      pattern: "^[a-zA-Z0-9][a-zA-Z0-9_.:/@+-]*$",
      maxLength: 91,
    }),
  ),
  limits: Type.Optional(
    Type.Partial(limitsSchema, { additionalProperties: false }),
  ),
});
export type Settings = Static<typeof settingsSchema>;
export function readSettings(value: unknown): Settings {
  const settings = decode(settingsSchema, value);
  if (settings.codex && !isAbsolute(settings.codex.workspace))
    throw new Error("codex.workspace must be an absolute directory");
  // The scarce browser subscription must never become a fallback or verifier.
  for (const [name, profile] of Object.entries(settings.profiles)) {
    if (profile) assertProfileProvider(name, profile.provider);
    const endpoint = profile?.baseUrl;
    if (!endpoint) continue;
    const url = new URL(endpoint);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "baseUrl must be an HTTP(S) endpoint without credentials, query, or fragment",
      );
  }
  if (settings.profiles.explorer?.provider === chatGptWebProviderId) {
    settings.maxExplorerResponses = chatGptResponseLimit(
      settings.maxExplorerResponses,
    );
  }
  return settings;
}

export function piRuntime(settings: Settings, key?: string): PiRuntime {
  settings = readSettings(settings);
  const models = createModels();
  models.setProvider(openaiProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(googleProvider());
  models.setProvider(chatGptWebProvider());
  models.setProvider({
    ...openaiCodexProvider(),
    auth: { apiKey: envApiKeyAuth("Codex gateway", []) },
  });
  const profiles = Object.fromEntries(
    profileNames.map((name) => {
      const configured = settings.profiles[name] ?? settings.profiles.default;
      const configuredKey = configured.apiKeyEnv
        ? process.env[configured.apiKeyEnv]
        : undefined;
      if (configured.apiKeyEnv && !configuredKey?.trim())
        throw new Error(
          `Missing provider credential environment variable: ${configured.apiKeyEnv}`,
        );
      const base = models.getModel(configured.provider, configured.model);
      if (!base)
        throw new Error(
          `Unknown Pi model: ${configured.provider}/${configured.model}`,
        );
      const model = {
        ...base,
        ...(configured.baseUrl ? { baseUrl: configured.baseUrl } : {}),
        ...(configured.provider === "openai-codex" &&
        configured.baseUrl &&
        !/(^|\.)chatgpt\.com$/i.test(new URL(configured.baseUrl).hostname)
          ? { compat: { ...base.compat, codexProxyAuth: true } }
          : {}),
      };
      const options: SimpleStreamOptions = {
        reasoning: configured.reasoning ?? defaultReasoning,
        transport: configured.transport,
        apiKey: configured.apiKeyEnv
          ? configuredKey
          : configured.provider === chatGptWebProviderId
            ? undefined
            : key,
      };
      return [name, { model, options } satisfies Profile];
    }),
  ) as Record<ProfileName, Profile>;
  return {
    models,
    profiles,
    usagePrefix: settings.usagePrefix,
  };
}
