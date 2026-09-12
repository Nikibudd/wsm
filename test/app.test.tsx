import React from "react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { render } from "ink-testing-library";
import { load } from "js-yaml";
import { App } from "../src/tui/App.js";
import { SettingsForm } from "../src/tui/Form.js";

const UP = "\x1b[A";
const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const ENTER = "\r";
const ESC = "\x1b";
const TAB = "\t";

function flush(ms = 30) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readConfigYaml(tmpDir: string): any {
  const raw = fs.readFileSync(path.join(tmpDir, "config.yaml"), "utf8");
  return load(raw);
}

describe("App (TUI)", () => {
  let tmpDir: string;
  const previousEnv = process.env.WSM_CONFIG_DIR;
  const previousShellEnv = process.env.SHELL;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-app-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;
    // Unset by default so the one-time shell-integration-setup prompt (see
    // the "Shell integration setup" describe block below) never fires here —
    // it only triggers for a detected (zsh/bash) shell, and these tests
    // exercise everything else about the App, keystroke-for-keystroke, with
    // no knowledge of that prompt existing.
    delete process.env.SHELL;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
    if (previousShellEnv === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShellEnv;
  });

  test("shows the empty state with no workspaces configured", async () => {
    const { lastFrame, unmount } = render(<App />);
    await flush();
    expect(lastFrame()).toContain("No workspaces yet.");
    expect(lastFrame()).toContain("+ New workspace");
    unmount();
  });

  test("1/2/3 switch tabs from anywhere, and the tab bar reflects which one is active", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    // Tab bar is always visible, showing all three regardless of which is active.
    expect(lastFrame()).toContain("1 Workspaces");
    expect(lastFrame()).toContain("2 Custom Commands");
    expect(lastFrame()).toContain("3 Settings");
    // Starts on the Workspaces tab.
    expect(lastFrame()).toContain("No workspaces yet.");

    stdin.write("2");
    await flush();
    expect(lastFrame()).toContain("Custom commands");
    expect(lastFrame()).not.toContain("No workspaces yet.");

    stdin.write("3");
    await flush();
    expect(lastFrame()).toContain("Closes current workspace(s) first");
    expect(lastFrame()).not.toContain("Custom commands");

    stdin.write("1");
    await flush();
    expect(lastFrame()).toContain("No workspaces yet.");
    expect(lastFrame()).not.toContain("Closes current workspace(s) first");

    unmount();
  });

  test("switching tabs and back preserves where you were in the Workspaces drill-down", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      "workspaces:\n  - name: acme-api\n    items: []\n",
    );

    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write(ENTER); // drill into the (Ungrouped) group -> workspaces pane
    await flush();
    expect(lastFrame()).toContain("acme-api");

    stdin.write("3"); // switch away to Settings
    await flush();
    stdin.write("1"); // and back to Workspaces
    await flush();

    // Still on the workspaces pane (inside the group), not reset to Groups.
    expect(lastFrame()).toContain("Groups › Ungrouped");

    unmount();
  });

  test("creates a single-folder (default layout) workspace end-to-end", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("a");
    await flush(); // group field focused
    stdin.write(ENTER);
    await flush(); // -> name field
    stdin.write("myapp"); // whole string in one write, like a paste/fast type
    await flush();
    stdin.write(ENTER);
    await flush(); // -> layout select (default "single")
    stdin.write(ENTER);
    await flush(); // -> cwd field (layout stayed single)
    stdin.write("/tmp/myapp");
    await flush();
    stdin.write(ENTER);
    await flush(); // last field -> submit

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.workspaces).toHaveLength(1);
    expect(config.workspaces[0]).toMatchObject({ name: "myapp", cwd: "/tmp/myapp" });
    expect(config.workspaces[0].layout).toBeUndefined();
  });

  test("typing a name in one burst is not corrupted (functional-updater text field)", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("a");
    await flush();
    stdin.write(ENTER); // -> name
    await flush();
    // type, then backspace several times, then type more — all in separate
    // writes arriving close together, the exact pattern that used to lose
    // keystrokes before text-field editing was made race-proof.
    stdin.write("myapp-wrong");
    await flush(5);
    stdin.write("\x7f\x7f\x7f\x7f\x7f\x7f"); // removes "-wrong" (6 chars)
    await flush(5);
    stdin.write("-right");
    await flush();
    stdin.write(ENTER); // -> layout
    await flush();
    stdin.write(ENTER); // -> cwd
    await flush();
    stdin.write(ENTER); // submit with blank cwd
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.workspaces[0].name).toBe("myapp-right");
  });

  test("split-layout items render as two columns, and deleting one leaves the other side intact", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      `workspaces:
  - name: split-app
    layout: split
    frontendCwd: /tmp/fe
    backendCwd: /tmp/be
    items:
      - name: fe-editor
        type: app
        launch: code .
        side: frontend
      - name: fe-dev
        type: command
        launch: npm run dev
        side: frontend
      - name: be-server
        type: command
        launch: task runserver
        side: backend
`,
    );

    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write(ENTER); // enter the (only) group
    await flush();
    stdin.write(ENTER); // open split-app's items
    await flush();

    expect(lastFrame()).toContain("Frontend");
    expect(lastFrame()).toContain("Backend");
    expect(lastFrame()).toContain("fe-editor");
    expect(lastFrame()).toContain("be-server");

    stdin.write(DOWN); // select fe-dev
    await flush();
    stdin.write(RIGHT); // switch focus to backend column
    await flush();
    expect(lastFrame()).toMatch(/›\s*be-server/);

    stdin.write("d");
    await flush();
    stdin.write("y"); // confirm delete
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    const items = config.workspaces[0].items;
    expect(items.map((i: any) => i.name)).toEqual(["fe-editor", "fe-dev"]);
  });

  test("left arrow from the frontend column exits back to the workspace list", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      `workspaces:
  - name: split-app
    layout: split
    frontendCwd: /tmp/fe
    backendCwd: /tmp/be
    items:
      - name: fe-editor
        type: app
        launch: code .
        side: frontend
`,
    );

    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();
    stdin.write(ENTER);
    await flush();
    stdin.write(ENTER); // into split-app items, frontend column focused
    await flush();

    stdin.write(LEFT); // already in frontend column -> back to workspace list
    await flush();

    expect(lastFrame()).toContain("Groups ›");
    expect(lastFrame()).toMatch(/›\s*split-app/);

    unmount();
  });

  test("shows a green open indicator for a workspace tracked as an open session", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      `workspaces:
  - name: running-app
    cwd: /tmp/running
    items: []
`,
    );
    fs.writeFileSync(
      path.join(tmpDir, "state.json"),
      JSON.stringify({
        sessions: [{ workspace: "running-app", openedAt: "now", items: [] }],
      }),
    );

    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    expect(lastFrame()).toContain("●");

    stdin.write(ENTER); // drill into the (Ungrouped) group
    await flush();
    expect(lastFrame()).toMatch(/●\s*running-app/);

    unmount();
  });

  test("deleting a group cascades to all workspaces inside it", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      `workspaces:
  - name: a
    group: Doomed
    items: []
  - name: b
    group: Doomed
    items: []
  - name: c
    group: Safe
    items: []
`,
    );

    const { stdin, unmount } = render(<App />);
    await flush();

    // "Doomed" sorts before "Safe" alphabetically, so it's the first row.
    stdin.write("d");
    await flush();
    stdin.write("y");
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.workspaces.map((w: any) => w.name)).toEqual(["c"]);
  });

  test("duplicating a workspace clones its items under a new name, leaving the original untouched", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      `workspaces:
  - name: acme-api
    group: Work
    cwd: /tmp/acme-api
    items:
      - name: editor
        type: app
        launch: code .
        close: osascript -e 'tell application "Visual Studio Code" to quit'
      - name: docker
        type: command
        launch: docker compose up -d
        close: docker compose down
`,
    );

    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write(ENTER); // drill into the "Work" group
    await flush();
    stdin.write("c"); // duplicate the selected workspace
    await flush();

    expect(lastFrame()).toContain("Duplicate workspace");
    expect(lastFrame()).toContain("acme-api-copy");

    stdin.write(ENTER); // group field, prefilled "Work" -> keep it
    await flush();
    stdin.write(ENTER); // name field, prefilled "acme-api-copy" -> keep it
    await flush();
    stdin.write(ENTER); // layout select, prefilled "single" -> keep it
    await flush();
    stdin.write(ENTER); // cwd field, prefilled "/tmp/acme-api" -> keep it, submit
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.workspaces).toHaveLength(2);
    const original = config.workspaces.find((w: any) => w.name === "acme-api");
    const copy = config.workspaces.find((w: any) => w.name === "acme-api-copy");
    expect(original.items).toHaveLength(2);
    expect(copy).toMatchObject({ group: "Work", cwd: "/tmp/acme-api" });
    expect(copy.items).toEqual(original.items);
  });

  test("pressing 3 switches to the Settings tab, and toggling+saving persists it", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("3");
    await flush();
    expect(lastFrame()).toContain("Settings");
    expect(lastFrame()).toContain("Closes current workspace(s) first");

    stdin.write(LEFT); // cycle the 2-option select the other way -> "Keeps them running"
    await flush();
    expect(lastFrame()).toContain("Keeps them running");

    stdin.write(ENTER); // -> Dead sessions field
    await flush();
    stdin.write(RIGHT); // "Flag only" -> "Auto-remove from state.json"
    await flush();
    stdin.write(ENTER); // -> Theme field
    await flush();
    stdin.write(ENTER); // last field, left as "Default" -> submit
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.settings).toEqual({
      defaultClose: false,
      autoPruneStaleSessions: true,
      autocomplete: false,
      shellIntegrationPrompted: false,
    });
  });

  test("cycling and saving the Theme field persists the selection to themes.json", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("3");
    await flush();
    stdin.write(ENTER); // -> Dead sessions field
    await flush();
    stdin.write(ENTER); // -> Theme field
    await flush();
    expect(lastFrame()).toContain("Default");

    stdin.write(RIGHT); // Default -> Catppuccin Mocha
    await flush();
    expect(lastFrame()).toContain("Catppuccin Mocha");

    stdin.write(ENTER); // last field -> submit
    await flush();

    unmount();

    const themes = JSON.parse(fs.readFileSync(path.join(tmpDir, "themes.json"), "utf8"));
    expect(themes.activeTheme).toBe("Catppuccin Mocha");
  });

  test("canceling out of Settings after cycling the theme doesn't persist the unsaved preview", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("3");
    await flush();
    stdin.write(ENTER); // -> Dead sessions field
    await flush();
    stdin.write(ENTER); // -> Theme field
    await flush();
    stdin.write(RIGHT); // Default -> Catppuccin Mocha, unsaved
    await flush();
    stdin.write(ESC); // cancel
    await flush();

    unmount();

    // themes.json was written on mount (Default) but never updated, since
    // cancel doesn't submit — the previewed-but-uncommitted "Catppuccin
    // Mocha" selection must not leak into the persisted file.
    const themes = JSON.parse(fs.readFileSync(path.join(tmpDir, "themes.json"), "utf8"));
    expect(themes.activeTheme).toBe("Default");
  });

  test("pressing 2 switches to the Custom Commands tab, and adding one persists it", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();
    expect(lastFrame()).toContain("Custom commands");
    expect(lastFrame()).toContain("No custom commands yet.");

    stdin.write("a");
    await flush(); // -> Name field
    stdin.write("logs");
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Command field
    stdin.write("docker compose logs -f"); // typing starts multiline "edit mode"
    await flush();
    stdin.write(ESC); // exit edit mode (does not cancel the form)
    await flush();
    stdin.write(ENTER); // not editing anymore: enter behaves like any other field -> submit
    await flush();

    expect(lastFrame()).toContain("logs");
    expect(lastFrame()).toContain("docker compose logs -f");

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.customCommands).toEqual([{ name: "logs", command: "docker compose logs -f" }]);
  });

  test("rejects a custom command name that isn't a valid shell function identifier", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();
    stdin.write("a");
    await flush(); // -> Name field
    stdin.write("2bad-name");
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Command field
    stdin.write("echo hi"); // typing starts multiline "edit mode"
    await flush();
    stdin.write(ESC); // exit edit mode (does not cancel the form)
    await flush();
    stdin.write(ENTER); // not editing anymore: enter behaves like any other field -> submit, fails name validation
    await flush();

    expect(lastFrame()).toContain("valid shell function name");

    unmount();
  });

  test("editing and deleting a custom command", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      `workspaces: []
customCommands:
  - name: logs
    command: docker compose logs -f
`,
    );

    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();
    expect(lastFrame()).toContain("logs");

    // edit: enter on the selected row, change the command, save
    stdin.write(ENTER);
    await flush(); // -> Name field (prefilled "logs")
    stdin.write(ENTER);
    await flush(); // -> Command field (prefilled), replace it
    stdin.write("\x7f"); // backspace starts multiline "edit mode" too, same as typing
    await flush();
    stdin.write("\x7f".repeat(29)); // clear the rest of the prefilled command text
    await flush();
    stdin.write("docker compose logs -f --tail=100");
    await flush();
    stdin.write(ESC); // exit edit mode (does not cancel the form)
    await flush();
    stdin.write(ENTER); // not editing anymore: enter behaves like any other field -> submit
    await flush();

    expect(lastFrame()).toContain("docker compose logs -f --tail=100");

    // delete: select it, press d, confirm
    stdin.write("d");
    await flush();
    expect(lastFrame()).toContain("Delete custom command");
    stdin.write("y");
    await flush();

    expect(lastFrame()).toContain("No custom commands yet.");

    stdin.write(ESC);
    await flush();
    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.customCommands).toEqual([]);
  });

  test("the Command field: enter submits until you start typing, then enter inserts a newline until esc", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();
    stdin.write("a");
    await flush(); // -> Name field
    stdin.write("greet");
    await flush();
    stdin.write(TAB); // tab is a no-op on a plain text field — must not advance
    await flush();
    stdin.write(ENTER); // enter is what actually advances a text field
    await flush(); // -> Command field (multiline), not yet edited

    // Landing on a fresh multiline field: enter behaves like any other
    // field (advance/submit), not "insert a newline" — this only changes
    // once you actually start typing into it. Since Command is the last
    // field, this submits the form, so back out to prove it: cancel and
    // reopen the "add" form from scratch to actually test the typing path.
    stdin.write(ESC); // cancel the still-empty form (not editing yet, so esc cancels)
    await flush();

    stdin.write("a");
    await flush();
    stdin.write("greet");
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Command field

    stdin.write('local who="${1:-world}"'); // typing starts multiline "edit mode"
    await flush();
    stdin.write(ENTER); // while editing, enter inserts a newline, does not submit
    await flush();
    stdin.write('echo "hi $who"');
    await flush();

    // still mid-edit: esc here exits edit mode, not the whole form
    stdin.write(ESC);
    await flush();
    expect(lastFrame()).toContain("New custom command");

    stdin.write(ENTER); // not editing anymore: enter now submits
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.customCommands).toEqual([
      { name: "greet", command: 'local who="${1:-world}"\necho "hi $who"' },
    ]);
  });

  test("left/right arrows move the cursor within a line, so typing inserts instead of only appending", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();
    stdin.write("a");
    await flush();
    stdin.write("greet");
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Command field

    stdin.write("hello world"); // starts editing, cursor at the end
    await flush();
    stdin.write(LEFT.repeat(5)); // move left before "world" (back over its 5 characters)
    await flush();
    stdin.write("big "); // inserted at the cursor, not appended at the end
    await flush();
    stdin.write(ESC);
    await flush();
    stdin.write(ENTER); // submit
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.customCommands).toEqual([{ name: "greet", command: "hello big world" }]);
  });

  test("up/down arrows move the cursor between lines, preserving column, for editing an earlier line", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();
    stdin.write("a");
    await flush();
    stdin.write("greet");
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Command field

    stdin.write("line one"); // starts editing
    await flush();
    stdin.write(ENTER); // newline
    await flush();
    stdin.write("line two");
    await flush();
    stdin.write(UP); // move up to "line one", same column (end of "line one", 8 chars in)
    await flush();
    stdin.write(" EDITED"); // inserted at the end of "line one", not "line two"
    await flush();
    stdin.write(ESC);
    await flush();
    stdin.write(ENTER); // submit
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.customCommands).toEqual([
      { name: "greet", command: "line one EDITED\nline two" },
    ]);
  });

  // Real bug: some terminals send a pasted line break as "\r" rather than
  // forwarding the clipboard's literal "\n" — indistinguishable, from the
  // app's side, from someone rapidly typing and pressing Enter (which also
  // sends "\r"). When that "\r" arrives folded into a larger `input` string
  // (a paste, not a single discrete keypress), it isn't a bare `key.return`
  // event, so it was landing in the value as a literal "\r" character
  // instead of being normalized to "\n" like every other line break.
  test("a pasted line break arriving as a literal \\r (not a discrete return keypress) is treated as a newline", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();
    stdin.write("a");
    await flush();
    stdin.write("greet");
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Command field

    // One input event containing embedded "\r"s, the way a paste can
    // arrive — not three separate ENTER keystrokes.
    stdin.write("line one\rline two\rline three");
    await flush();
    stdin.write(ESC);
    await flush();
    stdin.write(ENTER); // submit
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.customCommands).toEqual([
      { name: "greet", command: "line one\nline two\nline three" },
    ]);
  });

  test("the Custom Commands list shows only the first line of a multi-line command, not the raw embedded newlines", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      `workspaces: []
customCommands:
  - name: greet
    command: |-
      local who="\${1:-world}"
      echo "hi $who"
`,
    );

    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("2");
    await flush();

    const frame = lastFrame() ?? "";
    expect(frame).toContain('local who="${1:-world}"');
    // The rest of the body must not leak into the list at all — a naive
    // <Text> render of the full multi-line string breaks the box layout
    // (confirmed via a real pty run against wsmdev, not just this harness):
    // the embedded newline splits the row's text but the second line loses
    // the row's own indentation, landing flush against the box border.
    expect(frame).not.toContain('echo "hi $who"');

    unmount();
  });
});

describe("Shell integration setup", () => {
  let tmpDir: string;
  let rcFile: string;
  const previousConfigEnv = process.env.WSM_CONFIG_DIR;
  const previousRcEnv = process.env.WSM_RC_FILE;
  const previousShellEnv = process.env.SHELL;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-app-autocomplete-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;
    rcFile = path.join(tmpDir, ".zshrc-under-test");
    process.env.WSM_RC_FILE = rcFile;
    process.env.SHELL = "/bin/zsh";
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousConfigEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousConfigEnv;
    if (previousRcEnv === undefined) delete process.env.WSM_RC_FILE;
    else process.env.WSM_RC_FILE = previousRcEnv;
    if (previousShellEnv === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShellEnv;
  });

  test("prompts once, on first run with a supported shell, to set up tab-completion and custom commands", async () => {
    const { lastFrame, unmount } = render(<App />);
    await flush();
    expect(lastFrame()).toContain("Shell integration");
    expect(lastFrame()).toContain("tab-completion");
    expect(lastFrame()).toContain("Custom Commands");
    unmount();
  });

  test("confirming the prompt (\"insert it for me\") installs completion and wires up the shared wsmrc pipe", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("y");
    await flush();

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.settings.autocomplete).toBe(true);
    expect(config.settings.shellIntegrationPrompted).toBe(true);
    const completionFile = path.join(tmpDir, "completion.zsh");
    const wsmRcFile = path.join(tmpDir, "wsmrc.zsh");
    expect(fs.existsSync(completionFile)).toBe(true);
    expect(fs.readFileSync(completionFile, "utf8")).toContain("wsm completion zsh");
    // the rc file sources the umbrella wsmrc file, not completion.zsh directly
    expect(fs.readFileSync(rcFile, "utf8")).toContain(wsmRcFile);
    expect(fs.readFileSync(wsmRcFile, "utf8")).toContain(completionFile);
  });

  test("choosing \"I'll insert it myself\" sets up every managed file but never touches the rc file", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("m");
    await flush();

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.settings.autocomplete).toBe(true);
    expect(config.settings.shellIntegrationPrompted).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "completion.zsh"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "wsmrc.zsh"))).toBe(true);
    expect(fs.existsSync(rcFile)).toBe(false);
  });

  test("declining the prompt persists the choice without installing anything", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("n");
    await flush();

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.settings.autocomplete).toBe(false);
    expect(config.settings.shellIntegrationPrompted).toBe(true);
    expect(fs.existsSync(rcFile)).toBe(false);
  });

  test("does not prompt again once already asked", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      "workspaces: []\nsettings:\n  shellIntegrationPrompted: true\n",
    );

    const { lastFrame, unmount } = render(<App />);
    await flush();

    expect(lastFrame()).toContain("No workspaces yet.");
    expect(lastFrame()).not.toContain("Shell integration");
    unmount();
  });

  test("does not prompt when no supported shell is detected", async () => {
    process.env.SHELL = "/usr/bin/fish";

    const { lastFrame, unmount } = render(<App />);
    await flush();

    expect(lastFrame()).toContain("No workspaces yet.");
    expect(lastFrame()).not.toContain("Shell integration");
    unmount();
  });

  test("toggling autocompletion on from the Settings tab installs it immediately", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      "workspaces: []\nsettings:\n  shellIntegrationPrompted: true\n  autocomplete: false\n",
    );

    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("3");
    await flush(); // -> "wsm open" field
    stdin.write(ENTER);
    await flush(); // -> "Dead sessions" field
    stdin.write(ENTER);
    await flush(); // -> "Shell completion" field (present because SHELL is set)
    stdin.write(RIGHT); // Off -> On
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Theme field
    stdin.write(ENTER);
    await flush(); // last field -> submit

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.settings.autocomplete).toBe(true);
    const completionFile = path.join(tmpDir, "completion.zsh");
    const wsmRcFile = path.join(tmpDir, "wsmrc.zsh");
    expect(fs.existsSync(completionFile)).toBe(true);
    expect(fs.readFileSync(completionFile, "utf8")).toContain("wsm completion zsh");
    expect(fs.readFileSync(rcFile, "utf8")).toContain(wsmRcFile);
    expect(fs.readFileSync(wsmRcFile, "utf8")).toContain(completionFile);
  });

  test("toggling autocompletion off from the Settings tab removes only the completion file, leaving the shared rc pipe intact", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      "workspaces: []\nsettings:\n  shellIntegrationPrompted: true\n  autocomplete: true\n",
    );
    // Seed a real installed state matching settings.autocomplete: true above.
    const { installCompletion } = await import("../src/shellIntegration.js");
    installCompletion("zsh");
    expect(fs.existsSync(path.join(tmpDir, "completion.zsh"))).toBe(true);
    const wsmRcFile = path.join(tmpDir, "wsmrc.zsh");
    const rcContentsAfterSeed = fs.readFileSync(rcFile, "utf8");

    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("3");
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Dead sessions
    stdin.write(ENTER);
    await flush(); // -> Shell completion (currently On)
    stdin.write(LEFT); // On -> Off
    await flush();
    stdin.write(ENTER);
    await flush(); // -> Theme
    stdin.write(ENTER);
    await flush(); // submit

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.settings.autocomplete).toBe(false);
    expect(fs.existsSync(path.join(tmpDir, "completion.zsh"))).toBe(false);
    // turning off tab-completion must not rip out the shared rc line — custom
    // commands (and a future re-enable) still depend on it.
    expect(fs.readFileSync(rcFile, "utf8")).toBe(rcContentsAfterSeed);
    expect(fs.readFileSync(rcFile, "utf8")).toContain(wsmRcFile);
  });
});

describe("SettingsForm (Theme live preview)", () => {
  // SettingsForm itself, in isolation: the App/theme rendering pipeline
  // (which produces the actual on-screen color) is exercised separately by
  // the App tests above; ink-testing-library renders with chalk's color
  // support forced off under Jest, so there is no ANSI output here to
  // assert on — what's actually testable, and what matters for "does it
  // preview live", is that onPreviewTheme fires the instant the Theme
  // field's value changes, before the form is submitted.
  test("calls onPreviewTheme immediately when the Theme field is cycled, before any submit", async () => {
    const onPreviewTheme = jest.fn();
    const onSubmit = jest.fn();
    const { stdin, unmount } = render(
      <SettingsForm
        existing={{
          defaultClose: true,
          autoPruneStaleSessions: false,
          autocomplete: false,
          shellIntegrationPrompted: false,
        }}
        themeNames={["Default", "Catppuccin Mocha", "Dracula"]}
        activeTheme="Default"
        onPreviewTheme={onPreviewTheme}
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    await flush();

    stdin.write(ENTER); // -> Dead sessions field
    await flush();
    stdin.write(ENTER); // -> Theme field
    await flush();
    expect(onPreviewTheme).not.toHaveBeenCalled();

    stdin.write(RIGHT); // Default -> Catppuccin Mocha
    await flush();
    expect(onPreviewTheme).toHaveBeenCalledWith("Catppuccin Mocha");
    expect(onSubmit).not.toHaveBeenCalled();

    stdin.write(RIGHT); // Catppuccin Mocha -> Dracula
    await flush();
    expect(onPreviewTheme).toHaveBeenLastCalledWith("Dracula");
    expect(onSubmit).not.toHaveBeenCalled();

    unmount();
  });
});
