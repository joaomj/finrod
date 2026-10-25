import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const port = Number(process.env.FINROD_PORT ?? "8787");
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error(`FINROD_PORT must be a TCP port number; got "${process.env.FINROD_PORT}".`);
}

const appDir = join(import.meta.dirname, "..", "app");
const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;
  const file = normalize(join(appDir, path === "/" ? "index.html" : path));
  if (!file.startsWith(appDir)) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] ?? "application/octet-stream" }).end(body);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") response.writeHead(404).end();
    else throw error;
  }
}).listen(port, "127.0.0.1", () => console.log(`Finrod listening on http://127.0.0.1:${port}`));
