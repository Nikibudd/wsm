import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  expandHome,
  getConfigDir,
  getConfigFile,
  getStateFile,
  getThemesFile,
  ensureConfigDir,
  getLogsDir,
  getItemLogPath,
  ensureLogsDir,
  sanitizePathSegment,
  getCompletionScriptPath,
  getRcFilePath,
} from "../src/paths.js";

describe("paths", () => {
  const previousEnv = process.env.WSM_CONFIG_DIR;
  const previousRcEnv = process.env.WSM_RC_FILE;
  const previousArgv1 = process.argv[1];

  afterEach(() => {
    if (previousEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousEnv;
    if (previousRcEnv === undefined) delete process.env.WSM_RC_FILE;
    else process.env.WSM_RC_FILE = previousRcEnv;
    process.argv[1] = previousArgv1;
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
    expect(getThemesFile()).toBe(path.join(expected, "themes.json"));
  });

  test("without WSM_CONFIG_DIR, invoked as the real `wsm` binary, defaults to ~/.config/workspace-manager", () => {
    delete process.env.WSM_CONFIG_DIR;
    process.argv[1] = "/opt/homebrew/bin/wsm";
    expect(getConfigDir()).toBe(path.join(os.homedir(), ".config", "workspace-manager"));
  });

  test("without WSM_CONFIG_DIR, invoked as anything other than exactly `wsm`, falls back to a separate dev config dir", () => {
    // `wsmdev` (npm link during development), a direct `node dist/cli.js`,
    // `tsx src/cli.ts` (npm run dev) — none of these should ever be able to
    // touch the real ~/.config/workspace-manager just by someone forgetting
    // to set WSM_CONFIG_DIR. Only the literal "wsm" binary name does.
    delete process.env.WSM_CONFIG_DIR;
    for (const invokedAs of ["/opt/homebrew/bin/wsmdev", "/some/path/dist/cli.js", "/repo/src/cli.ts"]) {
      process.argv[1] = invokedAs;
      expect(getConfigDir()).toBe(path.join(os.homedir(), ".config", "workspace-manager-dev"));
    }
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

  describe("sanitizePathSegment", () => {
    test("leaves an already-safe name unchanged", () => {
      expect(sanitizePathSegment("demo")).toBe("demo");
      expect(sanitizePathSegment("my-workspace_2")).toBe("my-workspace_2");
    });

    test("replaces unsafe characters (including spaces) with underscores", () => {
      expect(sanitizePathSegment("My Workspace!")).toBe("My_Workspace_");
    });

    test("collapses embedded slashes so the result can never traverse directories", () => {
      const result = sanitizePathSegment("../../etc");
      expect(result).not.toContain("/");
      expect(result).not.toBe("..");
    });

    test("rejects empty, '.', and '..' results", () => {
      expect(() => sanitizePathSegment("")).toThrow();
      expect(() => sanitizePathSegment("   ")).toThrow();
      expect(() => sanitizePathSegment(".")).toThrow();
      expect(() => sanitizePathSegment("..")).toThrow();
    });
  });

  describe("log paths", () => {
    test("getLogsDir is a 'logs' subdirectory of the config dir", () => {
      process.env.WSM_CONFIG_DIR = "/tmp/wsm-logs-test";
      expect(getLogsDir()).toBe(path.join("/tmp/wsm-logs-test", "logs"));
    });

    test("getItemLogPath builds one sanitized, non-accumulating path per (workspace, item)", () => {
      process.env.WSM_CONFIG_DIR = "/tmp/wsm-logs-test";
      expect(getItemLogPath("demo", "editor")).toBe(
        path.join("/tmp/wsm-logs-test", "logs", "demo__editor.log"),
      );
      expect(getItemLogPath("My Workspace", "My Item!")).toBe(
        path.join("/tmp/wsm-logs-test", "logs", "My_Workspace__My_Item_.log"),
      );
    });

    test("getItemLogPath never escapes the logs directory, even for traversal-shaped names", () => {
      process.env.WSM_CONFIG_DIR = "/tmp/wsm-logs-test";
      const logPath = getItemLogPath("../evil", "../../etc/passwd");
      expect(path.dirname(logPath)).toBe(getLogsDir());
    });

    test("ensureLogsDir creates the logs directory if missing", () => {
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-paths-test-"));
      try {
        process.env.WSM_CONFIG_DIR = tmp;
        const logsDir = path.join(tmp, "logs");
        expect(fs.existsSync(logsDir)).toBe(false);
        ensureLogsDir();
        expect(fs.existsSync(logsDir)).toBe(true);
      } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
      }
    });
  });

  describe("getCompletionScriptPath", () => {
    test("is a shell-specific file under the config dir", () => {
      process.env.WSM_CONFIG_DIR = "/tmp/wsm-completion-test";
      expect(getCompletionScriptPath("zsh")).toBe(path.join("/tmp/wsm-completion-test", "completion.zsh"));
      expect(getCompletionScriptPath("bash")).toBe(path.join("/tmp/wsm-completion-test", "completion.bash"));
    });
  });

  describe("getRcFilePath", () => {
    test("WSM_RC_FILE overrides the default rc file location, read live", () => {
      process.env.WSM_RC_FILE = "~/custom-rc";
      expect(getRcFilePath("zsh")).toBe(path.join(os.homedir(), "custom-rc"));
      process.env.WSM_RC_FILE = "/tmp/other-rc";
      expect(getRcFilePath("zsh")).toBe("/tmp/other-rc");
    });

    test("without WSM_RC_FILE, invoked as the real `wsm` binary, defaults to ~/.zshrc or ~/.bashrc", () => {
      delete process.env.WSM_RC_FILE;
      process.argv[1] = "/opt/homebrew/bin/wsm";
      expect(getRcFilePath("zsh")).toBe(path.join(os.homedir(), ".zshrc"));
      expect(getRcFilePath("bash")).toBe(path.join(os.homedir(), ".bashrc"));
    });

    // Same reasoning as getConfigDir's wsm/wsmdev split: a dev/test build
    // must never be able to touch the developer's real shell rc file just
    // because WSM_RC_FILE wasn't set. Route it into the (already-isolated)
    // dev config dir instead.
    test("without WSM_RC_FILE, invoked as anything other than exactly `wsm`, never resolves to the real home-dir rc file", () => {
      delete process.env.WSM_RC_FILE;
      delete process.env.WSM_CONFIG_DIR;
      for (const invokedAs of ["/opt/homebrew/bin/wsmdev", "/some/path/dist/cli.js", "/repo/src/cli.ts"]) {
        process.argv[1] = invokedAs;
        expect(getRcFilePath("zsh")).not.toBe(path.join(os.homedir(), ".zshrc"));
        expect(getRcFilePath("zsh")).toBe(path.join(getConfigDir(), "dev-rc.zsh"));
      }
    });
  });
});
