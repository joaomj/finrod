import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve, join, extname } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-core";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { createModels } from "@earendil-works/pi-ai/models";
import { Harness, createRegistry, UserEntry, AssistantEntry } from "@earendil-works/pi-durable";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";

let server, browser, origin;
const sessionKey = "sk-or-browser-fixture";
const contentType = { ".js": "text/javascript", ".html": "text/html", ".css": "text/css", ".wasm": "application/wasm" };
before(async () => {
  server = createServer(async (request, response) => {
    const path = request.url === "/" ? "/index.html" : request.url;
    try {
      const file = resolve("web-dist", `.${path}`);
      if (!file.startsWith(resolve("web-dist") + "/")) { response.writeHead(403).end(); return; }
      const body = await readFile(file);
      response.writeHead(200, { "Content-Type": contentType[extname(file)] ?? "application/octet-stream" });
      response.end(body);
    } catch (error) { if (error.code === "ENOENT") response.writeHead(404).end(); else { response.writeHead(500).end(); throw error; } }
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  const executablePath = process.env.FINROD_TEST_BROWSER ?? (existsSync("/usr/bin/brave-browser") ? "/usr/bin/brave-browser" : undefined);
  browser = await chromium.launch({ ...(executablePath ? { executablePath } : {}), headless: true });
});
after(async () => { await browser?.close(); if (server) await new Promise(resolve => server.close(resolve)); });

const answer = text => ({ role: "assistant", content: [{ type: "text", text }], api: "openai-completions", provider: "openrouter", model: "anthropic/claude-haiku-5.5", stopReason: "stop", timestamp: 1700000000000,
  usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });

const textStream = text => 'data: ' + JSON.stringify({ id: "reply", choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }] }) + '\n\ndata: [DONE]\n\n';

async function legacySnapshot() {
  const directory = await mkdtemp(join(tmpdir(), "finrod-legacy-"));
  try {
    const file = join(directory, "history.sqlite");
    const harness = await Harness.open(await openNodeSqliteStorage(file), { models: createModels(), registry: createRegistry() }, BACKGROUND_CONTEXT);
    try {
      const root = await harness.root(BACKGROUND_CONTEXT);
      await root.commit(async tx => {
        await tx.appendEntry(UserEntry, root.id, { model: [{ role: "user", content: "My migration word is cedar.", timestamp: 1700000000000 }] });
        await tx.appendEntry(AssistantEntry, root.id, { model: [answer("I will remember cedar.")] });
      }, BACKGROUND_CONTEXT);
    } finally { await harness.close(BACKGROUND_CONTEXT); }
    return new Uint8Array(await readFile(file));
  } finally { await rm(directory, { recursive: true, force: true }); }
}

async function preview(t, { legacy, liveExa = false, liveModel = false, titleGate } = {}) {
  const context = await browser.newContext({ acceptDownloads: true });
  t.after(() => context.close());
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  t.after(() => assert.deepEqual(errors, [], "No uncaught browser errors"));
  const modelRequests = [], toolCalls = [];
  if (!liveExa) await page.route("https://mcp.exa.ai/**", async route => {
    const request = route.request();
    if (request.method() !== "POST") { await route.fulfill({ status: 405 }); return; }
    const body = request.postDataJSON();
    let result;
    if (body.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "exa-fixture", version: "1" } };
    else if (body.method === "tools/list") result = { tools: [
      { name: "web_search_exa", description: "Search the web", inputSchema: { type: "object", properties: { query: { type: "string" }, objective: { type: "string" }, numResults: { type: "number" } }, required: ["query", "objective"] } },
      { name: "web_fetch_exa", description: "Read a page", inputSchema: { type: "object", properties: { urls: { type: "array", items: { type: "string" } } }, required: ["urls"] } },
    ] };
    else if (body.method === "tools/call") { toolCalls.push(body.params); result = { content: [{ type: "text", text: "São Paulo won 2–1. Source: https://example.org/match" }] }; }
    else { await route.fulfill({ status: 202 }); return; }
    // Use SSE and non-ASCII data to exercise the native client's browser HTTP parser.
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: `data: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result })}\n\n` });
  });
  if (!liveModel) await page.route("https://openrouter.ai/**", async route => {
    const body = route.request().postDataJSON();
    modelRequests.push(body);
    const resultCount = body.messages.filter(message => message.role === "tool").length;
    const isTitle = !body.tools?.length;
    if (isTitle && titleGate) await titleGate;
    const hasResult = isTitle || resultCount >= 2;
    const delta = isTitle ? { content: "São Paulo match score" } : hasResult ? { content: "São Paulo won 2–1. Source: https://example.org/match" }
      : { tool_calls: [{ index: 0, id: resultCount ? "call-fetch" : "call-search", type: "function", function: resultCount
        ? { name: "web_fetch_exa", arguments: JSON.stringify({ urls: [liveExa ? "https://exa.ai/docs/get-started/exa-mcp" : "https://example.org/match"] }) }
        : { name: "web_search_exa", arguments: JSON.stringify({ query: liveExa ? "Exa MCP official documentation" : "São Paulo match result", objective: "Find a primary source for the requested information.", numResults: 1 }) } }] };
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: [
      { id: "chat-fixture", choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] },
      { id: "chat-fixture", choices: [{ index: 0, delta: {}, finish_reason: hasResult ? "stop" : "tool_calls" }] },
    ].map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join("") + "data: [DONE]\n\n" });
  });
  if (legacy) {
    await page.route(origin + "/", route => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Prepare legacy storage</title>" }));
    await page.goto(origin);
    await page.unroute(origin + "/");
    await page.evaluate(async bytes => {
      const existing = indexedDB.deleteDatabase("finrod-browser");
      await new Promise((resolve, reject) => { existing.onsuccess = resolve; existing.onerror = reject; existing.onblocked = reject; });
      const request = indexedDB.open("finrod-browser", 1);
      const db = await new Promise((resolve, reject) => {
        request.onupgradeneeded = () => request.result.createObjectStore("snapshots");
        request.onsuccess = () => resolve(request.result); request.onerror = reject;
      });
      const tx = db.transaction("snapshots", "readwrite");
      tx.objectStore("snapshots").put(new Uint8Array(bytes), "conversation");
      await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onabort = reject; });
      db.close();
    }, [...legacy]);
  }
  await page.goto(origin);
  await page.waitForFunction(() => !document.querySelector("#message").disabled);
  return { page, context, modelRequests, toolCalls };
}
const activeHistory = backup => backup.sessions.find(session => session.session_id === backup.active_session_id).history;

async function openSettings(page) {
  if (!await page.locator("#settings").evaluate(dialog => dialog.open)) await page.locator("#settings-open").click();
}
async function send(page, text = "What was São Paulo's match score yesterday?") {
  await openSettings(page);
  await page.locator("#provider-key").fill(sessionKey);
  await page.locator("#settings-done").click();
  await page.locator("#message").fill(text);
  await page.locator("#send").click();
}
async function finished(page) {
  await page.waitForFunction(() => document.querySelector("#stop").hidden && document.querySelector("#status").dataset.state === "ready");
}
async function backup(page) {
  await openSettings(page);
  const download = page.waitForEvent("download");
  await page.locator("#export").click();
  const exported = JSON.parse(await readFile(await (await download).path(), "utf8"));
  await page.locator("#settings-done").click();
  return exported;
}

test("phone user migrates old history, researches, reopens, and exports/restores without replay", { timeout: 20_000 }, async t => {
  let releaseTitle;
  const titleGate = new Promise(resolve => { releaseTitle = resolve; });
  t.after(() => releaseTitle());
  const { page, context, modelRequests, toolCalls } = await preview(t, { legacy: await legacySnapshot(), titleGate });
  assert.match(await page.locator("#history").innerText(), /migration word is cedar/);
  assert.match(await page.locator("#status").innerText(), /migrated safely/);
  await send(page); await finished(page);
  assert.match(await page.locator("#history").innerText(), /São Paulo won 2–1/);
  assert.equal(modelRequests[0].model, "anthropic/claude-haiku-5.5");
  assert(modelRequests[0].messages.some(message => JSON.stringify(message).includes("cedar")));
  assert(modelRequests[0].messages.some(message => JSON.stringify(message).includes("timezone:")));
  assert.deepEqual(toolCalls, [
    { name: "web_search_exa", arguments: { query: "São Paulo match result", objective: "Find a primary source for the requested information.", numResults: 1 } },
    { name: "web_fetch_exa", arguments: { urls: ["https://example.org/match"] } },
  ]);
  const exported = await backup(page);
  assert.equal(activeHistory(exported).status, "idle");
  assert(!JSON.stringify(exported).includes(sessionKey));
  await page.reload(); await page.waitForFunction(() => !document.querySelector("#message").disabled);
  assert.equal(await page.locator("#provider-key").inputValue(), sessionKey);
  assert.match(await page.locator("#history").innerText(), /São Paulo won 2–1/);
  assert.equal(modelRequests.length, 3, "Reopening must not issue another paid request");
  const second = await context.newPage(); await second.goto(origin);
  await second.waitForFunction(() => document.querySelector("#status").textContent.includes("Another Finrod page"));
  await second.close();
  page.on("dialog", dialog => dialog.accept());
  await openSettings(page);
  await page.locator("#restore").setInputFiles({ name: "backup.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(exported)) });
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("History restored"));
  assert.deepEqual(await backup(page), exported);
  await openSettings(page);
  await page.locator("#restore").setInputFiles({ name: "bad.json", mimeType: "application/json", buffer: Buffer.from('{"format":"finrod-phone","version":9}') });
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Unsupported or damaged"));
  assert.deepEqual(await backup(page), exported, "Invalid restore must preserve existing history");
  await openSettings(page);
  await page.locator("#forget-key").click();
  await page.locator("#settings-done").click();
  await page.reload(); await page.waitForFunction(() => !document.querySelector("#message").disabled);
  assert.equal(await page.locator("#provider-key").inputValue(), "");
  assert.deepEqual(await backup(page), exported, "Forgetting the key must not alter history");
  await page.locator("#new-chat").click();
  await send(page, "What was São Paulo's latest score?"); await finished(page);
  assert(!modelRequests[3].messages.some(message => JSON.stringify(message).includes("cedar")), "A new chat must not send another chat's context");
  await page.locator("#chats-open").click();
  await page.locator("#chat-list").getByText("Naming…").waitFor();
  await page.locator("#chats-close").click();
  await page.locator("#new-chat").click();
  await page.waitForFunction(() => !document.querySelector("#new-chat").disabled && !document.querySelector("#messages").children.length);
  releaseTitle();
  await page.locator("#chats-open").click();
  await page.locator("#chat-list").getByRole("button", { name: "São Paulo match score", exact: true }).waitFor();
  await page.locator("#chat-list").getByRole("button", { name: "Previous conversation", exact: true }).click();
  await page.waitForFunction(() => document.querySelector("#history").textContent.includes("cedar"));
  const titles = modelRequests.filter(body => !body.tools?.length);
  assert.equal(titles.length, 1, "Naming must be one tool-free call, even after switching chats");
  assert(!JSON.stringify(titles[0].messages).includes("cedar"));
  const allChats = await backup(page);
  assert.deepEqual(allChats.sessions.map(session => session.session_id), [1, 2, 3]);
  assert.equal(allChats.sessions[1].title, "São Paulo match score");
  assert.equal(allChats.sessions[2].title, "New chat", "A late title must not rename the active chat");
  assert.equal(allChats.sessions[2].history.messages.length, 0);
  assert(!JSON.stringify(allChats.sessions[1].history.messages).includes("cedar"));
  await openSettings(page);
  await page.locator("#restore").setInputFiles({ name: "all-chats.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(allChats)) });
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("History restored"));
  assert.deepEqual(await backup(page), allChats);
  await page.reload(); await page.waitForFunction(() => !document.querySelector("#message").disabled);
  assert.equal(modelRequests.length, 7, "Reopening must not replay chat or title requests");
  assert.deepEqual(await backup(page), allChats);
});

test("interrupted tool work reopens as failed, is not replayed, and supplies valid context on the next turn", { timeout: 20_000 }, async t => {
  const { page, modelRequests } = await preview(t);
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  await page.route("https://mcp.exa.ai/**", async route => {
    const body = route.request().postDataJSON();
    if (body?.method !== "tools/call") { await route.fallback(); return; }
    await gate;
    await route.abort();
  });
  await send(page);
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Searching the web"));
  await page.reload(); release();
  await page.waitForFunction(() => !document.querySelector("#message").disabled);
  assert.match(await page.locator("#status").innerText(), /interrupted/);
  assert.equal(modelRequests.length, 1);
  const exported = await backup(page);
  const interrupted = activeHistory(exported).messages.find(message => message.role === "toolResult");
  assert.equal(interrupted.isError, true);
  assert.match(interrupted.content[0].text, /not automatically retried/);
  await page.unroute("https://mcp.exa.ai/**");
  // A simple provider reply is enough to inspect the real next-turn context.
  await page.route("https://openrouter.ai/**", async route => {
    modelRequests.push(route.request().postDataJSON());
    await route.fulfill({ status: 200, contentType: "text/event-stream", body: textStream("Ready.") });
  });
  // Exa metadata is required before sending, so keep the existing fixture route for it.
  await page.route("https://mcp.exa.ai/**", async route => {
    const body = route.request().postDataJSON();
    let result;
    if (body.method === "initialize") result = { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "exa", version: "1" } };
    else if (body.method === "tools/list") result = { tools: ["web_search_exa", "web_fetch_exa"].map(name => ({ name, inputSchema: { type: "object", properties: {} } })) };
    else { await route.fulfill({ status: 202 }); return; }
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ jsonrpc: "2.0", id: body.id, result }) });
  });
  await send(page, "Continue with a new question."); await finished(page);
  const transcript = modelRequests.filter(body => body.tools?.length).at(-1).messages;
  assert(transcript.some(message => message.role === "tool" && message.tool_call_id === "call-search"));
});

test("storage failure blocks paid work; provider failure is visible and credentials stay out of backups", { timeout: 20_000 }, async t => {
  const { page, modelRequests } = await preview(t);
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = function () { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await send(page);
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("could not be saved"));
  assert.equal(modelRequests.length, 0, "Saving input must precede inference");
  await page.reload(); await page.waitForFunction(() => !document.querySelector("#message").disabled);
  await page.route("https://openrouter.ai/**", route => route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: `Invalid key ${sessionKey}` } }) }));
  await send(page);
  await page.waitForFunction(() => !document.querySelector("#message").disabled && document.querySelector("#status").dataset.state === "error");
  assert.match(await page.locator("#status").innerText(), /Invalid key/);
  assert(!(await page.locator("#status").innerText()).includes(sessionKey));
  const exported = await backup(page);
  assert.equal(activeHistory(exported).status, "failed");
  assert(!JSON.stringify(exported).includes(sessionKey));
  await page.reload(); await page.waitForFunction(() => !document.querySelector("#message").disabled);
  assert.equal(activeHistory(await backup(page)).status, "failed");
  assert(!JSON.stringify(await backup(page)).includes(sessionKey), "Persisted errors must remain redacted after reopening");
  await page.route("https://openrouter.ai/**", async route => {
    const body = route.request().postDataJSON();
    modelRequests.push(body);
    if (body.tools?.length) await route.fulfill({ status: 200, contentType: "text/event-stream", body: textStream("Ready.") });
    else await route.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ error: { message: `Invalid title key ${sessionKey}` } }) });
  });
  await send(page, "Can we continue?");
  await page.waitForFunction(() => document.querySelector("#status").textContent.includes("Chat title unavailable"));
  const unnamed = await backup(page);
  assert.equal(unnamed.sessions[0].title, "New chat");
  assert.equal(unnamed.sessions[0].titleState, "failed");
  assert(!JSON.stringify(unnamed).includes(sessionKey), "Title errors must not leak credentials into backups");
  assert.equal(activeHistory(unnamed).messages.at(-1).content[0].text, "Ready.", "A title failure must not replace the conversation reply");
  await page.reload(); await page.waitForFunction(() => !document.querySelector("#message").disabled);
  assert.equal(modelRequests.length, 2, "A failed title must not retry on reopening");
});

test("native MCP searches and retrieves Exa pages directly from Brave", { skip: !process.env.FINROD_TEST_LIVE_EXA, timeout: 25_000 }, async t => {
  const { page, modelRequests } = await preview(t, { liveExa: true });
  await send(page, "Find Exa MCP documentation.");
  await finished(page);
  assert.equal(modelRequests.filter(body => body.tools?.length).length, 3);
  const result = modelRequests.filter(body => body.tools?.length)[2].messages.find(message => message.role === "tool");
  const exported = await backup(page);
  const toolResults = activeHistory(exported).messages.filter(message => message.role === "toolResult");
  assert.equal(toolResults.length, 2);
  for (const toolResult of toolResults) assert.equal(toolResult.isError, false, JSON.stringify(toolResult));
  assert(result?.content && /https?:\/\//.test(JSON.stringify(result.content)), "Live Exa must provide source URLs");
});


test("Haiku performs a complete research conversation through live OpenRouter and Exa", {
  skip: !process.env.FINROD_TEST_LIVE_MODEL, timeout: 45_000,
}, async t => {
  assert(process.env.OPENROUTER_API_KEY, "OPENROUTER_API_KEY is required for the live model check");
  const { page } = await preview(t, { liveExa: true, liveModel: true });
  await openSettings(page);
  await page.locator("#provider-key").fill(process.env.OPENROUTER_API_KEY);
  await page.locator("#settings-done").click();
  await page.locator("#message").fill("Use web_search_exa exactly once to find the official Exa MCP documentation. Request one result. Reply with one short sentence and its source URL.");
  await page.locator("#send").click();
  await finished(page);
  const exported = await backup(page);
  const tool = activeHistory(exported).messages.find(message => message.role === "toolResult");
  assert(tool && !tool.isError, "The live model must successfully use Exa");
  const final = activeHistory(exported).messages.at(-1);
  assert.equal(final.role, "assistant");
  assert(final.content.some(block => block.type === "text" && /https:\/\//.test(block.text)), "The live reply must cite a source");
  assert(!JSON.stringify(exported).includes(process.env.OPENROUTER_API_KEY), "The backup must not contain the provider credential");
});
