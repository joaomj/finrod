import { build } from "esbuild";
import { copyFile, mkdir, rm, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "web-dist");
const mcpRoot = fileURLToPath(new URL(".", import.meta.resolve("@earendil-works/pi-mcp")));
// Pi MCP 1.1.0 exports Node stdio from its root and uses Buffer in HTTP SSE.
// Keep the native HTTP implementation; adapt only packaging and UTF-8 byte counting.
const browserMcp = {
  name: "pi-mcp-browser",
  setup(build) {
    build.onResolve({ filter: /^@earendil-works\/pi-mcp$/ }, () => ({ path: "http", namespace: "pi-mcp-browser" }));
    build.onLoad({ filter: /.*/, namespace: "pi-mcp-browser" }, () => ({ contents: `
      export { McpClient } from ${JSON.stringify(resolve(mcpRoot, "client.js"))};
      export { StreamableHttpTransport } from ${JSON.stringify(resolve(mcpRoot, "transports/streamable-http.js"))};
      export { toLlmContent } from ${JSON.stringify(resolve(mcpRoot, "protocol/content.js"))};
    `, resolveDir: root }));
    build.onLoad({ filter: /pi-mcp\/dist\/transports\/streamable-http\.js$/ }, async ({ path }) => {
      const source = await readFile(path, "utf8");
      if ((source.match(/Buffer\.byteLength/g) ?? []).length !== 2) throw new Error("Pi MCP browser adaptation no longer matches the pinned client. Review the HTTP parser before building.");
      return { contents: 'const utf8ByteLength = value => new TextEncoder().encode(value).byteLength;\n' + source.replaceAll("Buffer.byteLength", "utf8ByteLength"), loader: "js" };
    });
  },
};
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["web/main.ts"],
  outdir: output,
  bundle: true,
  minify: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  target: "safari17",
  alias: { "sql.js": "sql.js/dist/sql-wasm-browser.js" },
  metafile: false,
  plugins: [browserMcp],
});
for (const name of ["index.html", "style.css"]) await copyFile(resolve(root, "web", name), resolve(output, name));
await copyFile(resolve(root, "node_modules/sql.js/dist/sql-wasm-browser.wasm"), resolve(output, "sql-wasm.wasm"));
console.log(`Built the phone-local prototype in ${output}. No credentials are embedded.`);
