import { jest } from "@jest/globals";
import { EventEmitter } from "node:events";
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

// A real EventEmitter (not a plain { pid, unref } object) so tests can
// simulate a launched process exiting via `.emit("exit", code)` — needed to
// test launch-failure detection, which listens for the child's "exit" event.
class MockChildProcess extends EventEmitter {
  pid: number;
  unref = jest.fn();
  constructor(pid: number) {
    super();
    this.pid = pid;
  }
}

jest.unstable_mockModule("node:child_process", () => ({
  spawn: spawnMock,
  spawnSync: spawnSyncMock,
}));

const launcher = await import("../src/launcher.js");
const configModule = await import("../src/config.js");
const stateModule = await import("../src/state.js");
const pathsModule = await import("../src/paths.js");

describe("launcher", () => {
  let tmpDir: string;
  const previousEnv = process.env.WSM_CONFIG_DIR;
  let pidCounter: number;
  let killSpy: jest.SpiedFunction<typeof process.kill>;
  let spawnedChildren: MockChildProcess[];

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-launcher-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;

    pidCounter = 1000;
    spawnedChildren = [];
    spawnMock.mockReset().mockImplementation(() => {
      const child = new MockChildProcess(pidCounter++);
      spawnedChildren.push(child);
      return child;
    });
    spawnSyncMock.mockReset().mockImplementation(() => ({ status: 0 }));
    killSpy = jest.spyOn(process, "kill").mockImplementation(() => true);
    // Real (short) timers, not Jest fake timers — see launcher.test.ts's
    // failure-detection describe block for why. Keep this tiny so the ~15
    // pre-existing tests that never emit "exit" don't each pay the real
    // observation-window latency.
    launcher.__setObserveWindowMsForTesting(15);
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
    // stdin is still ignored; stdout/stderr are redirected to a log file via
    // fd stdio (see the "per-item log capture" describe block below).
    expect(options.stdio[0]).toBe("ignore");
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
    await launcher.openWorkspace("b", { close: false });

    expect(killSpy).not.toHaveBeenCalled();
    const state = stateModule.loadState();
    expect(state.sessions.map((s) => s.workspace)).toEqual(["a", "b"]);
  });

  test("settings.defaultClose: false is respected with no explicit --close/--no-close flag", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
      settings: { defaultClose: false },
    });

    await launcher.openWorkspace("a", {});
    await launcher.openWorkspace("b", {});

    expect(killSpy).not.toHaveBeenCalled();
    const state = stateModule.loadState();
    expect(state.sessions.map((s) => s.workspace)).toEqual(["a", "b"]);
  });

  test("an explicit --close overrides settings.defaultClose: false", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
      settings: { defaultClose: false },
    });

    await launcher.openWorkspace("a", {});
    await launcher.openWorkspace("b", { close: true });

    expect(killSpy).toHaveBeenCalledTimes(1);
    const state = stateModule.loadState();
    expect(state.sessions.map((s) => s.workspace)).toEqual(["b"]);
  });

  test("closeSession prefers an explicit close command over killing the pid", () => {
    const session: Session = {
      workspace: "demo",
      openedAt: "now",
      items: [
        { name: "docker", type: "command", pid: 1, close: "docker compose down", cwd: "/tmp" },
        { name: "server", type: "command", pid: 3 },
      ],
    };

    launcher.closeSession(session);

    expect(spawnSyncMock).toHaveBeenCalledWith(
      process.env.SHELL || "/bin/zsh",
      ["-i", "-c", "docker compose down"],
      { cwd: "/tmp", stdio: "ignore" },
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
    await launcher.openWorkspace("a", { close: false });
    await launcher.openWorkspace("b", { close: false });

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
    await launcher.openWorkspace("a", { close: false });
    await launcher.openWorkspace("b", { close: false });

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

  test("statusJson returns machine-readable sessions with a running flag per item", async () => {
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
    const alivePid = state.sessions[0]!.items[0]!.pid!;
    const deadPid = state.sessions[0]!.items[1]!.pid!;
    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (pid === deadPid && signal === 0) throw new Error("ESRCH");
      return true;
    }) as typeof process.kill);

    const parsed = JSON.parse(launcher.statusJson());

    expect(parsed).toEqual({
      sessions: [
        {
          workspace: "demo",
          openedAt: state.sessions[0]!.openedAt,
          items: [
            { name: "alive-item", pid: alivePid, running: true },
            { name: "dead-item", pid: deadPid, running: false },
          ],
        },
      ],
    });
  });

  test("statusJson returns an empty sessions array when nothing is open", () => {
    const parsed = JSON.parse(launcher.statusJson());
    expect(parsed).toEqual({ sessions: [] });
  });

  // An item with a custom `close` command (e.g. `docker stop ...`) has no
  // generic way to verify liveness — the launcher pid dies as soon as
  // `docker run -d` returns (same reason a dead tracked pid doesn't mean a
  // detached app/container quit — see itemRunning()'s comment in
  // launcher.ts), but there's no generic way to check an arbitrary close
  // command's target either. Must not guess: treat as unknown rather than
  // falsely reporting "not running" (and never auto-prune on an
  // unverifiable item).
  describe("liveness for items with a custom `close` command is left unverified, not guessed from the dead launcher pid", () => {
    beforeEach(() => {
      seedConfig({
        workspaces: [
          {
            name: "demo",
            items: [
              { name: "Mongo", type: "command", launch: "docker run -d --rm mongo", close: "docker stop mongo" },
            ],
          },
        ],
      });
      killSpy.mockImplementation((() => {
        throw new Error("ESRCH");
      }) as unknown as typeof process.kill);
    });

    test("statusReport does not flag it as not running", async () => {
      await launcher.openWorkspace("demo", {});
      expect(launcher.statusReport()).not.toContain("(not running)");
    });

    test("statusJson reports running: null (unverifiable), not false", async () => {
      await launcher.openWorkspace("demo", {});
      const parsed = JSON.parse(launcher.statusJson());
      expect(parsed.sessions[0].items[0].running).toBeNull();
    });

    test("pruneDeadSessions leaves it alone", async () => {
      await launcher.openWorkspace("demo", {});
      const { pruned } = launcher.pruneDeadSessions(stateModule.loadState());
      expect(pruned).toEqual([]);
    });
  });

  test("pruneDeadSessions drops only the dead items, and drops a session entirely once all its items are dead", async () => {
    seedConfig({
      workspaces: [
        {
          name: "mixed",
          items: [
            { name: "alive-item", type: "command", launch: "sleep 300" },
            { name: "dead-item", type: "command", launch: "sleep 300" },
          ],
        },
        {
          name: "all-dead",
          items: [{ name: "also-dead", type: "command", launch: "sleep 300" }],
        },
      ],
    });
    await launcher.openWorkspace("mixed", {});
    await launcher.openWorkspace("all-dead", { close: false });

    const before = stateModule.loadState();
    const deadPid = before.sessions[0]!.items[1]!.pid!;
    const allDeadPid = before.sessions[1]!.items[0]!.pid!;
    killSpy.mockImplementation(((pid: number, signal?: string | number) => {
      if (signal === 0 && (pid === deadPid || pid === allDeadPid)) throw new Error("ESRCH");
      return true;
    }) as typeof process.kill);

    const { state: pruned, pruned: prunedList } = launcher.pruneDeadSessions(before);

    expect(pruned.sessions).toHaveLength(1);
    expect(pruned.sessions[0]!.workspace).toBe("mixed");
    expect(pruned.sessions[0]!.items.map((i) => i.name)).toEqual(["alive-item"]);
    expect(prunedList).toEqual([
      { workspace: "mixed", item: "dead-item" },
      { workspace: "all-dead", item: "also-dead" },
    ]);
  });

  test("pruneDeadSessions is a no-op when every tracked pid is alive", async () => {
    seedConfig({
      workspaces: [{ name: "demo", items: [{ name: "x", type: "command", launch: "sleep 300" }] }],
    });
    await launcher.openWorkspace("demo", {});
    const state = stateModule.loadState();

    const { state: pruned, pruned: prunedList } = launcher.pruneDeadSessions(state);

    expect(pruned).toEqual(state);
    expect(prunedList).toEqual([]);
  });

  test("closeWorkspaces() with no name/all closes only the most recently opened session", async () => {
    seedConfig({
      workspaces: [
        { name: "a", items: [{ name: "x", type: "command", launch: "sleep 300" }] },
        { name: "b", items: [{ name: "y", type: "command", launch: "sleep 300" }] },
      ],
    });
    await launcher.openWorkspace("a", { close: false });
    await launcher.openWorkspace("b", { close: false });

    await launcher.closeWorkspaces({});

    const remaining = stateModule.loadState().sessions.map((s) => s.workspace);
    expect(remaining).toEqual(["a"]);
  });

  describe("per-item log capture", () => {
    test("redirects the child's stdout+stderr to a per-item log file via fd stdio, not Node-side piping", async () => {
      seedConfig({
        workspaces: [{ name: "demo", items: [{ name: "editor", type: "app", launch: "code ." }] }],
      });

      await launcher.openWorkspace("demo", {});

      const [, , options] = spawnMock.mock.calls[0] as [string, string[], any];
      expect(Array.isArray(options.stdio)).toBe(true);
      expect(options.stdio[0]).toBe("ignore");
      expect(typeof options.stdio[1]).toBe("number");
      expect(options.stdio[2]).toBe(options.stdio[1]); // stdout and stderr share one fd/log file

      const expectedLogPath = pathsModule.getItemLogPath("demo", "editor");
      expect(fs.existsSync(expectedLogPath)).toBe(true);
    });

    test("records the log path on the session item", async () => {
      seedConfig({
        workspaces: [{ name: "demo", items: [{ name: "editor", type: "app", launch: "code ." }] }],
      });

      await launcher.openWorkspace("demo", {});

      const state = stateModule.loadState();
      expect(state.sessions[0]!.items[0]!.logPath).toBe(pathsModule.getItemLogPath("demo", "editor"));
    });

    test("overwrites the log file on each relaunch instead of accumulating", async () => {
      seedConfig({
        workspaces: [{ name: "demo", items: [{ name: "editor", type: "app", launch: "code ." }] }],
      });
      const logPath = pathsModule.getItemLogPath("demo", "editor");

      await launcher.openWorkspace("demo", { close: false });
      fs.appendFileSync(logPath, "leftover output from a previous run\n");
      expect(fs.readFileSync(logPath, "utf8")).not.toBe("");

      await launcher.openWorkspace("demo", { close: false });

      expect(fs.readFileSync(logPath, "utf8")).toBe("");
    });

    test("sanitizes workspace/item names so the log path can't escape the logs directory", async () => {
      seedConfig({
        workspaces: [{ name: "../evil", items: [{ name: "../../etc/passwd", type: "command", launch: "true" }] }],
      });

      await launcher.openWorkspace("../evil", {});

      const state = stateModule.loadState();
      const logPath = state.sessions[0]!.items[0]!.logPath!;
      expect(path.dirname(logPath)).toBe(pathsModule.getLogsDir());
      expect(fs.existsSync(logPath)).toBe(true);
    });
  });

  describe("launch-failure detection", () => {
    let errorSpy: jest.SpiedFunction<typeof console.error>;

    beforeEach(() => {
      errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
      errorSpy.mockRestore();
    });

    // openWorkspace's body runs synchronously (no `await` is reached) right
    // up until it awaits the observation windows at the very end — so by
    // the time the call below returns a pending promise, `spawn` has
    // already run and launcher's "exit" listener is already attached. That
    // lets the test emit "exit" itself instead of needing fake timers or a
    // real 4-second wait.
    test("prints an error pointing at the log file when an item exits non-zero within the observation window", async () => {
      launcher.__setObserveWindowMsForTesting(50);
      seedConfig({
        workspaces: [{ name: "demo", items: [{ name: "broken", type: "command", launch: "false" }] }],
      });

      const promise = launcher.openWorkspace("demo", {});
      expect(spawnedChildren).toHaveLength(1);
      spawnedChildren[0]!.emit("exit", 1, null);
      await promise;

      const logPath = pathsModule.getItemLogPath("demo", "broken");
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("broken"));
      expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(logPath));
    });

    test("does not flag a fast clean exit (code 0) — the common hand-off case for `open -a X .` / `docker run -d`", async () => {
      launcher.__setObserveWindowMsForTesting(50);
      seedConfig({
        workspaces: [{ name: "demo", items: [{ name: "handoff", type: "app", launch: "open -a X ." }] }],
      });

      const promise = launcher.openWorkspace("demo", {});
      spawnedChildren[0]!.emit("exit", 0, null);
      await promise;

      expect(errorSpy).not.toHaveBeenCalled();
    });

    test("does not flag an item still running when the observation window closes (silence is not failure)", async () => {
      launcher.__setObserveWindowMsForTesting(20);
      seedConfig({
        workspaces: [{ name: "demo", items: [{ name: "server", type: "command", launch: "sleep 300" }] }],
      });

      await launcher.openWorkspace("demo", {}); // no "exit" ever emitted

      expect(errorSpy).not.toHaveBeenCalled();
    });

    test("observation windows run concurrently across items, so total latency doesn't scale with item count", async () => {
      launcher.__setObserveWindowMsForTesting(120);
      seedConfig({
        workspaces: [
          {
            name: "demo",
            items: [
              { name: "a", type: "command", launch: "sleep 300" },
              { name: "b", type: "command", launch: "sleep 300" },
              { name: "c", type: "command", launch: "sleep 300" },
            ],
          },
        ],
      });

      const start = Date.now();
      await launcher.openWorkspace("demo", {}); // none exit; each waits out its own window
      const elapsed = Date.now() - start;

      // Sequential would be >= 3 * 120ms; concurrent should land close to one window.
      expect(elapsed).toBeLessThan(3 * 120);
    });
  });
});
