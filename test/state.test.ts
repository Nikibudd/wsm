import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadState, saveState } from "../src/state.js";
import type { State } from "../src/types.js";

describe("state", () => {
  let tmpDir: string;
  const previousEnv = process.env.WSM_CONFIG_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-state-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
  });

  test("loadState returns no sessions when no file exists", () => {
    expect(loadState()).toEqual({ sessions: [] });
  });

  test("loadState returns default for malformed json instead of throwing", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "state.json"), "{not valid json");
    expect(() => loadState()).not.toThrow();
    expect(loadState()).toEqual({ sessions: [] });
  });

  test("saveState then loadState round-trips sessions", () => {
    const state: State = {
      sessions: [
        {
          workspace: "demo",
          openedAt: "2026-01-01T00:00:00.000Z",
          items: [
            { name: "editor", type: "app", pid: 123 },
            { name: "docker", type: "command", pid: 456, close: "docker compose down", cwd: "/tmp" },
          ],
        },
      ],
    };
    saveState(state);
    expect(loadState()).toEqual(state);
  });
});
