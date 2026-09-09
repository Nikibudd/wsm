import os from "node:os";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Gradient from "ink-gradient";
import { getSettings, loadConfig, saveConfig } from "../config.js";
import { getConfigFile } from "../paths.js";
import { loadState } from "../state.js";
import { getActiveTheme, loadThemes, saveThemes } from "../theme.js";
import type { ThemesFile } from "../theme.js";
import type { Config, ItemSide, Workspace, WorkspaceItem } from "../types.js";
import { UNGROUPED } from "../types.js";
import { ItemForm, RenameGroupForm, SettingsForm, WorkspaceForm } from "./Form.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { ThemeProvider, useTheme } from "./ThemeContext.js";

type Pane = "groups" | "workspaces" | "items";

type Overlay =
  | { kind: "addWorkspace"; presetGroup?: string }
  | { kind: "editWorkspace"; workspaceName: string }
  | { kind: "itemForm"; workspaceName: string; itemIndex: number | null; presetSide?: ItemSide }
  | { kind: "confirmDeleteWorkspace"; workspaceName: string }
  | { kind: "confirmDeleteItem"; workspaceName: string; itemIndex: number }
  | { kind: "renameGroup"; groupName: string }
  | { kind: "confirmDeleteGroup"; groupName: string }
  | { kind: "settings" };

function displayPath(p: string): string {
  const home = os.homedir();
  return p.startsWith(home) ? "~" + p.slice(home.length) : p;
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
            <Text
              key={g.name}
              color={selected ? theme.selectionText : theme.text}
              backgroundColor={selected ? theme.selectionBg : undefined}
            >
              {selected ? "› " : "  "}
              {hasOpen ? <Text color={selected ? theme.selectionText : theme.success}>● </Text> : "  "}
              {g.name} ({count})
            </Text>
          );
        })
      )}
      <Box height={1} />
      <Text
        color={active && selectedIndex === addRowIndex ? theme.selectionText : theme.success}
        backgroundColor={active && selectedIndex === addRowIndex ? theme.selectionBg : undefined}
      >
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
            <Text
              key={w.name}
              color={selected ? theme.selectionText : theme.text}
              backgroundColor={selected ? theme.selectionBg : undefined}
            >
              {selected ? "› " : "  "}
              {isOpen ? <Text color={selected ? theme.selectionText : theme.success}>● </Text> : "  "}
              {w.name} ({w.items.length})
            </Text>
          );
        })
      )}
      <Box height={1} />
      <Text
        color={active && selectedIndex === addRowIndex ? theme.selectionText : theme.success}
        backgroundColor={active && selectedIndex === addRowIndex ? theme.selectionBg : undefined}
      >
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ New workspace
      </Text>
    </Box>
  );
}

function ItemRow({ item, selected }: { item: WorkspaceItem; selected: boolean }) {
  const theme = useTheme();
  const typeColor = item.type === "app" ? theme.typeApp : theme.typeCommand;
  const closeLabel = item.closeAppName
    ? `quit "${item.closeAppName}"`
    : item.close
      ? `run "${item.close}"`
      : "kill process";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text
        color={selected ? theme.selectionText : theme.text}
        backgroundColor={selected ? theme.selectionBg : undefined}
      >
        {selected ? "› " : "  "}
        {item.name} <Text color={selected ? theme.selectionText : typeColor}>[{item.type}]</Text>
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
      <Text
        color={active && selectedIndex === addRowIndex ? theme.selectionText : theme.success}
        backgroundColor={active && selectedIndex === addRowIndex ? theme.selectionBg : undefined}
      >
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ Add item
      </Text>
    </Box>
  );
}

function splitEntries(workspace: Workspace): { frontend: ItemEntry[]; backend: ItemEntry[] } {
  const frontend: ItemEntry[] = [];
  const backend: ItemEntry[] = [];
  workspace.items.forEach((item, originalIndex) => {
    (item.side === "backend" ? backend : frontend).push({ item, originalIndex });
  });
  return { frontend, backend };
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
  itemColumn: ItemSide;
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

  const isSplit = workspace.layout === "split";

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
          const { frontend, backend } = splitEntries(workspace);
          return (
            <Box flexDirection="row" flexGrow={1}>
              <SideColumn
                title="Frontend"
                cwd={workspace.frontendCwd}
                entries={frontend}
                active={active && itemColumn === "frontend"}
                selectedIndex={selectedIndex}
              />
              <Box width={2} />
              <SideColumn
                title="Backend"
                cwd={workspace.backendCwd}
                entries={backend}
                active={active && itemColumn === "backend"}
                selectedIndex={selectedIndex}
              />
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
          <Text
            color={active && selectedIndex === workspace.items.length ? theme.selectionText : theme.success}
            backgroundColor={
              active && selectedIndex === workspace.items.length ? theme.selectionBg : undefined
            }
          >
            {active && selectedIndex === workspace.items.length ? "› " : "  "}+ Add item
          </Text>
        </>
      )}
    </Box>
  );
}

export function App() {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [config, setConfig] = useState<Config>(() => loadConfig());
  const [themesFile, setThemesFile] = useState<ThemesFile>(() => loadThemes());
  const [pane, setPane] = useState<Pane>("groups");
  const [groupIndex, setGroupIndex] = useState(0);
  const [wsIndex, setWsIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [itemColumn, setItemColumn] = useState<ItemSide>("frontend");
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Unsaved theme selection from the Settings overlay's Theme field, applied
  // immediately so changing it previews live; cleared on save (themesFile
  // itself now reflects it) or cancel (revert to the persisted theme).
  const [previewThemeName, setPreviewThemeName] = useState<string | null>(null);

  const openNames = useMemo(() => new Set(loadState().sessions.map((s) => s.workspace)), []);

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
  const isSplit = currentWorkspace?.layout === "split";
  const { frontend: frontendEntries, backend: backendEntries } = useMemo(
    () => (currentWorkspace ? splitEntries(currentWorkspace) : { frontend: [], backend: [] }),
    [currentWorkspace],
  );
  const activeColumnEntries = itemColumn === "frontend" ? frontendEntries : backendEntries;

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
    setItemColumn("frontend");
  }, [currentWorkspace?.name]);

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
        } else if (input === "s") {
          setOverlay({ kind: "settings" });
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
          if (itemColumn === "backend") {
            setItemColumn("frontend");
            setItemIndex(0);
          } else {
            setPane("workspaces");
          }
        } else if (key.rightArrow) {
          if (itemColumn === "frontend") {
            setItemColumn("backend");
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
              presetSide: itemColumn,
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

  const contentHeight = Math.max(10, rows - 5);

  const hint = useMemo(() => {
    if (pane === "groups") {
      return "↑↓ select · enter/→ open group · a new workspace · r rename group · d delete group · s settings · ● = open · q quit";
    }
    if (pane === "workspaces") {
      return "↑↓ select · enter/→ open · a add workspace · r rename/move · d delete · ←/esc back · ● = open · q quit";
    }
    if (isSplit) {
      return "↑↓ select · ←→ frontend/backend · enter edit · a add item · c workspace settings · d delete · esc back · q quit";
    }
    return "↑↓ select · enter edit · a add item · c workspace settings · d delete · ←/esc back · q quit";
  }, [pane, isSplit]);

  let overlayNode: React.ReactNode = null;
  if (overlay) {
    if (overlay.kind === "addWorkspace") {
      overlayNode = (
        <WorkspaceForm
          existingNames={config.workspaces.map((w) => w.name)}
          presetGroup={overlay.presetGroup}
          onSubmit={({ name, cwd, group, layout, frontendCwd, backendCwd }) => {
            const workspace: Workspace = {
              name,
              group: group || undefined,
              layout: layout === "split" ? "split" : undefined,
              cwd: layout === "single" ? cwd || undefined : undefined,
              frontendCwd: layout === "split" ? frontendCwd || undefined : undefined,
              backendCwd: layout === "split" ? backendCwd || undefined : undefined,
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
          onSubmit={({ name, cwd, group, layout, frontendCwd, backendCwd }) => {
            mutateWorkspace(overlay.workspaceName, (w) => ({
              ...w,
              name,
              group: group || undefined,
              layout: layout === "split" ? "split" : undefined,
              cwd: layout === "single" ? cwd || undefined : undefined,
              frontendCwd: layout === "split" ? frontendCwd || undefined : undefined,
              backendCwd: layout === "split" ? backendCwd || undefined : undefined,
            }));
            pendingSelect.current = { type: "workspace", name };
            setOverlay(null);
            flash(`Saved workspace "${name}"`);
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
          isSplit={workspace.layout === "split"}
          presetSide={overlay.presetSide}
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
    } else if (overlay.kind === "settings") {
      overlayNode = (
        <SettingsForm
          existing={getSettings(config)}
          themeNames={themesFile.themes.map((t) => t.name)}
          activeTheme={themesFile.activeTheme}
          onPreviewTheme={setPreviewThemeName}
          onSubmit={({ settings, theme }) => {
            setConfig((prev) => ({ ...prev, settings }));
            setThemesFile((prev) => ({ ...prev, activeTheme: theme }));
            setPreviewThemeName(null);
            setOverlay(null);
            flash("Saved settings");
          }}
          onCancel={() => {
            setPreviewThemeName(null);
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

  return (
    <ThemeProvider value={activeTheme.colors}>
      <Box flexDirection="column" width={columns} height={rows}>
        <Header width={columns} />
        <Box flexGrow={1} flexDirection="row">
          {overlay ? (
            <Box flexGrow={1} alignItems="center" justifyContent="center" height={contentHeight}>
              {overlayNode}
            </Box>
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
        <Footer hint={overlay ? "" : hint} message={message} width={columns} />
      </Box>
    </ThemeProvider>
  );
}
