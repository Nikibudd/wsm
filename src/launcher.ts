import { spawn, spawnSync } from "node:child_process";
import { expandHome } from "./paths.js";
import { loadState, saveState } from "./state.js";
import { loadConfig, findWorkspace } from "./config.js";
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

function launchItem(workspace: Workspace, item: WorkspaceItem): SessionItem {
  const cwd = resolveCwd(workspace, item);
  const child = spawn(USER_SHELL, shellArgs(item.launch), {
    cwd,
    detached: true,
    stdio: "ignore",
  });
  child.unref();
  return {
    name: item.name,
    type: item.type,
    pid: child.pid,
    close: item.close,
    closeAppName: item.closeAppName,
    cwd,
  };
}

function closeSessionItem(item: SessionItem): { ok: boolean; message: string } {
  try {
    if (item.close) {
      spawnSync(USER_SHELL, shellArgs(item.close), { cwd: item.cwd, stdio: "ignore" });
      return { ok: true, message: "ran close command" };
    }
    if (item.closeAppName) {
      const script = `tell application "${item.closeAppName}" to quit`;
      spawnSync("osascript", ["-e", script], { stdio: "ignore" });
      return { ok: true, message: `quit app "${item.closeAppName}"` };
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

export async function openWorkspace(name: string, opts: { noClose?: boolean }): Promise<void> {
  const config = loadConfig();
  const workspace = findWorkspace(config, name);
  if (!workspace) {
    throw new Error(`No workspace named "${name}" found. Run "wsm" to configure one.`);
  }

  const state = loadState();
  if (!opts.noClose && state.sessions.length > 0) {
    for (const session of state.sessions) closeSession(session);
    state.sessions = [];
  }

  console.log(`Opening workspace "${name}"...`);
  const items: SessionItem[] = [];
  for (const item of workspace.items) {
    console.log(`  → ${item.name}: ${item.launch}`);
    const sessionItem = launchItem(workspace, item);
    items.push(sessionItem);
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

export function pruneDeadSessions(state: State): {
  state: State;
  pruned: { workspace: string; item: string }[];
} {
  const pruned: { workspace: string; item: string }[] = [];
  const sessions: Session[] = [];
  for (const session of state.sessions) {
    const items = session.items.filter((item) => {
      const alive = !item.pid || isPidAlive(item.pid);
      if (!alive) pruned.push({ workspace: session.workspace, item: item.name });
      return alive;
    });
    if (items.length > 0) sessions.push(items.length === session.items.length ? session : { ...session, items });
  }
  if (pruned.length === 0) return { state, pruned };
  return { state: { sessions }, pruned };
}

export function statusReport(): string {
  const state = loadState();
  if (state.sessions.length === 0) return "No workspaces currently open.";
  const lines: string[] = [];
  for (const session of state.sessions) {
    lines.push(`• ${session.workspace} (opened ${session.openedAt})`);
    for (const item of session.items) {
      const pidInfo = item.pid ? ` [pid ${item.pid}]` : "";
      const stale = item.pid && !isPidAlive(item.pid) ? " (not running)" : "";
      lines.push(`    - ${item.name}${pidInfo}${stale}`);
    }
  }
  return lines.join("\n");
}
