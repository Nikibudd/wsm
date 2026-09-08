import fs from "node:fs";
import { load, dump } from "js-yaml";
import { CONFIG_FILE, ensureConfigDir } from "./paths.js";
import type { Config, Workspace } from "./types.js";

function defaultConfig(): Config {
  return { workspaces: [] };
}

export function loadConfig(): Config {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) {
    return defaultConfig();
  }
  const raw = fs.readFileSync(CONFIG_FILE, "utf8");
  if (!raw.trim()) return defaultConfig();
  const parsed = load(raw) as Config | undefined;
  if (!parsed || !Array.isArray(parsed.workspaces)) return defaultConfig();
  return parsed;
}

export function saveConfig(config: Config): void {
  ensureConfigDir();
  const raw = dump(config, { indent: 2, lineWidth: 100 });
  fs.writeFileSync(CONFIG_FILE, raw, "utf8");
}

export function findWorkspace(config: Config, name: string): Workspace | undefined {
  return config.workspaces.find((w) => w.name === name);
}
