export type ItemType = "app" | "command";

// A workspace has one implicit project folder by default (`Workspace.cwd`).
// Setting `folders` (2 or more named entries) splits it into that many
// named project folders instead — e.g. frontend/backend, or frontend/
// backend-1/backend-2 — and each item picks one via `folderIndex` (an index
// into `folders`). `folders` with 0 or 1 entries is never saved; "how many
// folders" is entirely derived from its length, there's no separate
// enum/flag for it (see the removed `WorkspaceLayout`/"split" concept this
// replaces — AGENTS.md's "Configurable folder count" note has the history).
export interface WorkspaceFolder {
  name: string;
  cwd?: string;
}

export interface WorkspaceItem {
  name: string;
  type: ItemType;
  /** Shell command used to launch this item. */
  launch: string;
  /** Working directory for launch/close commands. Falls back to the workspace's cwd (or its assigned folder's cwd, if `folderIndex` is set). */
  cwd?: string;
  /** Which of the workspace's `folders` this item runs in by default (index into that array), when the workspace has more than one. */
  folderIndex?: number;
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
  /** Default working directory for items that don't specify their own. Used when `folders` has fewer than 2 entries (the default). */
  cwd?: string;
  /** Named project folders items can be split across — omitted (or fewer than 2 entries) means just one folder, `cwd`. */
  folders?: WorkspaceFolder[];
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
  /** How many project folders a workspace's "Folders" field allows splitting into. Default: 6. Above 6 is accepted but flagged "experimental" in the Settings tab — the items pane's per-folder columns get narrower with each one and haven't been verified to render well past that. */
  maxWorkspaceFolders?: number;
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
