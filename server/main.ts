import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { Chat, liveOf, messagesOf, Refused, type Threads } from "./chat.js";
import { loadConfig } from "./config.js";
import { EXA_CALLBACK_PATH } from "./exa-auth.js";
import { isStoredName, MAX_FILE_BYTES, mimeOfStoredName, type Attachment } from "./files.js";

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

async function upload(request: IncomingMessage, response: ServerResponse) {
  const name = decodeURIComponent(String(request.headers["x-file-name"] ?? "file"));
  const bytes = await readBody(request, MAX_FILE_BYTES, `"${name}" is larger than the ${MAX_FILE_BYTES / (1024 * 1024)} MB limit.`);
  if (bytes.length === 0) throw new HttpError(400, `"${name}" is empty.`);
  let attachment: Attachment;
  try {
    attachment = await chat.storeFile(bytes, name);
  } catch (error) {
    if (error instanceof Error && /is not an image/.test(error.message)) throw new HttpError(415, error.message);
    throw error;
  }
  return json(response, 201, attachment);
}

async function storedFile(response: ServerResponse, name: string) {
  if (!isStoredName(name)) throw new HttpError(404, "Not found.");
  const body = await chat.readFile(name);
  response.writeHead(200, { "content-type": mimeOfStoredName(name), "cache-control": "private, max-age=31536000, immutable" }).end(body);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify(body));
}

async function events(request: IncomingMessage, response: ServerResponse, store: Threads, id: number) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-store",
    connection: "keep-alive",
  });
  let lastMessages = "";
  let lastLive = "";
  const stop = await store.watch(id, (view) => {
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

function page(response: ServerResponse, status: number, title: string, text: string) {
  const escape = (value: string) => value.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  response
    .writeHead(status, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" })
    .end(
      `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">` +
        `<title>${escape(title)}</title><link rel="stylesheet" href="/style.css">` +
        `<main class="notice"><h1>${escape(title)}</h1><p>${escape(text)}</p><p><a href="/">Voltar ao Finrod</a></p></main>`,
    );
}

async function exaCallback(response: ServerResponse, params: URLSearchParams) {
  try {
    await chat.exa.finish(params);
  } catch (error) {
    console.error("Exa sign-in failed:", error);
    return page(response, 400, "Exa não conectado", error instanceof Error ? error.message : String(error));
  }
  response.writeHead(303, { location: "/", "cache-control": "no-store" }).end();
}

/** The uploads a message refers to, read again from their originals so a stale upload is noticed. */
async function filesOf(wanted: readonly unknown[]): Promise<Attachment[]> {
  const files: Attachment[] = [];
  for (const item of wanted) {
    const { id, name } = item as { id?: unknown; name?: unknown };
    if (typeof id !== "string" || !isStoredName(id)) throw new HttpError(400, "A file reference in this message is not an upload.");
    const shown = typeof name === "string" && name ? name.slice(0, 200) : "file";
    try {
      files.push(await chat.describeFile(id, shown));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new HttpError(400, "That upload no longer exists. Send the file again.");
      throw error;
    }
  }
  return files;
}

async function api(request: IncomingMessage, response: ServerResponse, path: string) {
  if (path === "/api/files" && request.method === "POST") return upload(request, response);
  if (path.startsWith("/api/files/") && request.method === "GET") return storedFile(response, path.slice("/api/files/".length));
  if (path === "/api/exa" && request.method === "GET") return json(response, 200, { connected: await chat.exa.connected() });
  if (path === "/api/exa/connect" && request.method === "POST") return json(response, 200, { url: await chat.exa.start() });
  if (path === "/api/exa" && request.method === "DELETE") {
    await chat.exa.disconnect();
    return json(response, 200, {});
  }
  // Temporary conversations share the routes of permanent ones, under their own prefix.
  const temporary = path === "/api/temporary" || path.startsWith("/api/temporary/");
  const rest = temporary ? `/api${path.slice("/api/temporary".length)}` : path;
  const store = temporary ? chat.temporary : chat.threads;
  if (rest === "/api/conversations" && request.method === "GET") return json(response, 200, await store.list());
  if (rest === "/api/conversations" && request.method === "POST") return json(response, 201, { id: await store.create() });
  const vote = /^\/api\/conversations\/(\d+)\/messages\/(\d+)\/vote$/.exec(rest);
  if (vote && request.method === "PUT") {
    const body = await readJson(request);
    if (body.vote !== "up" && body.vote !== "down" && body.vote !== null) throw new HttpError(400, 'vote must be "up", "down", or null.');
    if (!(await store.rate(Number(vote[1]), Number(vote[2]), body.vote))) throw new HttpError(404, "Answer not found.");
    return json(response, 200, {});
  }
  const conversation = /^\/api\/conversations\/(\d+)$/.exec(rest);
  if (conversation && request.method === "DELETE") {
    if (!(await store.remove(Number(conversation[1])))) throw new HttpError(404, "Conversation not found.");
    return json(response, 200, {});
  }
  const match = /^\/api\/conversations\/(\d+)\/(messages|events)$/.exec(rest);
  if (!match) throw new HttpError(404, "Not found.");
  const id = Number(match[1]);
  if (match[2] === "events" && request.method === "GET") return events(request, response, store, id);
  if (match[2] === "messages" && request.method === "POST") {
    const body = await readJson(request);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    const requestId = typeof body.requestId === "string" ? body.requestId : "";
    const wanted = Array.isArray(body.files) ? body.files : [];
    if (text.length > MAX_MESSAGE_CHARS) throw new HttpError(400, `Message must be at most ${MAX_MESSAGE_CHARS} characters.`);
    if (!text && wanted.length === 0) throw new HttpError(400, "Message must have text or a file.");
    if (!/^[A-Za-z0-9-]{8,64}$/.test(requestId)) throw new HttpError(400, "requestId must be 8-64 letters, digits, or hyphens.");
    if (!(await store.send(id, text, await filesOf(wanted), requestId))) throw new HttpError(404, "Conversation not found.");
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
  const url = new URL(request.url ?? "/", "http://localhost");
  const path = url.pathname;
  try {
    if (path === EXA_CALLBACK_PATH && request.method === "GET") await exaCallback(response, url.searchParams);
    else if (path.startsWith("/api/")) await api(request, response, path);
    else await file(response, path);
  } catch (error) {
    if (error instanceof HttpError) return json(response, error.status, { error: error.message });
    if (error instanceof Refused) return json(response, 409, { error: error.message });
    console.error(`${request.method} ${path} failed:`, error);
    if (!response.headersSent) json(response, 500, { error: "Internal error." });
    else response.end();
  }
});

server.listen(config.port, "127.0.0.1", () => {
  console.log(`Finrod listening on http://127.0.0.1:${config.port} (profile ${config.profile}, model ${config.model}, public URL ${config.publicUrl})`);
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
