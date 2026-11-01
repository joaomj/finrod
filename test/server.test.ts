import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, test } from "node:test";

type Message = { id: number; role: "user" | "assistant"; text: string; error?: string };
type Live = { busy: boolean; partial?: string };
type State = { messages: Message[]; live: Live };

let dataDir: string;
const servers: ChildProcess[] = [];

before(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "finrod-test-"));
});

after(async () => {
  for (const server of servers) server.kill("SIGKILL");
  await rm(dataDir, { recursive: true, force: true });
});

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, "127.0.0.1", resolve));
  const { port } = probe.address() as { port: number };
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

/** Start the built server on `dataDir` with the OpenRouter stub preloaded. */
async function startServer(options: { hang: boolean }) {
  const port = await freePort();
  const child = spawn(process.execPath, ["--import", "./test/stub-openrouter.mjs", "dist/server/main.js"], {
    env: {
      ...process.env,
      OPENROUTER_API_KEY: "test-key",
      FINROD_PORT: String(port),
      FINROD_DATA_DIR: dataDir,
      FINROD_STUB_HANG: options.hang ? "1" : "0",
    },
    stdio: ["ignore", "pipe", "inherit"],
  });
  servers.push(child);
  await new Promise<void>((resolve, reject) => {
    child.once("exit", (code) => reject(new Error(`Server exited with code ${code} before listening.`)));
    child.stdout!.on("data", (data: Buffer) => data.toString().includes("Finrod listening") && resolve());
  });
  return { base: `http://127.0.0.1:${port}`, kill: () => new Promise((resolve) => (child.once("exit", resolve), child.kill("SIGKILL"))) };
}

async function post(base: string, path: string, body?: unknown) {
  const response = await fetch(base + path, { method: "POST", ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  assert.equal(response.ok, true, `POST ${path} returned ${response.status}`);
  return (await response.json()) as Record<string, unknown>;
}

/** Follow a conversation's event stream until `done` accepts a state; return every state seen. */
async function follow(base: string, id: number, done: (state: State) => boolean): Promise<State[]> {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(new Error("Timed out waiting for the conversation to reach the expected state.")), 15_000);
  const seen: State[] = [];
  const state: State = { messages: [], live: { busy: false } };
  try {
    const response = await fetch(`${base}/api/conversations/${id}/events`, { signal: abort.signal });
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

const answered = (state: State) => !state.live.busy && state.messages.some((m) => m.role === "assistant" && !m.error);

test("a message streams its answer and the conversation reopens with the same history", async () => {
  const { base, kill } = await startServer({ hang: false });
  try {
    const id = (await post(base, "/api/conversations")).id as number;
    const watching = follow(base, id, answered);
    await post(base, `/api/conversations/${id}/messages`, { text: "hello", requestId: "request-0001" });
    const states = await watching;

    assert.ok(states.some((s) => s.live.busy && s.live.partial === "Stub answer"), "the partial answer was streamed before it finished");
    const final = states.at(-1)!;
    assert.deepEqual(
      final.messages.map(({ role, text }) => ({ role, text })),
      [
        { role: "user", text: "hello" },
        { role: "assistant", text: "Stub answer to: hello" },
      ],
    );

    const reopened = await follow(base, id, (state) => state.messages.length > 0);
    assert.deepEqual(reopened.at(-1)!.messages, final.messages);
    const list = (await (await fetch(`${base}/api/conversations`)).json()) as { id: number; title: string }[];
    assert.deepEqual(list.map(({ id, title }) => ({ id, title })), [{ id, title: "hello" }]);
  } finally {
    await kill();
  }
});

test("a server killed mid-answer restarts without losing or duplicating the conversation", async () => {
  const first = await startServer({ hang: true });
  const id = (await post(first.base, "/api/conversations")).id as number;
  await post(first.base, `/api/conversations/${id}/messages`, { text: "hello", requestId: "request-0002" });
  await follow(first.base, id, (state) => state.live.partial === "Stub answer");
  await first.kill();

  const second = await startServer({ hang: false });
  try {
    const states = await follow(second.base, id, answered);
    const messages = states.at(-1)!.messages;
    assert.deepEqual(
      messages.map(({ role, text, error }) => ({ role, text, error })),
      [
        { role: "user", text: "hello", error: undefined },
        { role: "assistant", text: "Stub answer", error: "Interrupted." },
        { role: "assistant", text: "Stub answer to: hello", error: undefined },
      ],
    );

    // The phone retries the send it never saw confirmed; the repeat must change nothing.
    await post(second.base, `/api/conversations/${id}/messages`, { text: "hello", requestId: "request-0002" });
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    const settled = await follow(second.base, id, (state) => !state.live.busy);
    assert.deepEqual(settled.at(-1)!.messages, messages);
  } finally {
    await second.kill();
  }
});
