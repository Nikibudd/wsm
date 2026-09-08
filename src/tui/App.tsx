import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useStdout } from "ink";
import Gradient from "ink-gradient";
import { loadConfig, saveConfig } from "../config.js";
import { CONFIG_FILE } from "../paths.js";
import type { Config, Workspace, WorkspaceItem } from "../types.js";
import { ItemForm, WorkspaceForm } from "./Form.js";
import { ConfirmDialog } from "./ConfirmDialog.js";

type Pane = "workspaces" | "items";

type Overlay =
  | { kind: "addWorkspace" }
  | { kind: "editWorkspace"; workspaceIndex: number }
  | { kind: "itemForm"; workspaceIndex: number; itemIndex: number | null }
  | { kind: "confirmDeleteWorkspace"; workspaceIndex: number }
  | { kind: "confirmDeleteItem"; workspaceIndex: number; itemIndex: number };

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

function WorkspacePane({
  workspaces,
  selectedIndex,
  active,
  height,
}: {
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
      <Text bold underline color={active ? "cyan" : "white"}>
        Workspaces
      </Text>
      <Box height={1} />
      {workspaces.length === 0 ? (
        <Text dimColor>No workspaces yet.</Text>
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
  width,
}: {
  workspace: Workspace | undefined;
  selectedIndex: number;
  active: boolean;
  height: number;
  width: number;
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
  const [pane, setPane] = useState<Pane>("workspaces");
  const [wsIndex, setWsIndex] = useState(0);
  const [itemIndex, setItemIndex] = useState(0);
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const messageTimer = useRef<NodeJS.Timeout | undefined>(undefined);
  const flash = (text: string) => {
    setMessage(text);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 2500);
  };

  useEffect(() => {
    saveConfig(config);
  }, [config]);

  useEffect(() => {
    setWsIndex((i) => Math.min(i, config.workspaces.length));
  }, [config.workspaces.length]);

  const currentWorkspace = config.workspaces[wsIndex];

  useEffect(() => {
    if (currentWorkspace) {
      setItemIndex((i) => Math.min(i, currentWorkspace.items.length));
    } else {
      setItemIndex(0);
    }
  }, [currentWorkspace, wsIndex]);

  const mutateWorkspace = (index: number, fn: (w: Workspace) => Workspace) => {
    setConfig((prev) => {
      const workspaces = prev.workspaces.map((w, i) => (i === index ? fn(w) : w));
      return { ...prev, workspaces };
    });
  };

  useInput(
    (input, key) => {
      if (input === "q" || (key.ctrl && input === "c")) {
        exit();
        return;
      }

      if (pane === "workspaces") {
        const maxIndex = config.workspaces.length; // add-row included
        if (key.downArrow) setWsIndex((i) => Math.min(i + 1, maxIndex));
        else if (key.upArrow) setWsIndex((i) => Math.max(i - 1, 0));
        else if (key.return || key.rightArrow) {
          if (wsIndex === config.workspaces.length) {
            setOverlay({ kind: "addWorkspace" });
          } else if (config.workspaces.length > 0) {
            setPane("items");
          }
        } else if (input === "a") {
          setOverlay({ kind: "addWorkspace" });
        } else if (input === "r" && wsIndex < config.workspaces.length) {
          setOverlay({ kind: "editWorkspace", workspaceIndex: wsIndex });
        } else if (input === "d" && wsIndex < config.workspaces.length) {
          setOverlay({ kind: "confirmDeleteWorkspace", workspaceIndex: wsIndex });
        }
        return;
      }

      // pane === "items"
      const workspace = config.workspaces[wsIndex];
      if (!workspace) {
        setPane("workspaces");
        return;
      }
      const maxIndex = workspace.items.length; // add-row included

      if (key.leftArrow || key.escape) {
        setPane("workspaces");
      } else if (key.downArrow) {
        setItemIndex((i) => Math.min(i + 1, maxIndex));
      } else if (key.upArrow) {
        setItemIndex((i) => Math.max(i - 1, 0));
      } else if (key.return || input === "a") {
        if (input === "a" || itemIndex === maxIndex) {
          setOverlay({ kind: "itemForm", workspaceIndex: wsIndex, itemIndex: null });
        } else {
          setOverlay({ kind: "itemForm", workspaceIndex: wsIndex, itemIndex });
        }
      } else if (input === "d" && itemIndex < maxIndex) {
        setOverlay({ kind: "confirmDeleteItem", workspaceIndex: wsIndex, itemIndex });
      } else if (input === "c") {
        setOverlay({ kind: "editWorkspace", workspaceIndex: wsIndex });
      }
    },
    { isActive: overlay === null },
  );

  const contentHeight = Math.max(10, rows - 5);

  const hint = useMemo(() => {
    if (pane === "workspaces") {
      return "↑↓ select · enter/→ open · a add · r rename · d delete · q quit";
    }
    return "↑↓ select · enter edit · a add item · c workspace settings · d delete · ←/esc back · q quit";
  }, [pane]);

  let overlayNode: React.ReactNode = null;
  if (overlay) {
    if (overlay.kind === "addWorkspace") {
      overlayNode = (
        <WorkspaceForm
          existingNames={config.workspaces.map((w) => w.name)}
          onSubmit={(name, cwd) => {
            setConfig((prev) => ({
              ...prev,
              workspaces: [...prev.workspaces, { name, cwd: cwd || undefined, items: [] }],
            }));
            setWsIndex(config.workspaces.length);
            setOverlay(null);
            flash(`Created workspace "${name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      );
    } else if (overlay.kind === "editWorkspace") {
      const workspace = config.workspaces[overlay.workspaceIndex];
      overlayNode = workspace ? (
        <WorkspaceForm
          existing={workspace}
          existingNames={config.workspaces.map((w) => w.name)}
          onSubmit={(name, cwd) => {
            mutateWorkspace(overlay.workspaceIndex, (w) => ({ ...w, name, cwd: cwd || undefined }));
            setOverlay(null);
            flash(`Saved workspace "${name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
    } else if (overlay.kind === "itemForm") {
      const workspace = config.workspaces[overlay.workspaceIndex];
      const existing =
        overlay.itemIndex !== null ? workspace?.items[overlay.itemIndex] : undefined;
      overlayNode = workspace ? (
        <ItemForm
          existing={existing}
          onSubmit={(item) => {
            mutateWorkspace(overlay.workspaceIndex, (w) => {
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
      const workspace = config.workspaces[overlay.workspaceIndex];
      overlayNode = workspace ? (
        <ConfirmDialog
          message={`Delete workspace "${workspace.name}" and all its items?`}
          onConfirm={() => {
            setConfig((prev) => ({
              ...prev,
              workspaces: prev.workspaces.filter((_, i) => i !== overlay.workspaceIndex),
            }));
            setOverlay(null);
            flash(`Deleted workspace "${workspace.name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
    } else if (overlay.kind === "confirmDeleteItem") {
      const workspace = config.workspaces[overlay.workspaceIndex];
      const item = workspace?.items[overlay.itemIndex];
      overlayNode = item ? (
        <ConfirmDialog
          message={`Delete item "${item.name}"?`}
          onConfirm={() => {
            mutateWorkspace(overlay.workspaceIndex, (w) => ({
              ...w,
              items: w.items.filter((_, i) => i !== overlay.itemIndex),
            }));
            setOverlay(null);
            flash(`Deleted item "${item.name}"`);
          }}
          onCancel={() => setOverlay(null)}
        />
      ) : null;
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
            <WorkspacePane
              workspaces={config.workspaces}
              selectedIndex={wsIndex}
              active={pane === "workspaces"}
              height={contentHeight}
            />
            <Box width={1} />
            <ItemPane
              workspace={currentWorkspace}
              selectedIndex={itemIndex}
              active={pane === "items"}
              height={contentHeight}
              width={columns - 33}
            />
          </>
        )}
      </Box>
      <Footer hint={overlay ? "" : hint} message={message} width={columns} />
    </Box>
  );
}
