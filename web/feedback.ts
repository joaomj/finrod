import type { History, SavedMessage } from "./history.js";

export type Vote = "up" | "down";
export type Feedback = { message_index: number; vote: Vote; comment: string; createdAt: number; updatedAt: number };

export function rateable(message: SavedMessage | undefined): boolean {
  return message?.role === "assistant" && message.stopReason !== "toolUse" &&
    message.content.some(block => block.type === "text" && !!block.text.trim());
}
export function parseFeedback(value: unknown, history: History): Feedback[] {
  if (value === undefined) return [];
  const fail = (): never => { throw new Error("Unsupported or damaged Finrod feedback. Your current history has not been replaced."); };
  if (!Array.isArray(value)) return fail();
  const seen = new Set<number>();
  return value.map((entry): Feedback => {
    if (!entry || typeof entry !== "object" || !Number.isSafeInteger(entry.message_index) || entry.message_index < 0 ||
        seen.has(entry.message_index) || !rateable(history.messages[entry.message_index]) ||
        !["up", "down"].includes(entry.vote) || typeof entry.comment !== "string" || entry.comment.length > 2000 ||
        (entry.vote === "up" && entry.comment !== "") || !Number.isFinite(entry.createdAt) || !Number.isFinite(entry.updatedAt)) fail();
    seen.add(entry.message_index);
    return { message_index: entry.message_index, vote: entry.vote, comment: entry.comment, createdAt: entry.createdAt, updatedAt: entry.updatedAt };
  });
}
