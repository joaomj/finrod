import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { createRegistry, defineDoc, defineExtension, Harness, section, watchEvents, type EntryRecord } from "@earendil-works/pi-durable";
import { SqliteStorage } from "@earendil-works/pi-durable/storage/sqlite";
import { openBrowserDatabase } from "./storage.js";

export const MODEL = "openai/gpt-4o-mini";
const turn = defineDoc<{ status: "idle" | "pending" | "interrupted" | "failed" }>({
  kind: "finrod.browser-turn", version: 1, scope: "conversation", history: "latest", fork: "initial",
  initial: () => ({ status: "idle" }),
});
export type ChatMessage = { role: "user" | "assistant"; text: string; partial: boolean; error?: string };

function displayed(message: Message, partial = false): ChatMessage[] {
  if (message.role === "user") {
    const text = typeof message.content === "string" ? message.content : message.content.flatMap(b => b.type === "text" ? [b.text] : []).join("\n");
    return [{ role: "user", text, partial }];
  }
  if (message.role !== "assistant") return [];
  const text = message.content.flatMap(b => b.type === "text" ? [b.text] : []).join("\n");
  const error = message.stopReason === "error" || message.stopReason === "aborted" ? "Answer interrupted or failed; it is not complete." : undefined;
  return text || error ? [{ role: "assistant", text, partial, ...(error ? { error } : {}) }] : [];
}

export async function openBrowserAssistant(render: (messages: ChatMessage[]) => void, report: (message: string) => void) {
  let key = "";
  let stopped = false;
  const safeError = (error: unknown): string => {
    const text = error instanceof Error ? error.message : String(error);
    return key ? text.split(key).join("[redacted]") : text;
  };
  const provider = openrouterProvider();
  // No credential is read from disk, IndexedDB, build-time environment, or the website.
  const models = createModels({ authContext: { env: async () => undefined, fileExists: async () => false } });
  models.setProvider({ ...provider, auth: { apiKey: { name: "OpenRouter session key", resolve: async () => key ? { auth: { apiKey: key } } : undefined } } });
  if (!models.getModel("openrouter", MODEL)) throw new Error(`Browser model ${MODEL} is absent from the pinned Pi catalog.`);
  const registry = createRegistry();
  registry.install(defineExtension({ name: "finrod-browser", sections: [section("finrod", () =>
    "You are Finrod, a personal conversational assistant. Be concise and honest about uncertainty. Reply in the user's language. This prototype has no tools, web access, or imported sources; do not claim otherwise.")] }));
  const database = await openBrowserDatabase();
  let storage: SqliteStorage;
  try { storage = await SqliteStorage.open(database); }
  catch (error) {
    try { await database.close(); }
    catch (closeError) { throw new AggregateError([error, closeError], "Browser storage initialization and cleanup failed."); }
    throw error;
  }
  let harness: Harness | undefined;
  try {
    harness = await Harness.open(storage, { models, registry, onReport: error => report(safeError(error)),
      settings: { retry: { maxRetries: 0 }, stream: { timeoutMs: 120_000 }, progress: { partialIntervalMs: 500 }, compaction: { enabled: false } },
    }, context);
    const root = await harness.root(context, { agent: { model: { provider: "openrouter", modelId: MODEL }, tools: [] } });
    const previous = await harness.snapshot(turn, root.id, context);
    // No key is available during recovery. Cancel unfinished work rather than resume a paid request.
    await root.abort(context, { background: true });
    const interrupted = previous?.status === "pending" || previous?.status === "interrupted";
    if (previous?.status === "pending") await root.commit(async tx => { (await tx.doc(turn, root.id)).status = "interrupted"; }, context);
    await root.configure({ model: { provider: "openrouter", modelId: MODEL }, tools: [] }, context);
    const stream = await watchEvents(harness, root.id, context);
    let entries = new Map<number, EntryRecord>(stream.snapshot.entries.map(entry => [entry.id, entry]));
    let partial: AssistantMessage | undefined = stream.snapshot.generation?.message;
    const refresh = () => render([
      ...[...entries.values()].flatMap(entry => (entry.model ?? []).flatMap(message => displayed(message))),
      ...(partial ? displayed(partial, true) : []),
    ]);
    refresh();
    stream.start(async events => {
      for (const event of events) {
        if (event.type === "snapshot") {
          entries = new Map(event.entries.map(entry => [entry.id, entry]));
          partial = event.generation?.message;
        } else if (event.type === "entry_appended" || event.type === "message_end") {
          entries.set(event.entry.id, event.entry);
          if (event.type === "message_end") partial = undefined;
        } else if (event.type === "message_start" && event.message.role === "assistant") {
          partial = structuredClone(event.message);
        } else if (event.type === "message_update" && partial) {
          for (const change of event.changes) {
            if (change.type === "message") partial = structuredClone(change.message);
            else if (change.type === "block" || change.type.endsWith("_start")) {
              if ("block" in change) partial.content[change.contentIndex] = structuredClone(change.block);
            } else if (change.type === "text_delta") {
              const block = partial.content[change.contentIndex];
              if (block?.type === "text") block.text += change.delta;
            }
          }
        }
      }
      refresh();
    });
    const opened = harness;
    return {
      interrupted,
      failed: previous?.status === "failed",
      async send(text: string, sessionKey: string) {
        if (!sessionKey.trim()) throw new Error("Enter your own OpenRouter API key. It is used only while this page is open.");
        if (!text.trim()) throw new Error("Enter a message.");
        if (text.length > 20_000) throw new Error("This prototype accepts messages of at most 20,000 characters.");
        key = sessionKey.trim();
        stopped = false;
        await root.commit(async tx => { (await tx.doc(turn, root.id)).status = "pending"; }, context);
        try {
          if (stopped || document.visibilityState === "hidden") throw new Error("Request interrupted before it started. Keep Finrod open to send a message.");
          const submission = await root.submit({ type: "input", content: text.trim(), requestId: `browser:${crypto.randomUUID()}`, whenBusy: "reject" }, context);
          const result = await submission.wait(context);
          if (result.status !== "done") throw new Error(`Answer did not complete: ${result.reason}. ${JSON.stringify(result.detail ?? "No provider detail")}`);
          await root.commit(async tx => { (await tx.doc(turn, root.id)).status = "idle"; }, context);
        } catch (error) {
          const original = new Error(safeError(error), { cause: error });
          try { await root.commit(async tx => { (await tx.doc(turn, root.id)).status = "failed"; }, context); }
          catch (saveError) { throw new AggregateError([original, saveError], "Request failed and its failure state could not be saved. Reload Finrod."); }
          throw original;
        }
      },
      async interrupt() {
        stopped = true;
        await root.abort(context, { background: true });
        await root.commit(async tx => { (await tx.doc(turn, root.id)).status = "interrupted"; }, context);
      },
      async close() { key = ""; await stream.stop(); await opened.close(context); },
    };
  } catch (error) {
    try { if (harness) await harness.close(context); else await storage.close(context); }
    catch (closeError) { throw new AggregateError([error, closeError], "Browser runtime initialization and cleanup failed."); }
    throw error;
  }
}
