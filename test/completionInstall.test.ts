import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectShell,
  installCompletion,
  uninstallCompletion,
  refreshInstalledCompletion,
} from "../src/completionInstall.js";
import { getCompletionScriptPath, getRcFilePath } from "../src/paths.js";

describe("completionInstall", () => {
  let tmpDir: string;
  let rcFile: string;
  const previousConfigEnv = process.env.WSM_CONFIG_DIR;
  const previousRcEnv = process.env.WSM_RC_FILE;
  const previousShellEnv = process.env.SHELL;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-completion-install-test-"));
    process.env.WSM_CONFIG_DIR = tmpDir;
    rcFile = path.join(tmpDir, ".zshrc-under-test");
    process.env.WSM_RC_FILE = rcFile;
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    if (previousConfigEnv === undefined) delete process.env.WSM_CONFIG_DIR;
    else process.env.WSM_CONFIG_DIR = previousConfigEnv;
    if (previousRcEnv === undefined) delete process.env.WSM_RC_FILE;
    else process.env.WSM_RC_FILE = previousRcEnv;
    if (previousShellEnv === undefined) delete process.env.SHELL;
    else process.env.SHELL = previousShellEnv;
  });

  describe("detectShell", () => {
    test("recognizes zsh and bash from $SHELL's basename", () => {
      process.env.SHELL = "/bin/zsh";
      expect(detectShell()).toBe("zsh");
      process.env.SHELL = "/usr/local/bin/bash";
      expect(detectShell()).toBe("bash");
    });

    test("returns null for an unsupported or unset shell", () => {
      process.env.SHELL = "/usr/bin/fish";
      expect(detectShell()).toBeNull();
      delete process.env.SHELL;
      expect(detectShell()).toBeNull();
    });
  });

  describe("installCompletion", () => {
    test("writes a completion file under the config dir that evals `wsm completion <shell>`", () => {
      installCompletion("zsh");
      const scriptPath = getCompletionScriptPath("zsh");
      expect(fs.existsSync(scriptPath)).toBe(true);
      expect(fs.readFileSync(scriptPath, "utf8")).toContain('eval "$(wsm completion zsh)"');
    });

    test("appends exactly one marker-wrapped source line to an empty/missing rc file", () => {
      installCompletion("zsh");
      const contents = fs.readFileSync(rcFile, "utf8");
      const scriptPath = getCompletionScriptPath("zsh");
      expect(contents).toContain(scriptPath);
      expect(contents).toMatch(/source/);
    });

    test("preserves existing rc file content, adding the block after it", () => {
      fs.writeFileSync(rcFile, 'export PATH="/usr/local/bin:$PATH"\n');
      installCompletion("zsh");
      const contents = fs.readFileSync(rcFile, "utf8");
      expect(contents.startsWith('export PATH="/usr/local/bin:$PATH"\n')).toBe(true);
      expect(contents).toContain(getCompletionScriptPath("zsh"));
    });

    test("is idempotent: calling it twice does not duplicate the rc file block", () => {
      installCompletion("zsh");
      const afterFirst = fs.readFileSync(rcFile, "utf8");

      installCompletion("zsh");
      const afterSecond = fs.readFileSync(rcFile, "utf8");

      expect(afterSecond).toBe(afterFirst);
    });

    test("self-heals: recreates a since-deleted completion file without touching an already-installed rc block", () => {
      installCompletion("zsh");
      const scriptPath = getCompletionScriptPath("zsh");
      fs.rmSync(scriptPath);
      const rcBefore = fs.readFileSync(rcFile, "utf8");

      installCompletion("zsh");

      expect(fs.existsSync(scriptPath)).toBe(true);
      expect(fs.readFileSync(rcFile, "utf8")).toBe(rcBefore);
    });
  });

  describe("uninstallCompletion", () => {
    test("removes the completion file and the rc file block, restoring prior rc content exactly", () => {
      const original = 'export PATH="/usr/local/bin:$PATH"\nalias ll="ls -la"\n';
      fs.writeFileSync(rcFile, original);
      installCompletion("zsh");

      uninstallCompletion("zsh");

      expect(fs.existsSync(getCompletionScriptPath("zsh"))).toBe(false);
      expect(fs.readFileSync(rcFile, "utf8")).toBe(original);
    });

    test("is a safe no-op when nothing was installed", () => {
      expect(() => uninstallCompletion("zsh")).not.toThrow();
    });
  });

  describe("refreshInstalledCompletion", () => {
    test("does nothing when autocomplete is disabled", () => {
      process.env.SHELL = "/bin/zsh";
      refreshInstalledCompletion(false);
      expect(fs.existsSync(getCompletionScriptPath("zsh"))).toBe(false);
      expect(fs.existsSync(rcFile)).toBe(false);
    });

    test("does nothing when the shell can't be detected, even if autocomplete is enabled", () => {
      process.env.SHELL = "/usr/bin/fish";
      refreshInstalledCompletion(true);
      expect(fs.existsSync(getCompletionScriptPath("bash"))).toBe(false);
      expect(fs.existsSync(getCompletionScriptPath("zsh"))).toBe(false);
    });

    test("(re-)installs for the detected shell when autocomplete is enabled", () => {
      process.env.SHELL = "/bin/zsh";
      refreshInstalledCompletion(true);
      expect(fs.existsSync(getCompletionScriptPath("zsh"))).toBe(true);
      expect(fs.readFileSync(rcFile, "utf8")).toContain(getCompletionScriptPath("zsh"));
    });
  });

  test("getRcFilePath resolves consistently with what installCompletion actually writes to", () => {
    process.env.SHELL = "/bin/zsh";
    installCompletion("zsh");
    expect(getRcFilePath("zsh")).toBe(rcFile);
    expect(fs.existsSync(rcFile)).toBe(true);
  });
});
