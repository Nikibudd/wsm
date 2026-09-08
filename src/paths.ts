import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (!p) return os.homedir();
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}

// WSM_CONFIG_DIR lets the config/state directory be overridden — used for
// isolated testing so real user config is never touched by accident. Read
// live (not cached at module-load time) so it can be changed between calls,
// e.g. by tests that don't want to reset the whole module registry.
export function getConfigDir(): string {
  const override = process.env.WSM_CONFIG_DIR;
  return override ? expandHome(override) : path.join(os.homedir(), ".config", "workspace-manager");
}

export function getConfigFile(): string {
  return path.join(getConfigDir(), "config.yaml");
}

export function getStateFile(): string {
  return path.join(getConfigDir(), "state.json");
}

export function ensureConfigDir(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
}
