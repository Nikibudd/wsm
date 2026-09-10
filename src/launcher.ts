import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import { expandHome, getItemLogPath, ensureLogsDir } from "./paths.js";
import { loadState, saveState } from "./state.js";
import { loadConfig, findWorkspace, getSettings } from "./config.js";
import type { Session, SessionItem, State, Workspace, WorkspaceItem } from "./types.js";

function resolveCwd(workspace: Workspace, item: WorkspaceItem): string {
  if (item.cwd) return expandHome(item.cwd);
  if (workspace.layout === "split") {
    const sideCwd = item.side === "frontend" ? workspace.frontendCwd : workspace.backendCwd;
    return expandHome(sideCwd ?? "~");
  }
  return expandHome(workspace.cwd ?? "~");
}

// Run through the user's actual login shell in interactive mode (`-i`), not a
// bare `/bin/sh` (which `child_process`'s `shell: true` uses). Interactive
// mode is what makes zsh/bash source ~/.zshrc or ~/.bashrc, so shell
// functions and aliases defined there behave the same as typing the command
// in a real terminal.
const USER_SHELL = process.env.SHELL || "/bin/zsh";

function shellArgs(command: string): string[] {
  return ["-i", "-c", command];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// How long to watch a freshly-launched item for an immediate crash before
// assuming it's fine. Hardcoded, not a user setting (see AGENTS.md's note
// that the CLI's fast paths stay config-free). Overridable only for tests —
// without this seam, every openWorkspace-calling test would pay this
// latency for real, and there are ~15 of them.
const DEFAULT_OBSERVE_WINDOW_MS = 4000;
let observeWindowMs = DEFAULT_OBSERVE_WINDOW_MS;

/** Test-only: override the launch-failure observation window duration. */
export function __setObserveWindowMsForTesting(ms: number): void {
  observeWindowMs = ms;
}

// Resolves with the child's exit code if it exits within `timeoutMs`, or
// null if the window elapses first — still running is not a failure, it's
// just unknown, and must be treated as silence rather than success/failure.
function observeExit(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve) => {
    let settled = false;
    const onExit = (code: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(code);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.off("exit", onExit);
      resolve(null);
    }, timeoutMs);
    child.once("exit", onExit);
  });
}

function launchItem(workspace: Workspace, item: WorkspaceItem): { sessionItem: SessionItem; observe: Promise<void> } {
  const cwd = resolveCwd(workspace, item);
  const logPath = getItemLogPath(workspace.name, item.name);
  ensureLogsDir();
  // OS-level fd redirection (not Node-side piping): the log fd is handed
  // directly to the child's stdio, so capturing output costs nothing in
  // this process — no stream plumbing, no backpressure, nothing to await.
  const logFd = fs.openSync(logPath, "w");
  let child: ChildProcess;
  try {
    child = spawn(USER_SHELL, shellArgs(item.launch), {
      cwd,
      detached: true,
      stdio: ["ignore", logFd, logFd],
    });
  } finally {
    // The child already has its own duped copy of the fd; our copy is done.
    fs.closeSync(logFd);
  }
  child.unref();

  const observe = observeExit(child, observeWindowMs).then((code) => {
    // code === 0 (fast clean exit, e.g. `open -a X .` / `docker run -d`)
    // and code === null (still running when the window closed) are both
    // expected outcomes, not failures — only a non-zero exit is flagged.
    if (code !== null && code !== 0) {
      console.error(`✗ ${item.name} exited with code ${code} shortly after launch — see ${logPath}`);
    }
  });

  return {
    sessionItem: {
      name: item.name,
      type: item.type,
      pid: child.pid,
      close: item.close,
      cwd,
      logPath,
    },
    observe,
  };
}

function closeSessionItem(item: SessionItem): { ok: boolean; message: string } {
  try {
    if (item.close) {
      spawnSync(USER_SHELL, shellArgs(item.close), { cwd: item.cwd, stdio: "ignore" });
      return { ok: true, message: "ran close command" };
    }
    if (item.pid) {
      try {
        // Negative pid signals the whole process group (items are spawned detached,
        // so they are the leader of their own group).
        process.kill(-item.pid, "SIGTERM");
      } catch {
        process.kill(item.pid, "SIGTERM");
      }
      return { ok: true, message: `terminated pid ${item.pid}` };
    }
    return { ok: false, message: "no close method configured, left running" };
  } catch (err) {
    return { ok: false, message: (err as Error).message };
  }
}

export function closeSession(session: Session): void {
  console.log(`Closing workspace "${session.workspace}"...`);
  for (const item of [...session.items].reverse()) {
    const result = closeSessionItem(item);
    const icon = result.ok ? "✓" : "✗";
    console.log(`  ${icon} ${item.name}: ${result.message}`);
  }
}

export async function closeWorkspaces(opts: { name?: string; all?: boolean }): Promise<void> {
  const state = loadState();
  if (state.sessions.length === 0) {
    console.log("Nothing is currently open.");
    return;
  }

  let targets: Session[];
  let remaining: Session[];

  if (opts.all) {
    targets = state.sessions;
    remaining = [];
  } else if (opts.name) {
    targets = state.sessions.filter((s) => s.workspace === opts.name);
    remaining = state.sessions.filter((s) => s.workspace !== opts.name);
    if (targets.length === 0) {
      console.log(`Workspace "${opts.name}" is not currently open.`);
      return;
    }
  } else {
    targets = [state.sessions[state.sessions.length - 1]];
    remaining = state.sessions.slice(0, -1);
  }

  for (const session of targets) closeSession(session);
  saveState({ sessions: remaining });
}

export async function openWorkspace(name: string, opts: { close?: boolean }): Promise<void> {
  const config = loadConfig();
  const workspace = findWorkspace(config, name);
  if (!workspace) {
    throw new Error(`No workspace named "${name}" found. Run "wsm" to configure one.`);
  }
  const shouldClose = opts.close ?? getSettings(config).defaultClose;

  const state = loadState();
  if (shouldClose && state.sessions.length > 0) {
    for (const session of state.sessions) closeSession(session);
    state.sessions = [];
  }

  console.log(`Opening workspace "${name}"...`);
  const items: SessionItem[] = [];
  // Each item's observation window starts at spawn time and runs
  // concurrently with the others (and with any inter-item delayMs) — only
  // awaited together at the end, so total added latency stays ~one window
  // regardless of item count, not one window per item.
  const observations: Promise<void>[] = [];
  for (const item of workspace.items) {
    console.log(`  → ${item.name}: ${item.launch}`);
    const { sessionItem, observe } = launchItem(workspace, item);
    items.push(sessionItem);
    observations.push(observe);
    if (item.delayMs) await sleep(item.delayMs);
  }

  const session: Session = {
    workspace: name,
    openedAt: new Date().toISOString(),
    items,
  };
  state.sessions.push(session);
  saveState(state);
  console.log(`Workspace "${name}" is open (${items.length} item(s)).`);

  await Promise.all(observations);
}

function isPidAlive(pid: number): boolean {
  try {
    // Signal 0 sends nothing but still throws (ESRCH) if the pid is gone.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Whether an item is actually still running — true/false when we have a
// reliable signal, null when we don't and refuse to guess.
//
// The tracked `item.pid` is the *launcher shell's* pid (from `$SHELL -i -c
// "<launch>"`), not necessarily the thing the launch command started. For a
// command that hands off to a detached process — `code .`, `open -a X .`,
// `docker run -d ...` — that shell exits within moments of launching,
// almost always well before the real app/container does. So a dead
// launcher pid does NOT mean the item quit; it's the expected, permanent
// state for anything launched this way, and treating it as "not running"
// produces near-constant false positives for exactly the items (GUI apps,
// backgrounded containers) this check exists to help with.
//
// - close-command items (arbitrary custom command, e.g. `docker stop ...`):
//   no generic way to verify. Rather than guess from the (expectedly dead)
//   launcher pid, report unknown — never flagged as stale, never pruned.
// - everything else: closing this item IS killing item.pid directly, so
//   that pid's liveness is accurate and meaningful here.
function itemRunning(item: SessionItem): boolean | null {
  if (item.close) return null;
  return !item.pid || isPidAlive(item.pid);
}

export function pruneDeadSessions(state: State): {
  state: State;
  pruned: { workspace: string; item: string }[];
} {
  const pruned: { workspace: string; item: string }[] = [];
  const sessions: Session[] = [];
  for (const session of state.sessions) {
    const items = session.items.filter((item) => {
      const dead = itemRunning(item) === false;
      if (dead) pruned.push({ workspace: session.workspace, item: item.name });
      return !dead;
    });
    if (items.length > 0) sessions.push({ ...session, items });
  }
  return { state: { sessions }, pruned };
}

interface SessionItemStatus {
  name: string;
  pid?: number;
  running: boolean | null;
}

interface SessionStatus {
  workspace: string;
  openedAt: string;
  items: SessionItemStatus[];
}

// Shared by statusReport (human text) and statusJson (machine-readable) so
// the liveness check happens in exactly one place.
function buildStatus(state: State): SessionStatus[] {
  return state.sessions.map((session) => ({
    workspace: session.workspace,
    openedAt: session.openedAt,
    items: session.items.map((item) => ({
      name: item.name,
      pid: item.pid,
      running: itemRunning(item),
    })),
  }));
}

export function statusReport(state: State = loadState()): string {
  const sessions = buildStatus(state);
  if (sessions.length === 0) return "No workspaces currently open.";
  const lines: string[] = [];
  for (const session of sessions) {
    lines.push(`• ${session.workspace} (opened ${session.openedAt})`);
    for (const item of session.items) {
      const pidInfo = item.pid ? ` [pid ${item.pid}]` : "";
      const stale = item.running === false ? " (not running)" : "";
      lines.push(`    - ${item.name}${pidInfo}${stale}`);
    }
  }
  return lines.join("\n");
}

export function statusJson(state: State = loadState()): string {
  return JSON.stringify({ sessions: buildStatus(state) }, null, 2);
}
