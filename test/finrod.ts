import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { after } from "node:test";

export type WikiChange = { change: number; pages: { path: string; added: string[]; removed: string[] }[] };
export type Message = { id: number; role: "user" | "assistant"; text: string; error?: string };
export type Live = { busy: boolean; partial?: string };
export type State = { messages: Message[]; live: Live };

export const GATEWAY_TOKEN = "test-gateway-token-0123456789abcdef";
/** A request as the gateway sends it, with the token. */
export function call(url: string, init: RequestInit = {}) {
  return fetch(url, { ...init, headers: { authorization: `Bearer ${GATEWAY_TOKEN}`, ...(init.headers as Record<string, string>) } });
}

const dataDirs: string[] = [];
const servers: ChildProcess[] = [];

after(async () => {
  for (const server of servers) server.kill("SIGKILL");
  await Promise.all(dataDirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

export async function newDataDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "finrod-test-"));
  dataDirs.push(dir);
  await writeFile(join(dir, "memory-key"), "correct horse battery staple\n");
  return dir;
}

export async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/**
 * Start the built server on `dataDir` with the OpenRouter stub preloaded, or, with `live`, on the real Claude models
 * through the Claude Code login on this machine. The wiki waits an hour unless told otherwise.
 */
export async function startServer(dataDir: string, options: { hang: boolean; live?: boolean; model?: string; wikiModel?: string; wikiIdleSeconds?: number; wikiCleanupSeconds?: number; port?: number; canaryFile?: string }) {
  const port = options.port ?? (await freePort());
  const provider = options.live
    ? { FINROD_PROVIDER: "claude-directsdk", CLAUDE_DIRECTSDK_COMMAND: join(homedir(), ".local", "bin", "claude"), DISABLE_AUTOUPDATER: "1" }
    : { OPENROUTER_API_KEY: "test-key", FINROD_STUB_HANG: options.hang ? "1" : "0" };
  const child = spawn(process.execPath, [...(options.live ? [] : ["--import", "./test/stub-openrouter.mjs"]), "dist/server/main.js"], {
    env: {
      ...process.env,
      ...provider,
      FINROD_PORT: String(port),
      FINROD_DATA_DIR: dataDir,
      ...(options.model ? { FINROD_MODEL: options.model } : {}),
      ...(options.wikiModel ? { FINROD_WIKI_MODEL: options.wikiModel } : {}),
      ...(options.canaryFile ? { FINROD_CANARY_FILE: options.canaryFile } : {}),
      FINROD_GATEWAY_TOKEN: GATEWAY_TOKEN,
      FINROD_TRANSCRIBE_COMMAND: "test/stub-transcribe.mjs",
      FINROD_MEMORY_KEY_FILE: join(dataDir, "memory-key"),
      FINROD_WIKI_IDLE_SECONDS: String(options.wikiIdleSeconds ?? 3600),
      FINROD_WIKI_CLEANUP_SECONDS: String(options.wikiCleanupSeconds ?? 7 * 24 * 3600),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  servers.push(child);
  // Everything the process writes, as the system log would keep it.
  let output = "";
  child.stderr!.on("data", (data: Buffer) => {
    output += data.toString();
    process.stderr.write(data);
  });
  await new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`Server exited with code ${code} before listening.`)));
    child.stdout!.on("data", (data: Buffer) => {
      output += data.toString();
      if (data.toString().includes("Finrod listening")) resolve();
    });
  });
  return { base: `http://127.0.0.1:${port}`, output: () => output, kill: () => new Promise((resolve) => (child.exitCode !== null || child.signalCode !== null ? resolve(undefined) : (child.once("exit", resolve), child.kill("SIGKILL")))) };
}

/** The facts of a page, without their sources. */
const facts = (page?: { content: string }) => new Set((page?.content ?? "").split("\n").flatMap((line) => (line.startsWith("- ") ? [line.slice(2).replace(/ \(source: [^()]+\)$/, "")] : [])));

/** The changes the wiki recorded in `dataDir`'s default profile, oldest first, each page with the facts it gained and lost, once `done` accepts them. */
export async function wikiChanges(dataDir: string, done: (changes: WikiChange[]) => boolean | Promise<boolean>, ms = 15_000): Promise<WikiChange[]> {
  const dir = join(dataDir, "profiles", "default", "wiki-changes");
  for (const end = Date.now() + ms; Date.now() < end; await new Promise((resolve) => setTimeout(resolve, 200))) {
    const files = (await readdir(dir).catch(() => [])).filter((name) => name.endsWith(".json")).sort((a, b) => parseInt(a) - parseInt(b));
    const changes = await Promise.all(files.map(async (name) => {
      const record = JSON.parse(await readFile(join(dir, name), "utf8")) as Record<string, { before?: { content: string }; after?: { content: string } }>;
      const pages = Object.entries(record).flatMap(([path, { before, after }]) => {
        const [was, is] = [facts(before), facts(after)];
        const page = { path, added: [...is].filter((fact) => !was.has(fact)), removed: [...was].filter((fact) => !is.has(fact)) };
        return page.added.length || page.removed.length ? [page] : [];
      });
      return { change: parseInt(name), pages };
    }));
    const changed = changes.filter((change) => change.pages.length);
    if (await done(changed)) return changed;
  }
  throw new Error("Timed out waiting for the wiki to change.");
}

export async function post(base: string, path: string, body?: unknown) {
  const response = await call(base + path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.ok, true, `POST ${path} returned ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

/** Follow a conversation's event stream until `done` accepts a state; return every state seen. */
export async function follow(base: string, id: number, done: (state: State) => boolean, ms = 15_000): Promise<State[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("Timed out waiting for the conversation to reach the expected state.")), ms);
  const seen: State[] = [];
  const state: State = { messages: [], live: { busy: false } };
  try {
    const response = await call(`${base}/api/conversations/${id}/events`, { signal: abort.signal });
    const decoder = new TextDecoder();
    let buffered = "";
    for await (const chunk of response.body!) {
      buffered += decoder.decode(chunk as Uint8Array, { stream: true });
      for (let end = buffered.indexOf("\n\n"); end >= 0; end = buffered.indexOf("\n\n")) {
        const event = /^event: (\w+)\ndata: (.*)$/m.exec(buffered.slice(0, end));
        buffered = buffered.slice(end + 2);
        if (!event) continue;
        if (event[1] === "messages") state.messages = JSON.parse(event[2]!);
        if (event[1] === "live") state.live = JSON.parse(event[2]!);
        seen.push(structuredClone(state));
        if (done(state)) return seen;
      }
    }
    throw new Error("The event stream ended before the conversation reached the expected state.");
  } finally {
    clearTimeout(timer);
    abort.abort();
  }
}
