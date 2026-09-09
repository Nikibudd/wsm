import fs from "node:fs";
import { ensureConfigDir } from "./paths.js";

// Shared "never throw" contract for a JSON file under the config dir:
// missing, empty, or malformed content all fall back to `makeDefault()`
// rather than propagating an error, and the fallback is a fresh call each
// time so callers can't accidentally share/mutate one default instance
// across loads. Used by both state.ts and theme.ts to keep this contract
// consistent instead of each hand-rolling it — see AGENTS.md.
export function readJsonFile<T>(
  file: string,
  isValid: (value: unknown) => value is T,
  makeDefault: () => T,
): T {
  ensureConfigDir();
  if (!fs.existsSync(file)) return makeDefault();
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return makeDefault();
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : makeDefault();
  } catch {
    return makeDefault();
  }
}

export function writeJsonFile<T>(file: string, data: T): void {
  ensureConfigDir();
  fs.writeFileSync(file, JSON.stringify(data, null, 2), "utf8");
}
