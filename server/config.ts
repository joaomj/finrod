import { resolve } from "node:path";

export type Config = {
  readonly port: number;
  readonly dataDir: string;
  readonly profile: string;
  readonly model: string;
};

/** Read and validate settings from the environment; throw with the setting name and the fix. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = Number(env.FINROD_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`FINROD_PORT must be a TCP port number (1-65535); got "${env.FINROD_PORT}".`);
  }
  if (!env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set. Provide the OpenRouter API key in the service environment.");
  }
  const profile = env.FINROD_PROFILE ?? "default";
  if (!/^[a-z0-9-]+$/.test(profile)) {
    throw new Error(`FINROD_PROFILE must use lowercase letters, digits, and hyphens; got "${profile}".`);
  }
  return {
    port,
    dataDir: resolve(env.FINROD_DATA_DIR ?? ".finrod"),
    profile,
    model: env.FINROD_MODEL ?? "deepseek/deepseek-v4.1-flash-1017",
  };
}
