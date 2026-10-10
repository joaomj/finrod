import type { ReplyMetadata } from "../reply.js";
import { DatabaseSync } from "node:sqlite";

export type Incoming = {
  updateId: number;
  chatId: number;
  messageId: number;
  text?: string;
  voiceFileId?: string;
};
export type Work = Incoming & { transcript: string | null };
export type Delivery = { id: number; chatId: number; text: string; rateable: number };

export class TelegramStore {
  private readonly db: DatabaseSync;

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS identity (id INTEGER PRIMARY KEY CHECK(id=1), bot_id INTEGER NOT NULL, owner_id INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS cursor (id INTEGER PRIMARY KEY CHECK(id=1), value INTEGER NOT NULL);
      INSERT OR IGNORE INTO cursor VALUES (1, 0);
      CREATE TABLE IF NOT EXISTS inbox (
        update_id INTEGER PRIMARY KEY, payload TEXT NOT NULL,
        transcript TEXT, completed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS outbox (
        id INTEGER PRIMARY KEY, update_id INTEGER NOT NULL, part INTEGER NOT NULL,
        chat_id INTEGER NOT NULL, text TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', telegram_message_id INTEGER,
        UNIQUE(update_id, part)
      );
      CREATE TABLE IF NOT EXISTS reply_metadata (
        update_id INTEGER PRIMARY KEY, request_id TEXT NOT NULL,
        conversation_id INTEGER NOT NULL, submission_id INTEGER NOT NULL,
        answer_entry_id INTEGER NOT NULL, provider TEXT NOT NULL, model TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS feedback (
        delivery_id INTEGER PRIMARY KEY REFERENCES outbox(id),
        user_id INTEGER NOT NULL, vote TEXT NOT NULL CHECK(vote IN ('up','down')),
        last_update_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
    `);
    this.db.prepare("UPDATE outbox SET status='uncertain' WHERE status='sending'").run();
  }

  bind(botId: number, ownerId: number): void {
    this.db.prepare("INSERT OR IGNORE INTO identity VALUES (1,?,?)").run(botId, ownerId);
    const identity = this.db.prepare("SELECT bot_id,owner_id FROM identity WHERE id=1").get() as { bot_id: number; owner_id: number };
    if (identity.bot_id !== botId || identity.owner_id !== ownerId) {
      throw new Error("FINROD_DATA_DIR belongs to a different Telegram bot or owner. Restore the original configuration or use a separate data directory.");
    }
  }

  get offset(): number {
    return (this.db.prepare("SELECT value FROM cursor WHERE id=1").get() as { value: number }).value;
  }

  admit(updateId: number, incoming?: Incoming): void {
    this.transaction(() => {
      if (incoming) {
        this.db.prepare("INSERT OR IGNORE INTO inbox(update_id,payload) VALUES (?,?)")
          .run(updateId, JSON.stringify(incoming));
      }
      this.db.prepare("UPDATE cursor SET value=MAX(value, ?) WHERE id=1").run(updateId + 1);
    });
  }

  next(): Work | undefined {
    const row = this.db.prepare(
      "SELECT payload,transcript FROM inbox WHERE completed=0 ORDER BY update_id LIMIT 1",
    ).get() as { payload: string; transcript: string | null } | undefined;
    return row ? { ...JSON.parse(row.payload) as Incoming, transcript: row.transcript } : undefined;
  }

  transcribed(updateId: number, text: string): void {
    this.db.prepare("UPDATE inbox SET transcript=? WHERE update_id=? AND completed=0").run(text, updateId);
  }

  complete(work: Incoming, replies: string[], failed = false, metadata?: ReplyMetadata): void {
    this.transaction(() => {
      if (metadata) {
        this.db.prepare(`INSERT OR IGNORE INTO reply_metadata
          (update_id,request_id,conversation_id,submission_id,answer_entry_id,provider,model)
          VALUES (?,?,?,?,?,?,?)`).run(work.updateId, metadata.requestId, metadata.conversationId,
            metadata.submissionId, metadata.answerEntryId, metadata.provider, metadata.model);
      }
      for (const [part, text] of replies.entries()) {
        this.db.prepare("INSERT OR IGNORE INTO outbox(update_id,part,chat_id,text) VALUES (?,?,?,?)")
          .run(work.updateId, part, work.chatId, text);
      }
      this.db.prepare("UPDATE inbox SET completed=? WHERE update_id=?").run(failed ? 2 : 1, work.updateId);
    });
  }

  nextDelivery(): Delivery | undefined {
    return this.db.prepare(
      "SELECT id,chat_id AS chatId,text,EXISTS(SELECT 1 FROM reply_metadata WHERE update_id=outbox.update_id) AS rateable FROM outbox WHERE status='pending' ORDER BY id LIMIT 1",
    ).get() as Delivery | undefined;
  }

  sending(id: number): void {
    this.transition(id, "pending", "sending");
  }

  delivered(id: number, messageId: number): void {
    const result = this.db.prepare(
      "UPDATE outbox SET status='sent',telegram_message_id=? WHERE id=? AND status='sending'",
    ).run(messageId, id);
    if (result.changes !== 1) throw new Error(`Delivery ${id}: expected an in-flight reply.`);
  }

  uncertain(id: number): void {
    this.transition(id, "sending", "uncertain");
  }

  uncertainDeliveries(): Delivery[] {
    return this.db.prepare(
      "SELECT id,chat_id AS chatId,text,EXISTS(SELECT 1 FROM reply_metadata WHERE update_id=outbox.update_id) AS rateable FROM outbox WHERE status='uncertain' ORDER BY id",
    ).all() as Delivery[];
  }

  recordFeedback(input: {
    updateId: number; deliveryId: number; chatId: number; messageId: number;
    userId: number; vote: "up" | "down";
  }): boolean {
    let accepted = false;
    this.transaction(() => {
      const delivery = this.db.prepare(`SELECT o.id FROM outbox o JOIN reply_metadata r ON r.update_id=o.update_id
        WHERE o.id=? AND o.chat_id=? AND o.telegram_message_id=? AND o.status='sent'`)
        .get(input.deliveryId, input.chatId, input.messageId);
      if (delivery) {
        this.db.prepare(`INSERT INTO feedback(delivery_id,user_id,vote,last_update_id) VALUES (?,?,?,?)
          ON CONFLICT(delivery_id) DO UPDATE SET
            vote=excluded.vote, last_update_id=excluded.last_update_id,
            updated_at=CASE WHEN feedback.vote<>excluded.vote THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE feedback.updated_at END
          WHERE excluded.last_update_id>feedback.last_update_id`)
          .run(input.deliveryId, input.userId, input.vote, input.updateId);
        accepted = true;
      }
      this.db.prepare("UPDATE cursor SET value=MAX(value, ?) WHERE id=1").run(input.updateId + 1);
    });
    return accepted;
  }

  close(): void {
    this.db.close();
  }

  private transition(id: number, from: string, to: string): void {
    const result = this.db.prepare("UPDATE outbox SET status=? WHERE id=? AND status=?").run(to, id, from);
    if (result.changes !== 1) throw new Error(`Delivery ${id}: expected status ${from}.`);
  }

  private transaction(operation: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      operation();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
