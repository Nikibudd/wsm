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
  /** Optional free-form label (e.g. "container", "editor") for opening/closing a subset of a workspace's items together — see `wsm open <name> <tag>`/`wsm close <name> <tag>`. */
  tag?: string;
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
  /** Whether wsm sources shell tab-completion (a completion file wsm manages under the config dir, sourced via the shared wsmrc mechanism — see AGENTS.md). Default: false. */
  autocomplete?: boolean;
  /** Whether the TUI has already asked once whether to set up shell integration (tab-completion + custom commands), so it only ever asks once. Default: false. */
  shellIntegrationPrompted?: boolean;
}

/** A user-defined shell function, e.g. `logs` -> `docker compose logs -f`, made available in the shell (not scoped to any workspace) via `wsm commands` — see AGENTS.md. */
export interface CustomCommand {
  name: string;
  command: string;
}

export interface Config {
  workspaces: Workspace[];
  settings?: Settings;
  customCommands?: CustomCommand[];
}

export interface SessionItem {
  name: string;
  type: ItemType;
  pid?: number;
  close?: string;
  cwd?: string;
  /** Path to this item's captured stdout+stderr log, if launch-failure detection wrote one. */
  logPath?: string;
}

export interface Session {
  workspace: string;
  openedAt: string;
  items: SessionItem[];
}

export interface State {
  sessions: Session[];
}
