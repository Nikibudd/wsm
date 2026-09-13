import React, { useEffect, useMemo, useRef, useState } from "react";
import { Box, Text, useInput, useStdout } from "ink";
import type { Key } from "ink";
import { isValidCustomCommandName } from "../customCommands.js";
import type {
  CustomCommand,
  ItemSide,
  ItemType,
  Settings,
  Workspace,
  WorkspaceItem,
  WorkspaceLayout,
} from "../types.js";
import { useTheme } from "./ThemeContext.js";

export interface FieldOption {
  label: string;
  value: string;
}

export interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "select" | "multiline";
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
  /** Stretches to fill its parent (flexGrow) instead of the usual fixed,
   * capped-width dialog box — used when a form is a tab's entire full-screen
   * content (e.g. Settings) rather than a centered overlay. */
  fullScreen?: boolean;
  /** Only meaningful with fullScreen: the exact height to fill, matching the
   * contentHeight every other full-screen pane is given. */
  height?: number;
  onChange: FieldUpdater;
  onSubmit: () => void;
  onCancel: () => void;
}

// A multiline field's cursor is a single flat character offset into the
// whole value, including embedded "\n"s — moving it left/right by one
// naturally crosses line boundaries correctly with no special-casing.
// These two helpers translate that flat offset to/from a (line, column)
// pair, which is what up/down movement and rendering the cursor in the
// right place both need.
function multilineCursorLineCol(value: string, cursor: number): { line: number; col: number } {
  const clamped = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, clamped);
  const lines = before.split("\n");
  return { line: lines.length - 1, col: lines[lines.length - 1]!.length };
}

// Moves the cursor up (-1) or down (+1) one line, preserving column as
// closely as the target line's length allows (clamped, not wrapped) — the
// same behavior any text editor's up/down arrow has.
function multilineCursorVerticalMove(value: string, cursor: number, direction: -1 | 1): number {
  const lines = value.split("\n");
  const { line, col } = multilineCursorLineCol(value, cursor);
  const targetLine = line + direction;
  if (targetLine < 0 || targetLine >= lines.length) return cursor;
  const targetCol = Math.min(col, lines[targetLine]!.length);
  let offset = 0;
  for (let i = 0; i < targetLine; i++) offset += lines[i]!.length + 1;
  return offset + targetCol;
}

export function Form({
  title,
  accentColor,
  fields,
  values,
  error,
  submitLabel = "save",
  fullScreen = false,
  height,
  onChange,
  onSubmit,
  onCancel,
}: FormProps) {
  const [focusIndex, setFocusIndex] = useState(0);
  // Multiline fields are modal: while not editing, enter/esc mean the same
  // thing they do on every other field (advance-or-submit / cancel), so
  // typing behavior stays consistent across the whole form. The moment you
  // type anything else, this flips true and enter starts meaning "newline"
  // instead — esc is the only way back out, to normal per-field navigation.
  // Reset on every focus change so landing on (or back on) a multiline
  // field always starts in the non-editing state, never mid-edit.
  //
  // The *decision* of which mode we're in is made from a ref
  // (multilineEditingRef), not the useState value below — a large paste
  // delivers many keystrokes across several of Ink's internal render
  // cycles, and this needs to read as true the instant the first character
  // of the paste sets it, not whenever React next happens to commit a
  // render. Reading the state value here instead was a real bug: with a
  // long paste, some of it would still be processed against a stale
  // "not editing yet" view, so an embedded newline could hit `advanceOrSubmit`
  // (closing/submitting the form mid-paste) instead of inserting a line,
  // and the "start editing" branch re-reading `values[field.key]` on every
  // one of those stale passes reset the cursor back to the same stale
  // position each time — together corrupting the pasted text into merged,
  // out-of-order lines. `multilineEditing` (state) still exists purely to
  // drive rendering (color, hint text), kept in sync wherever the ref changes.
  const multilineEditingRef = useRef(false);
  const [multilineEditing, setMultilineEditing] = useState(false);
  const setEditing = (next: boolean) => {
    multilineEditingRef.current = next;
    setMultilineEditing(next);
  };
  // A flat character offset into the multiline value (see the two helpers
  // above). This is a ref, not state: Ink can deliver several keystrokes
  // from one stdin chunk before a render commits, and inserting/deleting
  // "at the cursor" needs to read the position left by the *previous*
  // keystroke in that same burst, synchronously — a ref mutates
  // immediately, where a captured state value would still read stale here
  // the same way a naive (non-functional) text value once did (see the
  // ink-text-input lesson below). cursorRenderTick forces a re-render for
  // pure cursor moves (arrow keys), which don't otherwise touch `values`
  // and so wouldn't cause one on their own.
  const multilineCursor = useRef(0);
  const [, setCursorRenderTick] = useState(0);
  const bumpCursorRender = () => setCursorRenderTick((t) => t + 1);
  const { stdout } = useStdout();
  const theme = useTheme();
  const resolvedAccent = accentColor ?? theme.accent;
  const width = Math.max(40, Math.min(68, (stdout?.columns || 80) - 4));

  useEffect(() => {
    if (focusIndex > fields.length - 1) {
      setFocusIndex(Math.max(0, fields.length - 1));
    }
  }, [fields.length, focusIndex]);

  useEffect(() => {
    setEditing(false);
    multilineCursor.current = 0;
  }, [focusIndex]);

  const advanceOrSubmit = () => {
    if (focusIndex === fields.length - 1) onSubmit();
    else setFocusIndex((i) => i + 1);
  };

  // Shared by both multiline states below: cursor movement, backspace,
  // ctrl+u, and plain-character insertion are identical whether this
  // keystroke is what started editing or editing was already underway —
  // only what enter/esc/tab do differs, handled by the callers.
  const applyMultilineKeystroke = (fieldKey: string, input: string, key: Key) => {
    const value = values[fieldKey] ?? "";
    const pos = multilineCursor.current;

    if (key.leftArrow) {
      multilineCursor.current = Math.max(0, pos - 1);
      bumpCursorRender();
      return;
    }
    if (key.rightArrow) {
      multilineCursor.current = Math.min(value.length, pos + 1);
      bumpCursorRender();
      return;
    }
    if (key.upArrow || key.downArrow) {
      multilineCursor.current = multilineCursorVerticalMove(value, pos, key.upArrow ? -1 : 1);
      bumpCursorRender();
      return;
    }
    if (key.backspace || key.delete) {
      if (pos === 0) return;
      onChange(fieldKey, (prev) => prev.slice(0, pos - 1) + prev.slice(pos));
      multilineCursor.current = pos - 1;
      return;
    }
    if (key.ctrl && input === "u") {
      onChange(fieldKey, () => "");
      multilineCursor.current = 0;
      return;
    }
    if (key.ctrl || key.meta) {
      return;
    }
    if (input) {
      // A discrete Enter keypress arrives as key.return with empty input,
      // handled by the callers below — but a pasted line break often
      // doesn't: some terminals send "\r" for a pasted newline (the same
      // byte a real Enter key sends), and when it's folded into a larger
      // `input` string rather than its own isolated keypress, Ink reports
      // it as plain text, not key.return. Normalizing it here means a
      // paste's line breaks land as "\n" the same as a discrete Enter does,
      // regardless of which byte the source terminal happened to send.
      const text = input.replace(/\r\n?/g, "\n");
      onChange(fieldKey, (prev) => prev.slice(0, pos) + text + prev.slice(pos));
      multilineCursor.current = pos + text.length;
    }
  };

  useInput((input, key) => {
    const field = fields[focusIndex];

    if (field?.kind === "multiline" && multilineEditingRef.current) {
      if (key.escape) {
        setEditing(false);
        return;
      }
      if (key.return) {
        const pos = multilineCursor.current;
        onChange(field.key, (prev) => prev.slice(0, pos) + "\n" + prev.slice(pos));
        multilineCursor.current = pos + 1;
        return;
      }
      applyMultilineKeystroke(field.key, input, key);
      return;
    }

    if (key.escape) {
      onCancel();
      return;
    }

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

    if (field.kind === "multiline") {
      // Not editing yet: enter behaves like every other field (advance or
      // submit). Starting to type — anything but tab, which stays a no-op
      // here just like on a text field — is what switches into edit mode,
      // applying this same keystroke immediately rather than requiring a
      // separate "start editing" key first. The cursor starts at the end
      // of the existing value, matching where typing would previously have
      // always appended.
      if (key.return) {
        advanceOrSubmit();
        return;
      }
      if (key.tab) {
        return;
      }
      multilineCursor.current = (values[field.key] ?? "").length;
      setEditing(true);
      applyMultilineKeystroke(field.key, input, key);
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
      borderColor={resolvedAccent}
      paddingX={2}
      paddingY={1}
      {...(fullScreen ? { flexGrow: 1, height } : { width })}
    >
      <Text bold color={resolvedAccent}>
        {title}
      </Text>
      <Box height={1} />
      {fields.map((f, i) => {
        const focused = i === focusIndex;
        const value = values[f.key] ?? "";
        return (
          <Box key={f.key}>
            <Box width={16}>
              <Text color={focused ? resolvedAccent : theme.border}>
                {focused ? "› " : "  "}
                {f.label}
              </Text>
            </Box>
            <Box flexGrow={1}>
              {f.kind === "text" ? (
                focused ? (
                  <Text color={theme.text}>
                    {value || (f.placeholder ? "" : "")}
                    <Text backgroundColor={theme.text} color={theme.selectionText}>
                      {" "}
                    </Text>
                    {!value && f.placeholder ? <Text dimColor> {f.placeholder}</Text> : null}
                  </Text>
                ) : (
                  <Text color={value ? theme.text : theme.border}>
                    {value || f.placeholder || "—"}
                  </Text>
                )
              ) : f.kind === "multiline" ? (
                (() => {
                  const editing = focused && multilineEditing;
                  // Distinct color while actively editing, on top of the
                  // cursor block — the whole point is a visible answer to
                  // "am I currently typing into this, or just looking at
                  // it," since enter/esc mean different things in each state.
                  const valueColor = editing ? resolvedAccent : theme.text;
                  const cursor = editing
                    ? multilineCursorLineCol(value, multilineCursor.current)
                    : null;
                  return (
                    <Box flexDirection="column">
                      {value ? (
                        value.split("\n").map((line, li) => {
                          if (!cursor || li !== cursor.line) {
                            // Ink drops a fully-empty <Text> row's height,
                            // collapsing blank lines — a single space keeps
                            // them visible without changing what's shown.
                            return (
                              <Text key={li} color={valueColor}>
                                {line || " "}
                              </Text>
                            );
                          }
                          // The line the cursor is on: highlight the
                          // character it sits over (or a blank space, at
                          // end of line) rather than always appending after
                          // everything, now that the cursor can be
                          // anywhere in the value, not just at the end.
                          const before = line.slice(0, cursor.col);
                          const at = line[cursor.col] ?? " ";
                          const after = line.slice(cursor.col + 1);
                          return (
                            <Text key={li} color={valueColor}>
                              {before}
                              <Text backgroundColor={valueColor} color={theme.selectionText}>
                                {at}
                              </Text>
                              {after}
                            </Text>
                          );
                        })
                      ) : (
                        <Text color={focused ? valueColor : theme.border}>
                          {editing ? (
                            <Text backgroundColor={valueColor} color={theme.selectionText}>
                              {" "}
                            </Text>
                          ) : null}
                          {f.placeholder ? (
                            <Text dimColor>{focused ? ` ${f.placeholder}` : f.placeholder}</Text>
                          ) : focused ? null : (
                            "—"
                          )}
                        </Text>
                      )}
                    </Box>
                  );
                })()
              ) : (
                <Text color={focused ? resolvedAccent : theme.text}>
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
          <Text color={theme.danger}>{error}</Text>
        </>
      ) : null}
      <Box height={1} />
      <Text dimColor>
        {fields[focusIndex]?.kind === "multiline"
          ? multilineEditing
            ? "←→↑↓ move cursor · enter newline · esc done editing"
            : `↑↓ field · enter next / ${submitLabel} · type to edit · esc cancel`
          : `↑↓ field · ←→ change · enter next / ${submitLabel} · esc cancel`}
      </Text>
    </Box>
  );
}

export function ItemForm({
  existing,
  isSplit,
  presetSide,
  onSubmit,
  onCancel,
}: {
  existing?: WorkspaceItem;
  isSplit: boolean;
  presetSide?: ItemSide;
  onSubmit: (item: WorkspaceItem) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    name: existing?.name ?? "",
    type: existing?.type ?? "app",
    launch: existing?.launch ?? "",
    side: existing?.side ?? presetSide ?? "frontend",
    cwd: existing?.cwd ?? "",
    closeStrategy: existing?.close ? "command" : existing ? "none" : "process",
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
        { label: "Custom command", value: "command" },
        { label: "Kill process", value: "process" },
        { label: "Leave running", value: "none" },
      ],
    });
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
  initialValues,
  title,
  submitLabel = "save",
  onSubmit,
  onCancel,
}: {
  existing?: Workspace;
  existingNames: string[];
  presetGroup?: string;
  /** Seeds field values without the identity-based "same name is fine" exception `existing` gets — used for duplicating a workspace, where the new name must differ from every existing one, including the source's. */
  initialValues?: Partial<WorkspaceFormResult>;
  title?: string;
  submitLabel?: string;
  onSubmit: (result: WorkspaceFormResult) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    group: existing?.group ?? initialValues?.group ?? presetGroup ?? "",
    name: existing?.name ?? initialValues?.name ?? "",
    layout: existing?.layout ?? initialValues?.layout ?? "single",
    cwd: existing?.cwd ?? initialValues?.cwd ?? "",
    frontendCwd: existing?.frontendCwd ?? initialValues?.frontendCwd ?? "",
    backendCwd: existing?.backendCwd ?? initialValues?.backendCwd ?? "",
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
      title={title ?? (existing ? `Edit workspace · ${existing.name}` : "New workspace")}
      fields={fields}
      values={values}
      error={error}
      submitLabel={submitLabel}
      onChange={(k, updater) => {
        setError("");
        setValues((prev) => ({ ...prev, [k]: updater(prev[k] ?? "") }));
      }}
      onSubmit={handleSubmit}
      onCancel={onCancel}
    />
  );
}

export interface SettingsFormResult {
  settings: Required<Settings>;
  theme: string;
}

export function SettingsForm({
  existing,
  themeNames,
  activeTheme,
  completionAvailable = false,
  fullScreen,
  height,
  onPreviewTheme,
  onSubmit,
  onCancel,
}: {
  existing: Required<Settings>;
  themeNames: string[];
  activeTheme: string;
  /** Whether a supported shell (bash/zsh) was detected — hides the autocompletion field entirely otherwise, since there'd be nothing to install. */
  completionAvailable?: boolean;
  /** See Form's fullScreen/height — Settings renders as the Settings tab's entire full-screen content, not a centered overlay. */
  fullScreen?: boolean;
  height?: number;
  onPreviewTheme: (name: string) => void;
  onSubmit: (result: SettingsFormResult) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    defaultClose: existing.defaultClose ? "close" : "keep",
    autoPruneStaleSessions: existing.autoPruneStaleSessions ? "on" : "off",
    autocomplete: existing.autocomplete ? "on" : "off",
    theme: activeTheme,
  });

  const fields: FieldDef[] = [
    {
      key: "defaultClose",
      label: "wsm open",
      kind: "select",
      options: [
        { label: "Closes current workspace(s) first", value: "close" },
        { label: "Keeps them running (--no-close)", value: "keep" },
      ],
    },
    {
      key: "autoPruneStaleSessions",
      label: "Dead sessions",
      kind: "select",
      options: [
        { label: "Flag only, in wsm status", value: "off" },
        { label: "Auto-remove from state.json", value: "on" },
      ],
    },
    ...(completionAvailable
      ? [
          {
            key: "autocomplete",
            label: "Shell completion",
            kind: "select" as const,
            options: [
              { label: "Off", value: "off" },
              { label: "On (adds one rc-file line)", value: "on" },
            ],
          },
        ]
      : []),
    {
      key: "theme",
      label: "Theme",
      kind: "select",
      options: themeNames.map((name) => ({ label: name, value: name })),
    },
  ];

  const handleSubmit = () => {
    onSubmit({
      settings: {
        defaultClose: values.defaultClose === "close",
        autoPruneStaleSessions: values.autoPruneStaleSessions === "on",
        autocomplete: completionAvailable ? values.autocomplete === "on" : existing.autocomplete,
        shellIntegrationPrompted: existing.shellIntegrationPrompted,
      },
      theme: values.theme,
    });
  };

  return (
    <Form
      title="Settings"
      fields={fields}
      values={values}
      submitLabel="save"
      fullScreen={fullScreen}
      height={height}
      onChange={(k, updater) =>
        setValues((prev) => {
          const next = { ...prev, [k]: updater(prev[k] ?? "") };
          if (k === "theme" && next.theme !== prev.theme) onPreviewTheme(next.theme);
          return next;
        })
      }
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

export function CustomCommandForm({
  existing,
  existingNames,
  onSubmit,
  onCancel,
}: {
  existing?: CustomCommand;
  existingNames: string[];
  onSubmit: (command: CustomCommand) => void;
  onCancel: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({
    name: existing?.name ?? "",
    command: existing?.command ?? "",
  });
  const [error, setError] = useState("");

  const fields: FieldDef[] = [
    { key: "name", label: "Name", kind: "text", placeholder: "e.g. logs" },
    {
      key: "command",
      label: "Command",
      kind: "multiline",
      placeholder: 'docker compose logs -f "$@"',
    },
  ];

  const handleSubmit = () => {
    const name = values.name.trim();
    if (!name) {
      setError("Name is required");
      return;
    }
    if (!isValidCustomCommandName(name)) {
      setError(
        "Name must be a valid shell function name (letters, digits, underscore, hyphen; can't start with a digit or hyphen)",
      );
      return;
    }
    if (name !== existing?.name && existingNames.includes(name)) {
      setError("A custom command with that name already exists");
      return;
    }
    if (!values.command.trim()) {
      setError("Command is required");
      return;
    }
    onSubmit({ name, command: values.command.trim() });
  };

  return (
    <Form
      title={existing ? `Edit command · ${existing.name}` : "New custom command"}
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
