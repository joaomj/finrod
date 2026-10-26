import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { BACKGROUND_CONTEXT as context } from "@earendil-works/chord/context";
import type { AssistantMessage, ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";
import { createModels, type Models } from "@earendil-works/pi-ai/models";
import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";
import {
  createRegistry,
  defineDoc,
  Harness,
  type ConversationId,
  type ConversationView,
  type LiveState,
  type Registry,
} from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import type { Config } from "./config.js";
import { ExaAuth } from "./exa-auth.js";
import { describeStoredFile, readStoredFile, storeFile, type Attachment } from "./files.js";
import { research } from "./research.js";

const INSTRUCTIONS = [
  "You are Finrod, a personal assistant. Answer in the language the user writes in. Be direct and concise.",
  "Use web_search whenever the answer depends on current or external facts you cannot know for certain.",
  "Do not answer such questions from memory and do not send the user to look it up.",
  "Cite the sources you used as Markdown links next to the facts they support.",
].join(" ");
const TITLE_LENGTH = 60;

export type ConversationSummary = { id: number; title: string; updatedAt: number; temporary: boolean };

/** Finrod's own index of conversations: titles and last activity, newest first. */
const ConversationIndex = defineDoc<{ items: Omit<ConversationSummary, "temporary">[] }>({
  kind: "finrod.conversations",
  version: 1,
  scope: "session",
  initial: () => ({ items: [] }),
  checkpointWhen: (_value, _ops, info) => info.deltasSinceBase >= 50,
});

export type Vote = "up" | "down";
export type Source = { title: string; url: string };
/** What the app shows of a sent file; the text sent to the model stays on the server. */
export type SentFile = Pick<Attachment, "id" | "kind" | "name" | "mime" | "size" | "unreadable">;
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  text: string;
  error?: string;
  vote?: Vote;
  sources?: Source[];
  files?: SentFile[];
};
/** Kind of an input placed with files, so the transcript keeps their names next to the text. */
const MESSAGE_KIND = "finrod.message";
type MessageData = { text: string; files: SentFile[] };
/** A thumbs vote on one answer; the newest entry for a target wins, and `vote: null` clears it. */
const FEEDBACK = "finrod.feedback";
type FeedbackData = { target: number; vote: Vote | null };
export type LiveStatus = { busy: boolean; partial?: string; retry?: string; tool?: string };

/** A message cannot be sent because the conversation went away or the request is not allowed here. */
export class Refused extends Error {}

type ThreadsOpen = {
  readonly models: Models;
  readonly registry: Registry;
  readonly model: { provider: string; modelId: string };
  readonly storage: Awaited<ReturnType<typeof openNodeSqliteStorage>>;
  /** Absent for temporary conversations, which never write a file. */
  readonly filesDir?: string;
  /** Absent for temporary conversations, whose database is in memory. */
  readonly databasePath?: string;
};

/**
 * Conversations of one store. The permanent store is the profile's SQLite file; the temporary store
 * lives in memory and ends with the process.
 */
export class Threads {
  private constructor(
    private readonly harness: Harness,
    private readonly model: { provider: string; modelId: string },
    private readonly filesDir: string | undefined,
    private readonly databasePath: string | undefined,
    readonly temporary: boolean,
  ) {}

  /**
   * Conversations removed in this process. The harness keeps a removed conversation in memory, so Finrod
   * refuses it here instead of serving an answer that no longer exists on disk.
   */
  private readonly removed = new Set<number>();

  private async handle(id: number) {
    if (this.removed.has(id)) return undefined;
    return this.harness.conversation(id as ConversationId, context);
  }

  static async open(open: ThreadsOpen): Promise<Threads> {
    const harness = await Harness.open(open.storage, { models: open.models, registry: open.registry }, context);
    harness.resume();
    return new Threads(harness, open.model, open.filesDir, open.databasePath, open.filesDir === undefined);
  }

  /** Settles when the store closes; `failed` means the process must restart. */
  get closed() {
    return this.harness.closed;
  }

  close() {
    return this.harness.close(context);
  }

  async list(): Promise<ConversationSummary[]> {
    const items = (await this.harness.snapshot(ConversationIndex, context))?.items ?? [];
    return items.map((item) => ({ ...item, temporary: this.temporary }));
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

  /**
   * Admit a message; a repeated `requestId` returns the original submission instead of sending twice. Files
   * go to the model as image content, or as document text.
   */
  async send(id: number, text: string, files: readonly Attachment[], requestId: string): Promise<boolean> {
    if (files.length && this.temporary) throw new Refused("Temporary conversations do not keep files.");
    const conversation = await this.handle(id);
    if (!conversation) return false;
    const content = await this.contentOf(text, files);
    const draft =
      files.length === 0
        ? { type: "input" as const, content: text, requestId }
        : {
            type: "input" as const,
            content,
            requestId,
            entry: { kind: MESSAGE_KIND, data: { text, files: files.map(sentFile) } satisfies MessageData },
          };
    await conversation.submit(draft, context);
    await this.harness.commit(async (tx) => {
      const index = await tx.doc(ConversationIndex);
      const at = index.items.findIndex((item) => item.id === id);
      const title = at >= 0 && index.items[at]!.title ? index.items[at]!.title : titleOf(text || files.map((file) => file.name).join(", "));
      if (at >= 0) index.items.splice(at, 1);
      index.items.unshift({ id, title, updatedAt: Date.now() });
    }, context);
    return true;
  }

  /** Image pixels and document text as the model receives them. */
  private async contentOf(text: string, files: readonly Attachment[]): Promise<(TextContent | ImageContent)[]> {
    const content: (TextContent | ImageContent)[] = [];
    if (text) content.push({ type: "text", text });
    for (const file of files) {
      if (file.kind === "image") {
        const bytes = await readStoredFile(this.filesDir!, file.id);
        content.push({ type: "image", data: bytes.toString("base64"), mimeType: file.mime });
      } else if (file.text) {
        content.push({ type: "text", text: `--- ${file.name} ---\n${file.text}` });
      }
    }
    return content;
  }

  /**
   * Store a vote on an answer as a passive entry the model never sees. Returns false when the conversation or the
   * answer does not exist.
   */
  async rate(id: number, target: number, vote: Vote | null): Promise<boolean> {
    const conversation = await this.handle(id);
    if (!conversation) return false;
    const { entries } = await conversation.context(context);
    if (!entries.some((entry) => entry.id === target && entry.kind === "pi.assistant")) return false;
    const data: FeedbackData = { target, vote };
    await conversation.submit({ type: "write", entry: { kind: FEEDBACK, data } }, context);
    return true;
  }

  /** Follow one conversation; `onView` gets the current view, then every committed change. */
  async watch(id: number, onView: (view: ConversationView) => void): Promise<(() => Promise<unknown>) | undefined> {
    const conversation = await this.handle(id);
    if (!conversation) return undefined;
    const watch = await conversation.watch(context);
    onView(watch.value);
    watch.start(async (view) => onView(view));
    return () => watch.stop();
  }

  /**
   * Remove a conversation. A temporary one leaves the list and its memory ends with the process. A permanent
   * one loses its messages, its documents, and its stored files from the profile, because pi-durable has no API
   * to remove a conversation.
   */
  async remove(id: number): Promise<boolean> {
    const conversation = await this.handle(id);
    if (!conversation) return false;
    const view = await conversation.viewState(context);
    const live = view.value.docs["pi.live"] as LiveState | undefined;
    view.dispose();
    if (live?.run !== undefined) throw new Refused("Wait for the answer to finish before deleting this conversation.");

    const { entries } = await conversation.context(context);
    const files = entries.flatMap((entry) => (entry.kind === MESSAGE_KIND ? (entry.data as MessageData).files.map((file) => file.id) : []));
    if (!this.temporary) this.deleteRows(id);

    await this.harness.commit(async (tx) => {
      const index = await tx.doc(ConversationIndex);
      const at = index.items.findIndex((item) => item.id === id);
      if (at >= 0) index.items.splice(at, 1);
    }, context);

    if (this.filesDir) await Promise.all(files.map((name) => rm(join(this.filesDir!, name), { force: true })));
    this.removed.add(id);
    return true;
  }

  /** Delete one conversation's rows, and the rows of its documents, in the profile database. */
  private deleteRows(id: number): void {
    const database = new DatabaseSync(this.databasePath!, { timeout: 5_000 });
    try {
      database.exec("BEGIN IMMEDIATE");
      const documents = "SELECT id FROM documents WHERE scope_kind = 'conversation' AND owner_id = " + Number(id);
      database.exec(`DELETE FROM document_revisions WHERE document_id IN (${documents})`);
      database.exec(`DELETE FROM documents WHERE scope_kind = 'conversation' AND owner_id = ${Number(id)}`);
      for (const table of ["entries", "submissions", "tasks"]) {
        database.exec(`DELETE FROM ${table} WHERE conversation_id = ${Number(id)}`);
      }
      database.exec(`DELETE FROM record_ids WHERE id IN (${documents})`);
      database.exec(`DELETE FROM conversations WHERE id = ${Number(id)}`);
      database.exec(`DELETE FROM record_ids WHERE id = ${Number(id)} AND record_type = 'conversation'`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(`Deleting conversation ${id} from ${this.databasePath} failed.`, { cause: error });
    } finally {
      database.close();
    }
  }
}

/** Everything the HTTP layer needs: the two stores, the profile's files, and the Exa account. */
export class Chat {
  private constructor(
    readonly threads: Threads,
    readonly temporary: Threads,
    private readonly filesDir: string,
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
    const files = join(dir, "files");
    await mkdir(files, { recursive: true, mode: 0o700 });
    const databasePath = join(dir, "finrod.sqlite");
    const exa = new ExaAuth(join(dir, "exa-oauth.json"), config.publicUrl);
    const registry = createRegistry();
    registry.install(research(exa));
    const model = { provider: "openrouter", modelId: config.model };
    const threads = await Threads.open({
      models,
      registry,
      model,
      storage: await openNodeSqliteStorage(databasePath),
      filesDir: files,
      databasePath,
    });
    // Temporary conversations exist only while the process runs.
    const temporary = await Threads.open({ models, registry, model, storage: await openNodeSqliteStorage(":memory:") });
    return new Chat(threads, temporary, files, exa);
  }

  /** Settles when the permanent store closes; `failed` means the process must restart. */
  get closed() {
    return this.threads.closed;
  }

  async close() {
    await this.threads.close();
    await this.temporary.close();
  }

  /**
   * Store an uploaded file as the profile's original and return what the model needs from it. Rejects a file
   * that is not an image, a PDF, or plain text.
   */
  storeFile(bytes: Uint8Array, name: string): Promise<Attachment> {
    return storeFile(this.filesDir, bytes, name);
  }

  /** An original uploaded earlier, read again for the message that sends it. */
  describeFile(id: string, name: string): Promise<Attachment> {
    return describeStoredFile(this.filesDir, id, name);
  }

  /** One stored original, for the app to show. */
  readFile(id: string): Promise<Buffer> {
    return readStoredFile(this.filesDir, id);
  }
}

function sentFile(file: Attachment): SentFile {
  const { id, kind, name, mime, size, unreadable } = file;
  return { id, kind, name, mime, size, ...(unreadable ? { unreadable } : {}) };
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
    } else if (entry.kind === MESSAGE_KIND) {
      const data = entry.data as MessageData;
      found = [];
      messages.push({ id: entry.id, role: "user", text: data.text, ...(data.files.length ? { files: data.files } : {}) });
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
