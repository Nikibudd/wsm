# workspace-manager (`wsm`)

Fast CLI workspace switcher for coding projects. Configure once, then switch
between projects with a single command — every app, terminal, database
connection, and background command (docker, etc.) for the old project shuts
down automatically as the new one opens.

## Install

### From a release

Download `wsm.mjs` from the [Releases page](https://github.com/Nikibudd/wsm/releases) — it's a single
self-contained file (all dependencies bundled in), the only requirement is
Node.js (20+) installed. Then:

```bash
chmod +x wsm.mjs
mkdir -p ~/.local/bin
mv wsm.mjs ~/.local/bin/wsm
```

Make sure `~/.local/bin` is on your `PATH` (add `export PATH="$HOME/.local/bin:$PATH"`
to your shell rc file if it isn't), then confirm with `wsm --version`. Any
directory already on your `PATH` works the same way — e.g. `/opt/homebrew/bin`
on Apple Silicon Homebrew installs.

### Build it yourself

Same end result as downloading a release, just self-built from source:

```bash
git clone https://github.com/Nikibudd/wsm.git
cd wsm
npm install
npm run build
npm run bundle        # -> release/wsm.mjs, already executable
mv release/wsm.mjs ~/.local/bin/wsm
```

## Usage

```bash
wsm                     # opens the configuration TUI
wsm open <name>         # closes whatever's open, then opens <name>
wsm open <name> --no-close   # opens <name> without closing anything else
wsm close [name]        # closes the current (or named) open workspace
wsm close --all         # closes every currently open workspace
wsm list                # lists configured workspaces
wsm status              # shows what's currently open
wsm update              # downloads and installs the latest release, in place
wsm completion <shell>  # prints a completion script for bash or zsh (usually set up for you, see below)
```

`wsm update` only works on a real release install (see "From a release"
above) — it refuses to run on a development build (`wsmdev`), which updates
via `npm run build` instead.

The first time you launch the TUI (`wsm`, no args), it offers to set up
tab-completion for bash/zsh. Accepting adds one line to your shell rc file
(`~/.zshrc`/`~/.bashrc`) that sources a small file wsm manages — nothing
else about your rc file ever needs to change after that, including on
future `wsm update`s. Declined it, or want to turn it on/off later? Toggle
"Shell completion" from the Settings overlay (`s` from the Groups pane).
Prefer to wire it up yourself instead of going through the prompt? `wsm
completion zsh` / `wsm completion bash` prints the completion script
directly, the same one the automatic setup uses.

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
        close: osascript -e 'tell application "Visual Studio Code" to quit'
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
        close: osascript -e 'tell application "Visual Studio Code" to quit'
      - name: terminal
        type: app
        launch: open -a Ghostty
      - name: docker
        type: command
        launch: docker compose up -d
        close: docker compose down
      - name: mongo-compass
        type: app
        launch: open -a "MongoDB Compass" "mongodb://localhost:27017"
        close: osascript -e 'tell application "MongoDB Compass" to quit'
```

`close` is just a shell command — `osascript ...` above is one example (macOS
AppleScript), not something wsm has special support for. See Notes below for
the Linux equivalent.

Currently-open workspaces are tracked in
`~/.config/workspace-manager/state.json` (PIDs, close commands) so `wsm open`
knows what to tear down and `wsm status` can report on it.

## Notes

- `type: app` items launched via `open -a` (or similar) exit immediately —
  the launcher shell hands off to the real, separate app process and returns,
  so there's nothing meaningful left to kill by PID. Give these a `close`
  command (e.g. `osascript -e 'tell application "X" to quit'` on macOS,
  `pkill -x "X"` on Linux) if you want them closed when switching away;
  without one, `wsm close` just leaves them running. `type: command` items
  are launched detached in their own process group and are killed by PID
  when no `close` command is given, which works correctly for anything that
  stays attached to the launcher shell (most CLI tools, `docker run -d`,
  etc.) — just not `type: app`-style hand-off launches.
- `wsm open` captures every launched item's stdout+stderr to a log file
  under `~/.config/workspace-manager/logs/` (one per workspace/item,
  overwritten on each relaunch, not accumulated) and watches for about 4
  seconds after launch — if an item exits with a non-zero code in that
  window, wsm prints an error pointing at its log file so you don't have to
  go hunting for why something didn't come up. A fast, clean exit (code 0 —
  common for hand-off launches like `open -a X .` or `docker run -d`) and an
  item still running when the window closes are both left alone, not
  flagged.
- wsm has no built-in "quit this app by name" mechanism (there used to be
  one, macOS-only via AppleScript — removed, since there's no equivalent API
  that works the same way across desktop environments, especially on Linux
  where X11 has tools like `wmctrl`/`xdotool` but Wayland deliberately
  restricts this kind of cross-app control by design, compositor by
  compositor). Use `close` for anything that needs more than a plain PID
  kill.
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

## Contributing

### Development setup

```bash
git clone https://github.com/Nikibudd/wsm.git
cd wsm
npm install
npm run build
npm link   # makes the `wsmdev` command available globally
```

`npm link` installs the command as `wsmdev`, not `wsm` — a locally-linked
dev build and an installed release can coexist without clashing, and
`wsmdev` automatically uses a separate `~/.config/workspace-manager-dev`
config directory so testing changes can't touch your real config. Run
`npm run build` again after any source change to pick it up; `npm link`
itself only needs re-running if `package.json`'s `bin` field changes.

### Tests

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
