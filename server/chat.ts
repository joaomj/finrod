import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import { createDirectSdkProvider } from "pi-claude-directsdk/src/provider.js";
import { closeAllSessions } from "pi-claude-directsdk/src/sdk/stream.js";
import {
  createRegistry,
  defineDoc,
  Harness,
  type ConversationId,
  type ConversationView,
  type HarnessSettings,
  type LiveState,
  type Registry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Config } from "./config.js";
import { ChatGPT } from "./chatgpt.js";
import { clock } from "./clock.js";
import { Dreaming, WIKI_CHANGE_KIND } from "./dream.js";
import { legacyMemories } from "./memories.js";
import { research } from "./research.js";
import { Search, searching } from "./search.js";
import { Voice } from "./voice.js";
import { Wiki, wikiTools, type PageChange } from "./wiki.js";
import finrodPrompt from "./prompts/finrod.md";
import wikiPrompt from "./prompts/wiki.md";

/** The model's instructions: Finrod's rules, the core page, and the index of the other pages. */
async function instructionsFor(wiki: Wiki): Promise<string> {
  const { core, index } = await wiki.overview();
  const notes = wikiPrompt.trim().replace("{{core}}", () => core || "(empty)").replace("{{index}}", () => index || "(empty)");
  return `${finrodPrompt.trim()}\n\n${notes}`;
}

/** Finrod's own index of conversations, newest first. The newest one is the user's stream. */
const ConversationIndex = defineDoc<{ items: { id: number }[] }>({
  kind: "finrod.conversations",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
});

export type Source = { title: string; url: string };
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  /** Milliseconds since the epoch when the message was written. */
  at: number;
  text: string;
  error?: string;
  sources?: Source[];
  /** Seconds of speech a spoken message was transcribed from. */
  voice?: number;
  /** What a wiki update changed; the entry has no text. */
  wiki?: { change: number; pages: PageChange[] };
};
/** Kind of an input that carries more than its text, such as the length of the voice note it came from. */
const MESSAGE_KIND = "finrod.message";
type MessageData = { text: string; voice?: number };
export type LiveStatus = { busy: boolean; partial?: string; retry?: string; tool?: string };

type ThreadsOpen = {
  readonly models: Models;
  readonly registry: Registry;
  readonly model: { provider: string; modelId: string };
  readonly storage: Awaited<ReturnType<typeof openNodeSqliteStorage>>;
  readonly settings: HarnessSettings;
  readonly wiki: Wiki;
};

/** The conversations of the profile's SQLite file. */
export class Threads {
  private constructor(
    readonly harness: Harness,
    private readonly model: { provider: string; modelId: string },
    private readonly wiki: Wiki,
  ) {}

  private creating: Promise<number> | undefined;

  static async open(open: ThreadsOpen): Promise<Threads> {
    const harness = await Harness.open(open.storage, { models: open.models, registry: open.registry, settings: open.settings }, context);
    harness.resume();
    return new Threads(harness, open.model, open.wiki);
  }

  /** Settles when the store closes; `failed` means the process must restart. */
  get closed() {
    return this.harness.closed;
  }

  close() {
    return this.harness.close(context);
  }

  /** The user's stream: the newest conversation, created on first use. */
  async stream(): Promise<number> {
    const items = (await this.harness.snapshot(ConversationIndex, context))?.items ?? [];
    if (items[0]) return items[0].id;
    this.creating ??= this.create().finally(() => {
      this.creating = undefined;
    });
    return this.creating;
  }

  private async create(): Promise<number> {
    const instructions = await instructionsFor(this.wiki);
    const conversation = await this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: this.model, instructions },
        init: async (tx, id) => {
          (await tx.doc(ConversationIndex)).items.unshift({ id });
        },
      },
      context,
    );
    return conversation.id;
  }

  /**
   * Admit a message; a repeated `requestId` returns the original submission instead of sending twice. The core page
   * and the wiki's index reach the model through its instructions. A conversation keeps the model it was created with, so a
   * changed `FINROD_PROVIDER` or `FINROD_MODEL` is written to it here.
   */
  async send(id: number, text: string, requestId: string, voice?: number): Promise<boolean> {
    const conversation = await this.harness.conversation(id as ConversationId, context);
    if (!conversation) return false;
    const instructions = await instructionsFor(this.wiki);
    const agent = await conversation.agent(context);
    const sameModel = agent.model?.provider === this.model.provider && agent.model.modelId === this.model.modelId;
    if (!sameModel || agent.instructions !== instructions) {
      await conversation.configure({ model: this.model, instructions }, context);
    }
    const draft =
      voice === undefined
        ? { type: "input" as const, content: text, requestId }
        : { type: "input" as const, content: text, requestId, entry: { kind: MESSAGE_KIND, data: { text, voice } satisfies MessageData } };
    await conversation.submit(draft, context);
    return true;
  }

  /** The answers in one conversation after entry `after`, oldest first. */
  async answersAfter(id: number, after: number): Promise<ChatMessage[] | undefined> {
    const conversation = await this.harness.conversation(id as ConversationId, context);
    if (!conversation) return undefined;
    const view = await conversation.viewState(context);
    const messages = messagesOf(view.value);
    view.dispose();
    return messages.filter((message) => message.role === "assistant" && message.id > after);
  }

  /** Every message of one conversation, and whether Finrod is answering. */
  async activity(id: number): Promise<{ messages: ChatMessage[]; busy: boolean }> {
    const conversation = await this.harness.conversation(id as ConversationId, context);
    if (!conversation) throw new Error(`Conversation ${id} is missing.`);
    const view = await conversation.viewState(context);
    const activity = { messages: messagesOf(view.value), busy: liveOf(view.value).busy };
    view.dispose();
    return activity;
  }

  /** Follow one conversation; `onView` gets the current view, then every committed change. */
  async watch(id: number, onView: (view: ConversationView) => void): Promise<(() => Promise<unknown>) | undefined> {
    const conversation = await this.harness.conversation(id as ConversationId, context);
    if (!conversation) return undefined;
    const watch = await conversation.watch(context);
    onView(watch.value);
    watch.start(async (view) => onView(view));
    return () => watch.stop();
  }
}

/** Everything the HTTP layer needs: the conversations, the wiki, voice, and the gateway's delivery cursor. */
export class Chat {
  private constructor(
    readonly threads: Threads,
    readonly wiki: Wiki,
    readonly voice: Voice,
    private readonly cursorPath: string,
  ) {}

  /**
   * The answers the gateway has not acknowledged, in the user's stream. The cursor lives here, so the gateway keeps
   * no state and a restart sends nothing twice once acknowledged.
   */
  async gatewayAnswers(): Promise<{ conversation: number; answers: ChatMessage[] }> {
    const conversation = await this.threads.stream();
    return { conversation, answers: (await this.threads.answersAfter(conversation, await this.gatewayCursor())) ?? [] };
  }

  /** Mark every answer up to entry `id` as delivered. The cursor only moves forward. */
  async acknowledge(id: number): Promise<void> {
    if (id <= (await this.gatewayCursor())) return;
    await writeFile(`${this.cursorPath}.tmp`, JSON.stringify({ after: id }), { mode: 0o600 });
    await rename(`${this.cursorPath}.tmp`, this.cursorPath);
  }

  private async gatewayCursor(): Promise<number> {
    try {
      return (JSON.parse(await readFile(this.cursorPath, "utf8")) as { after: number }).after;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw new Error(`Reading the gateway cursor ${this.cursorPath} failed.`, { cause: error });
    }
  }

  static async open(config: Config): Promise<Chat> {
    const models = createModels();
    models.setProvider(
      config.provider === "openrouter" ? openrouterProvider() : createDirectSdkProvider((message) => console.error(message)),
    );
    const refresh = await models.refresh({ providers: [config.provider] });
    for (const [setting, id] of [["FINROD_MODEL", config.model], ["FINROD_WIKI_MODEL", config.wikiModel]] as const) {
      if (models.getModel(config.provider, id)) continue;
      const ids = models.getModels(config.provider).slice(0, 20).map((model) => model.id);
      throw new Error(
        `${setting} "${id}" is not in the ${config.provider} catalog. Set ${setting} to one of: ${ids.join(", ") || "(empty catalog)"}. ` +
          `Catalog refresh result: ${JSON.stringify(refresh)}`,
      );
    }
    const dir = join(config.dataDir, "profiles", config.profile);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    // A wrong FINROD_MEMORY_KEY_FILE stops Finrod here, not at the first wiki update.
    await legacyMemories(dir, config.memoryPassphrase);
    const wiki = new Wiki(join(dir, "wiki"), join(dir, "wiki-changes"));
    const voice = await Voice.open(join(dir, "voice"), config.transcribeCommand);
    const registry = createRegistry();
    const { reading, editing } = wikiTools(wiki);
    // The search reads the stream through `threads`, which opens below.
    let threads: Threads | undefined;
    const chatgpt = ChatGPT.open(join(dir, "chatgpt", "chatgpt.sqlite"));
    const search = new Search(join(dir, "search.sqlite"), wiki, async () => (await threads!.activity(await threads!.stream())).messages, chatgpt);
    const recalling = searching(search);
    const chatting = [research(), recalling, reading, clock()];
    for (const extension of [...chatting, editing]) registry.install(extension);
    const model = { provider: config.provider, modelId: config.model };
    threads = await Threads.open({
      models,
      registry,
      model,
      storage: await openNodeSqliteStorage(join(dir, "finrod.sqlite")),
      // Only wiki updates may edit the wiki; the chat reads it.
      settings: { extensions: chatting },
      wiki,
    });
    new Dreaming({ threads, wiki, model: { provider: config.provider, modelId: config.wikiModel }, extensions: [recalling, reading, editing], idleMs: config.dreamIdleMs, cleanupMs: config.cleanupMs, profileDir: dir, passphrase: config.memoryPassphrase, chatgpt }).start();
    return new Chat(threads, wiki, voice, join(dir, "gateway-cursor.json"));
  }

  /** Settles when the store closes; `failed` means the process must restart. */
  get closed() {
    return this.threads.closed;
  }

  close() {
    // No Claude Code process outlives Finrod.
    closeAllSessions();
    return this.threads.close();
  }
}

/** Search and read tools whose results carry the pages an answer rests on. */
const RESEARCH_TOOLS = new Set(["web_search", "web_fetch"]);
const MAX_SOURCES = 6;

/** Page titles and URLs from one tool result, in the order Exa listed them. */
function sourcesFrom(text: string): Source[] {
  const sources: Source[] = [];
  let title: string | undefined;
  for (const line of text.split("\n")) {
    const named = /^Title:\s*(\S.*)$/.exec(line);
    if (named) title = named[1]!.trim();
    const addressed = /^URL:\s*(\S+)\s*$/.exec(line);
    if (addressed) {
      const url = addressed[1]!;
      // Exa prints "N/A" for a page it has no title for; the address is then the best label.
      sources.push({ title: !title || title === "N/A" ? url : title, url });
      title = undefined;
    }
  }
  return sources;
}

export function messagesOf(view: ConversationView): ChatMessage[] {
  // Sources are attached by Finrod from the tool results, not asked of the model.
  let found: Source[] = [];
  const messages: ChatMessage[] = [];
  for (const entry of view.entries) {
    const message = entry.model?.[0];
    if (entry.kind === "pi.tool-result" && message?.role === "toolResult" && RESEARCH_TOOLS.has(message.toolName) && !message.isError) {
      const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      found.push(...sourcesFrom(text));
    } else if (entry.kind === WIKI_CHANGE_KIND) {
      const { at, ...wiki } = entry.data as NonNullable<ChatMessage["wiki"]> & { at: number };
      messages.push({ id: entry.id, role: "assistant", at, text: "", wiki });
    } else if (entry.kind === MESSAGE_KIND) {
      const data = entry.data as MessageData;
      found = [];
      messages.push({ id: entry.id, role: "user", at: message?.timestamp ?? 0, text: data.text, ...(data.voice === undefined ? {} : { voice: data.voice }) });
    } else if (entry.kind === "pi.user" && message?.role === "user") {
      found = [];
      messages.push({ id: entry.id, role: "user", at: message.timestamp, text: userText(message) });
    } else if (entry.kind === "pi.assistant" && message?.role === "assistant") {
      // Text written just before a lookup ("Let me check.") is not an answer; the answer follows the tool's result.
      const searching = message.content.some((part) => part.type === "toolCall");
      const text = searching ? "" : assistantText(message);
      const error =
        message.stopReason === "error"
          ? (message.errorMessage ?? "The model returned an error.")
          : message.stopReason === "aborted"
            ? "Interrupted."
            : undefined;
      if (!text && !error) continue;
      const sources = answerSources(found);
      found = [];
      messages.push({ id: entry.id, role: "assistant", at: message.timestamp, text, ...(error ? { error } : {}), ...(sources.length ? { sources } : {}) });
    }
  }
  return messages;
}

export function liveOf(view: ConversationView): LiveStatus {
  const live = view.docs["pi.live"] as LiveState | undefined;
  const partial = live?.generation?.message ? assistantText(live.generation.message as AssistantMessage) : undefined;
  const retry = live?.generation?.retry?.error;
  const tool = live?.tools?.find((slot) => slot.status !== "done")?.name;
  return {
    busy: live?.run !== undefined,
    ...(partial ? { partial } : {}),
    ...(retry ? { retry } : {}),
    ...(tool ? { tool } : {}),
  };
}

/** The pages used for one answer, one entry per URL, in the order the tools returned them. */
function answerSources(found: Source[]): Source[] {
  const seen = new Set<string>();
  const sources: Source[] = [];
  for (const source of found) {
    if (seen.has(source.url)) continue;
    seen.add(source.url);
    sources.push(source);
    if (sources.length === MAX_SOURCES) break;
  }
  return sources;
}

function userText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function assistantText(message: AssistantMessage): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}
