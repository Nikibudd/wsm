# Agent notes: workspace-manager (`wsm`)

Fast CLI/TUI workspace switcher. CLI (`wsm open/close/list/status`) is for
fast day-to-day switching; the full-screen Ink/React TUI (`wsm` with no args)
is for configuration only — don't blur that line by adding config-editing to
the CLI or long-running interactive flows to the TUI's non-interactive paths.

## Keep this file current

When you learn something new about *developing this project* — a gotcha, a
non-obvious root cause, a tooling constraint, a design decision and why it
was made — add it to this file before finishing the task, not just to your
own response. This file is only useful if it stays a living record; don't
let knowledge evaporate at the end of the conversation it was learned in.
Scope: this is about wsm's own codebase/tooling (the "Lessons learned" and
similar sections below), not the user's unrelated projects or one-off
environment/git operations — those don't belong here.

## Git workflow

This repo uses a git-flow-style model: `main` ← `develop` ← `feature/*`.
Branch new work from `develop`, not `main`; `main` only advances via a merge
from `develop` (a "release"). A remote (`origin`, GitHub) exists and every
branch is expected to be pushed there.

The history was reconstructed after the fact — the code across several early
features was actually written in one continuous session with nothing
committed, then split into per-feature branches/commits afterward to look
like normal incremental development. The commit *content* and ordering are
accurate (verified by diffing the fully-merged tree against the original
uncommitted state — it matched exactly), but don't read timestamps or the
number of commits per feature as literal evidence of how long something took
or how many sittings it happened over.

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
  cli.ts         commander entry point (open/close/list/status/completion; no-args -> TUI)
  completion.ts  bash/zsh completion script generation, used by `wsm completion <shell>`
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

Tool-wide behavior (as opposed to per-workspace config) lives in an optional
top-level `settings:` key in the same `config.yaml` — not a separate file.
`config.getSettings(config)` merges it with defaults (`defaultClose: true`,
`autoPruneStaleSessions: false`) and is the only place that needs to know
those defaults; callers (`cli.ts`, `App.tsx`) always go through it rather
than reading `config.settings` directly, so a missing/partial `settings:`
key never needs an `undefined` check at the call site. Edited via the TUI's
Settings overlay (press "s" from the Groups pane) — see `SettingsForm` in
`Form.tsx`, which reuses `Form`'s existing "select" field kind (two options,
cycled with ←→) for each boolean rather than introducing a new field kind.

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

- **An item's close method is one of three, in strict priority order —
  `close` (explicit command) > `closeAppName` (AppleScript quit) > killing
  the tracked pid — never a combination.** `closeSessionItem` in
  `launcher.ts` checks `close` first and returns immediately if it's set, so
  setting both `close` and `closeAppName` on the same item silently drops
  `closeAppName` with no warning. Real mistake made configuring a user
  workspace: added a bogus `close: "quit intellij"` (not a real shell
  command) alongside a correct `closeAppName: "IntelliJ IDEA"` — the bogus
  command would have run instead of the working AppleScript quit. If you
  ever add UI/validation around item close config, flag this combination
  rather than silently honoring the priority order.

- **The globally-linked `wsm` runs compiled `dist/cli.js`, not `src/`.**
  Editing source has zero effect on the real `wsm` command (the one the user
  runs for actual daily switching) until `npm run build` completes. This
  isn't just a "remember to build" note — `wsm` is the user's real daily
  driver, so testing against a stale build after a source edit means
  silently verifying old behavior and concluding a fix works when it hasn't
  been exercised at all. `npm link` itself only needs re-running if
  `package.json`'s `bin` field or package name changes, which is rare —
  don't confuse the two steps.

- **Sessions stack by name, they don't dedupe.** `wsm open <name> --no-close`
  pushes a new session onto `state.json` without checking whether a session
  for that same workspace name already exists — you can end up with two (or
  more) concurrent recorded sessions for one workspace name. `closeWorkspaces`
  given an explicit name closes **every** session matching that name, not
  just the most recent; only the no-args form (`wsm close`) targets a single
  session (the last one opened). This is intentional, not a bug — but it
  reads as surprising ("why did closing print two 'Closing workspace...'
  blocks?") if you don't know it going in.

- **`cli.ts` itself has no test file — it's just commander wiring.** Keep it
  that way: any actual logic a command needs (string building, script
  generation, name extraction) belongs in its own `src/` module with a
  matching `test/*.test.ts`, and `cli.ts`'s `.action()` should just call it.
  `src/completion.ts` (bash/zsh completion script generation, tested via
  string assertions on the generated script) and `config.workspaceNames()`
  follow this — that's what let shell completion get TDD'd without spawning
  a real child process per test. The generated scripts shell out to
  `wsm list --names-only` at *completion* time (not script-generation time),
  so completions stay in sync with `config.yaml` without regenerating or
  reinstalling the script.

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

Before `app.test.tsx` existed, TUI changes were verified with one-off Python
scripts driving a real pseudo-terminal (`pty.openpty()` + raw keystroke
bytes) — that's how the `ink-text-input` keystroke-loss bug was originally
found. That approach is no longer the default: extend `app.test.tsx` for new
TUI behavior instead of writing a fresh throwaway pty script each time. Fall
back to a manual pty script only for something Jest genuinely can't express
(e.g. checking real terminal resize handling, or literal alt-screen escape
sequences written to a real tty), and treat that as a sign the test suite has
a gap worth closing, not as the normal workflow.

## Commands

```bash
npm run build   # tsc -> dist/, chmod +x dist/cli.js — run this after every
                # src/ change before testing the real `wsm` command
npm run dev     # tsx src/cli.ts (no build step, but this is not what `wsm` runs)
npm link        # expose `wsm` globally — only needs re-running if package.json's
                # bin field or package name changes, not after ordinary edits
```
