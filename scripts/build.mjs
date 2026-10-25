import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/app", { recursive: true });
await Promise.all([
  build({ entryPoints: ["app/main.ts"], bundle: true, minify: true, format: "esm", target: "es2022", outfile: "dist/app/main.js" }),
  build({ entryPoints: ["server/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", outfile: "dist/server/main.js" }),
  copyFile("app/index.html", "dist/app/index.html"),
  copyFile("app/style.css", "dist/app/style.css"),
]);
