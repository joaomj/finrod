import { build } from "esbuild";
import { copyFile, mkdir, rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/app", { recursive: true });
await Promise.all([
  build({ entryPoints: ["app/main.ts"], bundle: true, minify: true, format: "esm", target: "es2022", outfile: "dist/app/main.js" }),
  build({ entryPoints: ["server/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", outfile: "dist/server/main.js" }),
  ...["index.html", "style.css", "manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png"].map((name) =>
    copyFile(`app/${name}`, `dist/app/${name}`),
  ),
]);
