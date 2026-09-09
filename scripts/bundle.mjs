#!/usr/bin/env node
// Bundles the compiled dist/cli.js and all its dependencies into a single
// executable file (release/wsm.mjs), so a release download doesn't need
// node_modules alongside it — just a Node.js install. Run `npm run build`
// first; this bundles dist/, it doesn't compile src/ itself.
import { build } from "esbuild";
import { chmodSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const rootDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const outfile = path.join(rootDir, "release", "wsm.mjs");

mkdirSync(path.dirname(outfile), { recursive: true });

await build({
  entryPoints: [path.join(rootDir, "dist", "cli.js")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile,
  external: ["node:*"],
  alias: {
    "react-devtools-core": path.join(rootDir, "scripts", "react-devtools-core-stub.js"),
  },
  // Some bundled CJS dependencies expect a real `require` in scope; esbuild's
  // own CJS-interop shim doesn't cover every case, so this bridges it.
  banner: {
    js: "import { createRequire as __wsmCreateRequire } from 'node:module';\nconst require = __wsmCreateRequire(import.meta.url);",
  },
});

chmodSync(outfile, 0o755);
console.log(`Bundled -> ${outfile}`);
