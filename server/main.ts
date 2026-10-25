import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Chat, liveOf, messagesOf } from "./chat.js";
import { loadConfig } from "./config.js";

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

const appDir = join(import.meta.dirname, "..", "app");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, "Request body is too large.");
    chunks.push(chunk);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {}
  throw new HttpError(400, "Request body must be a JSON object.");
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
  const stop = await chat.watch(id, (view) => {
    const messages = JSON.stringify(messagesOf(view));
    const live = JSON.stringify(liveOf(view));
    if (messages !== lastMessages) response.write(`event: messages\ndata: ${messages}\n\n`);
    if (live !== lastLive) response.write(`event: live\ndata: ${live}\n\n`);
    lastMessages = messages;
    lastLive = live;
  });
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
  if (path === "/api/conversations" && request.method === "GET") return json(response, 200, await chat.list());
  if (path === "/api/conversations" && request.method === "POST") return json(response, 201, { id: await chat.create() });
  const vote = /^\/api\/conversations\/(\d+)\/messages\/(\d+)\/vote$/.exec(path);
  if (vote && request.method === "PUT") {
    const body = await readJson(request);
    if (body.vote !== "up" && body.vote !== "down" && body.vote !== null) throw new HttpError(400, 'vote must be "up", "down", or null.');
    if (!(await chat.rate(Number(vote[1]), Number(vote[2]), body.vote))) throw new HttpError(404, "Answer not found.");
    return json(response, 200, {});
  }
  const match = /^\/api\/conversations\/(\d+)\/(messages|events)$/.exec(path);
  if (!match) throw new HttpError(404, "Not found.");
  const id = Number(match[1]);
  if (match[2] === "events" && request.method === "GET") return events(request, response, id);
  if (match[2] === "messages" && request.method === "POST") {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    if (!text || text.length > MAX_MESSAGE_CHARS) throw new HttpError(400, `Message must be 1-${MAX_MESSAGE_CHARS} characters.`);
    if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new HttpError(400, "requestId must be 8-64 letters, digits, or hyphens.");
    if (!(await chat.send(id, text, requestId))) throw new HttpError(404, "Conversation not found.");
    return json(response, 202, {});
  }
  throw new HttpError(405, "Method not allowed.");
}

async function file(response: ServerResponse, path: string) {
  const target = normalize(join(appDir, path === "/" ? "index.html" : path));
  if (!target.startsWith(appDir + "/")) throw new HttpError(404, "Not found.");
  try {
    const body = await readFile(target);
    const cache = path === "/" || path.endsWith(".html") ? "no-cache" : "public, max-age=300";
    response.writeHead(200, { "content-type": types[extname(target)] ?? "application/octet-stream", "cache-control": cache }).end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(404, "Not found.");
    throw error;
  }
}

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  try {
    if (path.startsWith("/api/")) await api(request, response, path);
    else await file(response, path);
  } catch (error) {
    if (error instanceof HttpError) return json(response, error.status, { error: error.message });
    console.error(`${request.method} ${path} failed:`, error);
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
