import { DatabaseSync } from "node:sqlite";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import type { ChatMessage } from "./chat.js";
import { importedLine, type ChatGPT } from "./chatgpt.js";
import { CORE_PAGE, type Wiki } from "./wiki.js";

const MAX_RESULTS = 10;
const MAX_TEXT_CHARS = 600;

/**
 * BM25 search over what the user and Finrod said and over the wiki's pages, in SQLite FTS5. The index is derived:
 * `search.sqlite` can be deleted and rebuilds itself. Before each search it takes in the messages added since the last
 * one and reads the pages again, so it never needs a watcher.
 */
export class Search {
  private readonly db: DatabaseSync;

  constructor(
    path: string,
    private readonly wiki: Wiki,
    /** Every message of the user's stream, oldest first. */
    private readonly messages: () => Promise<ChatMessage[]>,
    readonly chatgpt?: ChatGPT,
  ) {
    this.db = new DatabaseSync(path);
    // Accents folded, so "medico" finds "médico"; no stemmer, since FTS5's only one is for English: "filho*" finds "filhos".
    const tokenize = `tokenize="unicode61 remove_diacritics 2"`;
    try {
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS messages USING fts5(text, id UNINDEXED, at UNINDEXED, role UNINDEXED, ${tokenize})`);
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS pages USING fts5(text, path UNINDEXED, ${tokenize})`);
      this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS chatgpt USING fts5(text, id UNINDEXED, at UNINDEXED, role UNINDEXED, title UNINDEXED, ${tokenize})`);
    } catch (error) {
      throw new Error(`Creating the search index ${path} failed; Finrod needs a Node.js whose SQLite has FTS5 (Node 22.19 or later).`, { cause: error });
    }
    // The import never changes, so it is indexed once; without it, its messages leave the index.
    const indexed = (this.db.prepare("SELECT count(*) AS n FROM chatgpt").get() as { n: number }).n > 0;
    if (!chatgpt) this.db.exec("DELETE FROM chatgpt");
    else if (!indexed) {
      const insert = this.db.prepare("INSERT INTO chatgpt (text, id, at, role, title) VALUES (?, ?, ?, ?, ?)");
      this.db.exec("BEGIN");
      try {
        for (const message of chatgpt.all()) insert.run(message.text, message.id, message.at, message.role, message.title);
        this.db.exec("COMMIT");
      } catch (error) {
        this.db.exec("ROLLBACK");
        throw error;
      }
    }
  }

  /** The best matches for the words in `query`, pages first, then messages before the current exchange, which the model sees. */
  async find(query: string, limit: number): Promise<string> {
    const match = matchOf(query);
    if (!match) return "Give one or more words to search for.";
    const all = await this.messages();
    await this.refresh(all);
    const current = all.findLast((message) => message.role === "user")?.id ?? Number.MAX_SAFE_INTEGER;
    const pages = this.db.prepare("SELECT path, snippet(pages, 0, '', '', '…', 24) AS text FROM pages WHERE pages MATCH ? ORDER BY bm25(pages) LIMIT 3").all(match) as { path: string; text: string }[];
    const messages = this.db.prepare("SELECT id, at, role, text, bm25(messages) AS rank FROM messages WHERE messages MATCH ? AND id < ? ORDER BY rank LIMIT ?").all(match, current, limit) as { id: number; at: number; role: string; text: string; rank: number }[];
    const imported = this.db.prepare("SELECT id, at, role, text, title, bm25(chatgpt) AS rank FROM chatgpt WHERE chatgpt MATCH ? ORDER BY rank LIMIT ?").all(match, limit) as { id: number; at: number; role: "user" | "assistant"; text: string; title: string; rank: number }[];
    const ranked = [
      ...messages.map((message) => ({ rank: message.rank, line: messageLine(message) })),
      ...imported.map((message) => ({ rank: message.rank, line: importedLine(message, MAX_TEXT_CHARS) })),
    ];
    const said = ranked.sort((a, b) => a.rank - b.rank).slice(0, limit).map(({ line }) => line);
    const lines = [...pages.map((page) => `[page ${page.path}] ${page.text}`), ...said];
    return lines.length ? lines.join("\n") : `Nothing matches ${query}.`;
  }

  /** The messages around message `id`, as they were said. */
  async around(id: number, count: number): Promise<string> {
    const all = (await this.messages()).filter((message) => !message.wiki);
    const at = all.findIndex((message) => message.id >= id);
    if (at < 0) return `There is no message #${id}.`;
    return all.slice(Math.max(0, at - count), at + count + 1).map((message) => messageLine(message)).join("\n");
  }

  private async refresh(all: ChatMessage[]) {
    const newest = (this.db.prepare("SELECT max(id) AS id FROM messages").get() as { id: number | null }).id ?? 0;
    const insert = this.db.prepare("INSERT INTO messages (text, id, at, role) VALUES (?, ?, ?, ?)");
    const insertPage = this.db.prepare("INSERT INTO pages (text, path) VALUES (?, ?)");
    const pages = [CORE_PAGE, ...(await this.wiki.index()).keys()];
    const texts = await Promise.all(pages.map(async (path) => [path, await this.wiki.read(path)] as const));
    const fresh = all.filter((message) => message.id > newest && message.text && !message.wiki);
    this.db.exec("BEGIN");
    try {
      for (const message of fresh) insert.run(message.text, message.id, message.at, message.role);
      // The wiki is small, so its pages are read again each time instead of tracked.
      this.db.exec("DELETE FROM pages");
      for (const [path, text] of texts) if (text) insertPage.run(text, path);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

/** An FTS5 query from free words, "quoted phrases", and prefixes such as filho*; any of them may match. */
function matchOf(query: string): string {
  const terms = [...query.matchAll(/"([^"]+)"|([\p{L}\p{N}]+)(\*)?/gu)].map(([, phrase, word, prefix]) =>
    phrase ? `"${phrase.replace(/[^\p{L}\p{N}\s]/gu, " ").trim()}"` : `"${word}"${prefix ?? ""}`,
  );
  return terms.filter((term) => term !== '""').join(" OR ");
}

function messageLine(message: { id: number; at: number; role: string; text: string }): string {
  const at = new Date(message.at).toISOString().slice(0, 16).replace("T", " ");
  const text = message.text.length > MAX_TEXT_CHARS ? `${message.text.slice(0, MAX_TEXT_CHARS)}…` : message.text;
  return `[#${message.id} ${at} ${message.role === "user" ? "user" : "Finrod"}] ${text}`;
}

const text = (value: string) => ({ output: [{ type: "text" as const, text: value }] });

/** `search` and `read_messages`, and `read_chatgpt` when there is an import, for the chat and the wiki updates alike. */
export function searching(search: Search) {
  const { chatgpt } = search;
  return defineExtension({
    name: "search",
    tools: [
      defineTool({
        name: "search",
        description:
          `Search everything the user and you said in past conversations${chatgpt ? ", what the user and ChatGPT said before you (#c numbers)" : ""}, and your notes about the user. Matches any of the words, ignoring accents and case; best matches first. Use word* for other endings of a word and \"quotes\" for an exact phrase.`,
        parameters: Type.Object({
          query: Type.String({ minLength: 1, description: "Words to look for, in the language they were said, such as: dentista médico consulta*" }),
          limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_RESULTS, description: `Most messages to return; default ${MAX_RESULTS}.` })),
        }),
        replay: "safe",
        execute: async (args) => text(await search.find(args.query, args.limit ?? MAX_RESULTS)),
      }),
      defineTool({
        name: "read_messages",
        description: "Read the messages around one message, such as #123 from a search result or a source.",
        parameters: Type.Object({
          id: Type.Integer({ minimum: 1, description: "The message's number, without #." }),
          count: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Messages before and after it; default 3." })),
        }),
        replay: "safe",
        execute: async (args) => text(await search.around(args.id, args.count ?? 3)),
      }),
      ...(chatgpt
        ? [
            defineTool({
              name: "read_chatgpt",
              description: "Read the messages around one message of the user's ChatGPT conversations, such as #c123 from a search result or a source.",
              parameters: Type.Object({
                id: Type.Integer({ minimum: 1, description: "The message's number, without #c." }),
                count: Type.Optional(Type.Integer({ minimum: 1, maximum: 10, description: "Messages before and after it; default 3." })),
              }),
              replay: "safe",
              execute: async (args) => {
                const found = chatgpt.around(args.id, args.count ?? 3);
                return text(found.length ? found.map((message) => importedLine(message)).join("\n") : `There is no message #c${args.id}.`);
              },
            }),
          ]
        : []),
    ],
  });
}
