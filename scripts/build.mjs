import { createHash } from "node:crypto";
import { build } from "esbuild";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
await mkdir("dist/app", { recursive: true });
await Promise.all([
  build({ entryPoints: ["app/main.ts"], bundle: true, minify: true, format: "esm", target: "es2022", outfile: "dist/app/main.js" }),
  build({ entryPoints: ["server/main.ts"], bundle: true, platform: "node", format: "esm", target: "node22", packages: "external", outfile: "dist/server/main.js" }),
  ...["style.css", "manifest.webmanifest", "apple-touch-icon.png", "icon-192.png", "icon-512.png"].map((name) =>
    copyFile(`app/${name}`, `dist/app/${name}`),
  ),
]);

// The server caches the app's files, so the page names the exact build of its script and style. Without
// this, an update leaves a browser running the previous app for as long as its cache holds it.
const version = createHash("sha256")
  .update(await readFile("dist/app/main.js"))
  .update(await readFile("dist/app/style.css"))
  .digest("hex")
  .slice(0, 10);
const page = await readFile("app/index.html", "utf8");
const versioned = page
  .replace('href="style.css"', `href="style.css?v=${version}"`)
  .replace('src="main.js"', `src="main.js?v=${version}"`);
if (versioned === page) throw new Error("index.html does not load style.css and main.js the way the build expects; asset versioning would not apply.");
await writeFile("dist/app/index.html", versioned);
