// Finrod's memory on the real Claude models, through the Claude Code login of the machine that runs the tests. Each run
// uses subscription quota and takes minutes, so it runs only with FINROD_LIVE=1:
//   FINROD_LIVE=1 scripts/server-test.sh test/live.test.ts
// The models' answers vary, so the checks accept any answer that shows the behavior.
import assert from "node:assert/strict";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { call, follow, newDataDir, post, startServer, wikiChanges, type Message } from "./finrod.ts";

const live = { skip: process.env.FINROD_LIVE === "1" ? false : "set FINROD_LIVE=1 to call the real models", timeout: 600_000 };
const ANSWER_MS = 180_000;

/** Send `text` and return Finrod's answer to it. */
async function ask(base: string, id: number, text: string, requestId: string): Promise<Message> {
  const before = (await follow(base, id, () => true)).at(-1)!.messages.filter((m) => !m.wiki).length;
  await post(base, `/api/conversations/${id}/messages`, { text, requestId });
  const states = await follow(base, id, (state) => !state.live.busy && state.messages.filter((m) => !m.wiki).length >= before + 2, ANSWER_MS);
  const answer = states.at(-1)!.messages.filter((m) => !m.wiki).at(-1)!;
  assert.equal(answer.error, undefined, `the model answered without an error: ${answer.error}`);
  return answer;
}

test("Sonnet finds a fact that only a wiki page holds, from the index in its prompt", live, async () => {
  const dir = await newDataDir();
  const wiki = join(dir, "profiles", "default", "wiki");
  await mkdir(join(wiki, "people"), { recursive: true });
  await writeFile(join(wiki, "core.md"), "# Sobre o usuário\n- Fala português do Brasil (source: #1)\n");
  await writeFile(join(wiki, "people", "beatriz.md"), "# Beatriz\n- Irmã do usuário (source: #1)\n- Mora em Tromsø, na Noruega, desde 2024 (source: #2)\n");
  await writeFile(join(wiki, "index.md"), "# Index\n\n- [people/beatriz.md](people/beatriz.md): Beatriz, irmã do usuário: onde mora e desde quando\n");
  const server = await startServer(dir, { hang: false, live: true });
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    const answer = await ask(server.base, id, "Em que cidade mora a minha irmã? Responda só com o nome da cidade.", "live-0001");
    assert.match(answer.text, /Troms/i, "only the page says where she lives");
  } finally {
    await server.kill();
  }
});

test("Opus turns a conversation into small, sourced pages after it goes quiet", live, async () => {
  const dir = await newDataDir();
  const wiki = join(dir, "profiles", "default", "wiki");
  const server = await startServer(dir, { hang: false, live: true, wikiIdleSeconds: 1 });
  try {
    const id = ((await (await call(`${server.base}/api/stream`)).json()) as { id: number }).id;
    await ask(server.base, id, "Oi! Minha irmã Beatriz se mudou para Tromsø, na Noruega, em março.", "live-0101");
    await ask(server.base, id, "Aliás, sou vegetariano há cinco anos. Lembre disso quando sugerir receitas.", "live-0102");
    const changes = await wikiChanges(server.base, (found) => found.length > 0, 480_000);

    const files = (await readdir(wiki, { recursive: true })).filter((name) => name.endsWith(".md"));
    const pages = Object.fromEntries(await Promise.all(files.map(async (name) => [name, await readFile(join(wiki, name), "utf8")] as const)));
    const notes = Object.entries(pages).filter(([name]) => name !== "index.md").map(([, text]) => text).join("\n");
    assert.match(notes, /Beatriz/, "the sister is in the notes");
    assert.match(notes, /Troms/i, "with where she lives");
    assert.match(notes, /vegetarian/i, "and the diet");
    const ids = (await follow(server.base, id, () => true)).at(-1)!.messages.map((m) => m.id);
    for (const source of notes.matchAll(/\(source: ([^)]+)\)/g)) {
      for (const [, cited] of source[1]!.matchAll(/#(\d+)/g)) assert.ok(ids.includes(Number(cited)), `#${cited} is a message of the conversation`);
    }
    assert.ok((pages["core.md"] ?? "").length <= 2_000, "the core page stays small");
    assert.ok(changes.flatMap((change) => change.pages).length > 0, "the user is told what changed");
    console.log(`Live wiki after one update:\n${Object.entries(pages).map(([name, text]) => `--- ${name}\n${text}`).join("\n")}`);
  } finally {
    await server.kill();
  }
});
