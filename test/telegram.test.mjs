import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
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
    return { text: "Saved answer", metadata: {
      requestId: "telegram:123:102", conversationId: 1, submissionId: 7,
      answerEntryId: 9, provider: "openrouter", model: "anthropic/claude-haiku-5.5",
    } };
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


test("per-message feedback keeps reply metadata and changed votes across restart without accepting foreign clicks", { timeout: 10000 }, async () => {
  const directory = await mkdtemp(join(tmpdir(), "finrod-feedback-"));
  let controller = new AbortController();
  let phase = 0;
  let polls = 0;
  let answers = 0;
  const sent = [];
  const notices = [];
  const incoming = id => ({ update_id: id, message: {
    message_id: id + 10, date: 1, from: { id: 42, is_bot: false, first_name: "Owner" },
    chat: { id: 42, type: "private" }, text: `Question ${id}`,
  } });
  const click = (updateId, index, direction, user = 42, overrides = {}) => ({
    update_id: updateId,
    callback_query: {
      id: `click-${phase}-${updateId}-${notices.length}`, chat_instance: "private",
      from: { id: user, is_bot: false, first_name: "User" },
      message: { message_id: 500 + index, date: 1, chat: { id: 42, type: "private" }, ...overrides },
      data: sent[index].reply_markup.inline_keyboard[0][direction === "up" ? 0 : 1].callback_data,
    },
  });
  let remaining = 0;
  const server = createServer(async (request, response) => {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : {};
    let result;
    if (request.url.endsWith("/getWebhookInfo")) {
      result = { url: "", pending_update_count: 0 };
    } else if (request.url.endsWith("/getUpdates")) {
      polls++;
      assert.ok(body.allowed_updates.includes("callback_query"));
      if (polls === 1) {
        result = [incoming(100), incoming(101)];
      } else if (polls === 2) {
        result = [click(102, 0, "up"), click(103, 2, "down")];
        remaining = result.length;
      } else if (polls === 3) {
        assert.equal(body.offset, 104);
        result = [
          click(104, 0, "down"), click(104, 0, "down"), click(102, 0, "up"),
          click(105, 0, "up", 999),
          click(106, 0, "up", 42, { message_id: 502 }),
          click(107, 0, "up", 42, { chat: { id: 999, type: "private" } }),
        ];
        remaining = result.length;
      } else {
        response.writeHead(500).end();
        return;
      }
    } else if (request.url.endsWith("/sendMessage")) {
      const id = 500 + sent.length;
      sent.push(body);
      result = { message_id: id, date: 1, chat: { id: 42, type: "private" }, text: body.text };
    } else if (request.url.endsWith("/answerCallbackQuery")) {
      notices.push(body.text);
      if (phase === 1 && notices.length === 3) {
        remaining--;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({ ok: false, error_code: 400,
          description: "Bad Request: query is too old and response timeout expired or query ID is invalid" }));
        return;
      }
      result = true;
      if (--remaining === 0) controller.abort();
    } else {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ok: true, result }));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const api = new Api("123:test", { apiRoot: `http://127.0.0.1:${server.address().port}` });
  let store = new TelegramStore(join(directory, "telegram.sqlite"));
  const answer = async work => {
    answers++;
    return { text: work.updateId === 100 ? "a".repeat(4100) : "Second answer", metadata: {
      requestId: `telegram:123:${work.updateId}`, conversationId: 1,
      submissionId: work.updateId + 20, answerEntryId: work.updateId + 30,
      provider: "openrouter", model: "anthropic/claude-haiku-5.5",
    } };
  };
  const exported = () => execFileSync(process.execPath, ["dist/feedback-export.js"], {
    env: { ...process.env, FINROD_DATA_DIR: directory }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim().split("\n").filter(Boolean).map(line => JSON.parse(line));
  try {
    await runTelegram({ api, store, ownerId: 42, answer, signal: controller.signal });
    const original = exported();
    assert.equal(sent.length, 3);
    assert.equal(original.length, 2);
    assert.equal(original[0].vote, "up");
    assert.equal(original[0].telegram_message_id, 500);
    assert.equal(original[0].source_message_id, 110);
    assert.equal(original[0].request_id, "telegram:123:100");
    assert.equal(original[0].conversation_id, 1);
    assert.equal(original[0].submission_id, 120);
    assert.equal(original[0].answer_entry_id, 130);
    assert.equal(original[0].provider, "openrouter");
    assert.equal(original[0].model, "anthropic/claude-haiku-5.5");
    assert.ok(Number.isFinite(Date.parse(original[0].created_at)));
    assert.equal(original[1].telegram_message_id, 502);
    assert.equal(original[1].request_id, "telegram:123:101");
    store.close();
    store = new TelegramStore(join(directory, "telegram.sqlite"));
    controller = new AbortController();
    phase = 1;
    await runTelegram({ api, store, ownerId: 42, answer, signal: controller.signal });
    const changed = exported();
    assert.equal(changed.length, 2);
    assert.equal(changed[0].vote, "down");
    assert.equal(changed[0].created_at, original[0].created_at);
    assert.deepEqual(changed[1], original[1]);
    assert.equal(answers, 2);
    assert.equal(sent.length, 3);
    assert.equal(store.offset, 108);
    assert.ok(notices.slice(-3).every(text => text.includes("unavailable")));
  } finally {
    store.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
