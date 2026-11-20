import { build } from "esbuild";
import { rm } from "node:fs/promises";

await rm("dist", { recursive: true, force: true });
// pi-claude-directsdk ships TypeScript source, which Node does not run from node_modules, so it is bundled.
const externalPackages = {
  name: "external-packages",
  setup(build) {
    build.onResolve({ filter: /^[^./]/ }, (args) =>
      args.path.startsWith("pi-claude-directsdk/") ? undefined : { path: args.path, external: true },
    );
  },
};
const node = { bundle: true, platform: "node", format: "esm", target: "node22", plugins: [externalPackages] };
await Promise.all([
  build({ ...node, entryPoints: ["server/main.ts"], loader: { ".md": "text" }, outfile: "dist/server/main.js" }),
  build({ ...node, entryPoints: ["gateway/main.ts"], outfile: "dist/gateway/main.js" }),
]);
