import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../web-dist/", import.meta.url));
const host = process.env.FINROD_WEB_HOST ?? "127.0.0.1";
const port = Number(process.env.FINROD_WEB_PORT ?? "4173");
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("FINROD_WEB_PORT: set an integer from 1 to 65535.");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".wasm": "application/wasm" };
await readFile(resolve(root, "index.html"));
const server = createServer(async (request, response) => {
  try {
    if (request.method !== "GET" && request.method !== "HEAD") { response.writeHead(405, { Allow: "GET, HEAD" }); response.end(); return; }
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(root.endsWith(sep) ? root : root + sep)) { response.writeHead(403); response.end(); return; }
    const type = types[extname(file)];
    if (!type) { response.writeHead(404); response.end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    if (error instanceof URIError) { response.writeHead(400); response.end(); return; }
    if (error.code === "ENOENT" || error.code === "EISDIR") { response.writeHead(404); response.end(); return; }
    console.error("Static file serving failed:", error);
    response.writeHead(500); response.end();
  }
});
server.on("error", error => { console.error("Browser development server failed:", error); process.exitCode = 1; });
server.listen(port, host, () => {
  console.log(`Finrod browser preview: http://${host}:${port}`);
  console.log("This server only serves files. Use HTTPS for access from an iPhone; it does not proxy model requests.");
});
