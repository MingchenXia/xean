import { resolve } from "node:path";
import { createRuntime, readSettings } from "../../src/roles/config.ts";
import { cliModels } from "./models.ts";

/** Local setup only: never creates a campaign or invokes a provider or an external backend. */
export async function doctor(settingsPath: string, key?: string) {
  try {
    let value: unknown;
    try {
      value = await Bun.file(resolve(settingsPath)).json();
    } catch {
      // JSON parser errors can quote the input, including credential material.
      throw new Error(`Cannot read settings JSON: ${resolve(settingsPath)}`);
    }
    const settings = readSettings(value);
    const { models, profiles } = createRuntime(settings, {
      models: await cliModels(),
      key,
    });
    for (const { model, checkAuth } of Object.values(profiles)) {
      if (!models.getModel(model.provider, model.modelId))
        throw new Error(`Unknown Pi model: ${model.provider}/${model.modelId}`);
      const available = await checkAuth!().catch(() => {
        throw new Error(
          `Could not check ${model.provider} credential availability.`,
        );
      });
      if (!available)
        throw new Error(`No ${model.provider} credential is available.`);
    }
    return {
      ok: true,
      message:
        "Local Pi setup checks passed. Provider authentication and optional backend configuration were not checked.",
    };
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : "Setup check failed",
    };
  }
}
