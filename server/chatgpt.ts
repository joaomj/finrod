import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

/** A message the user or ChatGPT wrote before Finrod, cited as `#c<id>`. */
export type ImportedMessage = { id: number; role: "user" | "assistant"; at: number; text: string; title: string };

const SELECT = "SELECT m.id, m.role, m.at, m.text, c.title FROM messages m JOIN conversations c ON c.id = m.conversation";

/**
 * The user's ChatGPT history in `<profile>/chatgpt/chatgpt.sqlite`, which a one-off import wrote. Finrod only reads it:
 * without the file, search and the wiki work as if there had been no import.
 */
export class ChatGPT {
  private constructor(private readonly db: DatabaseSync) {}

  /** The import, or `undefined` when there is none. */
  static open(path: string): ChatGPT | undefined {
    if (!existsSync(path)) return undefined;
    try {
      const db = new DatabaseSync(path, { readOnly: true });
      db.prepare(`${SELECT} LIMIT 1`).all();
      return new ChatGPT(db);
    } catch (error) {
      throw new Error(`The ChatGPT import ${path} does not open as one; import it again, or delete its folder to go without it.`, { cause: error });
    }
  }

  all(): ImportedMessage[] {
    return this.db.prepare(`${SELECT} ORDER BY m.id`).all() as ImportedMessage[];
  }

  /** What the user wrote after message `after`, oldest first, up to about `maxChars`; at least one message when any is left. */
  userMessages(after: number, maxChars: number): ImportedMessage[] {
    const found: ImportedMessage[] = [];
    let chars = 0;
    for (const message of this.db.prepare(`${SELECT} WHERE m.role = 'user' AND m.id > ? ORDER BY m.id`).iterate(after) as Iterable<ImportedMessage>) {
      chars += message.text.length;
      if (chars > maxChars && found.length) break;
      found.push(message);
    }
    return found;
  }

  /** Message `id` and up to `count` messages on each side, in its conversation. */
  around(id: number, count: number): ImportedMessage[] {
    return this.db
      .prepare(`${SELECT} WHERE m.conversation = (SELECT conversation FROM messages WHERE id = ?) AND m.id BETWEEN ? AND ? ORDER BY m.id`)
      .all(id, id - count, id + count) as ImportedMessage[];
  }
}

/** One imported message as the models read it: its source number, time, author, and conversation. */
export function importedLine(message: ImportedMessage, maxChars = Infinity): string {
  const at = new Date(message.at).toISOString().slice(0, 16).replace("T", " ");
  const text = message.text.length > maxChars ? `${message.text.slice(0, maxChars)}…` : message.text;
  return `[#c${message.id} ${at} ${message.role === "user" ? "user" : "ChatGPT"} in ${JSON.stringify(message.title)}] ${text}`;
}
