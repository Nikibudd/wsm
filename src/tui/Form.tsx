import React, { useEffect, useMemo, useState } from "react";
import { Box, Text, useInput } from "ink";
import type { ItemSide, ItemType, Workspace, WorkspaceItem, WorkspaceLayout } from "../types.js";

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "select";
  options?: FieldOption[];
  placeholder?: string;
}

// (key, updater) rather than (key, value): Ink can deliver several keypresses
// from a single stdin read chunk before React commits a render in between
// (e.g. fast backspacing), so every edit is applied via React's functional
// setState form against the true latest pending value, never a value closed
// over from a stale render — see Form's useInput handler below, which does
// all character editing itself instead of delegating to a text-input
// component that would compute from a (possibly stale) value prop.
export type FieldUpdater = (key: string, updater: (prev: string) => string) => void;

interface FormProps {
  title: string;
  accentColor?: string;
  fields: FieldDef[];
  values: Record<string, string>;
  error?: string;
  submitLabel?: string;
  onChange: FieldUpdater;
  onSubmit: () => void;
  onCancel: () => void;
}

export function Form({
  title,
  accentColor = "cyan",
  fields,
  values,
  error,
  submitLabel = "save",
  onChange,
  onSubmit,
  onCancel,
}: FormProps) {
  const [focusIndex, setFocusIndex] = useState(0);

  useEffect(() => {
    if (focusIndex > fields.length - 1) {
      setFocusIndex(Math.max(0, fields.length - 1));
    }
  }, [fields.length, focusIndex]);

  const advanceOrSubmit = () => {
    if (focusIndex === fields.length - 1) onSubmit();
    else setFocusIndex((i) => i + 1);
  };

  useInput((input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }

    const field = fields[focusIndex];
    if (!field) return;

    if (key.upArrow) {
      setFocusIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setFocusIndex((i) => Math.min(fields.length - 1, i + 1));
      return;
    }

    if (field.kind === "select") {
      if (key.leftArrow || key.rightArrow) {
        const opts = field.options ?? [];
        if (opts.length === 0) return;
        const currentIdx = Math.max(
          0,
          opts.findIndex((o) => o.value === values[field.key]),
        );
        const dir = key.leftArrow ? -1 : 1;
        const next = (currentIdx + dir + opts.length) % opts.length;
        const nextValue = opts[next]!.value;
        onChange(field.key, () => nextValue);
        return;
      }
      if (key.return) advanceOrSubmit();
      return;
    }

    // Text field: handle every keystroke here (rather than via a text-input
    // component) so edits go through React's functional setState updater and
    // survive multiple keystrokes landing in the same stdin chunk.
    if (key.return) {
      advanceOrSubmit();
      return;
    }
    if (key.backspace || key.delete) {
      onChange(field.key, (prev) => prev.slice(0, -1));
      return;
    }
    if (key.ctrl && input === "u") {
      onChange(field.key, () => "");
      return;
    }
    if (key.ctrl || key.meta || key.tab) {
      return;
    }
    if (input) {
      onChange(field.key, (prev) => prev + input);
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={accentColor}
      paddingX={2}
      paddingY={1}
      width={68}
    >
      <Text bold color={accentColor}>
        {title}
      </Text>
      <Box height={1} />
      {fields.map((f, i) => {
        const focused = i === focusIndex;
        const value = values[f.key] ?? "";
        return (
          <Box key={f.key}>
            <Box width={16}>
              <Text color={focused ? accentColor : "gray"}>
                {focused ? "› " : "  "}
                {f.label}
              </Text>
            </Box>
            <Box flexGrow={1}>
              {f.kind === "text" ? (
                focused ? (
                  <Text color="white">
                    {value || (f.placeholder ? "" : "")}
                    <Text backgroundColor="white" color="black">
                      {" "}
                    </Text>
                    {!value && f.placeholder ? <Text dimColor> {f.placeholder}</Text> : null}
                  </Text>
                ) : (
                  <Text color={value ? "white" : "gray"}>{value || f.placeholder || "—"}</Text>
                )
              ) : (
                <Text color={focused ? "yellow" : "white"}>
                  ‹ {f.options?.find((o) => o.value === value)?.label ?? value} ›
                </Text>
              )}
            </Box>
          </Box>
        );
      })}
      {error ? (
        <>
          <Box height={1} />
          <Text color="red">{error}</Text>
        </>
      ) : null}
      <Box height={1} />
      <Text dimColor>↑↓ field · ←→ change · enter next/{submitLabel} · esc cancel</Text>
    </Box>
  );
}

export function ItemForm({
  existing,
  isSplit,
  onSubmit,
  onCancel,
}: {
  existing?: WorkspaceItem;
  isSplit: boolean;
  onSubmit: (item: WorkspaceItem) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    name: existing?.name ?? "",
    type: existing?.type ?? "app",
    launch: existing?.launch ?? "",
    side: existing?.side ?? "frontend",
    cwd: existing?.cwd ?? "",
    closeStrategy: existing?.closeAppName
      ? "app"
      : existing?.close
        ? "command"
        : existing
          ? "none"
          : "app",
    closeAppName: existing?.closeAppName ?? "",
    closeCommand: existing?.close ?? "",
    delayMs: existing?.delayMs ? String(existing.delayMs) : "",
  });
  const [error, setError] = useState("");

  const fields = useMemo<FieldDef[]>(() => {
    const base: FieldDef[] = [
      { key: "name", label: "Name", kind: "text", placeholder: "e.g. editor" },
      {
        key: "type",
        label: "Type",
        kind: "select",
        options: [
          { label: "App", value: "app" },
          { label: "Command", value: "command" },
        ],
      },
      {
        key: "launch",
        label: "Launch",
        kind: "text",
        placeholder: values.type === "app" ? "open -a Ghostty" : "docker compose up -d",
      },
    ];
    if (isSplit) {
      base.push({
        key: "side",
        label: "Side",
        kind: "select",
        options: [
          { label: "Frontend", value: "frontend" },
          { label: "Backend", value: "backend" },
        ],
      });
    }
    base.push({
      key: "cwd",
      label: "Directory",
      kind: "text",
      placeholder: isSplit ? "(frontend/backend default)" : "(workspace default)",
    });
    base.push({
      key: "closeStrategy",
      label: "Close via",
      kind: "select",
      options: [
        { label: "Quit macOS app", value: "app" },
        { label: "Custom command", value: "command" },
        { label: "Kill process", value: "process" },
        { label: "Leave running", value: "none" },
      ],
    });
    if (values.closeStrategy === "app") {
      base.push({
        key: "closeAppName",
        label: "App name",
        kind: "text",
        placeholder: "Visual Studio Code",
      });
    }
    if (values.closeStrategy === "command") {
      base.push({
        key: "closeCommand",
        label: "Close cmd",
        kind: "text",
        placeholder: "docker compose down",
      });
    }
    base.push({ key: "delayMs", label: "Delay (ms)", kind: "text", placeholder: "0" });
    return base;
  }, [values.type, values.closeStrategy, isSplit]);

  const handleSubmit = () => {
    if (!values.name.trim()) {
      setError("Name is required");
      return;
    }
    if (!values.launch.trim()) {
      setError("Launch command is required");
      return;
    }
    if (values.delayMs.trim() && !/^\d+$/.test(values.delayMs.trim())) {
      setError("Delay must be a number");
      return;
    }
    const item: WorkspaceItem = {
      name: values.name.trim(),
      type: values.type as ItemType,
      launch: values.launch.trim(),
    };
    if (isSplit) item.side = values.side as ItemSide;
    if (values.cwd.trim()) item.cwd = values.cwd.trim();
    if (values.closeStrategy === "app" && values.closeAppName.trim()) {
      item.closeAppName = values.closeAppName.trim();
    }
    if (values.closeStrategy === "command" && values.closeCommand.trim()) {
      item.close = values.closeCommand.trim();
    }
    if (values.delayMs.trim()) item.delayMs = Number(values.delayMs.trim());
    onSubmit(item);
  };

  return (
    <Form
      title={existing ? `Edit item · ${existing.name}` : "Add item"}
      fields={fields}
      values={values}
      error={error}
      submitLabel="save"
      onChange={(k, updater) => {
        setError("");
        setValues((prev) => ({ ...prev, [k]: updater(prev[k] ?? "") }));
      }}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}

export interface WorkspaceFormResult {
  name: string;
  group: string;
  layout: WorkspaceLayout;
  cwd: string;
  frontendCwd: string;
  backendCwd: string;
}

export function WorkspaceForm({
  existing,
  existingNames,
  presetGroup,
  onSubmit,
  onCancel,
}: {
  existing?: Workspace;
  existingNames: string[];
  presetGroup?: string;
  onSubmit: (result: WorkspaceFormResult) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    group: existing?.group ?? presetGroup ?? "",
    name: existing?.name ?? "",
    layout: existing?.layout ?? "single",
    cwd: existing?.cwd ?? "",
    frontendCwd: existing?.frontendCwd ?? "",
    backendCwd: existing?.backendCwd ?? "",
  });
  const [error, setError] = useState("");

  const fields = useMemo<FieldDef[]>(() => {
    const base: FieldDef[] = [
      { key: "group", label: "Group", kind: "text", placeholder: "e.g. Work (blank = Ungrouped)" },
      { key: "name", label: "Name", kind: "text", placeholder: "e.g. acme-api" },
      {
        key: "layout",
        label: "Layout",
        kind: "select",
        options: [
          { label: "Single project folder", value: "single" },
          { label: "Split frontend/backend", value: "split" },
        ],
      },
    ];
    if (values.layout === "split") {
      base.push(
        { key: "frontendCwd", label: "Frontend dir", kind: "text", placeholder: "~/dev/acme-web" },
        { key: "backendCwd", label: "Backend dir", kind: "text", placeholder: "~/dev/acme-api" },
      );
    } else {
      base.push({ key: "cwd", label: "Directory", kind: "text", placeholder: "~/dev/acme-api" });
    }
    return base;
  }, [values.layout]);

  const handleSubmit = () => {
    const name = values.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    if (name !== existing?.name && existingNames.includes(name)) {
      setError("A workspace with that name already exists");
      return;
    }
    onSubmit({
      name,
      group: values.group.trim(),
      layout: values.layout as WorkspaceLayout,
      cwd: values.cwd.trim(),
      frontendCwd: values.frontendCwd.trim(),
      backendCwd: values.backendCwd.trim(),
    });
  };

  return (
    <Form
      title={existing ? `Edit workspace · ${existing.name}` : "New workspace"}
      fields={fields}
      values={values}
      error={error}
      submitLabel="save"
      onChange={(k, updater) => {
        setError("");
        setValues((prev) => ({ ...prev, [k]: updater(prev[k] ?? "") }));
      }}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}

export function RenameGroupForm({
  groupName,
  onSubmit,
  onCancel,
}: {
  groupName: string;
  onSubmit: (newName: string) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({ name: groupName });
  const [error, setError] = useState("");

  const fields: FieldDef[] = [
    { key: "name", label: "Group name", kind: "text", placeholder: "e.g. Work" },
  ];

  const handleSubmit = () => {
    const name = values.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    onSubmit(name);
  };

  return (
    <Form
      title={`Rename group "${groupName}"`}
      fields={fields}
      values={values}
      error={error}
      submitLabel="save"
      onChange={(k, updater) => {
        setError("");
        setValues((prev) => ({ ...prev, [k]: updater(prev[k] ?? "") }));
      }}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}
