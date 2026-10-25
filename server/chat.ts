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

const INSTRUCTIONS =
  "You are Finrod, a personal assistant. Answer in the language the user writes in. Be direct and concise.";
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

export type ChatMessage = { id: number; role: "user" | "assistant"; text: string; error?: string };
export type LiveStatus = { busy: boolean; partial?: string; retry?: string };

export class Chat {
  private constructor(
    private readonly harness: Harness,
    private readonly model: { provider: string; modelId: string },
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
    const harness = await Harness.open(storage, { models, registry: createRegistry() }, context);
    harness.resume();
    return new Chat(harness, { provider: "openrouter", modelId: config.model });
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

export function messagesOf(view: ConversationView): ChatMessage[] {
  const messages: ChatMessage[] = [];
  for (const entry of view.entries) {
    const message = entry.model?.[0];
    if (entry.kind === "pi.user" && message?.role === "user") {
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
      messages.push({ id: entry.id, role: "assistant", text, ...(error ? { error } : {}) });
    }
  }
  return messages;
}

export function liveOf(view: ConversationView): LiveStatus {
  const live = view.docs["pi.live"] as LiveState | undefined;
  const partial = live?.generation?.message ? assistantText(live.generation.message as AssistantMessage) : undefined;
  const retry = live?.generation?.retry?.error;
  return { busy: live?.run !== undefined, ...(partial ? { partial } : {}), ...(retry ? { retry } : {}) };
}

function userText(message: UserMessage): string {
  if (typeof message.content === "string") return message.content;
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n");
}

function assistantText(message: AssistantMessage): string {
  return message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}
