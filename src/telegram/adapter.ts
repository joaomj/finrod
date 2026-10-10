import { Api, GrammyError } from "grammy";
import type { AssistantReply, ReplyMetadata } from "../reply.js";
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
  answer: (work: Work) => Promise<AssistantReply>;
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
          ...(delivery.rateable ? { reply_markup: { inline_keyboard: [[
            { text: "\u{1F44D}", callback_data: `feedback:${delivery.id}:up` },
            { text: "\u{1F44E}", callback_data: `feedback:${delivery.id}:down` },
          ]] } } : {}),
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
      let metadata: ReplyMetadata | undefined;
      if (work.text === "/start" || work.text === "/help") {
        reply = "Finrod is your private assistant. Send text or a voice note. Ask explicitly to save, resume, correct, or delete a topic. Use the buttons below an assistant reply to rate it. /status reports uncertain replies.";
      } else if (work.text === "/status") {
        const uncertain = store.uncertainDeliveries();
        reply = uncertain.length
          ? `Delivery is uncertain for ${uncertain.length} replies. These were not resent automatically.\n\n${uncertain.map(item => `[${item.id}] ${item.text}`).join("\n\n")}`
          : "Finrod is running. No uncertain replies.";
      } else {
        try {
          const result = await answer(work);
          reply = result.text;
          metadata = result.metadata;
        } catch (cause) {
          store.complete(work, ["I could not finish this message. It is recorded as failed, not completed successfully. Please send it again after the service issue is resolved."], true);
          await deliver();
          throw new Error(`Telegram update ${work.updateId} failed.`, { cause });
        }
      }
      store.complete(work, splitReply(reply), false, metadata);
      await deliver();
    }
    if (signal.aborted) break;
    const updates = await api.getUpdates({ offset: store.offset, timeout: 25, allowed_updates: ["message", "callback_query"] });
    for (const update of updates) {
      const callback = update.callback_query;
      if (!callback) {
        store.admit(update.update_id, authorizedMessage(update, ownerId));
        continue;
      }
      const match = /^feedback:([1-9][0-9]*):(up|down)$/.exec(callback.data ?? "");
      const message = callback.message;
      let accepted = false;
      if (callback.from.id === ownerId && message?.chat.type === "private" && match && Number.isSafeInteger(Number(match[1]))) {
        accepted = store.recordFeedback({
          updateId: update.update_id, deliveryId: Number(match[1]), chatId: message.chat.id,
          messageId: message.message_id, userId: ownerId, vote: match[2] as "up" | "down",
        });
      } else {
        store.admit(update.update_id);
      }
      try {
        await api.answerCallbackQuery(callback.id, { text: accepted
          ? "Feedback saved. You can change it with either button."
          : "Feedback is unavailable for this message or user." });
      } catch (error) {
        if (error instanceof GrammyError && error.error_code === 400 && /query is too old|query ID is invalid/i.test(error.description)) {
          console.warn("Feedback acknowledgement expired; recorded feedback is unchanged.");
        } else {
          throw new Error("Could not acknowledge feedback; any recorded vote remains saved.", { cause: error });
        }
      }
    }
  }
}
