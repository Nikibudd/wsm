import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Gradient from "ink-gradient";
import { loadConfig, saveConfig } from "../config.js";
import { CONFIG_FILE } from "../paths.js";
import type { Config, Workspace, WorkspaceItem } from "../types.js";
import { UNGROUPED } from "../types.js";
import { ItemForm, RenameGroupForm, WorkspaceForm } from "./Form.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

type Pane = "groups" | "workspaces" | "items";

type Overlay =
  | { kind: "addWorkspace"; presetGroup?: string }
  | { kind: "editWorkspace"; workspaceName: string }
  | { kind: "itemForm"; workspaceName: string; itemIndex: number | null }
  | { kind: "confirmDeleteWorkspace"; workspaceName: string }
  | { kind: "confirmDeleteItem"; workspaceName: string; itemIndex: number }
  | { kind: "renameGroup"; groupName: string }
  | { kind: "confirmDeleteGroup"; groupName: string };

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
  return (
    <Box
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
      width={width}
      justifyContent="space-between"
    >
      <Gradient name="cristal">
        <Text bold> ⚡ WORKSPACE MANAGER </Text>
      </Gradient>
      <Text dimColor>{CONFIG_FILE}</Text>
    </Box>
  );
}

function Footer({ hint, message, width }: { hint: string; message: string | null; width: number }) {
  return (
    <Box paddingX={1} width={width}>
      <Box flexGrow={1} flexShrink={1}>
        <Text dimColor wrap="truncate-end">
          {hint}
        </Text>
      </Box>
      {message ? (
        <Box flexShrink={0}>
          <Text color="green">{message}</Text>
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
}: {
  groups: Group[];
  selectedIndex: number;
  active: boolean;
  height: number;
}) {
  const addRowIndex = groups.length;
  return (
    <Box
      flexDirection="column"
      width={32}
      height={height}
      borderStyle="round"
      borderColor={active ? "cyan" : "gray"}
      paddingX={1}
    >
      <Text bold underline color={active ? "cyan" : "white"}>
        Groups
      </Text>
      <Box height={1} />
      {groups.length === 0 ? (
        <Text dimColor>No workspaces yet.</Text>
      ) : (
        groups.map((g, i) => {
          const selected = active && i === selectedIndex;
          const count = g.workspaces.length;
          return (
            <Text
              key={g.name}
              color={selected ? "black" : "white"}
              backgroundColor={selected ? "cyan" : undefined}
            >
              {selected ? "› " : "  "}
              {g.name} ({count})
            </Text>
          );
        })
      )}
      <Box height={1} />
      <Text
        color={active && selectedIndex === addRowIndex ? "black" : "green"}
        backgroundColor={active && selectedIndex === addRowIndex ? "cyan" : undefined}
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
}: {
  groupName: string | undefined;
  workspaces: Workspace[];
  selectedIndex: number;
  active: boolean;
  height: number;
}) {
  const addRowIndex = workspaces.length;
  return (
    <Box
      flexDirection="column"
      width={32}
      height={height}
      borderStyle="round"
      borderColor={active ? "cyan" : "gray"}
      paddingX={1}
    >
      <Text bold underline color={active ? "cyan" : "white"} wrap="truncate-end">
        Groups › {groupName ?? "—"}
      </Text>
      <Box height={1} />
      {workspaces.length === 0 ? (
        <Text dimColor>No workspaces in this group.</Text>
      ) : (
        workspaces.map((w, i) => {
          const selected = active && i === selectedIndex;
          return (
            <Text
              key={w.name}
              color={selected ? "black" : "white"}
              backgroundColor={selected ? "cyan" : undefined}
            >
              {selected ? "› " : "  "}
              {w.name} ({w.items.length})
            </Text>
          );
        })
      )}
      <Box height={1} />
      <Text
        color={active && selectedIndex === addRowIndex ? "black" : "green"}
        backgroundColor={active && selectedIndex === addRowIndex ? "cyan" : undefined}
      >
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ New workspace
      </Text>
    </Box>
  );
}

function ItemRow({ item, selected }: { item: WorkspaceItem; selected: boolean }) {
  const typeColor = item.type === "app" ? "magenta" : "yellow";
  const closeLabel = item.closeAppName
    ? `quit "${item.closeAppName}"`
    : item.close
      ? `run "${item.close}"`
      : "kill process";
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={selected ? "black" : "white"} backgroundColor={selected ? "cyan" : undefined}>
        {selected ? "› " : "  "}
        {item.name} <Text color={selected ? "black" : typeColor}>[{item.type}]</Text>
      </Text>
      <Text dimColor>{"    "}launch: {item.launch}</Text>
      <Text dimColor>{"    "}close:  {closeLabel}</Text>
    </Box>
  );
}

function ItemPane({
  workspace,
  selectedIndex,
  active,
  height,
}: {
  workspace: Workspace | undefined;
  selectedIndex: number;
  active: boolean;
  height: number;
}) {
  if (!workspace) {
    return (
      <Box
        flexDirection="column"
        flexGrow={1}
        height={height}
        borderStyle="round"
        borderColor="gray"
        paddingX={2}
        justifyContent="center"
        alignItems="center"
      >
        <Text dimColor>Select a workspace, or press "a" to create one.</Text>
      </Box>
    );
  }

  const addRowIndex = workspace.items.length;

  return (
    <Box
      flexDirection="column"
      flexGrow={1}
      height={height}
      borderStyle="round"
      borderColor={active ? "cyan" : "gray"}
      paddingX={2}
    >
      <Text bold underline color={active ? "cyan" : "white"}>
        {workspace.name}
      </Text>
      <Text dimColor>cwd: {workspace.cwd ?? "(none set — items use their own or home dir)"}</Text>
      <Box height={1} />
      {workspace.items.length === 0 ? (
        <Text dimColor>No items yet. Press "a" to add one (editor, terminal, docker, ...).</Text>
      ) : (
        workspace.items.map((item, i) => (
          <ItemRow key={item.name + i} item={item} selected={active && i === selectedIndex} />
        ))
      )}
      <Text
        color={active && selectedIndex === addRowIndex ? "black" : "green"}
        backgroundColor={active && selectedIndex === addRowIndex ? "cyan" : undefined}
      >
        {active && selectedIndex === addRowIndex ? "› " : "  "}+ Add item
      </Text>
    </Box>
  );
}

export function App() {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();

  const [config, setConfig] = useState<Config>(() => loadConfig());
  const [pane, setPane] = useState<Pane>("groups");
  const [groupIndex, setGroupIndex] = useState(0);
  const [wsIndex, setWsIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const pendingSelect = useRef<PendingSelect | null>(null);
  const messageTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const flash = (text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 2500);
  };

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  const groups = useMemo(() => groupWorkspaces(config.workspaces), [config.workspaces]);
  const currentGroup = groups[groupIndex];
  const currentGroupWorkspaces = currentGroup?.workspaces ?? [];
  const currentWorkspace = currentGroupWorkspaces[wsIndex];

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
    setItemIndex((i) => Math.min(i, currentWorkspace ? currentWorkspace.items.length : 0));
  }, [currentWorkspace, wsIndex]);

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
      return "↑↓ select · enter/→ open group · a new workspace · r rename group · d delete group · q quit";
    }
    if (pane === "workspaces") {
      return "↑↓ select · enter/→ open · a add workspace · r rename/move · d delete · ←/esc back · q quit";
    }
    return "↑↓ select · enter edit · a add item · c workspace settings · d delete · ←/esc back · q quit";
  }, [pane]);

  let overlayNode: React.ReactNode = null;
  if (overlay) {
    if (overlay.kind === "addWorkspace") {
      overlayNode = (
        <WorkspaceForm
          existingNames={config.workspaces.map((w) => w.name)}
          presetGroup={overlay.presetGroup}
          onSubmit={(name, cwd, group) => {
            setConfig((prev) => ({
              ...prev,
              workspaces: [...prev.workspaces, { name, cwd: cwd || undefined, group: group || undefined, items: [] }],
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
          onSubmit={(name, cwd, group) => {
            mutateWorkspace(overlay.workspaceName, (w) => ({
              ...w,
              name,
              cwd: cwd || undefined,
              group: group || undefined,
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
              />
            ) : (
              <WorkspaceListPane
                groupName={currentGroup?.name}
                workspaces={currentGroupWorkspaces}
                selectedIndex={wsIndex}
                active={pane === "workspaces"}
                height={contentHeight}
              />
            )}
            <Box width={1} />
            <ItemPane
              workspace={currentWorkspace}
              selectedIndex={itemIndex}
              active={pane === "items"}
              height={contentHeight}
            />
          </>
        )}
      </Box>
      <Footer hint={overlay ? "" : hint} message={message} width={columns} />
    </Box>
  );
}
