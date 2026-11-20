import type { ConversationView } from "@earendil-works/pi-durable";
import { createHash, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Chat, liveOf, messagesOf } from "./chat.js";
import { loadConfig } from "./config.js";
import { MAX_AUDIO_BYTES, VoiceError } from "./voice.js";

const MAX_BODY_BYTES = 64 * 1024;
const MAX_MESSAGE_CHARS = 32_000;

const config = loadConfig(process.env);
const chat = await Chat.open(config);
chat.closed.then((end) => {
  if (end.reason === "failed") {
    console.error("Finrod storage failed; exiting so the service manager restarts it.", end.error);
    process.exit(1);
  }
});

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readBody(request: IncomingMessage, limit: number, tooLarge: string): Promise<Buffer> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, tooLarge);
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  try {
    const value: unknown = JSON.parse((await readBody(request, MAX_BODY_BYTES, "Request body is too large.")).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "Request body must be a JSON object.");
}

/** Any local process can reach 127.0.0.1, so every request must carry FINROD_GATEWAY_TOKEN. */
function requireGateway(request: IncomingMessage) {
  const digest = (value: string) => createHash("sha256").update(value).digest();
  const sent = /^Bearer (.+)$/.exec(request.headers.authorization ?? "")?.[1] ?? "";
  if (!timingSafeEqual(digest(sent), digest(config.gatewayToken))) throw new HttpError(401, "Wrong or missing gateway token.");
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

async function events(request: IncomingMessage, response: ServerResponse, id: number) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  let lastMessages = "";
  let lastLive = "";
  const publish = (view: ConversationView) => {
    const messages = JSON.stringify(messagesOf(view));
    const live = JSON.stringify(liveOf(view));
    if (messages !== lastMessages) response.write(`event: messages\ndata: ${messages}\n\n`);
    if (live !== lastLive) response.write(`event: live\ndata: ${live}\n\n`);
    lastMessages = messages;
    lastLive = live;
  };
  const stop = await chat.threads.watch(id, publish);
  if (!stop) {
    response.end("event: missing\ndata: {}\n\n");
    return;
  }
  const keepAlive = setInterval(() => response.write(": keep-alive\n\n"), 25_000);
  request.on("close", () => {
    clearInterval(keepAlive);
    void stop();
  });
}

async function api(request: IncomingMessage, response: ServerResponse, path: string) {
  requireGateway(request);
  if (path === "/api/gateway/answers" && request.method === "GET") return json(response, 200, await chat.gatewayAnswers());
  if (path === "/api/gateway/answers/ack" && request.method === "POST") {
    const body = await readJson(request);
    if (!Number.isSafeInteger(body.id) || (body.id as number) < 1) throw new HttpError(400, "id must be the entry ID of a delivered answer.");
    await chat.acknowledge(body.id as number);
    return json(response, 200, {});
  }
  if (path === "/api/stream" && request.method === "GET") return json(response, 200, { id: await chat.threads.stream() });
  if (path === "/api/voice" && request.method === "POST") {
    const extension = new URL(request.url ?? "/", "http://localhost").searchParams.get("extension") ?? "";
    const audio = await readBody(request, MAX_AUDIO_BYTES, "The recording is too large.");
    return json(response, 200, { text: await chat.voice.transcribe(extension, audio) });
  }
  const change = /^\/api\/wiki\/changes\/(\d+)\/undo$/.exec(path);
  if (change) {
    if (request.method !== "POST") throw new HttpError(405, "Method not allowed.");
    const restored = await chat.wiki.undo(Number(change[1]));
    if (restored === undefined) throw new HttpError(404, "Wiki change not found.");
    return json(response, 200, { restored });
  }
  const match = /^\/api\/conversations\/(\d+)\/(messages|events)$/.exec(path);
  if (!match) throw new HttpError(404, "Not found.");
  const id = Number(match[1]);
  if (match[2] === "events" && request.method === "GET") return events(request, response, id);
  if (match[2] === "messages" && request.method === "POST") {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const voiceSeconds = typeof body.voice === "number" && body.voice >= 0 ? Math.round(body.voice) : undefined;
    if (!text || text.length > MAX_MESSAGE_CHARS) throw new HttpError(400, `Message must have 1 to ${MAX_MESSAGE_CHARS} characters.`);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new HttpError(400, "requestId must be 8-64 letters, digits, or hyphens.");
    if (!(await chat.threads.send(id, text, requestId, voiceSeconds))) throw new HttpError(404, "Conversation not found.");
    return json(response, 202, {});
  }
  throw new HttpError(405, "Method not allowed.");
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  try {
    if (!path.startsWith("/api/")) throw new HttpError(404, "Not found.");
    await api(request, response, path);
  } catch (error) {
    if (error instanceof HttpError || error instanceof VoiceError) return json(response, error.status, { error: error.message });
    // The path and the error can carry request text; line breaks in them could forge another log entry.
    const detail = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(`${request.method} ${path} failed: ${detail}`.replace(/\n/g, "").replace(/\r/g, ""));
    if (!response.headersSent) json(response, 500, { error: "Internal error." });
    else response.end();
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Finrod listening on http://127.0.0.1:${config.port} (profile ${config.profile}, model ${config.model})`);
});

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    server.close();
    chat.close().then(
      () => process.exit(0),
      (error: unknown) => {
        console.error("Finrod failed to close storage cleanly.", error);
        process.exit(1);
      },
    );
  });
}
