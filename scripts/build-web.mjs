import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = resolve(root, "web-dist");
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["web/main.ts"],
  outdir: output,
  bundle: true,
  platform: "browser",
  format: "esm",
  splitting: true,
  target: "safari17",
  alias: { "sql.js": "sql.js/dist/sql-wasm-browser.js" },
  metafile: false,
});
for (const name of ["index.html", "style.css"]) await copyFile(resolve(root, "web", name), resolve(output, name));
await copyFile(resolve(root, "node_modules/sql.js/dist/sql-wasm-browser.wasm"), resolve(output, "sql-wasm.wasm"));
console.log(`Built the phone-local prototype in ${output}. No credentials are embedded.`);
