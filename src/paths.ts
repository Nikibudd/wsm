import os from "node:os";
import path from "node:path";
import fs from "node:fs";

export const CONFIG_DIR = path.join(os.homedir(), ".config", "workspace-manager");
export const CONFIG_FILE = path.join(CONFIG_DIR, "config.yaml");
export const STATE_FILE = path.join(CONFIG_DIR, "state.json");

export function ensureConfigDir(): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (!p) return p;
  if (p === "~") return os.homedir();
  if (p.startsWith("~/")) return path.join(os.homedir(), p.slice(2));
  return p;
}
