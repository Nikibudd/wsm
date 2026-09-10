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

// `wsm` and `wsmdev` are the same dist/cli.js, symlinked under two names
// (release install vs. `npm link` during development) — process.argv[1]
// preserves the literal invoked path, not the symlink's realpath, so this
// reliably tells them apart even though they're the exact same file.
function invokedCommandName(): string {
  const argv1 = process.argv[1];
  return argv1 ? path.basename(argv1) : "";
}

// WSM_CONFIG_DIR lets the config/state directory be overridden — used for
// isolated testing so real user config is never touched by accident. Read
// live (not cached at module-load time) so it can be changed between calls,
// e.g. by tests that don't want to reset the whole module registry.
//
// Below that override, only the literal "wsm" binary name touches the real
// ~/.config/workspace-manager. Anything else — "wsmdev" (npm link during
// development), a direct `node dist/cli.js`, `tsx src/cli.ts` (npm run dev)
// — falls back to a separate ~/.config/workspace-manager-dev sandbox, so a
// locally-linked dev build can never touch daily-driver config just by
// someone forgetting to set WSM_CONFIG_DIR. See AGENTS.md.
export function getConfigDir(): string {
  const override = process.env.WSM_CONFIG_DIR;
  if (override) return expandHome(override);
  const dirName = invokedCommandName() === "wsm" ? "workspace-manager" : "workspace-manager-dev";
  return path.join(os.homedir(), ".config", dirName);
}

export function getConfigFile(): string {
  return path.join(getConfigDir(), "config.yaml");
}

export function getStateFile(): string {
  return path.join(getConfigDir(), "state.json");
}

export function getThemesFile(): string {
  return path.join(getConfigDir(), "themes.json");
}

export function ensureConfigDir(): void {
  fs.mkdirSync(getConfigDir(), { recursive: true });
}

export function getLogsDir(): string {
  return path.join(getConfigDir(), "logs");
}

export function ensureLogsDir(): void {
  fs.mkdirSync(getLogsDir(), { recursive: true });
}

// Turns an arbitrary workspace/item name into one safe path segment.
// Anything outside [A-Za-z0-9._-] (including "/") collapses to "_", which
// also destroys any literal "/" before it could be used to escape the logs
// directory — the remaining empty/"."/".." checks catch the (now
// slash-free) leftover cases that would otherwise resolve to "no segment"
// or "one level up".
export function sanitizePathSegment(name: string): string {
  const cleaned = name.trim().replace(/[^A-Za-z0-9._-]+/g, "_");
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.includes("/")) {
    throw new Error(`Cannot use "${name}" as a path segment`);
  }
  return cleaned;
}

export function getItemLogPath(workspaceName: string, itemName: string): string {
  const ws = sanitizePathSegment(workspaceName);
  const item = sanitizePathSegment(itemName);
  return path.join(getLogsDir(), `${ws}__${item}.log`);
}
