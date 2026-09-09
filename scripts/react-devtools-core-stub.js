// Stand-in for the optional `react-devtools-core` package when bundling.
//
// ink/build/reconciler.js only ever imports the real package when
// `process.env.DEV === "true"` AND a runtime `import.meta.resolve()` check
// confirms it's actually installed (it isn't, here) — see the try/catch
// around that resolve() call. In normal `wsm` usage that branch never runs.
//
// esbuild, however, resolves the whole module graph statically at bundle
// time regardless of that runtime gate, so bundling fails without something
// to resolve `react-devtools-core` to. This stub is never actually invoked;
// it only needs to exist so esbuild has something to bundle.
export default {
  initialize() {},
  connectToDevTools() {},
};
