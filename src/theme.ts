import fs from "node:fs";
import { getThemesFile, ensureConfigDir } from "./paths.js";

// Semantic color roles used across the TUI. Muted/secondary text still uses
// Ink's `dimColor` modifier rather than a themed color — dimming whatever
// the terminal's default foreground is looks correct under any theme, so it
// doesn't need its own themed role.
export interface ThemeColors {
  accent: string;
  border: string;
  borderActive: string;
  text: string;
  success: string;
  danger: string;
  typeApp: string;
  typeCommand: string;
  selectionBg: string;
  selectionText: string;
}

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
// without truecolor support). Catppuccin Mocha and Dracula are two of the
// most widely used terminal color schemes; both use truecolor hex values,
// which Ink passes straight through to chalk.hex()/chalk.bgHex().
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
];

function defaultThemesFile(): ThemesFile {
  return { activeTheme: DEFAULT_THEMES[0]!.name, themes: DEFAULT_THEMES };
}

// New custom themes can be added by hand-editing themes.json (appending to
// `themes` and pointing `activeTheme` at the new entry) — there's no
// in-TUI theme creator, only switching between whatever's in the file.
export function loadThemes(): ThemesFile {
  ensureConfigDir();
  const file = getThemesFile();
  if (!fs.existsSync(file)) {
    return defaultThemesFile();
  }
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return defaultThemesFile();
    const parsed = JSON.parse(raw) as ThemesFile | undefined;
    if (!parsed || !Array.isArray(parsed.themes) || parsed.themes.length === 0) {
      return defaultThemesFile();
    }
    return parsed;
  } catch {
    return defaultThemesFile();
  }
}

export function saveThemes(themesFile: ThemesFile): void {
  ensureConfigDir();
  fs.writeFileSync(getThemesFile(), JSON.stringify(themesFile, null, 2), "utf8");
}

export function getActiveTheme(themesFile: ThemesFile): Theme {
  return (
    themesFile.themes.find((t) => t.name === themesFile.activeTheme) ??
    themesFile.themes[0] ??
    DEFAULT_THEMES[0]!
  );
}
