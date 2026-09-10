export type ItemType = "app" | "command";

// "single" (default, omitted from saved config) means the workspace has one
// project folder (`cwd`). "split" means it has separate frontend/backend
// folders (`frontendCwd`/`backendCwd`), and each item picks one via `side`.
export type WorkspaceLayout = "single" | "split";
export type ItemSide = "frontend" | "backend";

export interface WorkspaceItem {
  name: string;
  type: ItemType;
  /** Shell command used to launch this item. */
  launch: string;
  /** Working directory for launch/close commands. Falls back to the workspace's cwd. */
  cwd?: string;
  /** Which project folder this item runs in, when the workspace layout is "split". */
  side?: ItemSide;
  /** Optional shell command run instead of killing the process when closing. */
  close?: string;
  /** Optional pause (ms) after launching before starting the next item. */
  delayMs?: number;
}

export const UNGROUPED = "Ungrouped";

export interface Workspace {
  name: string;
  /** Default working directory for items that don't specify their own. Used when layout is "single" (the default). */
  cwd?: string;
  /** "single" (default, one project folder) or "split" (separate frontend/backend folders). */
  layout?: WorkspaceLayout;
  /** Frontend project folder, used when layout is "split". */
  frontendCwd?: string;
  /** Backend project folder, used when layout is "split". */
  backendCwd?: string;
  /** Optional group name for TUI organization, e.g. "Work", "Personal". */
  group?: string;
  items: WorkspaceItem[];
}

export interface Settings {
  /** Whether `wsm open` closes the currently open workspace(s) first by default. Override per-invocation with --close/--no-close. Default: true. */
  defaultClose?: boolean;
  /** Whether `wsm status` automatically drops session items whose tracked pid is no longer running, instead of just flagging them. Default: false. */
  autoPruneStaleSessions?: boolean;
}

export interface Config {
  workspaces: Workspace[];
  settings?: Settings;
}

export interface SessionItem {
  name: string;
  type: ItemType;
  pid?: number;
  close?: string;
  cwd?: string;
}

export interface Session {
  workspace: string;
  openedAt: string;
  items: SessionItem[];
}

export interface State {
  sessions: Session[];
}
