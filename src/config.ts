import fs from "node:fs";
import { load, dump } from "js-yaml";
import { getConfigFile, ensureConfigDir } from "./paths.js";
import type { Config, CustomCommand, Settings, Workspace, WorkspaceItem } from "./types.js";

function defaultConfig(): Config {
  return { workspaces: [] };
}

// Pre-N-folder schema, replaced by `Workspace.folders`/`WorkspaceItem.
// folderIndex` (see types.ts): a workspace had a fixed `layout: "split"`
// with exactly two folders (`frontendCwd`/`backendCwd`), and each item
// picked one via `side: "frontend" | "backend"`. `loadConfig` migrates this
// transparently on every load (not just once) so a config.yaml written by
// an older wsm — a real one exists in the wild, not a hypothetical — keeps
// working without the user hand-editing it; nothing here is a version flag
// or a one-time upgrade, it just recognizes the old shape by which fields
// are present. Loosely typed (not `Workspace`/`WorkspaceItem`) because
// that's exactly the fields this function exists to strip.
interface LegacyWorkspaceFields {
  layout?: "single" | "split";
  frontendCwd?: string;
  backendCwd?: string;
}
interface LegacyItemFields {
  side?: "frontend" | "backend";
}

// Exported for direct unit testing (test/config.test.ts) — the shape of
// the migration matters more precisely than "loadConfig doesn't throw."
export function migrateWorkspace(raw: Workspace & LegacyWorkspaceFields): Workspace {
  const { layout, frontendCwd, backendCwd, ...rest } = raw;
  if (layout !== "split") {
    // Not a legacy split workspace — still drop a stray `layout: "single"`
    // (or an old single-folder workspace re-saved by a newer wsm) so it
    // doesn't linger in config.yaml; `folders` presence is now the only
    // signal, there's no companion flag to keep in sync with it.
    return rest as Workspace;
  }
  const items: WorkspaceItem[] = raw.items.map((item) => {
    const { side, ...itemRest } = item as WorkspaceItem & LegacyItemFields;
    return side ? { ...itemRest, folderIndex: side === "backend" ? 1 : 0 } : itemRest;
  });
  return {
    ...rest,
    folders: [
      { name: "Frontend", cwd: frontendCwd },
      { name: "Backend", cwd: backendCwd },
    ],
    items,
  };
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
    return { ...parsed, workspaces: parsed.workspaces.map(migrateWorkspace) };
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
  shellIntegrationPrompted: false,
  maxWorkspaceFolders: 6,
};

export function getSettings(config: Config): Required<Settings> {
  return { ...DEFAULT_SETTINGS, ...config.settings };
}

export function getCustomCommands(config: Config): CustomCommand[] {
  return config.customCommands ?? [];
}
