# Agent notes: workspace-manager (`wsm`)

Fast CLI/TUI workspace switcher. CLI (`wsm open/close/list/status`) is for
fast day-to-day switching; the full-screen Ink/React TUI (`wsm` with no args)
is for configuration only — don't blur that line by adding config-editing to
the CLI or long-running interactive flows to the TUI's non-interactive paths.

## Workflow: tests first, then code

**Write the test before the implementation.** When adding a feature or fixing
a bug here:

1. Write a test that describes the *correct* observable behavior — what
   `wsm open` should launch, what the config should look like after an
   action, what the TUI should render after a keypress sequence.
2. Run it and watch it fail for the right reason.
3. Write the implementation to make that test pass.

The point: the test is the spec, and the code is written to match it — not
the other way around. Never write a test by observing what the current code
happens to do and asserting that; that just cements bugs as "expected
behavior" and defeats the purpose of having tests at all. If you're fixing a
bug, the new test must fail against the old code and pass against the fix —
if it doesn't fail first, it isn't testing the bug.

This project's tests were largely retrofitted after the fact (see git
history), and that process is exactly how two real bugs were found (see
"Lessons learned" below) — writing the test first would have caught them
before they shipped instead of during an audit. Don't repeat that pattern
going forward.

## Architecture

```
src/
  paths.ts       config/state file locations, ~ expansion
  types.ts       Config/Workspace/WorkspaceItem/Session/State shapes
  config.ts      load/save ~/.config/workspace-manager/config.yaml
  state.ts       load/save ~/.config/workspace-manager/state.json (open sessions)
  launcher.ts    spawns/kills items for `wsm open`/`wsm close`
  cli.ts         commander entry point (open/close/list/status; no-args -> TUI)
  tui/
    App.tsx      Ink app: Groups -> Workspaces -> Items drill-down, all state
    Form.tsx     generic keyboard-driven form + ItemForm/WorkspaceForm/RenameGroupForm
    ConfirmDialog.tsx
    index.tsx    alt-screen enter/exit, renders <App/>
test/            jest, mirrors src/ one file per module + app.test.tsx for the TUI
```

A workspace is a group of **items** (apps to launch or shell commands to run)
sharing a project folder. A workspace can instead be **split** into separate
frontend/backend folders (`layout: "split"`, `frontendCwd`/`backendCwd`),
in which case each item picks a `side`. Single-folder is always the default;
`layout` is omitted from saved config entirely unless split is chosen.

## Lessons learned (don't regress these)

- **Launch/close commands run via `$SHELL -i -c "<command>"`, not
  `shell: true`.** `child_process`'s `shell: true` uses a bare `/bin/sh`,
  which never sources `~/.zshrc`/`~/.bashrc` — so shell functions and aliases
  defined there (a real user's `vscode-close-here` function) silently
  "command not found." `-i` (interactive) is what makes the shell source rc
  files, matching what actually happens when a command is typed into a real
  terminal. See `test/launcher.test.ts` for the regression coverage.

- **Don't use `ink-text-input`.** It computes its next value from an
  `originalValue` *prop* rather than a functional state update. Ink can
  deliver several keypresses from a single stdin read chunk before React
  commits a render in between (confirmed via reading Ink's dispatch code —
  `discreteUpdates` sets priority, it doesn't force a synchronous flush), so
  fast typing or backspacing can silently drop characters. `Form.tsx` does
  its own character-level editing in a single `useInput` handler, applying
  every edit via React's functional `setState` updater
  (`setValues(prev => ...)`), which is correct regardless of how many
  keystrokes land in one chunk. Any future raw-keystroke-driven input in this
  codebase must follow the same functional-update pattern — never compute a
  next value from a value captured by closure.

- **Terminal size fallbacks must use `||`, not `??`.** `stdout.columns` can
  be `0` in edge cases (falsy but not nullish); `?? 80` doesn't replace `0`,
  and a `0`-width root `Box` blanks the whole screen. Always `|| 80` / `|| 24`.

- **`paths.ts` reads `WSM_CONFIG_DIR` live on every call** (`getConfigDir()`
  etc. are functions, not module-load-time constants). This used to be
  cached at import time, which forced tests into `jest.resetModules()` +
  per-test dynamic `import()` — and that combination caused a real dual-
  React-instance bug (a freshly re-imported `App.tsx` got a different copy
  of `ink`/`react` than the one `ink-testing-library` was rendering with,
  producing "Invalid hook call"). Keep path resolution lazy; don't
  reintroduce module-load-time env caching.

- **Never touch the user's real `~/.config/workspace-manager`** while
  developing or testing. Every test and every manual verification run points
  `WSM_CONFIG_DIR` at a throwaway temp directory. This matters doubly here
  because the user has real, hand-built config in there.

- **`loadConfig()`/`loadState()` must never throw** on a missing, empty, or
  malformed file — always fall back to the default shape. (`loadConfig` was
  missing this for a while; `loadState` had it from the start. Keep them
  consistent.)

## Testing

```bash
npm test          # run once
npm run test:watch
```

Jest runs in real ESM mode (`node --experimental-vm-modules`, wired into the
`test` script) with `babel-jest` doing transpile-only TS/JSX stripping —
**not** `ts-jest`, which doesn't support this project's TypeScript version.
`transformIgnorePatterns` is left at its default (don't add nested
`node_modules`) — Ink's dependency tree (specifically `yoga-layout`'s WASM
loader) must load through Node's native ESM loader, not get force-transformed
to CommonJS by Babel, or it breaks.

- Unit tests (`paths`, `config`, `state`) — plain static imports, set
  `process.env.WSM_CONFIG_DIR` to a temp dir in `beforeEach`. No module
  resetting needed (see the lesson above about why).
- `launcher.test.ts` mocks `node:child_process` via
  `jest.unstable_mockModule`, registered **once** at the top of the file
  before a single top-level `await import(...)` of the modules under test —
  reset the mock *implementations* per test, don't re-import per test.
- `app.test.tsx` renders the real `<App/>` via `ink-testing-library` and
  drives it with raw keystrokes (`stdin.write("\x1b[C")` for arrows, `"\r"`
  for enter, etc.), then asserts on `lastFrame()` text and/or the persisted
  `config.yaml`. `await flush()` (a small `setTimeout`) between keystrokes
  gives React a tick to commit before the next one.

## Commands

```bash
npm run build   # tsc -> dist/, chmod +x dist/cli.js
npm run dev     # tsx src/cli.ts (no build step)
npm link        # expose `wsm` globally (re-run after dependency changes)
```
