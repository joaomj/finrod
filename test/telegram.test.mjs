import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Api } from "grammy";
import { TelegramStore } from "../dist/telegram/store.js";
import { runTelegram } from "../dist/telegram/adapter.js";

test("private Telegram intake survives replay and reports uncertain delivery after restart", { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "finrod-telegram-"));
  const file = join(directory, "telegram.sqlite");
  const controller = new AbortController();
  let phase = 0;
  let polls = 0;
  let answers = 0;
  const delivered = [];
  const message = (id, from, type, text) => ({
    update_id: id,
    message: { message_id: id, date: 1, from: { id: from, is_bot: false, first_name: "User" },
      chat: { id: 42, type }, text },
  });
  const batch = [
    message(100, 999, "private", "unauthorized"),
    message(101, 42, "group", "not private"),
    message(102, 42, "private", "remember this"),
  ];
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    let result;
    if (request.url.endsWith("/getWebhookInfo")) {
      result = { url: "", pending_update_count: 0 };
    } else if (request.url.endsWith("/getUpdates")) {
      polls++;
      if (polls > 2) {
        response.writeHead(500).end();
        return;
      }
      if (phase === 0) {
        assert.equal(body.offset, 0);
        result = batch;
      } else {
        assert.equal(body.offset, 103);
        result = [...batch, message(103, 42, "private", "/status")];
      }
    } else if (request.url.endsWith("/sendMessage")) {
      if (phase === 0) {
        request.socket.destroy();
        return;
      }
      delivered.push(body.text);
      result = { message_id: 500, date: 1, chat: { id: 42, type: "private" }, text: body.text };
      controller.abort();
    } else {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const api = new Api("123:test", { apiRoot: `http://127.0.0.1:${server.address().port}` });
  let store = new TelegramStore(file);
  const answer = async work => {
    answers++;
    assert.equal(work.text, "remember this");
    return "Saved answer";
  };
  try {
    await assert.rejects(runTelegram({ api, store, ownerId: 42, answer, signal: controller.signal }), /delivery .* uncertain/);
    store.close();
    store = new TelegramStore(file);
    phase = 1;
    await runTelegram({ api, store, ownerId: 42, answer, signal: controller.signal });
    assert.equal(answers, 1);
    assert.equal(store.offset, 104);
    assert.equal(store.next(), undefined);
    assert.equal(delivered.length, 1);
    assert.match(delivered[0], /uncertain for 1 replies/);
    assert.match(delivered[0], /Saved answer/);
  } finally {
    store.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
