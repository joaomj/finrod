import type { Config } from "./config.js";

export async function transcribe(audio: Uint8Array, config: Config["transcription"]): Promise<string> {
  const headers: Record<string, string> = {};
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;
  let body: BodyInit;
  let path: string;
  if (config.provider === "openrouter") {
    path = "/audio/transcriptions";
    headers["Content-Type"] = "application/json";
    body = JSON.stringify({
      model: config.model,
      language: config.language,
      provider: { zdr: true },
      response_format: "json",
      input_audio: { data: Buffer.from(audio).toString("base64"), format: "ogg" },
    });
  } else {
    path = "/audio/transcriptions";
    const form = new FormData();
    form.set("model", config.model);
    form.set("language", config.language);
    form.set("file", new Blob([new Uint8Array(audio)], { type: "audio/ogg" }), "voice.ogg");
    form.set("response_format", "json");
    body = form;
  }
  const response = await fetch(`${config.baseUrl}${path}`, {
    method: "POST", headers, body, signal: AbortSignal.timeout(120_000), redirect: "error",
  });
  if (!response.ok) {
    throw new Error(`Transcription failed (HTTP ${response.status}). Check TRANSCRIPTION_MODEL, provider credentials, and ZDR endpoint availability.`);
  }
  const result = await response.json() as { text?: unknown };
  const text = result.text;
  if (typeof text !== "string" || !text.trim()) throw new Error("Transcription provider returned no text transcript.");
  return text.trim();
}
