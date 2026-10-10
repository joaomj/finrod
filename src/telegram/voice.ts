import { setTimeout as delay } from "node:timers/promises";

const transientCodes = new Set([
  "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_RES_CONTENT_LENGTH_MISMATCH", "UND_ERR_SOCKET", "ECONNRESET", "ETIMEDOUT", "EAI_AGAIN", "ENETUNREACH",
]);

function transient(error: unknown): boolean {
  if (error instanceof DOMException && error.name === "TimeoutError") return true;
  if (!(error instanceof Error)) return false;
  if ("code" in error && typeof error.code === "string" && transientCodes.has(error.code)) return true;
  if (error instanceof AggregateError) return error.errors.length > 0 && error.errors.every(transient);
  return error.cause !== undefined && transient(error.cause);
}

export async function downloadVoice(url: string): Promise<Uint8Array> {
  const attempts = 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: "error" });
      if (!response.ok) throw new Error(`Telegram voice download failed (HTTP ${response.status}).`);
      if (!response.body) throw new Error("Telegram returned an empty voice download.");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 20 * 1024 * 1024) throw new Error("Voice note exceeds the 20 MiB download limit.");
        chunks.push(chunk);
      }
      if (size === 0) throw new Error("Telegram returned an empty voice download.");
      return Buffer.concat(chunks);
    } catch (cause) {
      if (attempt === attempts || !transient(cause)) {
        throw new Error(`Telegram voice download failed after ${attempt} attempt(s).`, { cause });
      }
      console.warn(`Telegram voice download interrupted; retrying (${attempt + 1}/${attempts}).`);
      await delay(attempt * 1000);
    }
  }
  throw new Error("Telegram voice download exhausted its attempts.");
}
