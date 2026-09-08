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

Run `wsm` with no arguments to launch the interactive TUI. From there you can:

- Add/rename/delete workspaces
- Set a default working directory per workspace
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

Config lives at `~/.config/workspace-manager/config.yaml` and can be hand
edited too. Example:

```yaml
workspaces:
  - name: acme-api
    cwd: ~/dev/acme-api
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
