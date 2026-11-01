import { randomBytes } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

export type Memory = { id: string; text: string; status: "pending" | "saved"; createdAt: number };

export const MAX_MEMORY_CHARS = 300;

const normalize = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * What Finrod keeps about the user, in one JSON file of the profile. A memory starts pending and reaches the
 * model's instructions only after the user approves it.
 */
export class Memories {
  private readonly listeners = new Set<() => void>();
  private writing: Promise<void> = Promise.resolve();

  private constructor(
    private readonly path: string,
    private items: Memory[],
  ) {}

  static async open(path: string): Promise<Memories> {
    try {
      return new Memories(path, JSON.parse(await readFile(path, "utf8")) as Memory[]);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return new Memories(path, []);
      throw new Error(`Memory file ${path} is unreadable. Fix or move it; Finrod will not overwrite it.`, { cause: error });
    }
  }

  /** Newest first. */
  list(): Memory[] {
    return [...this.items].sort((a, b) => b.createdAt - a.createdAt);
  }

  saved(): Memory[] {
    return this.list().filter((item) => item.status === "saved");
  }

  get(id: string): Memory | undefined {
    return this.items.find((item) => item.id === id);
  }

  /** Propose a memory for review; a text already kept or pending returns that memory. */
  async propose(text: string): Promise<Memory> {
    const clean = text.trim().slice(0, MAX_MEMORY_CHARS);
    const known = this.items.find((item) => normalize(item.text) === normalize(clean));
    if (known) return known;
    const memory: Memory = { id: `m-${randomBytes(4).toString("hex")}`, text: clean, status: "pending", createdAt: Date.now() };
    this.items.push(memory);
    await this.changed();
    return memory;
  }

  async approve(id: string): Promise<boolean> {
    const memory = this.get(id);
    if (!memory) return false;
    memory.status = "saved";
    await this.changed();
    return true;
  }

  async edit(id: string, text: string): Promise<boolean> {
    const memory = this.get(id);
    if (!memory) return false;
    memory.text = text.trim().slice(0, MAX_MEMORY_CHARS);
    await this.changed();
    return true;
  }

  async remove(id: string): Promise<boolean> {
    if (!this.get(id)) return false;
    this.items = this.items.filter((item) => item.id !== id);
    await this.changed();
    return true;
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private async changed() {
    const snapshot = JSON.stringify(this.items, null, 2);
    const write = this.writing.then(async () => {
      await writeFile(`${this.path}.tmp`, snapshot, { mode: 0o600 });
      await rename(`${this.path}.tmp`, this.path);
    });
    this.writing = write.catch(() => {});
    await write;
    for (const listener of this.listeners) listener();
  }
}

export const REMEMBER_TOOL = "remember";

/** The tool the model uses to propose a memory. The app shows the proposal; only an approved one enters the prompt. */
export function remembering(memories: Memories) {
  const remember = defineTool({
    name: REMEMBER_TOOL,
    description: "Propose to remember a lasting fact about the user or a lasting preference. The user reviews it before it is kept.",
    parameters: Type.Object({
      text: Type.String({ minLength: 1, maxLength: MAX_MEMORY_CHARS, description: "One short sentence, in the user's language." }),
    }),
    replay: "safe",
    execute: async (args) => {
      const memory = await memories.propose(args.text);
      return { output: [{ type: "text", text: `Proposed to the user (id ${memory.id}). Continue the answer; do not mention it.` }] };
    },
  });
  return defineExtension({ name: "memory", tools: [remember] });
}
