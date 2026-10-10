import { constants } from "node:fs";
import { mkdir, open, readdir, rename, unlink } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

export async function knowledgeExtension(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const slug = Type.String({ pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$", maxLength: 80 });
  const path = (topic: string) => {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(topic) || topic.length > 80) {
      throw new Error("Topic ID must contain lowercase letters, digits, and single hyphens; maximum 80 characters.");
    }
    return join(directory, `${topic}.md`);
  };
  const content = (text: string) => ({ content: [{ type: "text" as const, text }] });
  const syncDirectory = async () => {
    const handle = await open(directory, constants.O_RDONLY);
    try { await handle.sync(); } finally { await handle.close(); }
  };
  return defineExtension({
    name: "finrod-knowledge",
    tools: [
      defineTool({
        name: "topics_list",
        description: "List saved topic IDs. Read a topic before resuming or changing it.",
        parameters: Type.Object({}),
        replay: "safe",
        execute: async () => {
          const entries = await readdir(directory, { withFileTypes: true });
          const topics = entries.filter(entry => entry.isFile() && entry.name.endsWith(".md"))
            .map(entry => entry.name.slice(0, -3)).sort();
          return content(topics.length ? topics.join("\n") : "No saved topics.");
        },
      }),
      defineTool({
        name: "topic_read",
        description: "Read one saved topic, including its summary, open questions, links, and sources.",
        parameters: Type.Object({ topic: slug }),
        replay: "safe",
        execute: async ({ topic }) => {
          const handle = await open(path(topic), constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const stat = await handle.stat();
            if (!stat.isFile() || stat.size > 64 * 1024) throw new Error("Topic must be a regular Markdown file of at most 64 KiB.");
            return content(await handle.readFile("utf8"));
          } finally { await handle.close(); }
        },
      }),
      defineTool({
        name: "topic_save",
        description: "Save or replace a topic only on explicit user request. Use Markdown with summary, open questions, related topic links, and source URLs. Read existing topics first; preserve relevant facts and sources. Use this to park a tangent or correct a saved topic.",
        parameters: Type.Object({ topic: slug, markdown: Type.String({ minLength: 1, maxLength: 50_000 }) }),
        replay: "unsafe",
        executionMode: "sequential",
        execute: async ({ topic, markdown }, api) => {
          const body = `${markdown.trim()}\n\nConversation reference: conversation ${api.conversationId}, tool task ${api.taskId}.\n`;
          if (Buffer.byteLength(body) > 64 * 1024) throw new Error("Topic exceeds the 64 KiB limit.");
          const target = path(topic);
          const temporary = join(directory, `.${randomUUID()}.tmp`);
          const handle = await open(temporary, "wx", 0o600);
          try {
            await handle.writeFile(body, "utf8");
            await handle.sync();
          } finally { await handle.close(); }
          await rename(temporary, target);
          await syncDirectory();
          return content(`Saved topic: ${topic}`);
        },
      }),
      defineTool({
        name: "topic_delete",
        description: "Delete a saved topic only on explicit user request. This deletes its Markdown page, not conversation history or backups. Tell the user about that distinction.",
        parameters: Type.Object({ topic: slug }),
        replay: "unsafe",
        executionMode: "sequential",
        execute: async ({ topic }) => {
          await unlink(path(topic));
          await syncDirectory();
          return content(`Deleted topic ${topic}. Conversation history and backups are unchanged.`);
        },
      }),
    ],
  });
}
