import { getStateFile } from "./paths.js";
import { readJsonFile, writeJsonFile } from "./jsonFile.js";
import type { State } from "./types.js";

function defaultState(): State {
  return { sessions: [] };
}

function isState(value: unknown): value is State {
  return !!value && typeof value === "object" && Array.isArray((value as State).sessions);
}

export function loadState(): State {
  return readJsonFile(getStateFile(), isState, defaultState);
}

export function saveState(state: State): void {
  writeJsonFile(getStateFile(), state);
}
