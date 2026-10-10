import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Api } from "grammy";
import { describeError } from "./errors.js";
import { loadConfig } from "./config.js";
import { openAssistant } from "./runtime.js";
import { transcribe } from "./transcription.js";
import { runTelegram } from "./telegram/adapter.js";
import { TelegramStore } from "./telegram/store.js";
import { downloadVoice } from "./telegram/voice.js";

async function main(): Promise<void> {
  process.umask(0o077);
  const config = loadConfig();
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const lock = new DatabaseSync(join(config.dataDir, "process-lock.sqlite"));
  try {
    lock.exec("BEGIN EXCLUSIVE");
  } catch (cause) {
    lock.close();
    throw new Error("FINROD_DATA_DIR: another Finrod process owns this directory, or its lock database cannot be opened.", { cause });
  }
  let store: TelegramStore | undefined;
  let assistant: Awaited<ReturnType<typeof openAssistant>> | undefined;
  const controller = new AbortController();
  const shutdown = () => controller.abort();
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
  try {
    store = new TelegramStore(join(config.dataDir, "telegram.sqlite"));
    const api = new Api(config.telegram.token);
    const identity = await api.getMe();
    store.bind(identity.id, config.telegram.ownerId);
    assistant = await openAssistant(config);
    const activeAssistant = assistant;
    const activeStore = store;
    console.log(`Finrod is running as @${identity.username}.`);
    await runTelegram({
      api, store, ownerId: config.telegram.ownerId, signal: controller.signal,
      answer: async work => {
        let text = work.text ?? work.transcript;
        if (!text && work.voiceFileId) {
          const file = await api.getFile(work.voiceFileId);
          if (!file.file_path) throw new Error("Telegram returned no path for the voice note.");
          if (file.file_size && file.file_size > 20 * 1024 * 1024) throw new Error("Voice note exceeds the 20 MiB download limit.");
          const audio = await downloadVoice(`https://api.telegram.org/file/bot${config.telegram.token}/${file.file_path}`);
          text = await transcribe(audio, config.transcription);
          activeStore.transcribed(work.updateId, text);
        }
        if (!text) throw new Error(`Telegram update ${work.updateId} has no text or transcript.`);
        return activeAssistant.answer(text, `telegram:${identity.id}:${work.updateId}`);
      },
    });
  } finally {
    process.removeListener("SIGINT", shutdown);
    process.removeListener("SIGTERM", shutdown);
    try {
      if (assistant) await assistant.close();
    } finally {
      try { store?.close(); } finally { lock.close(); }
    }
  }
}

main().catch(error => {
  console.error("Finrod stopped:", describeError(error));
  process.exitCode = 1;
});
