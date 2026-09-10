import React from "react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { jest } from "@jest/globals";
import { render } from "ink-testing-library";
import { load } from "js-yaml";
import { App } from "../src/tui/App.js";
import { SettingsForm } from "../src/tui/Form.js";

const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const ENTER = "\r";
const ESC = "\x1b";

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
    // Unset by default so the one-time autocomplete-setup prompt (see the
    // "Autocomplete setup" describe block below) never fires here — it only
    // triggers for a detected (zsh/bash) shell, and these tests exercise
    // everything else about the App, keystroke-for-keystroke, with no
    // knowledge of that prompt existing.
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

  test("pressing s from the groups pane opens Settings, and toggling+saving persists it", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("s");
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
      autocompletePrompted: false,
    });
  });

  test("cycling and saving the Theme field persists the selection to themes.json", async () => {
    const { stdin, lastFrame, unmount } = render(<App />);
    await flush();

    stdin.write("s");
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

    stdin.write("s");
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
});

describe("Autocomplete setup", () => {
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

  test("prompts once, on first run with a supported shell, to set up tab-completion", async () => {
    const { lastFrame, unmount } = render(<App />);
    await flush();
    expect(lastFrame()).toContain("tab-completion");
    unmount();
  });

  test("confirming the prompt installs completion and persists the choice", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("y");
    await flush();

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.settings.autocomplete).toBe(true);
    expect(config.settings.autocompletePrompted).toBe(true);
    const completionFile = path.join(tmpDir, "completion.zsh");
    expect(fs.existsSync(completionFile)).toBe(true);
    expect(fs.readFileSync(completionFile, "utf8")).toContain("wsm completion zsh");
    expect(fs.readFileSync(rcFile, "utf8")).toContain(completionFile);
  });

  test("declining the prompt persists the choice without installing anything", async () => {
    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("n");
    await flush();

    unmount();
    const config = readConfigYaml(tmpDir);
    expect(config.settings.autocomplete).toBe(false);
    expect(config.settings.autocompletePrompted).toBe(true);
    expect(fs.existsSync(rcFile)).toBe(false);
  });

  test("does not prompt again once already asked", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      "workspaces: []\nsettings:\n  autocompletePrompted: true\n",
    );

    const { lastFrame, unmount } = render(<App />);
    await flush();

    expect(lastFrame()).toContain("No workspaces yet.");
    expect(lastFrame()).not.toContain("tab-completion");
    unmount();
  });

  test("does not prompt when no supported shell is detected", async () => {
    process.env.SHELL = "/usr/bin/fish";

    const { lastFrame, unmount } = render(<App />);
    await flush();

    expect(lastFrame()).toContain("No workspaces yet.");
    expect(lastFrame()).not.toContain("tab-completion");
    unmount();
  });

  test("toggling autocompletion on from the Settings overlay installs it immediately", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      "workspaces: []\nsettings:\n  autocompletePrompted: true\n  autocomplete: false\n",
    );

    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("s");
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
    expect(fs.existsSync(completionFile)).toBe(true);
    expect(fs.readFileSync(completionFile, "utf8")).toContain("wsm completion zsh");
    expect(fs.readFileSync(rcFile, "utf8")).toContain(completionFile);
  });

  test("toggling autocompletion off from the Settings overlay uninstalls it", async () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "config.yaml"),
      "workspaces: []\nsettings:\n  autocompletePrompted: true\n  autocomplete: true\n",
    );
    fs.writeFileSync(rcFile, "");
    // Seed a real installed state matching settings.autocomplete: true above.
    const { installCompletion } = await import("../src/completionInstall.js");
    installCompletion("zsh");
    expect(fs.existsSync(path.join(tmpDir, "completion.zsh"))).toBe(true);

    const { stdin, unmount } = render(<App />);
    await flush();

    stdin.write("s");
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
    expect(fs.readFileSync(rcFile, "utf8")).not.toContain("wsm completion");
    expect(fs.readFileSync(rcFile, "utf8")).toBe("");
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
          autocompletePrompted: false,
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
