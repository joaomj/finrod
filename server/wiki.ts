import { mkdir, readFile, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool } from "@earendil-works/pi-durable";

/** The page that goes into every prompt; every other page is reached through the index. */
export const CORE_PAGE = "core.md";
export const MAX_CORE_CHARS = 2_000;
export const MAX_PAGE_CHARS = 8_000;
/** The index goes into every message, so it stays short: past this many pages, an update must merge before it adds. */
export const MAX_INDEX_PAGES = 60;
const INDEX = "index.md";
const PAGE_PATH = /^(?:[a-z0-9-]+\/)?[a-z0-9-]+\.md$/;
const SOURCE = /\(source: [^()]+\)$/;

/** One page as a change saw it; `undefined` when the page did not exist. */
type PageState = { content: string; summary: string } | undefined;
/** What one dreaming run did to the wiki: each page it touched, as it was before the run and as the run left it. */
type ChangeRecord = Record<string, { before: PageState; after: PageState }>;
/** What the user is shown about one page of a change: the facts added and removed, without their sources. */
export type PageChange = { path: string; added: string[]; removed: string[] };

/**
 * The user's wiki: Markdown pages in `<profile>/wiki`, and `index.md`, which lists every page but the core page with
 * its one-line summary. Every change a dreaming run makes is recorded in `<profile>/wiki-changes`, so it can be undone.
 */
export class Wiki {
  private writing: Promise<unknown> = Promise.resolve();

  constructor(
    readonly dir: string,
    private readonly changesDir: string,
  ) {}

  async read(path: string): Promise<string | undefined> {
    try {
      return await readFile(join(this.dir, path), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw new Error(`Reading the wiki page ${path} failed.`, { cause: error });
    }
  }

  /** Each indexed page and its summary, in index order. */
  async index(): Promise<Map<string, string>> {
    const lines = ((await this.read(INDEX)) ?? "").split("\n");
    return new Map(lines.flatMap((line) => {
      const entry = /^- \[([^\]]+)\]\([^)]*\): (.*)$/.exec(line);
      return entry ? [[entry[1]!, entry[2]!] as const] : [];
    }));
  }

  /** The core page and the index, as the chat model and the dreaming run see them. */
  async overview(): Promise<{ core: string; index: string }> {
    return { core: ((await this.read(CORE_PAGE)) ?? "").trim(), index: ((await this.read(INDEX)) ?? "").trim() };
  }

  /** Write or delete a page as part of change `change`; the first touch of a page in a change records its old state. */
  async set(change: number, path: string, page: PageState): Promise<void> {
    await this.serialized(async () => {
      const record = await this.record(change);
      record[path] ??= { before: await this.state(path), after: undefined };
      record[path].after = page;
      await this.put(path, page);
      await this.save(join(this.changesDir, `${change}.json`), JSON.stringify(record));
    });
  }

  /** The facts each page gained and lost in change `change`. */
  async changes(change: number): Promise<PageChange[]> {
    const facts = (page: PageState) => new Set((page?.content ?? "").split("\n").flatMap((line) => (/^\s*- /.test(line) ? [line.replace(/^\s*- /, "").replace(SOURCE, "").trim()] : [])));
    return Object.entries(await this.record(change)).flatMap(([path, { before, after }]) => {
      const [was, is] = [facts(before), facts(after)];
      const added = [...is].filter((fact) => !was.has(fact));
      const removed = [...was].filter((fact) => !is.has(fact));
      return added.length || removed.length ? [{ path, added, removed }] : [];
    });
  }

  /**
   * Put back each page of change `change` that is still as the change left it; a page changed since keeps the newer
   * version. Returns how many pages went back; a second undo finds none. `undefined` when there is no such change.
   */
  async undo(change: number): Promise<number | undefined> {
    return this.serialized(async () => {
      let record: ChangeRecord;
      try {
        record = JSON.parse(await readFile(join(this.changesDir, `${change}.json`), "utf8")) as ChangeRecord;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw new Error(`Reading the wiki change ${change} failed.`, { cause: error });
      }
      let restored = 0;
      for (const [path, { before, after }] of Object.entries(record)) {
        if (JSON.stringify(await this.state(path)) !== JSON.stringify(after) || JSON.stringify(before) === JSON.stringify(after)) continue;
        await this.put(path, before);
        restored++;
      }
      return restored;
    });
  }

  private async state(path: string): Promise<PageState> {
    const content = await this.read(path);
    return content === undefined ? undefined : { content, summary: (await this.index()).get(path) ?? "" };
  }

  private async put(path: string, page: PageState) {
    const file = join(this.dir, path);
    if (page) {
      await mkdir(dirname(file), { recursive: true, mode: 0o700 });
      await this.save(file, page.content);
    } else {
      await rm(file, { force: true });
      // A folder goes with its last page.
      if (dirname(file) !== this.dir) {
        await rmdir(dirname(file)).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
        });
      }
    }
    if (path === CORE_PAGE) return;
    const index = await this.index();
    if (page) index.set(path, page.summary);
    else index.delete(path);
    const lines = [...index].sort(([a], [b]) => a.localeCompare(b)).map(([name, summary]) => `- [${name}](${name}): ${summary}`);
    await this.save(join(this.dir, INDEX), `# Index\n\n${lines.join("\n")}\n`);
  }

  private async record(change: number): Promise<ChangeRecord> {
    try {
      return JSON.parse(await readFile(join(this.changesDir, `${change}.json`), "utf8")) as ChangeRecord;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw new Error(`Reading the wiki change ${change} failed.`, { cause: error });
    }
  }

  private async save(file: string, text: string) {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(`${file}.tmp`, text, { mode: 0o600 });
    await rename(`${file}.tmp`, file);
  }

  /** Changes run one at a time, so a change record always matches the pages. */
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const run = this.writing.then(work);
    this.writing = run.catch(() => {});
    return run;
  }
}

/** Why a page cannot be written, or `undefined` when it can. */
function refusal(path: string, content: string): string | undefined {
  if (!PAGE_PATH.test(path) || path === INDEX) return `"${path}" is not a page path. Use lowercase letters, digits, and hyphens, at most one folder, ending in .md; index.md is kept for you.`;
  const limit = path === CORE_PAGE ? MAX_CORE_CHARS : MAX_PAGE_CHARS;
  if (content.length > limit) return `The page has ${content.length} characters; the limit for ${path} is ${limit}. Keep only what matters, or move details to another page.`;
  const loose = content.split("\n").filter((line) => line.trim() && !/^#{1,6} /.test(line) && !(/^\s*- /.test(line) && SOURCE.test(line.trim())));
  if (loose.length) return `Every line must be a heading or a fact as a list item ending in "(source: ...)". These are not: ${loose.slice(0, 3).map((line) => JSON.stringify(line)).join(", ")}`;
  return undefined;
}

const text = (value: string) => ({ output: [{ type: "text" as const, text: value }] });

/** `wiki` lets a model read pages; `wiki-edit` lets the dreaming run change them, recorded under its conversation's ID. */
export function wikiTools(wiki: Wiki) {
  const readPage = defineTool({
    name: "read_page",
    description: "Read a page of your notes about the user, by its path in the index.",
    parameters: Type.Object({ path: Type.String({ description: "The page's path, such as people/ana.md." }) }),
    replay: "safe",
    execute: async (args) => {
      const page = PAGE_PATH.test(args.path) ? await wiki.read(args.path) : undefined;
      return text(page ?? `There is no page ${args.path}.`);
    },
  });
  const writePage = defineTool({
    name: "write_page",
    description: "Create or replace a whole wiki page.",
    parameters: Type.Object({
      path: Type.String({ description: "core.md, or a page such as people/ana.md." }),
      summary: Type.String({ minLength: 1, maxLength: 200, description: "One line for the index: what the page holds. Ignored for core.md." }),
      content: Type.String({ minLength: 1, description: "The whole page in Markdown: headings, and one fact per list item ending in (source: ...)." }),
    }),
    replay: "safe",
    execute: async (args, api) => {
      const content = `${args.content.trim()}\n`;
      const refused = refusal(args.path, content);
      if (refused) throw new Error(refused);
      const index = await wiki.index();
      if (args.path !== CORE_PAGE && !index.has(args.path) && index.size >= MAX_INDEX_PAGES) {
        throw new Error(`The index already lists ${index.size} pages, the most it may. Merge pages or delete one before you add ${args.path}.`);
      }
      await wiki.set(api.conversationId, args.path, { content, summary: args.path === CORE_PAGE ? "" : args.summary.replace(/\s+/g, " ").trim() });
      return text(`Wrote ${args.path}.`);
    },
  });
  const deletePage = defineTool({
    name: "delete_page",
    description: "Delete a wiki page that holds nothing worth keeping.",
    parameters: Type.Object({ path: Type.String() }),
    replay: "safe",
    execute: async (args, api) => {
      if (!PAGE_PATH.test(args.path) || (await wiki.read(args.path)) === undefined) return text(`There is no page ${args.path}.`);
      await wiki.set(api.conversationId, args.path, undefined);
      return text(`Deleted ${args.path}.`);
    },
  });
  return {
    reading: defineExtension({ name: "wiki", tools: [readPage] }),
    editing: defineExtension({ name: "wiki-edit", tools: [writePage, deletePage] }),
  };
}
