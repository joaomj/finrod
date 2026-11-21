// Preloaded into the real server process: answers OpenRouter chat requests locally so no test touches the network.
// In the chat: "read: <page>", "search: <words>", "around: <number>", and "chatgpt: <number>" as the newest message make
// it call read_page, search, read_messages, and read_chatgpt, and answer "Read: " with the tool's result. "which model?"
// answers with the model ID of the request. Any other answer names the facts of the core page it was given, so a test
// can see what reached the model.
// As the wiki update (a request that offers write_page): each user message "remember: X", in Finrod or in the ChatGPT
// import, adds X to the core page,
// "note <page>: X" writes X to that page, and "unsourced <page>: X" writes X without its source, which Finrod must
// refuse. Memories from before the wiki go to the core page. A cleanup removes the core facts that start with "stale:".
// FINROD_STUB_HANG=1 makes an answer stop after its first words and never finish, as when the process dies mid-answer.
// "fetch: <url>" makes it call web_fetch. A request that does not demand zero data retention and no data collection is
// refused, and so is one without the canary in its instructions when FINROD_CANARY_FILE is set.
import { readFileSync } from "node:fs";

const encoder = new TextEncoder();
const canary = process.env.FINROD_CANARY_FILE ? readFileSync(process.env.FINROD_CANARY_FILE, "utf8").trim() : undefined;
const text = (content) => (typeof content === "string" ? content : content.map((part) => part.text ?? "").join(" "));

/** The tool calls of a wiki update, from its input. */
function wikiEdits(input, model) {
  const core = (input.split("core.md:\n")[1] ?? "").split("\n\n")[0].split("\n").filter((line) => line.startsWith("- "));
  if (input.startsWith("This is a cleanup")) {
    const kept = core.filter((line) => !line.startsWith("- stale:"));
    return kept.length < core.length ? [{ path: "core.md", summary: "Core", content: kept.join("\n") }] : [];
  }
  const pages = new Map();
  const sourced = (fact, source) => `- ${fact} (source: ${source})`;
  for (const line of input.split("\n")) {
    const memory = /^\[memory (m-[0-9a-f]{8})\] (.+)$/.exec(line);
    if (memory) core.push(sourced(memory[2], `memory ${memory[1]}`));
    const said = /^\[#(c?\d+) [^\]]* user(?: in "[^"]*")?\] (.+)$/.exec(line);
    if (!said) continue;
    const [, number, message] = said;
    const id = number.startsWith("c") ? `chatgpt #${number}` : `#${number}`;
    const remember = /^remember: (.+)$/.exec(message);
    const note = /^(note|unsourced) ([a-z0-9/-]+\.md): (.+)$/.exec(message);
    if (remember) core.push(sourced(remember[1], id));
    if (note) pages.set(note[2], note[1] === "note" ? sourced(note[3], id) : `- ${note[3]}`);
  }
  const calls = [...pages].map(([path, fact]) => ({ path, summary: `About ${path}, by ${model}`, content: fact }));
  if (core.length) calls.unshift({ path: "core.md", summary: "Core", content: core.join("\n") });
  return calls;
}

/** The tool call a chat message asks for, if any. */
function chatTool(asked) {
  const [, verb, rest] = /^(read|search|around|chatgpt|fetch): (.+)$/.exec(asked) ?? [];
  if (verb === "fetch") return [["web_fetch", { urls: [rest] }]];
  if (verb === "read") return [["read_page", { path: rest }]];
  if (verb === "search") return [["search", { query: rest }]];
  if (verb === "around") return [["read_messages", { id: Number(rest), count: 1 }]];
  if (verb === "chatgpt") return [["read_chatgpt", { id: Number(rest), count: 1 }]];
  return [];
}

globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith("https://openrouter.ai/api/v1/chat/completions")) {
    throw new Error(`Test stub: unexpected network request to ${url}`);
  }
  const request = JSON.parse(init.body);
  const asked = text(request.messages.findLast((message) => message.role === "user").content);
  const chunk = (delta, finish = null) =>
    `data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: request.model, choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const system = String(request.messages.find((message) => message.role === "system")?.content ?? "");
  const refuse = (reason) => new Response(JSON.stringify({ error: { code: 400, message: `Test stub: ${reason}` } }), { status: 400, headers: { "content-type": "application/json" } });
  if (request.provider?.zdr !== true || request.provider?.data_collection !== "deny") return refuse("the request allows data retention");
  if (canary && !system.includes(canary)) return refuse("the instructions lack the canary");
  const known = (system.split("Core page:\n")[1] ?? "").split("\n\n")[0].split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2).replace(/ \(source: [^)]+\)$/, ""));
  const last = request.messages.at(-1);
  const updating = request.tools?.some((tool) => tool.function.name === "write_page");
  const calls =
    last.role !== "user" ? [] : updating ? wikiEdits(asked, request.model).map((args) => ["write_page", args]) : chatTool(asked);
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const body = new ReadableStream({
    async start(controller) {
      const send = (text) => controller.enqueue(encoder.encode(text));
      const answer = (content) => {
        send(chunk({ role: "assistant", content }));
        send(chunk({}, "stop"));
        send("data: [DONE]\n\n");
        controller.close();
      };
      if (calls.length) {
        const toolCalls = calls.map(([name, args], index) => ({ index, id: `call-${index}`, type: "function", function: { name, arguments: JSON.stringify(args) } }));
        send(chunk({ role: "assistant", content: null, tool_calls: toolCalls }));
        send(chunk({}, "tool_calls"));
        send("data: [DONE]\n\n");
        return controller.close();
      }
      if (updating) return answer("Done.");
      if (last.role === "tool") return answer(`Read: ${text(last.content)}`);
      if (asked === "which model?") return answer(`Model ${request.model}`);
      send(chunk({ role: "assistant", content: "Stub answer" }));
      if (process.env.FINROD_STUB_HANG === "1") return;
      await sleep(300);
      send(chunk({ content: ` to: ${asked}${known.length ? ` (knows: ${known.join("; ")})` : ""}` }));
      send(chunk({}, "stop"));
      send(`data: ${JSON.stringify({ id: "stub", object: "chat.completion.chunk", created: 0, model: request.model, choices: [], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } })}\n\n`);
      send("data: [DONE]\n\n");
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
};
