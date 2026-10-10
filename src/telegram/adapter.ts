import { Api } from "grammy";
import type { Update } from "grammy/types";
import { TelegramStore, type Incoming, type Work } from "./store.js";

export function authorizedMessage(update: Update, ownerId: number): Incoming | undefined {
  const message = update.message;
  if (!message || message.chat.type !== "private" || message.from?.id !== ownerId) return;
  if (!message.text && !message.voice) return;
  return {
    updateId: update.update_id,
    chatId: message.chat.id,
    messageId: message.message_id,
    ...(message.text ? { text: message.text } : {}),
    ...(message.voice ? { voiceFileId: message.voice.file_id } : {}),
  };
}

function splitReply(text: string): string[] {
  const chunks: string[] = [];
  let chunk = "";
  for (const character of text) {
    if (chunk.length + character.length > 4000) {
      chunks.push(chunk);
      chunk = "";
    }
    chunk += character;
  }
  if (chunk) chunks.push(chunk);
  if (!chunks.length) throw new Error("Assistant returned an empty reply.");
  return chunks;
}

export async function runTelegram(options: {
  api: Api;
  store: TelegramStore;
  ownerId: number;
  answer: (work: Work) => Promise<string>;
  signal: AbortSignal;
}): Promise<void> {
  const { api, store, ownerId, answer, signal } = options;
  const webhook = await api.getWebhookInfo();
  if (webhook.url) throw new Error("Telegram has a webhook: remove it before starting the polling service.");

  async function deliver(): Promise<void> {
    for (let delivery = store.nextDelivery(); delivery && !signal.aborted; delivery = store.nextDelivery()) {
      store.sending(delivery.id);
      let message;
      try {
        message = await api.sendMessage(delivery.chatId, delivery.text, {
          link_preview_options: { is_disabled: true },
        });
      } catch (cause) {
        store.uncertain(delivery.id);
        throw new Error(`Telegram delivery ${delivery.id} is uncertain; it will not be resent automatically.`, { cause });
      }
      store.delivered(delivery.id, message.message_id);
    }
  }

  while (!signal.aborted) {
    await deliver();
    for (let work = store.next(); work && !signal.aborted; work = store.next()) {
      let reply: string;
      if (work.text === "/start" || work.text === "/help") {
        reply = "Finrod is your private assistant. Send text or a voice note. Ask explicitly to save, resume, correct, or delete a topic. /status reports uncertain replies.";
      } else if (work.text === "/status") {
        const uncertain = store.uncertainDeliveries();
        reply = uncertain.length
          ? `Delivery is uncertain for ${uncertain.length} replies. These were not resent automatically.\n\n${uncertain.map(item => `[${item.id}] ${item.text}`).join("\n\n")}`
          : "Finrod is running. No uncertain replies.";
      } else {
        try {
          reply = await answer(work);
        } catch (cause) {
          store.complete(work, ["I could not finish this message. It is recorded as failed, not completed successfully. Please send it again after the service issue is resolved."], true);
          await deliver();
          throw new Error(`Telegram update ${work.updateId} failed.`, { cause });
        }
      }
      store.complete(work, splitReply(reply));
      await deliver();
    }
    if (signal.aborted) break;
    const updates = await api.getUpdates({ offset: store.offset, timeout: 25, allowed_updates: ["message"] });
    for (const update of updates) store.admit(update.update_id, authorizedMessage(update, ownerId));
  }
}
