import { DatabaseSync } from "node:sqlite";
import { homedir } from "node:os";
import { join } from "node:path";
import { describeError } from "./errors.js";

try {
  const directory = process.env.FINROD_DATA_DIR ?? join(homedir(), ".local", "share", "finrod");
  const db = new DatabaseSync(join(directory, "telegram.sqlite"), { readOnly: true });
  try {
    const query = db.prepare(`SELECT
      f.delivery_id, f.user_id, f.vote, f.created_at, f.updated_at,
      o.chat_id, o.telegram_message_id, o.part, o.update_id AS source_update_id,
      json_extract(i.payload,'$.messageId') AS source_message_id,
      r.request_id, r.conversation_id, r.submission_id, r.answer_entry_id, r.provider, r.model
      FROM feedback f
      JOIN outbox o ON o.id=f.delivery_id
      JOIN inbox i ON i.update_id=o.update_id
      JOIN reply_metadata r ON r.update_id=o.update_id
      ORDER BY f.delivery_id`);
    for (const row of query.iterate()) process.stdout.write(`${JSON.stringify(row)}\n`);
  } finally {
    db.close();
  }
} catch (error) {
  console.error("Feedback export failed:", describeError(error));
  process.exitCode = 1;
}
