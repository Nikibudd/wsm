import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expandHome, getConfigDir, getConfigFile, getStateFile, ensureConfigDir } from "../src/paths.js";

describe("paths", () => {
  const previousEnv = process.env.WSM_CONFIG_DIR;

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
  });

  test("expandHome expands ~ and ~/... but leaves other paths alone", () => {
    const home = os.homedir();
    expect(expandHome("~")).toBe(home);
    expect(expandHome("~/dev/project")).toBe(path.join(home, "dev/project"));
    expect(expandHome("/absolute/path")).toBe("/absolute/path");
    expect(expandHome("")).toBe(home);
  });

  test("WSM_CONFIG_DIR overrides the default config directory, read live", () => {
    process.env.WSM_CONFIG_DIR = "~/custom-wsm-dir";
    const expected = path.join(os.homedir(), "custom-wsm-dir");
    expect(getConfigDir()).toBe(expected);
    expect(getConfigFile()).toBe(path.join(expected, "config.yaml"));
    expect(getStateFile()).toBe(path.join(expected, "state.json"));
  });

  test("without WSM_CONFIG_DIR, defaults to ~/.config/workspace-manager", () => {
    delete process.env.WSM_CONFIG_DIR;
    expect(getConfigDir()).toBe(path.join(os.homedir(), ".config", "workspace-manager"));
  });

  test("changing WSM_CONFIG_DIR between calls changes the result (no caching)", () => {
    process.env.WSM_CONFIG_DIR = "/tmp/first-dir";
    expect(getConfigDir()).toBe("/tmp/first-dir");
    process.env.WSM_CONFIG_DIR = "/tmp/second-dir";
    expect(getConfigDir()).toBe("/tmp/second-dir");
  });

  test("ensureConfigDir creates the directory if missing", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-paths-test-"));
    const target = path.join(tmp, "nested", "config-dir");
    try {
      process.env.WSM_CONFIG_DIR = target;
      expect(fs.existsSync(target)).toBe(false);
      ensureConfigDir();
      expect(fs.existsSync(target)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
