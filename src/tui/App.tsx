import os from "node:os";
import path from "node:path";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Gradient from "ink-gradient";
import { getSettings, loadConfig, saveConfig } from "../config.js";
import { getConfigFile, getRcFilePath } from "../paths.js";
import {
  detectShell,
  installCompletion,
  installCompletionFilesOnly,
  shellIntegrationRcBlock,
  uninstallCompletion,
} from "../shellIntegration.js";
import type { CompletionShell } from "../shellIntegration.js";
import { loadState } from "../state.js";
import { getActiveTheme, loadThemes, saveThemes } from "../theme.js";
import type { ThemeColors, ThemesFile } from "../theme.js";
import type { Config, CustomCommand, Workspace, WorkspaceItem } from "../types.js";
import { UNGROUPED } from "../types.js";
import { CustomCommandForm, ItemForm, RenameGroupForm, SettingsForm, WorkspaceForm } from "./Form.js";
import { ConfirmDialog, ShellIntegrationPrompt } from "./ConfirmDialog.js";
import { ThemeProvider, useTheme } from "./ThemeContext.js";

type Pane = "groups" | "workspaces" | "items";

// Top-level tabs, switched with 1/2/3 (see TabBar) rather than mnemonic
// letters — Settings and Custom Commands used to be opened with "s"/"c"
// from the Groups pane specifically, which meant the set of keys that did
// something depended on which pane you were looking at. As persistent
// tabs, they're reachable the same way from anywhere, and "s"/"c" go back
// to meaning only what they already mean within the Workspaces tab
// (settings had no other "s" collision; "c" still means duplicate/edit
// depending on pane, unaffected by this).
type Tab = "workspaces" | "customCommands" | "settings";

type Overlay =
  | { kind: "addWorkspace"; presetGroup?: string }
  | { kind: "editWorkspace"; workspaceName: string }
  | { kind: "duplicateWorkspace"; workspaceName: string }
  | { kind: "itemForm"; workspaceName: string; itemIndex: number | null; presetFolderIndex?: number }
  | { kind: "confirmDeleteWorkspace"; workspaceName: string }
  | { kind: "confirmDeleteItem"; workspaceName: string; itemIndex: number }
  | { kind: "renameGroup"; groupName: string }
  | { kind: "confirmDeleteGroup"; groupName: string }
  | { kind: "shellIntegrationPrompt"; shell: CompletionShell };

function displayPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
}

// The "this row is the highlighted one" color pair, repeated across every
// selectable row/pane (group list, workspace list, item rows, every "+ Add
// …" row): selected text/background swap to the theme's selection colors,
// unselected falls back to whatever color the row would otherwise use.
function rowStyle(
  selected: boolean,
  theme: ThemeColors,
  fallbackColor: string = theme.text,
): { color: string; backgroundColor: string | undefined } {
  return {
    color: selected ? theme.selectionText : fallbackColor,
    backgroundColor: selected ? theme.selectionBg : undefined,
  };
}

type PendingSelect = { type: "group"; name: string } | { type: "workspace"; name: string };

interface Group {
  name: string;
  workspaces: Workspace[];
}

function groupWorkspaces(workspaces: Workspace[]): Group[] {
  const map = new Map<string, Workspace[]>();
  for (const w of workspaces) {
    const g = w.group?.trim() || UNGROUPED;
    if (!map.has(g)) map.set(g, []);
    map.get(g)!.push(w);
  }
  const names = [...map.keys()].sort((a, b) => {
    if (a === UNGROUPED) return 1;
    if (b === UNGROUPED) return -1;
    return a.localeCompare(b);
  });
  return names.map((name) => ({ name, workspaces: map.get(name)! }));
}

function useTerminalSize() {
  const { stdout } = useStdout();
  const [size, setSize] = useState({
    columns: stdout?.columns || 80,
    rows: stdout?.rows || 24,
  });

  useEffect(() => {
    if (!stdout) return;
    const onResize = () => setSize({ columns: stdout.columns || 80, rows: stdout.rows || 24 });
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);

  return size;
}

function Header({ width }: { width: number }) {
  const theme = useTheme();
  return (
    <Box
      borderStyle="round"
      borderColor={theme.accent}
      paddingX={1}
      width={width}
      justifyContent="space-between"
    >
      <Box flexShrink={0}>
        <Gradient name="cristal">
          <Text bold> ⚡ WORKSPACE MANAGER </Text>
        </Gradient>
      </Box>
      <Box flexShrink={1} flexGrow={0} minWidth={0}>
        <Text dimColor wrap="truncate-start">
          {displayPath(getConfigFile())}
        </Text>
      </Box>
    </Box>
  );
}

function Footer({ hint, message, width }: { hint: string; message: string | null; width: number }) {
  const theme = useTheme();
  return (
    <Box paddingX={1} width={width}>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {hint}
        </Text>
      </Box>
      {message ? (
        <Box flexShrink={0}>
          <Text color={theme.success}>{message}</Text>
        </Box>
      ) : null}
    </Box>
  );
}

const TABS: { key: Tab; number: string; label: string }[] = [
  { key: "workspaces", number: "1", label: "Workspaces" },
  { key: "customCommands", number: "2", label: "Custom Commands" },
  { key: "settings", number: "3", label: "Settings" },
];

function TabBar({ activeTab, width }: { activeTab: Tab; width: number }) {
  const theme = useTheme();
  return (
    <Box paddingX={1} width={width} borderStyle="round" borderColor={theme.accent}>
      {TABS.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <Box key={tab.key} marginRight={3}>
            <Text {...rowStyle(active, theme, theme.border)} bold={active}>
              {tab.number} {tab.label}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function GroupPane({
  groups,
  selectedIndex,
  active,
  height,
  openNames,
}: {
  groups: Group[];
  selectedIndex: number;
  active: boolean;
  height: number;
  openNames: Set<string>;
}) {
  const theme = useTheme();
  const addRowIndex = groups.length;
  return (
    <Box
      flexDirection="column"
      width={32}
      height={height}
      borderStyle="round"
      borderColor={active ? theme.borderActive : theme.border}
      paddingX={1}
    >
      <Text bold underline color={active ? theme.accent : theme.text}>
        Groups
      </Text>
      <Box height={1} />
      {groups.length === 0 ? (
        <Text dimColor>No workspaces yet.</Text>
      ) : (
        groups.map((g, i) => {
          const selected = active && i === selectedIndex;
          const count = g.workspaces.length;
          const hasOpen = g.workspaces.some((w) => openNames.has(w.name));
          return (
            <Text key={g.name} {...rowStyle(selected, theme)}>
              {selected ? "› " : "  "}
              {hasOpen ? <Text color={rowStyle(selected, theme, theme.success).color}>● </Text> : "  "}
              {g.name} ({count})
            </Text>
          );
        })
      )}
      <Box height={1} />
      <Text {...rowStyle(active && selectedIndex === addRowIndex, theme, theme.success)}>
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ New workspace
      </Text>
    </Box>
  );
}

function WorkspaceListPane({
  groupName,
  workspaces,
  selectedIndex,
  active,
  height,
  openNames,
}: {
  groupName: string | undefined;
  workspaces: Workspace[];
  selectedIndex: number;
  active: boolean;
  height: number;
  openNames: Set<string>;
}) {
  const theme = useTheme();
  const addRowIndex = workspaces.length;
  return (
    <Box
      flexDirection="column"
      width={32}
      height={height}
      borderStyle="round"
      borderColor={active ? theme.borderActive : theme.border}
      paddingX={1}
    >
      <Text bold underline color={active ? theme.accent : theme.text} wrap="truncate-end">
        Groups › {groupName ?? "—"}
      </Text>
      <Box height={1} />
      {workspaces.length === 0 ? (
        <Text dimColor>No workspaces in this group.</Text>
      ) : (
        workspaces.map((w, i) => {
          const selected = active && i === selectedIndex;
          const isOpen = openNames.has(w.name);
          return (
            <Text key={w.name} {...rowStyle(selected, theme)}>
              {selected ? "› " : "  "}
              {isOpen ? <Text color={rowStyle(selected, theme, theme.success).color}>● </Text> : "  "}
              {w.name} ({w.items.length})
            </Text>
          );
        })
      )}
      <Box height={1} />
      <Text {...rowStyle(active && selectedIndex === addRowIndex, theme, theme.success)}>
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ New workspace
      </Text>
    </Box>
  );
}

function ItemRow({ item, selected }: { item: WorkspaceItem; selected: boolean }) {
  const theme = useTheme();
  const typeColor = item.type === "app" ? theme.typeApp : theme.typeCommand;
  const closeLabel = item.close ? `run "${item.close}"` : "kill process";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text {...rowStyle(selected, theme)}>
        {selected ? "› " : "  "}
        {item.name} <Text color={rowStyle(selected, theme, typeColor).color}>[{item.type}]</Text>
        {item.tag ? <Text dimColor> #{item.tag}</Text> : null}
      </Text>
      <Text dimColor wrap="truncate-end">
        {"    "}launch: {item.launch}
      </Text>
      <Text dimColor wrap="truncate-end">
        {"    "}close:  {closeLabel}
      </Text>
    </Box>
  );
}

interface ItemEntry {
  item: WorkspaceItem;
  originalIndex: number;
}

function SideColumn({
  title,
  cwd,
  entries,
  active,
  selectedIndex,
}: {
  title: string;
  cwd: string | undefined;
  entries: ItemEntry[];
  active: boolean;
  selectedIndex: number;
}) {
  const theme = useTheme();
  const addRowIndex = entries.length;
  return (
    <Box flexDirection="column" flexGrow={1} flexBasis={0} minWidth={0}>
      <Text bold color={active ? theme.accent : theme.border}>
        {title}
      </Text>
      <Text dimColor wrap="truncate-end">
        {cwd ?? "(not set)"}
      </Text>
      <Box height={1} />
      {entries.length === 0 ? (
        <Text dimColor>No items yet.</Text>
      ) : (
        entries.map(({ item }, i) => (
          <ItemRow key={item.name + i} item={item} selected={active && i === selectedIndex} />
        ))
      )}
      <Text {...rowStyle(active && selectedIndex === addRowIndex, theme, theme.success)}>
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ Add item
      </Text>
    </Box>
  );
}

// One bucket per folder, items sorted into whichever their `folderIndex`
// names — clamped defensively (e.g. a hand-edited config.yaml with an
// out-of-range index, or a workspace just edited down to fewer folders
// than some item still references) rather than dropping/crashing on it.
function groupItemsByFolder(workspace: Workspace): ItemEntry[][] {
  const folderCount = workspace.folders?.length ?? 0;
  const buckets: ItemEntry[][] = Array.from({ length: Math.max(folderCount, 1) }, () => []);
  workspace.items.forEach((item, originalIndex) => {
    const idx = Math.min(Math.max(item.folderIndex ?? 0, 0), buckets.length - 1);
    buckets[idx]!.push({ item, originalIndex });
  });
  return buckets;
}

// Applied whenever a workspace's folders are (re)saved from WorkspaceForm —
// folders are referenced by index (see types.ts), so renaming one is free,
// but shrinking the folder count can leave items pointing past the new
// array's end. Clamps those back to the last valid folder rather than
// leaving a dangling index (groupItemsByFolder already clamps defensively
// too, but doing it here keeps what's actually saved to config.yaml clean,
// not just what's rendered). Drops `folderIndex` entirely once a workspace
// is back down to a single folder — `folders` itself is never saved at
// length <= 1 either, so there'd be nothing left for it to reference.
function clampItemFolders(items: WorkspaceItem[], folderCount: number): WorkspaceItem[] {
  if (folderCount <= 1) {
    return items.map(({ folderIndex: _folderIndex, ...rest }) => rest);
  }
  return items.map((item) =>
    item.folderIndex !== undefined && item.folderIndex >= folderCount
      ? { ...item, folderIndex: folderCount - 1 }
      : item,
  );
}

function ItemPane({
  workspace,
  selectedIndex,
  itemColumn,
  active,
  height,
}: {
  workspace: Workspace | undefined;
  selectedIndex: number;
  itemColumn: number;
  active: boolean;
  height: number;
}) {
  const theme = useTheme();

  if (!workspace) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        height={height}
        borderStyle="round"
        borderColor={theme.border}
        paddingX={2}
        justifyContent="center"
        alignItems="center"
      >
        <Text dimColor>Select a workspace, or press "a" to create one.</Text>
      </Box>
    );
  }

  const folders = workspace.folders ?? [];
  const isSplit = folders.length > 1;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      height={height}
      borderStyle="round"
      borderColor={active ? theme.borderActive : theme.border}
      paddingX={2}
    >
      <Text bold underline color={active ? theme.accent : theme.text}>
        {workspace.name}
      </Text>
      <Text dimColor>group: {workspace.group ?? UNGROUPED}</Text>
      {!isSplit ? (
        <Text dimColor>cwd: {workspace.cwd ?? "(none set — items use their own or home dir)"}</Text>
      ) : null}
      <Box height={1} />
      {isSplit ? (
        (() => {
          const buckets = groupItemsByFolder(workspace);
          return (
            <Box flexDirection="row" flexGrow={1}>
              {folders.map((folder, i) => (
                <React.Fragment key={i}>
                  {i > 0 ? <Box width={2} /> : null}
                  <SideColumn
                    title={folder.name}
                    cwd={folder.cwd}
                    entries={buckets[i] ?? []}
                    active={active && itemColumn === i}
                    selectedIndex={selectedIndex}
                  />
                </React.Fragment>
              ))}
            </Box>
          );
        })()
      ) : (
        <>
          {workspace.items.length === 0 ? (
            <Text dimColor>No items yet. Press "a" to add one (editor, terminal, docker, ...).</Text>
          ) : (
            workspace.items.map((item, i) => (
              <ItemRow key={item.name + i} item={item} selected={active && i === selectedIndex} />
            ))
          )}
          <Text {...rowStyle(active && selectedIndex === workspace.items.length, theme, theme.success)}>
            {active && selectedIndex === workspace.items.length ? "› " : "  "}+ Add item
          </Text>
        </>
      )}
    </Box>
  );
}

type CustomCommandsMode =
  | { kind: "list" }
  | { kind: "form"; index: number | null }
  | { kind: "confirmDelete"; index: number };

// Sidebar half of the Custom Commands tab, mirroring WorkspaceListPane:
// names only (no preview) plus a synthetic "+ Add command" row.
function CustomCommandListPane({
  commands,
  selectedIndex,
  active,
  height,
}: {
  commands: CustomCommand[];
  selectedIndex: number;
  // False while a command is being added/edited inline in the main panel
  // (see CustomCommandsScreen's "form" mode below) — the sidebar stays
  // visible for context but drops its highlight styling, matching how
  // WorkspaceListPane dims when focus has moved into the items pane.
  active: boolean;
  height: number;
}) {
  const theme = useTheme();
  const addRowIndex = commands.length;
  return (
    <Box
      flexDirection="column"
      width={32}
      height={height}
      borderStyle="round"
      borderColor={active ? theme.borderActive : theme.border}
      paddingX={1}
    >
      <Text bold underline color={active ? theme.accent : theme.text}>
        Custom commands
      </Text>
      <Box height={1} />
      {commands.length === 0 ? (
        <Text dimColor>No custom commands yet.</Text>
      ) : (
        commands.map((c, i) => (
          <Text key={c.name} {...rowStyle(active && i === selectedIndex, theme)}>
            {active && i === selectedIndex ? "› " : "  "}
            {c.name}
          </Text>
        ))
      )}
      <Box height={1} />
      <Text {...rowStyle(active && selectedIndex === addRowIndex, theme, theme.success)}>
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ Add command
      </Text>
    </Box>
  );
}

// Main-panel half, mirroring ItemPane: the selected command's full body,
// every line rendered as-is (never truncated) — unlike the old single-box
// list, which could only show a one-line preview without corrupting its
// own layout (see the removed comment this replaces, in git history).
function CustomCommandDetailPane({
  command,
  height,
}: {
  command: CustomCommand | undefined;
  height: number;
}) {
  const theme = useTheme();

  if (!command) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        height={height}
        borderStyle="round"
        borderColor={theme.border}
        paddingX={2}
        justifyContent="center"
        alignItems="center"
      >
        <Text dimColor>Select a command, or press "a" to add one.</Text>
      </Box>
    );
  }

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      height={height}
      borderStyle="round"
      borderColor={theme.border}
      paddingX={2}
    >
      <Text bold underline color={theme.text}>
        {command.name}
      </Text>
      <Box height={1} />
      {command.command.split("\n").map((line, i) => (
        // A fully-empty line would collapse to zero height in Ink; a single
        // space keeps blank lines in the body visible.
        <Text key={i} color={theme.text}>
          {line || " "}
        </Text>
      ))}
    </Box>
  );
}

// Self-contained tab content, unlike the Groups->Workspaces->Items
// drill-down: custom commands are a flat, workspace-independent list, so
// add/edit/delete are all handled as internal modes here rather than as
// separate top-level Overlay kinds in App — App only ever mounts this one
// component while its tab is active. The "list" and "form" modes both keep
// the sidebar on screen and share its layout — adding/editing a command
// happens inline in the main panel, the same space that otherwise shows the
// selected command's body, rather than a dialog covering the whole tab.
// "confirmDelete" is the exception: a plain yes/no prompt still takes over
// as a centered dialog, same as every destructive confirmation elsewhere in
// the app (see Workspaces' own confirmDeleteWorkspace/confirmDeleteItem).
function CustomCommandsScreen({
  commands,
  onChange,
  flash,
  height,
}: {
  commands: CustomCommand[];
  onChange: (next: CustomCommand[]) => void;
  flash: (text: string) => void;
  height: number;
}) {
  const [mode, setMode] = useState<CustomCommandsMode>({ kind: "list" });
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex((i) => Math.min(i, commands.length));
  }, [commands.length]);

  // No "esc closes this" here anymore — as a persistent tab (not an
  // overlay), there's nothing to close back to; switch tabs with 1/2/3
  // instead. Esc still works as "cancel" for the form/confirm sub-modes
  // below, unaffected.
  useInput(
    (input, key) => {
      const maxIndex = commands.length; // synthetic "+ Add command" row
      if (key.downArrow) {
        setSelectedIndex((i) => Math.min(i + 1, maxIndex));
      } else if (key.upArrow) {
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (key.return || input === "a") {
        if (input === "a" || selectedIndex === maxIndex) setMode({ kind: "form", index: null });
        else setMode({ kind: "form", index: selectedIndex });
      } else if (input === "d" && selectedIndex < maxIndex) {
        setMode({ kind: "confirmDelete", index: selectedIndex });
      }
    },
    { isActive: mode.kind === "list" },
  );

  if (mode.kind === "form") {
    const existing = mode.index !== null ? commands[mode.index] : undefined;
    return (
      <Box flexDirection="row" flexGrow={1} height={height}>
        <CustomCommandListPane commands={commands} selectedIndex={selectedIndex} active={false} height={height} />
        <Box width={1} />
        <CustomCommandForm
          existing={existing}
          existingNames={commands.map((c) => c.name)}
          fullScreen
          height={height}
          onSubmit={(command) => {
            const next = [...commands];
            if (mode.index !== null) next[mode.index] = command;
            else next.push(command);
            onChange(next);
            setMode({ kind: "list" });
            flash(`Saved custom command "${command.name}"`);
          }}
          onCancel={() => setMode({ kind: "list" })}
        />
      </Box>
    );
  }

  if (mode.kind === "confirmDelete") {
    const command = commands[mode.index];
    return command ? (
      <Box flexGrow={1} height={height} alignItems="center" justifyContent="center">
        <ConfirmDialog
          message={`Delete custom command "${command.name}"?`}
          onConfirm={() => {
            onChange(commands.filter((_, i) => i !== mode.index));
            setMode({ kind: "list" });
            flash(`Deleted custom command "${command.name}"`);
          }}
          onCancel={() => setMode({ kind: "list" })}
        />
      </Box>
    ) : null;
  }

  // -1: one line reserved below the panes for the hint text, the same way
  // App reserves a row for its own Footer outside contentHeight.
  const paneHeight = height - 1;
  const selectedCommand = selectedIndex < commands.length ? commands[selectedIndex] : undefined;

  return (
    <Box flexDirection="column" flexGrow={1} height={height}>
      <Box flexDirection="row" height={paneHeight}>
        <CustomCommandListPane
          commands={commands}
          selectedIndex={selectedIndex}
          active
          height={paneHeight}
        />
        <Box width={1} />
        <CustomCommandDetailPane command={selectedCommand} height={paneHeight} />
      </Box>
      <Text dimColor>↑↓ select · enter edit · a add · d delete · 1/2/3 tabs · q quit</Text>
    </Box>
  );
}

export function App() {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [config, setConfig] = useState<Config>(() => loadConfig());
  const [themesFile, setThemesFile] = useState<ThemesFile>(() => loadThemes());
  const [activeTab, setActiveTab] = useState<Tab>("workspaces");
  const [pane, setPane] = useState<Pane>("groups");
  const [groupIndex, setGroupIndex] = useState(0);
  const [wsIndex, setWsIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [itemColumn, setItemColumn] = useState(0);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Unsaved theme selection from the Settings overlay's Theme field, applied
  // immediately so changing it previews live; cleared on save (themesFile
  // itself now reflects it) or cancel (revert to the persisted theme).
  const [previewThemeName, setPreviewThemeName] = useState<string | null>(null);

  const openNames = useMemo(() => new Set(loadState().sessions.map((s) => s.workspace)), []);
  // $SHELL doesn't change during the app's lifetime, so this only needs
  // computing once.
  const shell = useMemo(() => detectShell(), []);

  const pendingSelect = useRef<PendingSelect | null>(null);
  const messageTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const flash = (text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 2500);
  };

  useEffect(() => {
    return () => {
      if (messageTimer.current) clearTimeout(messageTimer.current);
    };
  }, []);

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  // One-time prompt, first run only: only fires for a detected (bash/zsh)
  // shell, and only until settings.shellIntegrationPrompted is set — the
  // ShellIntegrationPrompt's own handlers below are what set it, whichever
  // of the three ways the user answers, so this effect never fires twice.
  useEffect(() => {
    if (shell && !getSettings(config).shellIntegrationPrompted) {
      setOverlay({ kind: "shellIntegrationPrompt", shell });
    }
    // Mount-only: $SHELL/config are read once, at startup.
  }, []);

  useEffect(() => {
    saveThemes(themesFile);
  }, [themesFile]);
  const activeTheme = useMemo(
    () => getActiveTheme({ ...themesFile, activeTheme: previewThemeName ?? themesFile.activeTheme }),
    [themesFile, previewThemeName],
  );

  const groups = useMemo(() => groupWorkspaces(config.workspaces), [config.workspaces]);
  const currentGroup = groups[groupIndex];
  const currentGroupWorkspaces = currentGroup?.workspaces ?? [];
  const currentWorkspace = currentGroupWorkspaces[wsIndex];
  const currentFolders = currentWorkspace?.folders ?? [];
  const isSplit = currentFolders.length > 1;
  const itemBuckets = useMemo(
    () => (currentWorkspace ? groupItemsByFolder(currentWorkspace) : []),
    [currentWorkspace],
  );
  const activeColumnEntries = itemBuckets[itemColumn] ?? [];

  // Resolve a pending "select this by name" request once the derived group
  // list reflects a just-made change (add/rename/move workspace or group).
  useEffect(() => {
    const pending = pendingSelect.current;
    if (!pending) return;
    if (pending.type === "group") {
      const gi = groups.findIndex((g) => g.name === pending.name);
      if (gi !== -1) {
        setGroupIndex(gi);
        setPane("groups");
        pendingSelect.current = null;
      }
      return;
    }
    for (let gi = 0; gi < groups.length; gi++) {
      const wi = groups[gi]!.workspaces.findIndex((w) => w.name === pending.name);
      if (wi !== -1) {
        setGroupIndex(gi);
        setWsIndex(wi);
        setPane("workspaces");
        pendingSelect.current = null;
        return;
      }
    }
  }, [groups]);

  useEffect(() => {
    setGroupIndex((i) => Math.min(i, groups.length));
  }, [groups.length]);

  useEffect(() => {
    setWsIndex((i) => Math.min(i, currentGroupWorkspaces.length));
  }, [currentGroup?.name, currentGroupWorkspaces.length]);

  useEffect(() => {
    setItemColumn(0);
  }, [currentWorkspace?.name]);

  // Clamp if the workspace was just edited down to fewer folders while its
  // items pane was focused on one that no longer exists.
  useEffect(() => {
    setItemColumn((c) => Math.min(c, Math.max(0, currentFolders.length - 1)));
  }, [currentFolders.length]);

  useEffect(() => {
    if (!currentWorkspace) {
      setItemIndex(0);
      return;
    }
    const maxIndex = isSplit ? activeColumnEntries.length : currentWorkspace.items.length;
    setItemIndex((i) => Math.min(i, maxIndex));
  }, [currentWorkspace, wsIndex, isSplit, activeColumnEntries.length]);

  // Fall back to a valid pane if the thing we were viewing disappeared
  // (e.g. deleting the only workspace in a group).
  useEffect(() => {
    if (pane === "workspaces" && !currentGroup) setPane("groups");
    else if (pane === "items" && !currentWorkspace) setPane(currentGroup ? "workspaces" : "groups");
  }, [pane, currentGroup, currentWorkspace]);

  const mutateWorkspace = (name: string, fn: (w: Workspace) => Workspace) => {
    setConfig((prev) => ({
      ...prev,
      workspaces: prev.workspaces.map((w) => (w.name === name ? fn(w) : w)),
    }));
  };

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }

      // Number-key tab switching works from anywhere (any pane, any depth
      // in the Workspaces drill-down) as long as no overlay/form is open —
      // same isActive gate the rest of this handler already has. See the
      // TabBar component for the visible 1/2/3 -> name mapping.
      if (input === "1") {
        setActiveTab("workspaces");
        return;
      }
      if (input === "2") {
        setActiveTab("customCommands");
        return;
      }
      if (input === "3") {
        setActiveTab("settings");
        return;
      }

      // The rest of this handler is the Workspaces tab's own Groups ->
      // Workspaces -> Items navigation — Custom Commands/Settings own
      // their own input handling as separate components, only ever
      // mounted while their tab is active.
      if (activeTab !== "workspaces") return;

      if (pane === "groups") {
        const maxIndex = groups.length; // synthetic "+ New workspace" row
        if (key.downArrow) setGroupIndex((i) => Math.min(i + 1, maxIndex));
        else if (key.upArrow) setGroupIndex((i) => Math.max(i - 1, 0));
        else if (key.return || key.rightArrow) {
          if (groupIndex === groups.length) {
            setOverlay({ kind: "addWorkspace" });
          } else if (groups.length > 0) {
            setPane("workspaces");
          }
        } else if (input === "a") {
          setOverlay({ kind: "addWorkspace" });
        } else if (input === "r" && groupIndex < groups.length) {
          setOverlay({ kind: "renameGroup", groupName: groups[groupIndex]!.name });
        } else if (input === "d" && groupIndex < groups.length) {
          setOverlay({ kind: "confirmDeleteGroup", groupName: groups[groupIndex]!.name });
        }
        return;
      }

      if (pane === "workspaces") {
        if (!currentGroup) {
          setPane("groups");
          return;
        }
        const maxIndex = currentGroupWorkspaces.length; // synthetic add row
        const presetGroup = currentGroup.name === UNGROUPED ? undefined : currentGroup.name;
        if (key.leftArrow || key.escape) {
          setPane("groups");
        } else if (key.downArrow) {
          setWsIndex((i) => Math.min(i + 1, maxIndex));
        } else if (key.upArrow) {
          setWsIndex((i) => Math.max(i - 1, 0));
        } else if (key.return || key.rightArrow) {
          if (wsIndex === maxIndex) {
            setOverlay({ kind: "addWorkspace", presetGroup });
          } else if (currentGroupWorkspaces.length > 0) {
            setPane("items");
          }
        } else if (input === "a") {
          setOverlay({ kind: "addWorkspace", presetGroup });
        } else if (input === "r" && wsIndex < maxIndex) {
          setOverlay({ kind: "editWorkspace", workspaceName: currentGroupWorkspaces[wsIndex]!.name });
        } else if (input === "c" && wsIndex < maxIndex) {
          setOverlay({
            kind: "duplicateWorkspace",
            workspaceName: currentGroupWorkspaces[wsIndex]!.name,
          });
        } else if (input === "d" && wsIndex < maxIndex) {
          setOverlay({
            kind: "confirmDeleteWorkspace",
            workspaceName: currentGroupWorkspaces[wsIndex]!.name,
          });
        }
        return;
      }

      // pane === "items"
      if (!currentWorkspace) {
        setPane(currentGroup ? "workspaces" : "groups");
        return;
      }

      if (isSplit) {
        const maxIndex = activeColumnEntries.length; // synthetic add row
        if (key.escape) {
          setPane("workspaces");
        } else if (key.leftArrow) {
          if (itemColumn > 0) {
            setItemColumn((c) => c - 1);
            setItemIndex(0);
          } else {
            setPane("workspaces");
          }
        } else if (key.rightArrow) {
          if (itemColumn < currentFolders.length - 1) {
            setItemColumn((c) => c + 1);
            setItemIndex(0);
          }
        } else if (key.downArrow) {
          setItemIndex((i) => Math.min(i + 1, maxIndex));
        } else if (key.upArrow) {
          setItemIndex((i) => Math.max(i - 1, 0));
        } else if (key.return || input === "a") {
          if (input === "a" || itemIndex === maxIndex) {
            setOverlay({
              kind: "itemForm",
              workspaceName: currentWorkspace.name,
              itemIndex: null,
              presetFolderIndex: itemColumn,
            });
          } else {
            setOverlay({
              kind: "itemForm",
              workspaceName: currentWorkspace.name,
              itemIndex: activeColumnEntries[itemIndex]!.originalIndex,
            });
          }
        } else if (input === "d" && itemIndex < maxIndex) {
          setOverlay({
            kind: "confirmDeleteItem",
            workspaceName: currentWorkspace.name,
            itemIndex: activeColumnEntries[itemIndex]!.originalIndex,
          });
        } else if (input === "c") {
          setOverlay({ kind: "editWorkspace", workspaceName: currentWorkspace.name });
        }
        return;
      }

      const maxIndex = currentWorkspace.items.length; // synthetic add row

      if (key.leftArrow || key.escape) {
        setPane("workspaces");
      } else if (key.downArrow) {
        setItemIndex((i) => Math.min(i + 1, maxIndex));
      } else if (key.upArrow) {
        setItemIndex((i) => Math.max(i - 1, 0));
      } else if (key.return || input === "a") {
        if (input === "a" || itemIndex === maxIndex) {
          setOverlay({ kind: "itemForm", workspaceName: currentWorkspace.name, itemIndex: null });
        } else {
          setOverlay({ kind: "itemForm", workspaceName: currentWorkspace.name, itemIndex });
        }
      } else if (input === "d" && itemIndex < maxIndex) {
        setOverlay({ kind: "confirmDeleteItem", workspaceName: currentWorkspace.name, itemIndex });
      } else if (input === "c") {
        setOverlay({ kind: "editWorkspace", workspaceName: currentWorkspace.name });
      }
    },
    { isActive: overlay === null },
  );

  // -7, not -5: Header (3 rows) + the bordered TabBar (3 rows) + Footer (1).
  const contentHeight = Math.max(10, rows - 7);

  const hint = useMemo(() => {
    if (pane === "groups") {
      return "↑↓ select · enter/→ open group · a new workspace · r rename group · d delete group · ● = open · 1/2/3 tabs · q quit";
    }
    if (pane === "workspaces") {
      return "↑↓ select · enter/→ open · a add workspace · r rename/move · c duplicate · d delete · ←/esc back · ● = open · 1/2/3 tabs · q quit";
    }
    if (isSplit) {
      return "↑↓ select · ←→ switch folder · enter edit · a add item · c workspace settings · d delete · esc back · 1/2/3 tabs · q quit";
    }
    return "↑↓ select · enter edit · a add item · c workspace settings · d delete · ←/esc back · 1/2/3 tabs · q quit";
  }, [pane, isSplit]);

  let overlayNode: React.ReactNode = null;
  if (overlay) {
    if (overlay.kind === "addWorkspace") {
      overlayNode = (
        <WorkspaceForm
          existingNames={config.workspaces.map((w) => w.name)}
          presetGroup={overlay.presetGroup}
          maxFolders={getSettings(config).maxWorkspaceFolders}
          onSubmit={({ name, cwd, group, folders }) => {
            const workspace: Workspace = {
              name,
              group: group || undefined,
              cwd: folders.length === 0 ? cwd || undefined : undefined,
              folders: folders.length > 0 ? folders : undefined,
              items: [],
            };
            setConfig((prev) => ({
              ...prev,
              workspaces: [...prev.workspaces, workspace],
            }));
            pendingSelect.current = { type: "workspace", name };
            setOverlay(null);
            flash(`Created workspace "${name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      );
    } else if (overlay.kind === "editWorkspace") {
      const workspace = config.workspaces.find((w) => w.name === overlay.workspaceName);
      overlayNode = workspace ? (
        <WorkspaceForm
          existing={workspace}
          existingNames={config.workspaces.map((w) => w.name)}
          maxFolders={getSettings(config).maxWorkspaceFolders}
          onSubmit={({ name, cwd, group, folders }) => {
            mutateWorkspace(overlay.workspaceName, (w) => ({
              ...w,
              name,
              group: group || undefined,
              cwd: folders.length === 0 ? cwd || undefined : undefined,
              folders: folders.length > 0 ? folders : undefined,
              items: clampItemFolders(w.items, folders.length),
            }));
            pendingSelect.current = { type: "workspace", name };
            setOverlay(null);
            flash(`Saved workspace "${name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
    } else if (overlay.kind === "duplicateWorkspace") {
      const source = config.workspaces.find((w) => w.name === overlay.workspaceName);
      overlayNode = source ? (
        <WorkspaceForm
          existingNames={config.workspaces.map((w) => w.name)}
          initialValues={{
            name: `${source.name}-copy`,
            group: source.group ?? "",
            cwd: source.cwd ?? "",
            folders: source.folders ?? [],
          }}
          title={`Duplicate workspace · ${source.name}`}
          submitLabel="duplicate"
          maxFolders={getSettings(config).maxWorkspaceFolders}
          onSubmit={({ name, cwd, group, folders }) => {
            const workspace: Workspace = {
              name,
              group: group || undefined,
              cwd: folders.length === 0 ? cwd || undefined : undefined,
              folders: folders.length > 0 ? folders : undefined,
              items: clampItemFolders(
                source.items.map((item) => ({ ...item })),
                folders.length,
              ),
            };
            setConfig((prev) => ({
              ...prev,
              workspaces: [...prev.workspaces, workspace],
            }));
            pendingSelect.current = { type: "workspace", name };
            setOverlay(null);
            flash(`Duplicated workspace as "${name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
    } else if (overlay.kind === "itemForm") {
      const workspace = config.workspaces.find((w) => w.name === overlay.workspaceName);
      const existing =
        overlay.itemIndex !== null ? workspace?.items[overlay.itemIndex] : undefined;
      overlayNode = workspace ? (
        <ItemForm
          existing={existing}
          folders={workspace.folders ?? []}
          presetFolderIndex={overlay.presetFolderIndex}
          onSubmit={(item) => {
            mutateWorkspace(overlay.workspaceName, (w) => {
              const items = [...w.items];
              if (overlay.itemIndex !== null) items[overlay.itemIndex] = item;
              else items.push(item);
              return { ...w, items };
            });
            setOverlay(null);
            flash(`Saved item "${item.name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
    } else if (overlay.kind === "confirmDeleteWorkspace") {
      const workspace = config.workspaces.find((w) => w.name === overlay.workspaceName);
      overlayNode = workspace ? (
        <ConfirmDialog
          message={`Delete workspace "${workspace.name}" and all its items?`}
          onConfirm={() => {
            setConfig((prev) => ({
              ...prev,
              workspaces: prev.workspaces.filter((w) => w.name !== overlay.workspaceName),
            }));
            setOverlay(null);
            flash(`Deleted workspace "${workspace.name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
    } else if (overlay.kind === "confirmDeleteItem") {
      const workspace = config.workspaces.find((w) => w.name === overlay.workspaceName);
      const item = workspace?.items[overlay.itemIndex];
      overlayNode = item ? (
        <ConfirmDialog
          message={`Delete item "${item.name}"?`}
          onConfirm={() => {
            mutateWorkspace(overlay.workspaceName, (w) => ({
              ...w,
              items: w.items.filter((_, i) => i !== overlay.itemIndex),
            }));
            setOverlay(null);
            flash(`Deleted item "${item.name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
    } else if (overlay.kind === "renameGroup") {
      overlayNode = (
        <RenameGroupForm
          groupName={overlay.groupName}
          onSubmit={(newName) => {
            const normalized = newName === UNGROUPED ? undefined : newName;
            setConfig((prev) => ({
              ...prev,
              workspaces: prev.workspaces.map((w) =>
                (w.group?.trim() || UNGROUPED) === overlay.groupName
                  ? { ...w, group: normalized }
                  : w,
              ),
            }));
            pendingSelect.current = { type: "group", name: newName };
            setOverlay(null);
            flash(`Renamed group to "${newName}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      );
    } else if (overlay.kind === "shellIntegrationPrompt") {
      const rcFileName = path.basename(getRcFilePath(overlay.shell));
      const rcBlock = shellIntegrationRcBlock(overlay.shell);
      overlayNode = (
        <ShellIntegrationPrompt
          rcFileName={rcFileName}
          rcBlock={rcBlock}
          onInsert={() => {
            installCompletion(overlay.shell);
            setConfig((prev) => ({
              ...prev,
              settings: { ...getSettings(prev), autocomplete: true, shellIntegrationPrompted: true },
            }));
            setOverlay(null);
            flash("Shell integration installed — restart your shell to use it");
          }}
          onManual={() => {
            installCompletionFilesOnly(overlay.shell);
            setConfig((prev) => ({
              ...prev,
              settings: { ...getSettings(prev), autocomplete: true, shellIntegrationPrompted: true },
            }));
            setOverlay(null);
            flash("Add the shown line to your rc file, then restart your shell");
          }}
          onSkip={() => {
            setConfig((prev) => ({
              ...prev,
              settings: { ...getSettings(prev), shellIntegrationPrompted: true },
            }));
            setOverlay(null);
          }}
        />
      );
    } else if (overlay.kind === "confirmDeleteGroup") {
      const count = groups.find((g) => g.name === overlay.groupName)?.workspaces.length ?? 0;
      overlayNode = (
        <ConfirmDialog
          message={`Delete group "${overlay.groupName}" and all ${count} workspace(s) inside it?`}
          onConfirm={() => {
            setConfig((prev) => ({
              ...prev,
              workspaces: prev.workspaces.filter(
                (w) => (w.group?.trim() || UNGROUPED) !== overlay.groupName,
              ),
            }));
            setOverlay(null);
            flash(`Deleted group "${overlay.groupName}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      );
    }
  }

  // Custom Commands and Settings are persistent tabs, not overlays: only
  // ever mounted while their tab is active (see the main return below),
  // so switching away and back discards any in-progress, unsaved edit —
  // same as canceling out of a form already does.
  const customCommandsNode = (
    <CustomCommandsScreen
      commands={config.customCommands ?? []}
      onChange={(next) => setConfig((prev) => ({ ...prev, customCommands: next }))}
      flash={flash}
      height={contentHeight}
    />
  );

  const previousSettings = getSettings(config);
  const settingsNode = (
    <SettingsForm
      existing={previousSettings}
      themeNames={themesFile.themes.map((t) => t.name)}
      activeTheme={themesFile.activeTheme}
      completionAvailable={shell !== null}
      fullScreen
      height={contentHeight}
      onPreviewTheme={setPreviewThemeName}
      onSubmit={({ settings, theme }) => {
        if (shell && settings.autocomplete !== previousSettings.autocomplete) {
          if (settings.autocomplete) installCompletion(shell);
          else uninstallCompletion(shell);
        }
        setConfig((prev) => ({ ...prev, settings }));
        setThemesFile((prev) => ({ ...prev, activeTheme: theme }));
        setPreviewThemeName(null);
        flash("Saved settings");
      }}
      onCancel={() => {
        setPreviewThemeName(null);
      }}
    />
  );

  const footerHint = overlay ? "" : activeTab === "workspaces" ? hint : "";

  return (
    <ThemeProvider value={activeTheme.colors}>
      <Box flexDirection="column" width={columns} height={rows}>
        <Header width={columns} />
        <TabBar activeTab={activeTab} width={columns} />
        <Box flexGrow={1} flexDirection="row">
          {overlay ? (
            <Box flexGrow={1} alignItems="center" justifyContent="center" height={contentHeight}>
              {overlayNode}
            </Box>
          ) : activeTab === "customCommands" ? (
            customCommandsNode
          ) : activeTab === "settings" ? (
            settingsNode
          ) : (
            <>
              {pane === "groups" ? (
                <GroupPane
                  groups={groups}
                  selectedIndex={groupIndex}
                  active={pane === "groups"}
                  height={contentHeight}
                  openNames={openNames}
                />
              ) : (
                <WorkspaceListPane
                  groupName={currentGroup?.name}
                  workspaces={currentGroupWorkspaces}
                  selectedIndex={wsIndex}
                  active={pane === "workspaces"}
                  height={contentHeight}
                  openNames={openNames}
                />
              )}
              <Box width={1} />
              <ItemPane
                workspace={currentWorkspace}
                selectedIndex={itemIndex}
                itemColumn={itemColumn}
                active={pane === "items"}
                height={contentHeight}
              />
            </>
          )}
        </Box>
        <Footer hint={footerHint} message={message} width={columns} />
      </Box>
    </ThemeProvider>
  );
}
