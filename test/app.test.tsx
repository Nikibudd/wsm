import React from "react";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { render } from "ink-testing-library";
import { load } from "js-yaml";
import { App } from "../src/tui/App.js";

const DOWN = "\x1b[B";
const LEFT = "\x1b[D";
const RIGHT = "\x1b[C";
const ENTER = "\r";

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

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-app-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
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
    stdin.write(ENTER); // last field -> submit
    await flush();

    unmount();

    const config = readConfigYaml(tmpDir);
    expect(config.settings).toEqual({ defaultClose: false, autoPruneStaleSessions: true });
  });
});
