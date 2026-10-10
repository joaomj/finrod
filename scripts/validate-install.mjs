import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseEnv } from "node:util";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import { loadConfig } from "../dist/config.js";

try {
  if (process.argv.length !== 3) throw new Error("Pass the private environment-file path to validate-install.mjs.");
  const env = parseEnv(readFileSync(process.argv[2], "utf8"));
  const config = loadConfig(env);
  const providers = {
    openrouter: { factory: openrouterProvider, key: "OPENROUTER_API_KEY" },
    anthropic: { factory: anthropicProvider, key: "ANTHROPIC_API_KEY" },
    openai: { factory: openaiProvider, key: "OPENAI_API_KEY" },
  };
  if (!Object.hasOwn(providers, config.model.provider)) {
    throw new Error("FINROD_MODEL_PROVIDER: set openrouter, anthropic, or openai.");
  }
  const provider = providers[config.model.provider];
  if (!env[provider.key]?.trim()) throw new Error(`${provider.key}: add the credential for the configured chat provider.`);
  const models = createModels();
  models.setProvider(provider.factory());
  if (!models.getModel(config.model.provider, config.model.modelId)) {
    throw new Error("FINROD_MODEL: choose a model available in the configured provider's pinned Pi catalog.");
  }
  process.stdout.write(`${resolve(config.dataDir)}\n`);
} catch (error) {
  // Do not include file content or credential values in installer diagnostics.
  console.error(error instanceof Error ? error.message : "Installation configuration validation failed.");
  process.exitCode = 1;
}
