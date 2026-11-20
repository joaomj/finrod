import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export type Config = {
  readonly port: number;
  readonly dataDir: string;
  readonly profile: string;
  /** Where answers come from: OpenRouter, or the Claude Code login through pi-claude-directsdk. */
  readonly provider: Provider;
  readonly model: string;
  /** The model that updates the wiki, from the same provider; updates run offline, so it can be slower and stronger. */
  readonly wikiModel: string;
  /** Script that prints the transcript of the audio file it is given; voice is off without it. */
  readonly transcribeCommand?: string;
  /** Secret the Matrix gateway, Finrod's only client, sends with every request. */
  readonly gatewayToken: string;
  /** The passphrase of `memories.enc`, which holds the memories approved before the wiki. */
  readonly memoryPassphrase: string;
  /** How long the conversation stays quiet before Finrod updates the wiki from it. */
  readonly dreamIdleMs: number;
  /** How often Finrod checks the whole wiki against its sources, merges, and prunes. */
  readonly cleanupMs: number;
};

export const PROVIDERS = ["openrouter", "claude-directsdk"] as const;
export type Provider = (typeof PROVIDERS)[number];

/** Read and validate settings from the environment; throw with the setting name and the fix. */
export function loadConfig(env: NodeJS.ProcessEnv): Config {
  const port = Number(env.FINROD_PORT ?? "8787");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`FINROD_PORT must be a TCP port number (1-65535); got "${env.FINROD_PORT}".`);
  }
  const provider = (env.FINROD_PROVIDER ?? "openrouter") as Provider;
  if (!PROVIDERS.includes(provider)) {
    throw new Error(`FINROD_PROVIDER must be one of ${PROVIDERS.join(", ")}; got "${env.FINROD_PROVIDER}".`);
  }
  if (provider === "openrouter" && !env.OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set. Provide the OpenRouter API key in the service environment.");
  }
  const profile = env.FINROD_PROFILE ?? "default";
  if (!/^[a-z0-9-]+$/.test(profile)) {
    throw new Error(`FINROD_PROFILE must use lowercase letters, digits, and hyphens; got "${profile}".`);
  }
  const gatewayToken = env.FINROD_GATEWAY_TOKEN;
  if (!gatewayToken || !/^[A-Za-z0-9_-]{32,}$/.test(gatewayToken)) {
    throw new Error("FINROD_GATEWAY_TOKEN must be at least 32 letters, digits, '-', or '_'. Generate one with: openssl rand -hex 32");
  }
  if (!env.FINROD_MEMORY_KEY_FILE) {
    throw new Error("FINROD_MEMORY_KEY_FILE is not set. Point it at a file with the memory passphrase; on the server, finrod.service sets it.");
  }
  let memoryPassphrase: string;
  try {
    memoryPassphrase = readFileSync(env.FINROD_MEMORY_KEY_FILE, "utf8").replace(/\r?\n$/, "");
  } catch (error) {
    throw new Error(`FINROD_MEMORY_KEY_FILE "${env.FINROD_MEMORY_KEY_FILE}" is unreadable.`, { cause: error });
  }
  if (memoryPassphrase.length < 16) {
    throw new Error("FINROD_MEMORY_KEY_FILE must hold a passphrase of at least 16 characters. On the server, finrod-data.service provides it from Proton Pass.");
  }
  const idleSeconds = Number(env.FINROD_WIKI_IDLE_SECONDS ?? "1800");
  if (!Number.isInteger(idleSeconds) || idleSeconds < 1) {
    throw new Error(`FINROD_WIKI_IDLE_SECONDS must be a whole number of seconds, at least 1; got "${env.FINROD_WIKI_IDLE_SECONDS}".`);
  }
  const cleanupSeconds = Number(env.FINROD_WIKI_CLEANUP_SECONDS ?? String(7 * 24 * 3600));
  if (!Number.isInteger(cleanupSeconds) || cleanupSeconds < 1) {
    throw new Error(`FINROD_WIKI_CLEANUP_SECONDS must be a whole number of seconds, at least 1; got "${env.FINROD_WIKI_CLEANUP_SECONDS}".`);
  }
  const model = env.FINROD_MODEL ?? (provider === "openrouter" ? "deepseek/deepseek-v4.1-flash-1017" : "sonnet");
  return {
    port,
    model,
    wikiModel: env.FINROD_WIKI_MODEL ?? (provider === "openrouter" ? model : "opus"),
    dreamIdleMs: idleSeconds * 1000,
    cleanupMs: cleanupSeconds * 1000,
    memoryPassphrase,
    gatewayToken,
    ...(env.FINROD_TRANSCRIBE_COMMAND ? { transcribeCommand: resolve(env.FINROD_TRANSCRIBE_COMMAND) } : {}),
    dataDir: resolve(env.FINROD_DATA_DIR ?? ".finrod"),
    profile,
    provider,
  };
}
