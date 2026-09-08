import fs from "node:fs";
import { STATE_FILE, ensureConfigDir } from "./paths.js";
import type { State } from "./types.js";

function defaultState(): State {
  return { sessions: [] };
}

export function loadState(): State {
  ensureConfigDir();
  if (!fs.existsSync(STATE_FILE)) {
    return defaultState();
  }
  try {
    const raw = fs.readFileSync(STATE_FILE, "utf8");
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
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), "utf8");
}
