# workspace-manager (`wsm`)

Fast CLI workspace switcher for coding projects. Configure once, then switch
between projects with a single command — every app, terminal, database
connection, and background command (docker, etc.) for the old project shuts
down automatically as the new one opens.

## Install

```bash
npm install
npm run build
npm link   # makes the `wsm` command available globally
```

## Tests

```bash
npm test          # run once
npm run test:watch
```

Jest runs in real ESM mode (`node --experimental-vm-modules`) rather than
via `ts-jest`, since `ts-jest` doesn't yet support this project's TypeScript
version. Source files are transpiled by `babel-jest` (types/JSX stripped
only — `tsc` still does the real type-checking in `npm run build`). Tests
never touch your real `~/.config/workspace-manager` — each one points
`WSM_CONFIG_DIR` at a throwaway temp directory.

- `test/paths.test.ts`, `test/config.test.ts`, `test/state.test.ts` — pure
  file/env logic (defaults, malformed-file recovery, round-tripping).
- `test/launcher.test.ts` — `open`/`close` behavior with `child_process`
  mocked (interactive-shell invocation, cwd resolution incl. split layout,
  close-command precedence, `--no-close` stacking) — no real processes are
  ever spawned.
- `test/app.test.tsx` — TUI interaction via
  [`ink-testing-library`](https://github.com/vadimdemedes/ink-testing-library)
  (simulated keypresses against the real component tree): workspace
  creation, split-column navigation/deletion, group cascade-delete, the
  open-workspace indicator, and a regression test for a keystroke-dropping
  race that once existed in fast text input.

## Usage

```bash
wsm                     # opens the configuration TUI
wsm open <name>         # closes whatever's open, then opens <name>
wsm open <name> --no-close   # opens <name> without closing anything else
wsm close [name]        # closes the current (or named) open workspace
wsm close --all         # closes every currently open workspace
wsm list                # lists configured workspaces
wsm status              # shows what's currently open
```

## Configuring a workspace

Run `wsm` with no arguments to launch the full-screen TUI (built with
[Ink](https://github.com/vadimdemedes/ink)/React). It's a two-pane dashboard
with three levels of drill-down: **Groups → Workspaces → Items**.

- Left pane starts on **Groups** (e.g. "Work", "Personal") — workspaces
  without a group show up under "Ungrouped". `enter`/`→` on a group reveals
  the workspaces inside it; `←`/`esc` goes back up a level. A green `●` marks
  a group or workspace that's currently open (per `wsm status`).
- `↑↓` move · `enter`/`→` open · `a` add · `r` rename (workspace form also
  lets you change/move a workspace's group) · `c` workspace settings (from
  the items pane) · `d` delete (with confirmation, cascades to everything
  inside) · `←`/`esc` back · `q` quit
- Add items to a workspace — each item is either:
  - **App**: a GUI app to launch, e.g. `code .`, `open -a Ghostty`,
    `open -a "MongoDB Compass" "mongodb://localhost:27017"`
  - **Command**: a shell command, e.g. `docker compose up -d`
- Choose how each item is closed when switching away:
  - Quit a macOS app by name (`osascript ... quit`) — best for GUI apps
  - Run a custom close/stop command — best for things like
    `docker compose down`
  - Terminate the launched process directly — default for plain background
    commands
  - Leave it running (skip auto-close)

Forms are keyboard-driven: `↑↓` between fields, `←→` to change a dropdown
value, `enter` to move to the next field (or save on the last one), `esc` to
cancel.

### Single project folder vs. split frontend/backend

By default a workspace has one project folder (`cwd`) that all its items
launch in unless they set their own `Directory`. The workspace form's
**Layout** field can be switched to "Split frontend/backend" instead, which
replaces the single directory with a **Frontend dir** and **Backend dir** —
each item then gets a **Side** field (Frontend/Backend) that picks which
folder it runs in by default (still overridable per item via `Directory`).
This only shows up once you opt in; single-folder stays the default for new
and existing workspaces. When split, the items pane renders as two side-by-side
columns (Frontend | Backend) instead of one list — `←→` switches between them
(or exits back to the workspace list from the frontend column), `↑↓` moves
within the focused column, and `a` adds an item to whichever column has focus.

```yaml
workspaces:
  - name: acme-app
    layout: split
    frontendCwd: ~/dev/acme-web
    backendCwd: ~/dev/acme-api
    items:
      - name: editor
        type: app
        launch: code .
        closeAppName: Visual Studio Code
      - name: frontend dev server
        type: command
        launch: npm run dev
        side: frontend
      - name: backend dev server
        type: command
        launch: task runserver
        side: backend
```

Config lives at `~/.config/workspace-manager/config.yaml` and can be hand
edited too. Example:

```yaml
workspaces:
  - name: acme-api
    cwd: ~/dev/acme-api
    group: Work
    items:
      - name: editor
        type: app
        launch: code .
        closeAppName: Visual Studio Code
      - name: terminal
        type: app
        launch: open -a Ghostty
        closeAppName: Ghostty
      - name: docker
        type: command
        launch: docker compose up -d
        close: docker compose down
      - name: mongo-compass
        type: app
        launch: open -a "MongoDB Compass" "mongodb://localhost:27017"
        closeAppName: MongoDB Compass
```

Currently-open workspaces are tracked in
`~/.config/workspace-manager/state.json` (PIDs, close commands) so `wsm open`
knows what to tear down and `wsm status` can report on it.

## Notes

- `type: app` items launched via `open -a` exit immediately (macOS forks the
  real app), so closing them relies on `closeAppName` (quits the app) rather
  than killing a PID. `type: command` items are launched detached in their
  own process group and are killed by PID when no `close` command is given.
- Item order matters: items launch in the order listed, so put things that
  need a head start (e.g. `docker compose up -d`) before things that depend
  on them, optionally adding a delay via the TUI's "delay before next item"
  field.
- Launch and close commands run through your login shell in interactive mode
  (`$SHELL -i -c "<command>"`), the same way a real terminal would, so shell
  functions and aliases from `~/.zshrc`/`~/.bashrc` work as close/launch
  commands, not just plain binaries.
- Set `WSM_CONFIG_DIR` to point `wsm` at a different config/state directory
  (e.g. for testing) instead of `~/.config/workspace-manager`.
