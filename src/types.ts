export type ItemType = "app" | "command";

export interface WorkspaceItem {
  name: string;
  type: ItemType;
  /** Shell command used to launch this item. */
  launch: string;
  /** Working directory for launch/close commands. Falls back to the workspace's cwd. */
  cwd?: string;
  /** Optional shell command run instead of killing the process when closing. */
  close?: string;
  /** Optional macOS application name to `quit` via AppleScript when closing. */
  closeAppName?: string;
  /** Optional pause (ms) after launching before starting the next item. */
  delayMs?: number;
}

export const UNGROUPED = "Ungrouped";

export interface Workspace {
  name: string;
  /** Default working directory for items that don't specify their own. */
  cwd?: string;
  /** Optional group name for TUI organization, e.g. "Work", "Personal". */
  group?: string;
  items: WorkspaceItem[];
}

export interface Config {
  workspaces: Workspace[];
}

export interface SessionItem {
  name: string;
  type: ItemType;
  pid?: number;
  close?: string;
  closeAppName?: string;
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
