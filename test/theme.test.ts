import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadThemes, saveThemes, getActiveTheme, DEFAULT_THEMES } from "../src/theme.js";
import type { ThemesFile } from "../src/theme.js";

describe("theme", () => {
  let tmpDir: string;
  const previousEnv = process.env.WSM_CONFIG_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-theme-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
  });

  test("ships several popular built-in themes", () => {
    const names = DEFAULT_THEMES.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "Default",
        "Catppuccin Mocha",
        "Dracula",
        "Nord",
        "Gruvbox Dark",
        "Tokyo Night",
        "Solarized Dark",
      ]),
    );
  });

  test("every built-in theme defines all ThemeColors roles with non-empty values", () => {
    const roles = [
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
    for (const theme of DEFAULT_THEMES) {
      for (const role of roles) {
        expect(theme.colors[role]).toBeTruthy();
      }
    }
  });

  test("loadThemes returns the built-in defaults, with the first theme active, when no file exists", () => {
    const loaded = loadThemes();
    expect(loaded.themes).toEqual(DEFAULT_THEMES);
    expect(loaded.activeTheme).toBe(DEFAULT_THEMES[0]!.name);
  });

  test("loadThemes falls back to defaults for an empty file", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "themes.json"), "");
    expect(loadThemes().themes).toEqual(DEFAULT_THEMES);
  });

  test("loadThemes falls back to defaults for malformed JSON instead of throwing", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "themes.json"), "{ not valid json");
    expect(() => loadThemes()).not.toThrow();
    expect(loadThemes().themes).toEqual(DEFAULT_THEMES);
  });

  test("saveThemes then loadThemes round-trips a custom theme list and active selection", () => {
    const custom: ThemesFile = {
      activeTheme: "Midnight",
      themes: [
        { name: "Midnight", colors: DEFAULT_THEMES[0]!.colors },
        { name: "Dracula", colors: DEFAULT_THEMES.find((t) => t.name === "Dracula")!.colors },
      ],
    };
    saveThemes(custom);
    expect(loadThemes()).toEqual(custom);
  });

  test("getActiveTheme resolves the theme matching activeTheme by name", () => {
    const file: ThemesFile = { activeTheme: "Dracula", themes: DEFAULT_THEMES };
    expect(getActiveTheme(file).name).toBe("Dracula");
  });

  test("getActiveTheme falls back to the first theme when activeTheme doesn't match any entry", () => {
    const file: ThemesFile = { activeTheme: "Nonexistent", themes: DEFAULT_THEMES };
    expect(getActiveTheme(file).name).toBe(DEFAULT_THEMES[0]!.name);
  });
});
