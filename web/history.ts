import type { AssistantMessage, Message } from "@earendil-works/pi-ai";

export type SavedMessage = Exclude<Message, { role: "system" }>;
export type History = {
  format: "finrod-phone";
  version: 1;
  status: "idle" | "pending" | "interrupted" | "failed";
  messages: SavedMessage[];
  partial?: AssistantMessage;
};
export const emptyHistory = (): History => ({ format: "finrod-phone", version: 1, status: "idle", messages: [] });
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
function fail(): never { throw new Error("Unsupported or damaged Finrod backup. Your current history has not been replaced."); }

function message(value: unknown): asserts value is SavedMessage {
  if (!object(value) || !Number.isFinite(value.timestamp)) fail();
  if (value.role === "user" && typeof value.content === "string") return;
  if (!["user", "assistant", "toolResult"].includes(String(value.role)) || !Array.isArray(value.content)) fail();
  for (const block of value.content) {
    if (!object(block)) fail();
    if (block.type === "text" && typeof block.text === "string") continue;
    if (value.role === "assistant" && block.type === "thinking" && typeof block.thinking === "string") continue;
    if (value.role === "assistant" && block.type === "toolCall" && typeof block.id === "string" && typeof block.name === "string" && object(block.arguments)) continue;
    fail();
  }
  if (value.role === "assistant") {
    if (typeof value.api !== "string" || typeof value.provider !== "string" || typeof value.model !== "string" ||
        !["stop", "length", "toolUse", "error", "aborted"].includes(String(value.stopReason)) || !object(value.usage)) fail();
    for (const field of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]) {
      if (!Number.isFinite(value.usage[field]) || Number(value.usage[field]) < 0) fail();
    }
    if (!object(value.usage.cost)) fail();
    for (const field of ["input", "output", "cacheRead", "cacheWrite", "total"]) {
      if (!Number.isFinite(value.usage.cost[field]) || Number(value.usage.cost[field]) < 0) fail();
    }
  }
  if (value.role === "toolResult" && (typeof value.toolCallId !== "string" || typeof value.toolName !== "string" || typeof value.isError !== "boolean")) fail();
}

export function parseHistory(value: unknown): History {
  if (!object(value) || value.format !== "finrod-phone" || value.version !== 1 ||
      !["idle", "pending", "interrupted", "failed"].includes(String(value.status)) || !Array.isArray(value.messages)) fail();
  value.messages.forEach(message);
  if (value.partial !== undefined) { message(value.partial); if (value.partial.role !== "assistant") fail(); }
  // Copy only the supported envelope. Credentials and unrelated backup fields are not imported.
  return { format: "finrod-phone", version: 1, status: value.status as History["status"],
    messages: structuredClone(value.messages as SavedMessage[]),
    ...(value.partial ? { partial: structuredClone(value.partial as AssistantMessage) } : {}) };
}

export function recoverHistory(history: History): History {
  const recovered = structuredClone(history);
  if (history.status === "pending") recovered.status = "interrupted";
  if (recovered.partial) {
    recovered.messages.push({ ...recovered.partial, stopReason: "aborted", errorMessage: "Answer interrupted; it is incomplete." });
    delete recovered.partial;
    recovered.status = "interrupted";
  }
  const messages: SavedMessage[] = [];
  for (let i = 0; i < recovered.messages.length; i++) {
    const current = recovered.messages[i]!;
    messages.push(current);
    if (current.role !== "assistant") continue;
    const calls = current.content.filter(block => block.type === "toolCall");
    const results = new Set<string>();
    while (recovered.messages[i + 1]?.role === "toolResult") {
      const result = recovered.messages[++i]!;
      if (result.role === "toolResult") results.add(result.toolCallId);
      messages.push(result);
    }
    for (const call of calls) if (!results.has(call.id)) {
      messages.push({ role: "toolResult", toolCallId: call.id, toolName: call.name, isError: true,
        content: [{ type: "text", text: "Tool call interrupted. It was not automatically retried." }], timestamp: Date.now() });
      recovered.status = "interrupted";
    }
  }
  recovered.messages = messages;
  return recovered;
}
