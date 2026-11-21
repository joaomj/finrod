import assert from "node:assert/strict";
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { test } from "node:test";
import { call, follow, newDataDir, post, startServer, wikiChanges, type Message, type State, type WikiChange } from "./finrod.ts";

const answered = (state: State) => !state.live.busy && state.messages.some((m) => m.role === "assistant" && !m.error);

test("a message streams its answer and the conversation reopens with the same history", async () => {
  const { base, kill } = await startServer(await newDataDir(), { hang: false });
  try {
    const id = ((await (await call(`${base}/api/stream`)).json()) as { id: number }).id;
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
    assert.equal(((await (await call(`${base}/api/stream`)).json()) as { id: number }).id, id, "the stream stays the same conversation");
  } finally {
    await kill();
  }
});

test("a server killed mid-answer restarts without losing or duplicating the conversation", async () => {
  const dir = await newDataDir();
  const first = await startServer(dir, { hang: true });
  const id = ((await (await call(`${first.base}/api/stream`)).json()) as { id: number }).id;
  await post(first.base, `/api/conversations/${id}/messages`, { text: "hello", requestId: "request-0002" });
  await follow(first.base, id, (state) => state.live.partial === "Stub answer");
  await first.kill();

  const second = await startServer(dir, { hang: false });
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

test("after a model change, an existing conversation answers with the new model", async () => {
  const dir = await newDataDir();
  const first = await startServer(dir, { hang: false });
  const id = ((await (await call(`${first.base}/api/stream`)).json()) as { id: number }).id;
  await post(first.base, `/api/conversations/${id}/messages`, { text: "which model?", requestId: "request-0003" });
  await follow(first.base, id, answered);
  await first.kill();

  const second = await startServer(dir, { hang: false, model: "openai/gpt-4o-mini" });
  try {
    await post(second.base, `/api/conversations/${id}/messages`, { text: "which model?", requestId: "request-0004" });
    const states = await follow(second.base, id, (state) => !state.live.busy && state.messages.length === 4);
    assert.deepEqual(
      states.at(-1)!.messages.filter((m) => m.role === "assistant").map(({ text, error }) => ({ text, error })),
      [
        { text: "Model deepseek/deepseek-v4.1-flash-1017", error: undefined },
        { text: "Model openai/gpt-4o-mini", error: undefined },
      ],
    );
  } finally {
    await second.kill();
  }
});

test("every answer waits for the gateway until it is acknowledged, across restarts, and only the gateway gets in", async () => {
  const dir = await newDataDir();
  const first = await startServer(dir, { hang: false });
  const answers = async (base: string) => {
    const response = await call(`${base}/api/gateway/answers`);
    assert.equal(response.status, 200);
    return (await response.json()) as { conversation: number; answers: Message[] };
  };
  for (const path of ["/api/stream", "/api/gateway/answers", "/api/conversations/1/messages"]) {
    assert.equal((await fetch(first.base + path)).status, 401, `${path} without the gateway token is refused`);
  }
  const id = ((await (await call(`${first.base}/api/stream`)).json()) as { id: number }).id;
  await post(first.base, `/api/conversations/${id}/messages`, { text: "hello", requestId: "request-0005" });
  await follow(first.base, id, answered);

  const pending = await answers(first.base);
  assert.equal(pending.conversation, id);
  assert.deepEqual(pending.answers.map(({ text }) => text), ["Stub answer to: hello"]);
  await first.kill();

  const second = await startServer(dir, { hang: false });
  try {
    assert.deepEqual((await answers(second.base)).answers, pending.answers, "an unacknowledged answer survives a restart");
    const ack = await call(`${second.base}/api/gateway/answers/ack`, { method: "POST", body: JSON.stringify({ id: pending.answers[0]!.id }) });
    assert.equal(ack.status, 200);
    assert.deepEqual((await answers(second.base)).answers, []);
  } finally {
    await second.kill();
  }
});

test("once the chat is quiet, the wiki model keeps what the user said with its source, the chat uses it, and undo takes it back", async () => {
  const dir = await newDataDir();
  const wiki = join(dir, "profiles", "default", "wiki");
  const server = await startServer(dir, { hang: false, wikiIdleSeconds: 1, wikiModel: "openai/gpt-4o-mini" });
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    let n = 100;
    const ask = async (text: string) => {
      const before = (await follow(server.base, id, () => true)).at(-1)!.messages.filter((m) => !m.wiki).length;
      await post(server.base, `/api/conversations/${id}/messages`, { text, requestId: `request-0${++n}` });
      const after = await follow(server.base, id, (state) => !state.live.busy && state.messages.filter((m) => !m.wiki).length >= before + 2);
      return after.at(-1)!.messages.filter((m) => !m.wiki).slice(before);
    };
    const [said] = await ask("remember: likes green tea");
    await ask("note people/ana.md: Ana is my sister");
    await ask("unsourced topics/secret.md: a fact with no source");

    const pages = (changes: WikiChange[]) => changes.flatMap((change) => change.pages);
    const changes = await wikiChanges(server.base, (found) => pages(found).length >= 2);
    assert.deepEqual(pages(changes).sort((a, b) => a.path.localeCompare(b.path)), [
      { path: "core.md", added: ["likes green tea"], removed: [] },
      { path: "people/ana.md", added: ["Ana is my sister"], removed: [] },
    ]);
    assert.equal(await readFile(join(wiki, "core.md"), "utf8"), `- likes green tea (source: #${said!.id})\n`, "each fact names the message it came from");
    assert.match(await readFile(join(wiki, "index.md"), "utf8"), /^- \[people\/ana\.md\]\(people\/ana\.md\): About people\/ana\.md, by openai\/gpt-4o-mini$/m, "FINROD_WIKI_MODEL writes the wiki");
    await assert.rejects(readFile(join(wiki, "topics", "secret.md")), "a fact without its source is refused");

    assert.match((await ask("hello")).at(-1)!.text, /\(knows: likes green tea\)$/, "the core page reaches every answer");
    assert.match((await ask("read: people/ana.md")).at(-1)!.text, /^Read: - Ana is my sister \(source: #\d+\)/, "the chat opens a page from the index");

    assert.match((await ask("search: sister")).at(-1)!.text, /\[page people\/ana\.md\] - Ana is my sister/, "search finds the wiki's pages");

    const undo = (change: number) => call(`${server.base}/api/wiki/changes/${change}/undo`, { method: "POST" });
    let restored = 0;
    for (const { change } of changes) restored += ((await (await undo(change)).json()) as { restored: number }).restored;
    assert.equal(restored, 2);
    assert.doesNotMatch((await ask("hello again")).at(-1)!.text, /knows/, "an undone fact leaves the prompt");
    assert.deepEqual(await readdir(wiki), ["index.md"], "and its pages are gone");
    assert.deepEqual(await (await undo(changes[0]!.change)).json(), { restored: 0 }, "a second undo changes nothing");
    assert.equal((await undo(99_999)).status, 404);
  } finally {
    await server.kill();
  }
});

test("the index stops at 60 pages: an update can change a listed page but must merge before it adds one", async () => {
  const dir = await newDataDir();
  const wiki = join(dir, "profiles", "default", "wiki");
  await mkdir(wiki, { recursive: true });
  const listed = Array.from({ length: 60 }, (_, n) => `topics/t${n}.md`);
  await writeFile(join(wiki, "index.md"), `# Index\n\n${listed.map((path) => `- [${path}](${path}): old`).join("\n")}\n`);
  const server = await startServer(dir, { hang: false, wikiIdleSeconds: 1 });
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    await post(server.base, `/api/conversations/${id}/messages`, { text: "note topics/new.md: one too many", requestId: "request-0301" });
    await follow(server.base, id, (state) => !state.live.busy && state.messages.length >= 2);
    await post(server.base, `/api/conversations/${id}/messages`, { text: "note topics/t0.md: still fits", requestId: "request-0302" });
    // The refused page was asked for first, so by the time t0 changes, it has been tried.
    const changes = await wikiChanges(server.base, (found) => found.length > 0);
    assert.deepEqual(changes.flatMap((change) => change.pages), [{ path: "topics/t0.md", added: ["still fits"], removed: [] }]);
    await assert.rejects(readFile(join(wiki, "topics", "new.md")), "the 61st page is refused");
  } finally {
    await server.kill();
  }
});

test("a cleanup runs on its own once due, with no new messages, and prunes what is no longer true", async () => {
  const server = await startServer(await newDataDir(), { hang: false, wikiIdleSeconds: 1, wikiCleanupSeconds: 3 });
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    await post(server.base, `/api/conversations/${id}/messages`, { text: "remember: likes tea", requestId: "request-0401" });
    await follow(server.base, id, (state) => !state.live.busy && state.messages.length >= 2);
    await post(server.base, `/api/conversations/${id}/messages`, { text: "remember: stale: works at the bakery", requestId: "request-0402" });
    const changes = await wikiChanges(server.base, (found) => found.some((change) => change.pages.some((page) => page.removed.length)));
    assert.deepEqual(changes.at(-1)!.pages, [{ path: "core.md", added: [], removed: ["stale: works at the bakery"] }]);
    assert.deepEqual(
      changes.flatMap((change) => change.pages.flatMap((page) => page.added)),
      ["likes tea", "stale: works at the bakery"],
      "the updates before it took in the messages",
    );
  } finally {
    await server.kill();
  }
});

test("search finds past messages by their words, accents and endings aside, and shows what was said around them", async () => {
  const server = await startServer(await newDataDir(), { hang: false });
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    let n = 200;
    const ask = async (text: string) => {
      const before = (await follow(server.base, id, () => true)).at(-1)!.messages.length;
      await post(server.base, `/api/conversations/${id}/messages`, { text, requestId: `request-0${++n}` });
      const after = await follow(server.base, id, (state) => !state.live.busy && state.messages.length >= before + 2);
      return after.at(-1)!.messages.slice(before);
    };
    const [doctor] = await ask("Marquei consulta no médico para terça");
    await ask("A Ana tem dois filhos");

    const byAccent = (await ask("search: medico")).at(-1)!.text;
    assert.match(byAccent, new RegExp(`\\[#${doctor!.id} [0-9-]+ [0-9:]+ user\\] Marquei consulta no médico para terça`));
    assert.doesNotMatch(byAccent, /Ana/, "only matching messages come back");
    assert.match((await ask("search: filho*")).at(-1)!.text, /user\] A Ana tem dois filhos/, "a prefix finds other endings");
    assert.match((await ask("search: dentista")).at(-1)!.text, /Nothing matches/);

    const around = (await ask(`around: ${doctor!.id}`)).at(-1)!.text;
    assert.match(around, /user\] Marquei consulta no médico para terça\n\[#\d+ [0-9-]+ [0-9:]+ Finrod\] Stub answer to: Marquei consulta/, "the answer to a found message comes with it");
  } finally {
    await server.kill();
  }
});

/** A memory file as v0.6.0 to v0.9.x wrote it. */
async function sealMemories(file: string, passphrase: string, items: { id: string; text: string; status: string }[]) {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(items.map((item) => ({ ...item, createdAt: 0 })))), cipher.final()]);
  const b64 = (bytes: Buffer) => bytes.toString("base64");
  await writeFile(file, JSON.stringify({ salt: b64(salt), iv: b64(iv), tag: b64(cipher.getAuthTag()), data: b64(data) }));
}

test("the memories approved before the wiki move into it once, and only their passphrase opens them", async () => {
  const dir = await newDataDir();
  const profile = join(dir, "profiles", "default");
  await mkdir(profile, { recursive: true });
  await sealMemories(join(profile, "memories.enc"), "correct horse battery staple", [
    { id: "m-0000000a", text: "likes coffee", status: "saved" },
    { id: "m-0000000b", text: "was only proposed", status: "pending" },
  ]);
  const sealed = await readFile(join(profile, "memories.enc"), "utf8");
  await writeFile(join(dir, "memory-key"), "a different passphrase");
  await assert.rejects(startServer(dir, { hang: false }), /exited/, "a wrong passphrase stops Finrod");
  assert.equal(await readFile(join(profile, "memories.enc"), "utf8"), sealed, "and leaves the memories as they were");

  await writeFile(join(dir, "memory-key"), "correct horse battery staple");
  const server = await startServer(dir, { hang: false });
  try {
    const [change] = await wikiChanges(server.base, (found) => found.length > 0);
    assert.deepEqual(change!.pages, [{ path: "core.md", added: ["likes coffee"], removed: [] }]);
    assert.equal(await readFile(join(profile, "wiki", "core.md"), "utf8"), "- likes coffee (source: memory m-0000000a)\n");
    await wikiChanges(server.base, async () => (await readdir(profile)).includes("memories.enc.imported"));
  } finally {
    await server.kill();
  }
  assert.deepEqual((await readdir(profile)).filter((name) => name.startsWith("memories")), ["memories.enc.imported"]);
});

/** A ChatGPT import as the one-off import script writes it. */
function writeChatGPT(file: string, messages: { role: "user" | "assistant"; text: string }[]) {
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY, conversation TEXT NOT NULL, role TEXT NOT NULL, at INTEGER NOT NULL, voice INTEGER NOT NULL, text TEXT NOT NULL);
    CREATE TABLE audio (file TEXT PRIMARY KEY, message INTEGER NOT NULL, seconds REAL, transcript TEXT);
    INSERT INTO conversations VALUES ('c-1', 'Aulas de xadrez', 0);`);
  const insert = db.prepare("INSERT INTO messages (conversation, role, at, voice, text) VALUES ('c-1', ?, ?, 0, ?)");
  messages.forEach(({ role, text }, n) => insert.run(role, Date.UTC(2025, 5, 1, 12, n), text));
  db.close();
}

test("a ChatGPT import is searched and taken into the wiki, and undoing its changes and deleting it leave Finrod as before", async () => {
  const dir = await newDataDir();
  const profile = join(dir, "profiles", "default");
  await mkdir(join(profile, "chatgpt"), { recursive: true });
  writeChatGPT(join(profile, "chatgpt", "chatgpt.sqlite"), [
    { role: "user", text: "remember: plays chess on Sundays" },
    { role: "assistant", text: "Que ótimo! O xadrez treina a memória." },
    { role: "user", text: "Quero melhorar no xadrez" },
  ]);
  let server = await startServer(dir, { hang: false, wikiIdleSeconds: 1 });
  const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
  let n = 600;
  const ask = async (text: string) => {
    const before = (await follow(server.base, id, () => true)).at(-1)!.messages.filter((m) => !m.wiki).length;
    await post(server.base, `/api/conversations/${id}/messages`, { text, requestId: `request-0${++n}` });
    const after = await follow(server.base, id, (state) => !state.live.busy && state.messages.filter((m) => !m.wiki).length >= before + 2);
    return after.at(-1)!.messages.filter((m) => !m.wiki).at(-1)!.text;
  };
  try {
    const [change] = await wikiChanges(server.base, (found) => found.length > 0);
    assert.deepEqual(change!.pages, [{ path: "core.md", added: ["plays chess on Sundays"], removed: [] }]);
    assert.equal(await readFile(join(profile, "wiki", "core.md"), "utf8"), "- plays chess on Sundays (source: chatgpt #c1)\n", "each fact names the imported message it came from");

    const found = await ask("search: xadrez");
    assert.match(found, /\[#c3 2025-06-01 12:02 user in "Aulas de xadrez"\] Quero melhorar no xadrez/, "search finds what the user wrote in ChatGPT");
    assert.match(found, /\[#c2 2025-06-01 12:01 ChatGPT in "Aulas de xadrez"\] Que ótimo!/, "and what ChatGPT answered");
    assert.match(await ask("chatgpt: 3"), /^Read: \[#c2 [^\]]+\] Que ótimo![^\n]*\n\[#c3 [^\]]+\] Quero melhorar no xadrez$/, "an imported message comes with what was said around it");

    const state = JSON.parse(await readFile(join(profile, "dream.json"), "utf8")) as { chatgptChanges: number[] };
    assert.deepEqual(state.chatgptChanges, [change!.change], "the updates that read the import are listed");
    for (const listed of [...state.chatgptChanges].reverse()) await post(server.base, `/api/wiki/changes/${listed}/undo`);
    assert.doesNotMatch(await ask("hello"), /knows/, "undoing them takes the import's facts out of the wiki");
  } finally {
    await server.kill();
  }

  await rm(join(profile, "chatgpt"), { recursive: true });
  server = await startServer(dir, { hang: false });
  try {
    // Only the import and the undone fact ever held this word.
    assert.match(await ask("search: Sundays"), /Nothing matches/, "without the import, search no longer finds it");
  } finally {
    await server.kill();
  }
});

test("with a canary, the chat and the wiki updates carry it to the model, and research never sends it out", async () => {
  const dir = await newDataDir();
  const url = "http://canarytokens.example/finrod-test-0123456789/index.html";
  await writeFile(join(dir, "canary"), `${url}\n`);
  // The stub refuses any request whose instructions lack the canary, so each answer and wiki change below carried it.
  const server = await startServer(dir, { hang: false, wikiIdleSeconds: 1, canaryFile: join(dir, "canary") });
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    await post(server.base, `/api/conversations/${id}/messages`, { text: "remember: likes tea", requestId: "request-0701" });
    assert.equal((await follow(server.base, id, answered)).at(-1)!.messages.at(-1)!.text, "Stub answer to: remember: likes tea");
    assert.deepEqual((await wikiChanges(server.base, (found) => found.length > 0))[0]!.pages, [{ path: "core.md", added: ["likes tea"], removed: [] }]);

    await post(server.base, `/api/conversations/${id}/messages`, { text: `fetch: ${url}`, requestId: "request-0702" });
    const fetched = (await follow(server.base, id, (state) => !state.live.busy && state.messages.filter((m) => !m.wiki).length === 4)).at(-1)!;
    assert.match(fetched.messages.at(-1)!.text, /^Read: .*refused: the request contains the canary/s);
  } finally {
    await server.kill();
  }
});

test("what the user says never reaches the server's log, even when transcription fails", async () => {
  const server = await startServer(await newDataDir(), { hang: false });
  const said = { text: "secret-typed-words", heard: "secret-spoken-words", failed: "secret-failed-words", garbled: "secret-garbled-words" };
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    const watching = follow(server.base, id, answered);
    await post(server.base, `/api/conversations/${id}/messages`, { text: said.text, requestId: "request-0006" });
    await watching;

    const transcribe = (audio: string) => call(`${server.base}/api/voice?extension=ogg`, { method: "POST", body: audio });
    const heard = await transcribe(`ok ${said.heard}`);
    assert.deepEqual(await heard.json(), { text: said.heard });
    assert.equal((await transcribe(`fail ${said.failed}`)).status, 500);
    assert.equal((await transcribe(`garble ${said.garbled}`)).status, 500);

    const output = server.output();
    assert.match(output, /Transcribing .* failed/, "the failures were logged, so the log was captured");
    for (const words of Object.values(said)) assert.ok(!output.includes(words), `the log contains "${words}"`);
  } finally {
    await server.kill();
  }
});
