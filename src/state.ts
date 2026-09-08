import fs from "node:fs";
import { getStateFile, ensureConfigDir } from "./paths.js";
import type { State } from "./types.js";

function defaultState(): State {
  return { sessions: [] };
}

export function loadState(): State {
  ensureConfigDir();
  const stateFile = getStateFile();
  if (!fs.existsSync(stateFile)) {
    return defaultState();
  }
  try {
    const raw = fs.readFileSync(stateFile, "utf8");
    if (!raw.trim()) return defaultState();
    const parsed = JSON.parse(raw) as State;
    if (!parsed || !Array.isArray(parsed.sessions)) return defaultState();
    return parsed;
  } catch {
    return defaultState();
  }
}

export function saveState(state: State): void {
  ensureConfigDir();
  fs.writeFileSync(getStateFile(), JSON.stringify(state, null, 2), "utf8");
}
