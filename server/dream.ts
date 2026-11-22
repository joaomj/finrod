import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { ConversationId, Extension } from "@earendil-works/pi-durable";
import { withCanary, type Canary } from "./canary.js";
import type { ChatMessage, Threads } from "./chat.js";
import { importedLine, type ChatGPT } from "./chatgpt.js";
import { legacyMemories, retireLegacyMemories } from "./memories.js";
import type { Wiki } from "./wiki.js";
import cleanupPrompt from "./prompts/wiki-cleanup.md";
import schemaPrompt from "./prompts/wiki-schema.md";

/** How much conversation one run reads; a longer backlog, as on the first run, takes several runs. */
const MAX_INPUT_CHARS = 40_000;

/** Kind of the stream entry that lists, after a cleanup, the facts learned since the last recap. */
export const RECAP_KIND = "finrod.recap";

/** How far the wiki has read the stream, and the run in progress, kept across restarts. */
type DreamState = {
  /** The newest stream entry the wiki has taken in. */
  after: number;
  running?: { conversation: number; upTo: number; input: string; legacy: boolean; cleanup?: boolean; chatgptUpTo?: number };
  /** After a failed run, the next one waits until then. */
  retryAt?: number;
  /** When the last cleanup, or the first update, finished; the next cleanup is due `cleanupMs` later. */
  cleanedAt?: number;
  /** The newest message of the ChatGPT import the wiki has taken in. */
  chatgptAfter?: number;
  /** The updates that read the ChatGPT import, oldest first, so all of them can be undone. */
  chatgptChanges?: number[];
};

type DreamingOptions = {
  readonly threads: Threads;
  readonly wiki: Wiki;
  readonly model: { provider: string; modelId: string };
  readonly extensions: readonly Extension[];
  readonly idleMs: number;
  readonly cleanupMs: number;
  readonly profileDir: string;
  readonly passphrase: string;
  readonly chatgpt: ChatGPT | undefined;
  readonly canary: Canary | undefined;
};

/**
 * Updates the wiki after the conversation, never during it: once the stream has been quiet for `idleMs`, a separate
 * conversation reads what was said since the last run and edits the pages. Its changes go to the user as one entry.
 */
export class Dreaming {
  private ticking = false;
  private readonly statePath: string;

  constructor(private readonly options: DreamingOptions) {
    this.statePath = join(options.profileDir, "dream.json");
  }

  start() {
    void this.tick();
    setInterval(() => void this.tick(), Math.min(this.options.idleMs, 60_000)).unref();
  }

  private async tick() {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.step();
    } catch (error) {
      // Messages and pages never reach the log; errors here name the step.
      console.error(`Updating the wiki failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.ticking = false;
    }
  }

  private async step() {
    const { threads, wiki, model, extensions, idleMs, cleanupMs, profileDir, passphrase, chatgpt } = this.options;
    const state = await this.state();
    if (state.running) return this.finish(state, state.running);
    if (state.retryAt && Date.now() < state.retryAt) return;
    const { messages: said, busy } = await threads.activity(await threads.stream());
    let budget = MAX_INPUT_CHARS;
    const fresh = said.filter((message) => message.id > state.after).filter((message, n) => (budget -= message.text.length) >= 0 || n === 0);
    const legacy = await legacyMemories(profileDir, passphrase);
    if (legacy?.length === 0) await retireLegacyMemories(profileDir);
    // What the user wrote in ChatGPT waits until the wiki has read Finrod's own messages.
    const imported = (!fresh.length && !legacy?.length && chatgpt?.userMessages(state.chatgptAfter ?? 0, MAX_INPUT_CHARS)) || [];
    // A cleanup reads no new messages: it checks the pages themselves, once in a while.
    const cleanup = !fresh.length && !legacy?.length && !imported.length && state.cleanedAt !== undefined && Date.now() - state.cleanedAt >= cleanupMs;
    if (!fresh.length && !legacy?.length && !imported.length && !cleanup) return;
    if ((fresh.length || imported.length || cleanup) && (busy || Date.now() - (said.at(-1)?.at ?? 0) < idleMs)) return;

    const { core, index } = await wiki.overview();
    if (cleanup && !core && !index) return this.save({ ...state, cleanedAt: Date.now() });
    const input = [
      ...(cleanup ? [cleanupPrompt.trim()] : []),
      `core.md:\n${core || "(empty)"}`,
      `index.md:\n${index || "(empty)"}`,
      ...(legacy?.length ? [`Memories the user approved before the wiki:\n${legacy.map(({ id, text }) => `[memory ${id}] ${text}`).join("\n")}`] : []),
      ...(fresh.length ? [`Conversation since the last update:\n${fresh.map(line).join("\n")}`] : []),
      ...(imported.length ? [`What the user wrote in ChatGPT before Finrod, oldest first:\n${imported.map((message) => importedLine(message)).join("\n")}`] : []),
    ].join("\n\n");
    const conversation = await threads.harness.createConversation({ ownership: { kind: "ownerless" }, agent: { model, instructions: withCanary(schemaPrompt.trim(), this.options.canary), extensions } }, context);
    const running = { conversation: conversation.id, upTo: fresh.at(-1)?.id ?? state.after, input, legacy: legacy !== undefined, cleanup, ...(imported.length ? { chatgptUpTo: imported.at(-1)!.id } : {}) };
    await this.save({ ...state, running });
    await this.finish(state, running);
  }

  /** Wait for the run, recap the week's facts after a cleanup, and move past what it read. Safe to repeat after a restart. */
  private async finish(state: DreamState, running: NonNullable<DreamState["running"]>) {
    const { threads, wiki, idleMs, profileDir } = this.options;
    const conversation = await threads.harness.conversation(running.conversation as ConversationId, context);
    if (!conversation) throw new Error(`The wiki update conversation ${running.conversation} is missing.`);
    // The same request ID finds the submission a run before a restart made.
    const settled = await (await conversation.submit({ type: "input", content: running.input, requestId: "dream" }, context)).wait(context);
    const { running: _, retryAt: __, ...kept } = state;
    // A failed run may have changed pages too, so it is listed as well.
    if (running.chatgptUpTo) kept.chatgptChanges = [...(state.chatgptChanges ?? []), running.conversation];
    if (settled.status !== "done") {
      console.error(`Updating the wiki failed: the run ended ${settled.status}; trying again in ${Math.round(idleMs / 60_000)} min.`);
      await this.save({ ...kept, retryAt: Date.now() + idleMs });
      return;
    }
    if (running.cleanup) await this.recap(running.conversation);
    if (running.legacy) await retireLegacyMemories(profileDir);
    await this.save({
      ...kept,
      after: running.upTo,
      cleanedAt: running.cleanup ? Date.now() : (state.cleanedAt ?? Date.now()),
      ...(running.chatgptUpTo ? { chatgptAfter: running.chatgptUpTo } : {}),
    });
  }

  /**
   * Tell the user, as an answer in the stream, each fact the wiki holds that the last recap did not, numbered by page
   * (A1, A2, B1) so they can correct one by its number. The chat model and the next update read it with the reply.
   */
  private async recap(change: number) {
    const { threads, wiki, profileDir } = this.options;
    const seenPath = join(profileDir, "recap.json");
    let seen: Record<string, string[]> = {};
    try {
      seen = JSON.parse(await readFile(seenPath, "utf8")) as Record<string, string[]>;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error(`Reading ${seenPath} failed.`, { cause: error });
    }
    const facts = await wiki.facts();
    const fresh = [...facts].map(([path, all]) => [path, all.filter((fact) => !seen[path]?.includes(fact))] as const).filter(([, added]) => added.length);
    if (fresh.length) {
      const pages = fresh.map(([path, added], n) => [`**${label(n)}. ${path}**`, ...added.map((fact, m) => `- ${label(n)}${m + 1}. ${fact}`)].join("\n"));
      const text = ["Resumo da semana: o que aprendi sobre você.", ...pages, 'Para corrigir, responda, por exemplo, "remova A2" ou "B1: na verdade é ...".'].join("\n\n");
      const message: AssistantMessage = { role: "assistant", content: [{ type: "text", text }], api: "finrod", provider: "finrod", model: "recap", usage: NO_USAGE, stopReason: "stop", timestamp: Date.now() };
      const stream = await threads.harness.conversation((await threads.stream()) as ConversationId, context);
      await stream!.submit({ type: "write", entry: { kind: RECAP_KIND, model: [message], data: { text, at: message.timestamp } }, requestId: `wiki-recap-${change}` }, context);
    }
    await writeFile(`${seenPath}.tmp`, JSON.stringify(Object.fromEntries(facts)), { mode: 0o600 });
    await rename(`${seenPath}.tmp`, seenPath);
  }

  private async state(): Promise<DreamState> {
    try {
      return JSON.parse(await readFile(this.statePath, "utf8")) as DreamState;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return { after: 0 };
      throw new Error(`Reading ${this.statePath} failed.`, { cause: error });
    }
  }

  private async save(state: DreamState) {
    await writeFile(`${this.statePath}.tmp`, JSON.stringify(state), { mode: 0o600 });
    await rename(`${this.statePath}.tmp`, this.statePath);
  }
}

/** One message as the run reads it: its source number, time, and author. */
const NO_USAGE = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };

/** A page's letter in a recap: A to Z, then AA, AB, and on. */
function label(n: number): string {
  return (n >= 26 ? label(Math.floor(n / 26) - 1) : "") + String.fromCharCode(65 + (n % 26));
}

function line(message: ChatMessage): string {
  const at = new Date(message.at).toISOString().slice(0, 16).replace("T", " ");
  return `[#${message.id} ${at} ${message.role === "user" ? "user" : "Finrod"}] ${message.text}`;
}
