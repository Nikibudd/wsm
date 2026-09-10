import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig, saveConfig, findWorkspace, workspaceNames, getSettings } from "../src/config.js";
import type { Config } from "../src/types.js";

describe("config", () => {
  let tmpDir: string;
  const previousEnv = process.env.WSM_CONFIG_DIR;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-config-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
  });

  test("loadConfig returns an empty workspace list when no file exists", () => {
    expect(loadConfig()).toEqual({ workspaces: [] });
  });

  test("loadConfig returns default for an empty file", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "config.yaml"), "");
    expect(loadConfig()).toEqual({ workspaces: [] });
  });

  test("loadConfig returns default for malformed yaml instead of throwing", () => {
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(path.join(tmpDir, "config.yaml"), "workspaces: [this is not, valid: yaml:::");
    expect(() => loadConfig()).not.toThrow();
    expect(loadConfig()).toEqual({ workspaces: [] });
  });

  test("saveConfig then loadConfig round-trips a full workspace, including group/layout/side", () => {
    const original: Config = {
      workspaces: [
        {
          name: "acme-app",
          group: "Work",
          layout: "split",
          frontendCwd: "/dev/acme-web",
          backendCwd: "/dev/acme-api",
          items: [
            { name: "editor", type: "app", launch: "code ." },
            { name: "backend", type: "command", launch: "task runserver", side: "backend" },
            {
              name: "frontend",
              type: "command",
              launch: "npm run dev",
              side: "frontend",
              cwd: "/custom/override",
              close: "pkill -f vite",
              delayMs: 500,
            },
          ],
        },
      ],
    };

    saveConfig(original);
    expect(loadConfig()).toEqual(original);
  });

  test("saveConfig writes to config.yaml under the config dir", () => {
    saveConfig({ workspaces: [{ name: "x", items: [] }] });
    const raw = fs.readFileSync(path.join(tmpDir, "config.yaml"), "utf8");
    expect(raw).toContain("name: x");
  });

  test("findWorkspace finds by exact name and returns undefined otherwise", () => {
    const config: Config = {
      workspaces: [
        { name: "a", items: [] },
        { name: "b", items: [] },
      ],
    };
    expect(findWorkspace(config, "b")?.name).toBe("b");
    expect(findWorkspace(config, "missing")).toBeUndefined();
  });

  test("workspaceNames returns the configured workspace names in order", () => {
    const config: Config = {
      workspaces: [
        { name: "b", items: [] },
        { name: "a", items: [] },
      ],
    };
    expect(workspaceNames(config)).toEqual(["b", "a"]);
  });

  test("workspaceNames returns an empty array for an empty config", () => {
    expect(workspaceNames({ workspaces: [] })).toEqual([]);
  });

  test("getSettings defaults to closing existing sessions and not auto-pruning, when unset", () => {
    expect(getSettings({ workspaces: [] })).toEqual({
      defaultClose: true,
      autoPruneStaleSessions: false,
    });
  });

  test("getSettings fills in defaults for keys the user hasn't overridden", () => {
    expect(getSettings({ workspaces: [], settings: { autoPruneStaleSessions: true } })).toEqual({
      defaultClose: true,
      autoPruneStaleSessions: true,
    });
  });

  test("saveConfig then loadConfig round-trips settings", () => {
    const original: Config = {
      workspaces: [],
      settings: { defaultClose: false, autoPruneStaleSessions: true },
    };
    saveConfig(original);
    expect(loadConfig()).toEqual(original);
  });
});
