import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
  createRegistry,
  defineDoc,
  Harness,
  type ConversationId,
  type ConversationView,
  type LiveState,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Config } from "./config.js";
import { ExaAuth } from "./exa-auth.js";
import { research } from "./research.js";

const INSTRUCTIONS = [
  "You are Finrod, a personal assistant. Answer in the language the user writes in. Be direct and concise.",
  "Use web_search whenever the answer depends on current or external facts you cannot know for certain.",
  "Do not answer such questions from memory and do not send the user to look it up.",
  "Cite the sources you used as Markdown links next to the facts they support.",
].join(" ");
const TITLE_LENGTH = 60;

export type ConversationSummary = { id: number; title: string; updatedAt: number };

/** Finrod's own index of conversations: titles and last activity, newest first. */
const ConversationIndex = defineDoc<{ items: ConversationSummary[] }>({
  kind: "finrod.conversations",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
});

export type Vote = "up" | "down";
export type Source = { title: string; url: string };
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  error?: string;
  vote?: Vote;
  sources?: Source[];
};
/** A thumbs vote on one answer; the newest entry for a target wins, and `vote: null` clears it. */
const FEEDBACK = "finrod.feedback";
type FeedbackData = { target: number; vote: Vote | null };
export type LiveStatus = { busy: boolean; partial?: string; retry?: string; tool?: string };

export class Chat {
  private constructor(
    private readonly harness: Harness,
    private readonly model: { provider: string; modelId: string },
    readonly exa: ExaAuth,
  ) {}

  static async open(config: Config): Promise<Chat> {
    const models = createModels();
    models.setProvider(openrouterProvider());
    const refresh = await models.refresh({ providers: ["openrouter"] });
    if (!models.getModel("openrouter", config.model)) {
      throw new Error(
        `FINROD_MODEL "${config.model}" is not in the OpenRouter catalog. Set FINROD_MODEL to an OpenRouter model ID. ` +
          `Catalog refresh result: ${JSON.stringify(refresh)}`,
      );
    }
    const dir = join(config.dataDir, "profiles", config.profile);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const storage = await openNodeSqliteStorage(join(dir, "finrod.sqlite"));
    const exa = new ExaAuth(join(dir, "exa-oauth.json"), config.publicUrl);
    const registry = createRegistry();
    registry.install(research(exa));
    const harness = await Harness.open(storage, { models, registry }, context);
    harness.resume();
    return new Chat(harness, { provider: "openrouter", modelId: config.model }, exa);
  }

  /** Settles when the store closes; `failed` means the process must restart. */
  get closed() {
    return this.harness.closed;
  }

  close() {
    return this.harness.close(context);
  }

  async list(): Promise<ConversationSummary[]> {
    return [...((await this.harness.snapshot(ConversationIndex, context))?.items ?? [])];
  }

  async create(): Promise<number> {
    const conversation = await this.harness.createConversation(
      {
        ownership: { kind: "ownerless" },
        agent: { model: this.model, instructions: INSTRUCTIONS },
        init: async (tx, id) => {
          (await tx.doc(ConversationIndex)).items.unshift({ id, title: "", updatedAt: Date.now() });
        },
      },
      context,
    );
    return conversation.id;
  }

  /** Admit a message; a repeated `requestId` returns the original submission instead of sending twice. */
  async send(id: number, text: string, requestId: string): Promise<boolean> {
    const conversation = await this.harness.conversation(id as ConversationId, context);
    if (!conversation) return false;
    await conversation.submit({ type: "input", content: text, requestId }, context);
    await this.harness.commit(async (tx) => {
      const index = await tx.doc(ConversationIndex);
      const at = index.items.findIndex((item) => item.id === id);
      const title = at >= 0 && index.items[at]!.title ? index.items[at]!.title : titleOf(text);
      if (at >= 0) index.items.splice(at, 1);
      index.items.unshift({ id, title, updatedAt: Date.now() });
    }, context);
    return true;
  }

  /**
   * Store a vote on an answer as a passive entry the model never sees. Returns false when the conversation or the
   * answer does not exist.
   */
  async rate(id: number, target: number, vote: Vote | null): Promise<boolean> {
    const conversation = await this.harness.conversation(id as ConversationId, context);
    if (!conversation) return false;
    const { entries } = await conversation.context(context);
    if (!entries.some((entry) => entry.id === target && entry.kind === "pi.assistant")) return false;
    const data: FeedbackData = { target, vote };
    await conversation.submit({ type: "write", entry: { kind: FEEDBACK, data } }, context);
    return true;
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

function titleOf(text: string): string {
  const line = text.trim().replace(/\s+/g, " ");
  return line.length > TITLE_LENGTH ? `${line.slice(0, TITLE_LENGTH - 1)}…` : line;
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
  const votes = new Map<number, Vote | null>();
  // Sources are attached by Finrod from the tool results, not asked of the model.
  let found: Source[] = [];
  for (const entry of view.entries) {
    if (entry.kind === FEEDBACK) {
      const data = entry.data as FeedbackData;
      votes.set(data.target, data.vote);
    }
  }
  const messages: ChatMessage[] = [];
  for (const entry of view.entries) {
    const message = entry.model?.[0];
    if (entry.kind === "pi.tool-result" && message?.role === "toolResult" && RESEARCH_TOOLS.has(message.toolName) && !message.isError) {
      const text = message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
      found.push(...sourcesFrom(text));
    } else if (entry.kind === "pi.user" && message?.role === "user") {
      found = [];
      messages.push({ id: entry.id, role: "user", text: userText(message) });
    } else if (entry.kind === "pi.assistant" && message?.role === "assistant") {
      const text = assistantText(message);
      const error =
        message.stopReason === "error"
          ? (message.errorMessage ?? "The model returned an error.")
          : message.stopReason === "aborted"
            ? "Interrupted."
            : undefined;
      if (!text && !error) continue;
      const vote = votes.get(entry.id);
      const sources = answerSources(found);
      found = [];
      messages.push({ id: entry.id, role: "assistant", text, ...(error ? { error } : {}), ...(vote ? { vote } : {}), ...(sources.length ? { sources } : {}) });
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
