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
import {
  chatGptWebProvider,
  chatGptWebProviderId,
} from "../providers/chatgpt-web.ts";
import {
  claudeCodeProvider,
  claudeCodeProviderId,
} from "../providers/claude-code.ts";
import { limitsSchema, positiveIntegerSchema } from "../types.ts";
import { decode, defaultReasoning, object } from "./contracts.ts";
import {
  profileNames,
  type PiRuntime,
  type Profile,
  type ProfileName,
} from "./pi.ts";
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
    chatGptWebProviderId,
    claudeCodeProviderId,
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
  // ChatGPT Pro is a scarce, browser-backed subscription. It is an explicit
  // one-shot Explorer backend, never a profile fallback or a verifier/oracle.
  // Keeping this check at the settings boundary prevents an omitted role
  // profile from silently assigning the scarce provider to every role.
  if (settings.profiles.default.provider === chatGptWebProviderId)
    throw new Error(
      "ChatGPT Web may only be configured explicitly for profiles.explorer; use a non-ChatGPT profiles.default",
    );
  for (const name of profileNames) {
    if (
      name !== "explorer" &&
      settings.profiles[name]?.provider === chatGptWebProviderId
    )
      throw new Error(
        `ChatGPT Web may only be configured explicitly for profiles.explorer, not profiles.${name}`,
      );
  }
  if (settings.profiles.explorer?.provider === chatGptWebProviderId) {
    if (
      settings.maxExplorerResponses !== undefined &&
      settings.maxExplorerResponses !== 1
    )
      throw new Error(
        "ChatGPT Web Explorer requires maxExplorerResponses=1; each browser response consumes scarce subscription capacity",
      );
    settings.maxExplorerResponses = 1;
  }
  for (const profile of Object.values(settings.profiles)) {
    if (
      profile?.provider === claudeCodeProviderId &&
      (profile.baseUrl || profile.apiKeyEnv || profile.transport)
    )
      throw new Error(
        "Claude Code profiles use local subscription auth and print mode; omit baseUrl, apiKeyEnv, and transport",
      );
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
  return settings;
}

export function piRuntime(settings: Settings, key?: string): PiRuntime {
  settings = readSettings(settings);
  const models = createModels();
  models.setProvider(openaiProvider());
  models.setProvider(anthropicProvider());
  models.setProvider(chatGptWebProvider());
  models.setProvider(claudeCodeProvider());
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
          : configured.provider === chatGptWebProviderId ||
              configured.provider === claudeCodeProviderId
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
