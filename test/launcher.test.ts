import { jest } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Config, Session } from "../src/types.js";

// child_process must be mocked before launcher.js (which imports it) is first
// loaded, so this whole file needs the module registered up front via a
// single dynamic import rather than per-test — the mock's *implementation*
// is what gets reset between tests, not the module graph itself.
const spawnMock = jest.fn();
const spawnSyncMock = jest.fn();

jest.unstable_mockModule("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

const launcher = await import("../src/launcher.js");
const configModule = await import("../src/config.js");
const stateModule = await import("../src/state.js");

describe("launcher", () => {
  let tmpDir: string;
  const previousEnv = process.env.WSM_CONFIG_DIR;
  let pidCounter: number;
  let killSpy: jest.SpiedFunction<typeof process.kill>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-launcher-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;

    pidCounter = 1000;
    spawnMock.mockReset().mockImplementation(() => ({ pid: pidCounter++, unref: jest.fn() }));
    spawnSyncMock.mockReset().mockImplementation(() => ({ status: 0 }));
    killSpy = jest.spyOn(process, "kill").mockImplementation(() => true);
  });

  afterEach(() => {
    killSpy.mockRestore();
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
  });

  function seedConfig(config: Config) {
    configModule.saveConfig(config);
  }

  test("launches items through the login shell in interactive mode (not a bare /bin/sh)", async () => {
    seedConfig({
      workspaces: [
        { name: "demo", cwd: "/tmp/demo", items: [{ name: "editor", type: "app", launch: "code ." }] },
      ],
    });

    await launcher.openWorkspace("demo", {});

    expect(spawnMock).toHaveBeenCalledTimes(1);
    const [shellPath, args, options] = spawnMock.mock.calls[0] as [string, string[], any];
    expect(shellPath).toBe(process.env.SHELL || "/bin/zsh");
    expect(args).toEqual(["-i", "-c", "code ."]);
    expect(options.cwd).toBe("/tmp/demo");
    expect(options.detached).toBe(true);
    expect(options.stdio).toBe("ignore");
  });

  test("resolves cwd with priority: item.cwd > split side dir > workspace cwd", async () => {
    seedConfig({
      workspaces: [
        {
          name: "split-app",
          layout: "split",
          frontendCwd: "/tmp/fe",
          backendCwd: "/tmp/be",
          items: [
            { name: "fe-item", type: "command", launch: "npm run dev", side: "frontend" },
            { name: "be-item", type: "command", launch: "task runserver", side: "backend" },
            { name: "override", type: "command", launch: "echo hi", side: "backend", cwd: "/tmp/explicit" },
          ],
        },
      ],
    });

    await launcher.openWorkspace("split-app", {});

    const cwds = spawnMock.mock.calls.map((call: any) => call[2].cwd);
    expect(cwds).toEqual(["/tmp/fe", "/tmp/be", "/tmp/explicit"]);
  });

  test("openWorkspace throws a clear error for an unknown workspace name", async () => {
    seedConfig({ workspaces: [] });
    await expect(launcher.openWorkspace("nope", {})).rejects.toThrow(/No workspace named "nope"/);
  });

  test("openWorkspace records the launched pids in a new session", async () => {
    seedConfig({
      workspaces: [{ name: "demo", items: [{ name: "editor", type: "app", launch: "code ." }] }],
    });

    await launcher.openWorkspace("demo", {});

    const state = stateModule.loadState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.workspace).toBe("demo");
    expect(state.sessions[0]!.items[0]).toMatchObject({ name: "editor", pid: 1000 });
  });

  test("opening a workspace closes the previous session first, by default", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
    });

    await launcher.openWorkspace("a", {});
    await launcher.openWorkspace("b", {});

    expect(killSpy).toHaveBeenCalledTimes(1); // default close = kill the tracked pid
    const state = stateModule.loadState();
    expect(state.sessions).toHaveLength(1);
    expect(state.sessions[0]!.workspace).toBe("b");
  });

  test("--no-close leaves the previous session open and stacks the new one", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
    });

    await launcher.openWorkspace("a", {});
    await launcher.openWorkspace("b", { noClose: true });

    expect(killSpy).not.toHaveBeenCalled();
    const state = stateModule.loadState();
    expect(state.sessions.map((s) => s.workspace)).toEqual(["a", "b"]);
  });

  test("closeSession prefers an explicit close command, then closeAppName, then killing the pid", () => {
    const session: Session = {
      workspace: "demo",
      openedAt: "now",
      items: [
        { name: "docker", type: "command", pid: 1, close: "docker compose down", cwd: "/tmp" },
        { name: "editor", type: "app", pid: 2, closeAppName: "Visual Studio Code" },
        { name: "server", type: "command", pid: 3 },
      ],
    };

    launcher.closeSession(session);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.env.SHELL || "/bin/zsh",
      ["-i", "-c", "docker compose down"],
      { cwd: "/tmp", stdio: "ignore" },
    );
    expect(spawnSyncMock).toHaveBeenCalledWith(
      "osascript",
      ["-e", 'tell application "Visual Studio Code" to quit'],
      { stdio: "ignore" },
    );
    expect(killSpy).toHaveBeenCalledWith(-3, "SIGTERM");
  });

  test("closeWorkspaces({ all: true }) removes every session", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
    });
    await launcher.openWorkspace("a", { noClose: true });
    await launcher.openWorkspace("b", { noClose: true });

    await launcher.closeWorkspaces({ all: true });

    expect(stateModule.loadState().sessions).toEqual([]);
  });

  test("closeWorkspaces({ name }) closes only the named session", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
    });
    await launcher.openWorkspace("a", { noClose: true });
    await launcher.openWorkspace("b", { noClose: true });

    await launcher.closeWorkspaces({ name: "a" });

    const remaining = stateModule.loadState().sessions.map((s) => s.workspace);
    expect(remaining).toEqual(["b"]);
  });

  test("statusReport flags a session item whose tracked pid is no longer running", async () => {
    seedConfig({
      workspaces: [
        {
          name: "demo",
          items: [
            { name: "alive-item", type: "command", launch: "sleep 300" },
            { name: "dead-item", type: "command", launch: "sleep 300" },
          ],
        },
      ],
    });
    await launcher.openWorkspace("demo", {});

    const state = stateModule.loadState();
    const deadPid = state.sessions[0]!.items[1]!.pid!;
    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (pid === deadPid && signal === 0) throw new Error("ESRCH");
      return true;
    }) as typeof process.kill);

    const report = launcher.statusReport();

    expect(report).toMatch(/alive-item \[pid \d+\]\s*$/m);
    expect(report).toContain(`dead-item [pid ${deadPid}] (not running)`);
  });

  test("closeWorkspaces() with no name/all closes only the most recently opened session", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
    });
    await launcher.openWorkspace("a", { noClose: true });
    await launcher.openWorkspace("b", { noClose: true });

    await launcher.closeWorkspaces({});

    const remaining = stateModule.loadState().sessions.map((s) => s.workspace);
    expect(remaining).toEqual(["a"]);
  });
});
