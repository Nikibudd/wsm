import fs from "node:fs";
import { load, dump } from "js-yaml";
import { getConfigFile, ensureConfigDir } from "./paths.js";
import type { Config, Settings, Workspace } from "./types.js";

function defaultConfig(): Config {
  return { workspaces: [] };
}

export function loadConfig(): Config {
  ensureConfigDir();
  const configFile = getConfigFile();
  if (!fs.existsSync(configFile)) {
    return defaultConfig();
  }
  try {
    const raw = fs.readFileSync(configFile, "utf8");
    if (!raw.trim()) return defaultConfig();
    const parsed = load(raw) as Config | undefined;
    if (!parsed || !Array.isArray(parsed.workspaces)) return defaultConfig();
    return parsed;
  } catch {
    return defaultConfig();
  }
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const raw = dump(config, { indent: 2, lineWidth: 100 });
  fs.writeFileSync(getConfigFile(), raw, "utf8");
}

export function findWorkspace(config: Config, name: string): Workspace | undefined {
  return config.workspaces.find((w) => w.name === name);
}

export function workspaceNames(config: Config): string[] {
  return config.workspaces.map((w) => w.name);
}

const DEFAULT_SETTINGS: Required<Settings> = {
  defaultClose: true,
  autoPruneStaleSessions: false,
  autocomplete: false,
  autocompletePrompted: false,
};

export function getSettings(config: Config): Required<Settings> {
  return { ...DEFAULT_SETTINGS, ...config.settings };
}
