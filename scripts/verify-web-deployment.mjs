import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";

const directory = process.argv[2];
const origin = process.argv[3];
if (!directory || !origin || process.argv.length !== 4) throw new Error("Pass the built asset directory and HTTPS deployment URL.");
const base = new URL(origin);
if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/") throw new Error("Deployment URL: use a plain HTTPS origin without credentials, query, or path.");
const root = resolve(directory);
const files = [];
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile() && /\.(html|js|css|wasm)$/.test(entry.name)) files.push(path);
    else throw new Error(`Unexpected deployment asset: ${relative(root, path)}`);
  }
}
await collect(root);
if (!files.length || !files.includes(resolve(root, "index.html"))) throw new Error("The build must contain index.html and static assets.");
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
for (const file of files.sort()) {
  const name = relative(root, file);
  const url = name === "index.html" ? base : new URL(name.split("/").map(encodeURIComponent).join("/"), base);
  const response = await fetch(url, {
    headers: { "Cache-Control": "no-cache" }, signal: AbortSignal.timeout(30_000), redirect: "error",
  }).catch(cause => { throw new Error(`Could not verify hosted asset ${name}.`, { cause }); });
  if (!response.ok) throw new Error(`Deployment verification failed for ${name} (HTTP ${response.status}).`);
  if (digest(new Uint8Array(await response.arrayBuffer())) !== digest(await readFile(file))) throw new Error(`Deployed ${name} differs from the release build.`);
  console.log(`${name}: HTTPS ${response.status}, matches the release build`);
}
console.log(`Verified all ${files.length} release assets at ${base.href}`);
