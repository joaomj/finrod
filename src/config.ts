import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";

type Environment = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Environment = process.env) {
  const required = (name: string): string => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name}: set a nonempty value in the service environment.`);
    return value;
  };
  const endpoint = (name: string, fallback: string): string => {
    let url: URL;
    try {
      url = new URL(env[name] ?? fallback);
    } catch (cause) {
      throw new Error(`${name}: set an absolute HTTP or HTTPS URL.`, { cause });
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) {
      throw new Error(`${name}: use HTTPS, or HTTP on localhost for a local provider.`);
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(`${name}: remove credentials, query parameters, and fragments from the URL.`);
    }
    return url.href.replace(/\/$/, "");
  };

  const owner = required("TELEGRAM_OWNER_ID");
  const ownerId = Number(owner);
  if (!/^[1-9]\d*$/.test(owner) || !Number.isSafeInteger(ownerId)) {
    throw new Error("TELEGRAM_OWNER_ID: set your positive numeric Telegram user ID.");
  }
  const dataDir = env.FINROD_DATA_DIR ?? join(homedir(), ".local", "share", "finrod");
  if (!isAbsolute(dataDir)) {
    throw new Error("FINROD_DATA_DIR: set an absolute directory outside the application checkout.");
  }
  const transcriptionProvider = env.TRANSCRIPTION_PROVIDER ?? "openrouter";
  if (transcriptionProvider !== "openrouter" && transcriptionProvider !== "openai-compatible") {
    throw new Error("TRANSCRIPTION_PROVIDER: set openrouter or openai-compatible.");
  }
  const transcriptionBaseUrl = transcriptionProvider === "openrouter"
    ? "https://openrouter.ai/api/v1"
    : endpoint("TRANSCRIPTION_BASE_URL", "http://127.0.0.1:8000/v1");

  return {
    dataDir,
    telegram: { token: required("TELEGRAM_BOT_TOKEN"), ownerId },
    model: { provider: required("FINROD_MODEL_PROVIDER"), modelId: required("FINROD_MODEL") },
    exa: { apiKey: required("EXA_API_KEY") },
    transcription: {
      provider: transcriptionProvider,
      baseUrl: transcriptionBaseUrl,
      model: env.TRANSCRIPTION_MODEL?.trim() || (transcriptionProvider === "openrouter" ? "openai/whisper-large-v3" : "whisper-1"),
      apiKey: transcriptionProvider === "openrouter"
        ? required("OPENROUTER_API_KEY")
        : env.TRANSCRIPTION_API_KEY?.trim(),
      zdr: transcriptionProvider === "openrouter",
    },
  };
}

export type Config = ReturnType<typeof loadConfig>;
