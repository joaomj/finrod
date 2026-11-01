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
import { clock } from "./clock.js";
import { ExaAuth } from "./exa-auth.js";
import { describeStoredFile, readStoredFile, storeFile, type Attachment } from "./files.js";
import { Memories, REMEMBER_TOOL, remembering, type Memory } from "./memories.js";
import { research } from "./research.js";
import { Voice } from "./voice.js";
import finrodPrompt from "./prompts/finrod.md";
import memoriesPrompt from "./prompts/memories.md";

const INSTRUCTIONS = finrodPrompt.trim();
const MAX_SNIPPET = 160;
const MAX_HITS = 20;

/** The model's instructions: Finrod's rules plus what the user approved Finrod to know. */
function instructionsFor(saved: readonly Memory[]): string {
  if (saved.length === 0) return INSTRUCTIONS;
  return `${INSTRUCTIONS}\n\n${memoriesPrompt}${saved.map((memory) => `- ${memory.text}`).join("\n")}`;
}

/** Finrod's own index of conversations, newest first. The app opens the newest one as the user's stream. */
const ConversationIndex = defineDoc<{ items: { id: number }[] }>({
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
export type RememberedMemory = Pick<Memory, "id" | "text" | "status">;
export type ChatMessage = {
  id: number;
  role: "user" | "assistant";
  /** Milliseconds since the epoch when the message was written. */
  at: number;
  text: string;
  error?: string;
  vote?: Vote;
  sources?: Source[];
  files?: SentFile[];
  /** Seconds of speech a spoken message was transcribed from. */
  voice?: number;
  /** Memories Finrod proposed while writing this answer. */
  memories?: RememberedMemory[];
};
export type SearchHit = { id: number; role: "user" | "assistant"; at: number; text: string };
/** Kind of an input placed with files, so the transcript keeps their names next to the text. */
const MESSAGE_KIND = "finrod.message";
type MessageData = { text: string; files: SentFile[]; voice?: number };
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
  readonly filesDir: string;
  readonly databasePath: string;
  readonly memories: Memories;
};

/** The conversations of the profile's SQLite file. */
export class Threads {
  private constructor(
    private readonly harness: Harness,
    private readonly model: { provider: string; modelId: string },
    private readonly filesDir: string,
    private readonly databasePath: string,
    private readonly memories: Memories,
  ) {}

  /** The instructions last written to a conversation by this process. */
  private instructions = "";
  private creating: Promise<number> | undefined;

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
    return new Threads(harness, open.model, open.filesDir, open.databasePath, open.memories);
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
    const instructions = instructionsFor(this.memories.saved());
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
    this.instructions = instructions;
    return conversation.id;
  }

  /**
   * Admit a message; a repeated `requestId` returns the original submission instead of sending twice. Files
   * go to the model as image content, or as document text. Approved memories reach the model through its instructions.
   */
  async send(id: number, text: string, files: readonly Attachment[], requestId: string, voice?: number): Promise<boolean> {
    const conversation = await this.handle(id);
    if (!conversation) return false;
    const instructions = instructionsFor(this.memories.saved());
    if (instructions !== this.instructions) {
      await conversation.configure({ instructions }, context);
      this.instructions = instructions;
    }
    const plain = files.length === 0 && voice === undefined;
    const draft = plain
      ? { type: "input" as const, content: text, requestId }
      : {
          type: "input" as const,
          content: await this.contentOf(text, files),
          requestId,
          entry: { kind: MESSAGE_KIND, data: { text, files: files.map(sentFile), ...(voice === undefined ? {} : { voice }) } satisfies MessageData },
        };
    await conversation.submit(draft, context);
    return true;
  }

  /** Image pixels and document text as the model receives them. */
  private async contentOf(text: string, files: readonly Attachment[]): Promise<(TextContent | ImageContent)[]> {
    const content: (TextContent | ImageContent)[] = [];
    if (text) content.push({ type: "text", text });
    for (const file of files) {
      if (file.kind === "image") {
        const bytes = await readStoredFile(this.filesDir, file.id);
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

  /** Messages whose text contains `query`, ignoring case and accents, newest first. */
  async search(id: number, query: string): Promise<SearchHit[] | undefined> {
    const conversation = await this.handle(id);
    if (!conversation) return undefined;
    const view = await conversation.viewState(context);
    const messages = messagesOf(view.value, this.memories);
    view.dispose();
    const fold = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const wanted = fold(query.trim());
    if (!wanted) return [];
    const hits: SearchHit[] = [];
    for (const message of [...messages].reverse()) {
      if (!message.text) continue;
      const at = fold(message.text).indexOf(wanted);
      if (at < 0) continue;
      const from = Math.max(0, at - 40);
      const snippet = message.text.slice(from, from + MAX_SNIPPET);
      hits.push({ id: message.id, role: message.role, at: message.at, text: `${from > 0 ? "…" : ""}${snippet}${from + MAX_SNIPPET < message.text.length ? "…" : ""}` });
      if (hits.length === MAX_HITS) break;
    }
    return hits;
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
   * Remove a conversation: its messages, its documents, and its stored files leave the profile, because pi-durable
   * has no API to remove a conversation.
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
    this.deleteRows(id);

    await this.harness.commit(async (tx) => {
      const index = await tx.doc(ConversationIndex);
      const at = index.items.findIndex((item) => item.id === id);
      if (at >= 0) index.items.splice(at, 1);
    }, context);

    await Promise.all(files.map((name) => rm(join(this.filesDir, name), { force: true })));
    this.removed.add(id);
    return true;
  }

  /** Delete one conversation's rows, and the rows of its documents, in the profile database. */
  private deleteRows(id: number): void {
    const database = new DatabaseSync(this.databasePath, { timeout: 5_000 });
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

/** Everything the HTTP layer needs: the conversations, the profile's files, memories, voice, and the Exa account. */
export class Chat {
  private constructor(
    readonly threads: Threads,
    private readonly filesDir: string,
    readonly exa: ExaAuth,
    readonly memories: Memories,
    readonly voice: Voice,
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
    const memories = await Memories.open(join(dir, "memories.json"));
    const voice = await Voice.open(join(dir, "voice"), config.transcribeCommand);
    const registry = createRegistry();
    registry.install(research(exa));
    registry.install(remembering(memories));
    registry.install(clock());
    const threads = await Threads.open({
      models,
      registry,
      model: { provider: "openrouter", modelId: config.model },
      storage: await openNodeSqliteStorage(databasePath),
      filesDir: files,
      databasePath,
      memories,
    });
    return new Chat(threads, files, exa, memories, voice);
  }

  /** Settles when the store closes; `failed` means the process must restart. */
  get closed() {
    return this.threads.closed;
  }

  close() {
    return this.threads.close();
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

export function messagesOf(view: ConversationView, memories: Memories): ChatMessage[] {
  const votes = new Map<number, Vote | null>();
  // Sources are attached by Finrod from the tool results, not asked of the model.
  let found: Source[] = [];
  let remembered: string[] = [];
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
    } else if (entry.kind === "pi.tool-result" && message?.role === "toolResult" && message.toolName === REMEMBER_TOOL && !message.isError) {
      const id = /\(id (m-[0-9a-f]{8})\)/.exec(message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"));
      if (id) remembered.push(id[1]!);
    } else if (entry.kind === MESSAGE_KIND) {
      const data = entry.data as MessageData;
      found = [];
      remembered = [];
      messages.push({
        id: entry.id,
        role: "user",
        at: message?.timestamp ?? 0,
        text: data.text,
        ...(data.files.length ? { files: data.files } : {}),
        ...(data.voice === undefined ? {} : { voice: data.voice }),
      });
    } else if (entry.kind === "pi.user" && message?.role === "user") {
      found = [];
      remembered = [];
      messages.push({ id: entry.id, role: "user", at: message.timestamp, text: userText(message) });
    } else if (entry.kind === "pi.assistant" && message?.role === "assistant") {
      // Text written just before a lookup ("Let me check.") is not an answer; the answer follows the tool's result.
      const searching = message.content.some((part) => part.type === "toolCall" && part.name !== REMEMBER_TOOL);
      const text = searching ? "" : assistantText(message);
      const error =
        message.stopReason === "error"
          ? (message.errorMessage ?? "The model returned an error.")
          : message.stopReason === "aborted"
            ? "Interrupted."
            : undefined;
      if (!text && !error) continue;
      const vote = votes.get(entry.id);
      const sources = answerSources(found);
      const kept = remembered.flatMap((id) => {
        const memory = memories.get(id);
        return memory ? [{ id: memory.id, text: memory.text, status: memory.status }] : [];
      });
      found = [];
      remembered = [];
      messages.push({ id: entry.id, role: "assistant", at: message.timestamp, text, ...(error ? { error } : {}), ...(vote ? { vote } : {}), ...(sources.length ? { sources } : {}), ...(kept.length ? { memories: kept } : {}) });
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
