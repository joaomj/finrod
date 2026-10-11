import { lstat } from "node:fs/promises";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export async function openChatgptSource(dataDir: string) {
  for (const part of ["sources", "sources/chatgpt", "sources/chatgpt/index.sqlite"]) {
    const path = join(dataDir, part);
    let stat;
    try { stat = await lstat(path); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && part !== "sources/chatgpt/index.sqlite") return undefined;
      throw new Error(`ChatGPT source: cannot inspect ${path}. Complete the import or remove the incomplete source directory.`, { cause: error });
    }
    if (stat.isSymbolicLink() || (part.endsWith(".sqlite") ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error(`ChatGPT source: ${path} must be a regular ${part.endsWith(".sqlite") ? "file" : "directory"}, not a symlink.`);
    }
  }
  const file = join(dataDir, "sources/chatgpt/index.sqlite");
  const query = <T>(run: (db: DatabaseSync) => T): T => {
    const db = new DatabaseSync(file, { readOnly: true });
    try { db.exec("PRAGMA query_only=ON"); return run(db); } finally { db.close(); }
  };
  query(db => {
    const version = db.prepare("PRAGMA user_version").get() as { user_version: number };
    if (version.user_version !== 1) throw new Error("ChatGPT source: unsupported index schema. Rebuild the index with schema version 1 before importing it.");
    db.prepare("SELECT id,title FROM conversations LIMIT 0").all();
    db.prepare("SELECT rowid,text,searchable FROM messages LIMIT 0").all();
    db.prepare("SELECT rowid FROM messages_fts LIMIT 0").all();
  });
  return {
    search(text: string | undefined, role: string | undefined, limit: number) {
      return query(db => text ? db.prepare(`
        SELECT c.title,m.conversation_id,m.message_id,m.node_id,m.role,m.created_at,
          snippet(messages_fts,1,'[',']',' … ',40) AS excerpt
        FROM messages_fts JOIN messages m ON m.rowid=messages_fts.rowid
        JOIN conversations c ON c.id=m.conversation_id
        WHERE messages_fts MATCH ? AND (? IS NULL OR m.role=?)
        ORDER BY bm25(messages_fts) LIMIT ?
      `).all(text, role ?? null, role ?? null, limit) : db.prepare(`
        SELECT id AS conversation_id,title,created_at,updated_at FROM conversations
        ORDER BY created_at DESC,id LIMIT ?
      `).all(limit));
    },
    conversation(id: string, offset: number, limit: number) {
      return query(db => {
        const conversation = db.prepare("SELECT id,title,created_at,updated_at,archive_member FROM conversations WHERE id=?").get(id);
        if (!conversation) throw new Error("ChatGPT conversation ID not found.");
        const total = (db.prepare("SELECT count(*) AS total FROM messages WHERE conversation_id=? AND searchable=1").get(id) as { total: number }).total;
        const messages = db.prepare(`SELECT message_id,node_id,parent_node_id,role,created_at,
          substr(text,1,1200) AS excerpt,length(text) AS text_characters FROM messages
          WHERE conversation_id=? AND searchable=1 ORDER BY rowid LIMIT ? OFFSET ?`).all(id,limit,offset);
        return { source: "chatgpt", conversation, messages, total, nextOffset: offset + messages.length < total ? offset + messages.length : null,
          note: "Mapping order, not reconstructed branch order. Excerpts stop at 1200 characters; use source_message for full text. Reasoning and non-text records are omitted." };
      });
    },
    message(conversation: string, node: string, offset: number, limit: number) {
      return query(db => {
        const message = db.prepare(`SELECT conversation_id,message_id,node_id,parent_node_id,role,created_at,
          substr(text,?+1,?) AS text,length(text) AS text_characters FROM messages
          WHERE conversation_id=? AND node_id=? AND searchable=1`).get(offset,limit,conversation,node) as { text_characters: number } | undefined;
        if (!message) throw new Error("ChatGPT text message not found. Use a node ID returned by source_search or source_conversation.");
        return { source: "chatgpt", message, nextOffset: offset + limit < message.text_characters ? offset + limit : null };
      });
    },
  };
}
