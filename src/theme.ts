import { getThemesFile } from "./paths.js";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";

// Semantic color roles used across the TUI. This array is the single source
// of truth for what a theme must define — ThemeColors is derived from it
// (rather than a hand-written interface a runtime check could drift from),
// and anything that needs to enumerate the roles (e.g. validating a theme
// defines all of them) should read this array, not repeat the list.
// Muted/secondary text still uses Ink's `dimColor` modifier rather than a
// themed color — dimming whatever the terminal's default foreground is
// looks correct under any theme, so it doesn't need its own themed role.
export const THEME_COLOR_ROLES = [
  "accent",
  "border",
  "borderActive",
  "text",
  "success",
  "danger",
  "typeApp",
  "typeCommand",
  "selectionBg",
  "selectionText",
] as const;

export type ThemeColors = Record<(typeof THEME_COLOR_ROLES)[number], string>;

export interface Theme {
  name: string;
  colors: ThemeColors;
}

export interface ThemesFile {
  activeTheme: string;
  themes: Theme[];
}

// "Default" reproduces the colors this TUI shipped with before theming
// existed (plain ANSI names, so it renders correctly even on terminals
// without truecolor support). The rest are some of the most widely used
// terminal/editor color schemes, all truecolor hex, which Ink passes
// straight through to chalk.hex()/chalk.bgHex().
export const DEFAULT_THEMES: Theme[] = [
  {
    name: "Default",
    colors: {
      accent: "cyan",
      border: "gray",
      borderActive: "cyan",
      text: "white",
      success: "green",
      danger: "red",
      typeApp: "magenta",
      typeCommand: "yellow",
      selectionBg: "cyan",
      selectionText: "black",
    },
  },
  {
    name: "Catppuccin Mocha",
    colors: {
      accent: "#cba6f7",
      border: "#6c7086",
      borderActive: "#cba6f7",
      text: "#cdd6f4",
      success: "#a6e3a1",
      danger: "#f38ba8",
      typeApp: "#f5c2e7",
      typeCommand: "#f9e2af",
      selectionBg: "#cba6f7",
      selectionText: "#11111b",
    },
  },
  {
    name: "Dracula",
    colors: {
      accent: "#bd93f9",
      border: "#6272a4",
      borderActive: "#bd93f9",
      text: "#f8f8f2",
      success: "#50fa7b",
      danger: "#ff5555",
      typeApp: "#ff79c6",
      typeCommand: "#f1fa8c",
      selectionBg: "#bd93f9",
      selectionText: "#282a36",
    },
  },
  {
    name: "Nord",
    colors: {
      accent: "#88c0d0",
      border: "#4c566a",
      borderActive: "#88c0d0",
      text: "#d8dee9",
      success: "#a3be8c",
      danger: "#bf616a",
      typeApp: "#b48ead",
      typeCommand: "#ebcb8b",
      selectionBg: "#88c0d0",
      selectionText: "#2e3440",
    },
  },
  {
    name: "Gruvbox Dark",
    colors: {
      accent: "#fe8019",
      border: "#928374",
      borderActive: "#fe8019",
      text: "#ebdbb2",
      success: "#b8bb26",
      danger: "#fb4934",
      typeApp: "#d3869b",
      typeCommand: "#fabd2f",
      selectionBg: "#fe8019",
      selectionText: "#282828",
    },
  },
  {
    name: "Tokyo Night",
    colors: {
      accent: "#7aa2f7",
      border: "#565f89",
      borderActive: "#7aa2f7",
      text: "#c0caf5",
      success: "#9ece6a",
      danger: "#f7768e",
      typeApp: "#bb9af7",
      typeCommand: "#e0af68",
      selectionBg: "#7aa2f7",
      selectionText: "#1a1b26",
    },
  },
  {
    name: "Solarized Dark",
    colors: {
      accent: "#268bd2",
      border: "#586e75",
      borderActive: "#268bd2",
      text: "#839496",
      success: "#859900",
      danger: "#dc322f",
      typeApp: "#d33682",
      typeCommand: "#b58900",
      selectionBg: "#268bd2",
      selectionText: "#002b36",
    },
  },
];

function defaultThemesFile(): ThemesFile {
  return { activeTheme: DEFAULT_THEMES[0]!.name, themes: DEFAULT_THEMES };
}

// Adds any built-in theme not already present (matched by name) to an
// existing file's theme list, so shipping a new built-in theme doesn't
// strand installs whose themes.json was auto-created before it existed. A
// name that's already present — built-in or user-customized under a
// built-in's name — is left exactly as saved, never overwritten.
function withMissingBuiltins(file: ThemesFile): ThemesFile {
  const existingNames = new Set(file.themes.map((t) => t.name));
  const missing = DEFAULT_THEMES.filter((t) => !existingNames.has(t.name));
  if (missing.length === 0) return file;
  return { ...file, themes: [...file.themes, ...missing] };
}

function isThemesFile(value: unknown): value is ThemesFile {
  return (
    !!value &&
    typeof value === "object" &&
    Array.isArray((value as ThemesFile).themes) &&
    (value as ThemesFile).themes.length > 0
  );
}

// New custom themes can be added by hand-editing themes.json (appending to
// `themes` and pointing `activeTheme` at the new entry) — there's no
// in-TUI theme creator, only switching between whatever's in the file.
export function loadThemes(): ThemesFile {
  return withMissingBuiltins(readJsonFile(getThemesFile(), isThemesFile, defaultThemesFile));
}

export function saveThemes(themesFile: ThemesFile): void {
  writeJsonFile(getThemesFile(), themesFile);
}

export function getActiveTheme(themesFile: ThemesFile): Theme {
  return (
    themesFile.themes.find((t) => t.name === themesFile.activeTheme) ??
    themesFile.themes[0] ??
    DEFAULT_THEMES[0]!
  );
}
