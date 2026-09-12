import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  detectShell,
  installCompletion,
  uninstallCompletion,
  refreshInstalledCompletion,
  ensureManagedShellFiles,
  installCompletionFilesOnly,
  shellIntegrationRcBlock,
} from "../src/shellIntegration.js";
import {
  getCompletionScriptPath,
  getRcFilePath,
  getWsmRcScriptPath,
  getCustomCommandsScriptPath,
} from "../src/paths.js";

describe("shellIntegration", () => {
  let tmpDir: string;
  let rcFile: string;
  const previousConfigEnv = process.env.WSM_CONFIG_DIR;
  const previousRcEnv = process.env.WSM_RC_FILE;
  const previousShellEnv = process.env.SHELL;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "wsm-shell-integration-test-"));
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

    test("writes the wsmrc umbrella file, sourcing both completion.<shell> and the shared commands.sh", () => {
      installCompletion("zsh");
      const wsmRcPath = getWsmRcScriptPath("zsh");
      expect(fs.existsSync(wsmRcPath)).toBe(true);
      const contents = fs.readFileSync(wsmRcPath, "utf8");
      expect(contents).toContain(getCompletionScriptPath("zsh"));
      expect(contents).toContain(getCustomCommandsScriptPath());
    });

    test("writes the shared commands.sh file that evals `wsm commands`", () => {
      installCompletion("zsh");
      const commandsPath = getCustomCommandsScriptPath();
      expect(fs.existsSync(commandsPath)).toBe(true);
      expect(fs.readFileSync(commandsPath, "utf8")).toContain('eval "$(wsm commands)"');
    });

    test("appends exactly one marker-wrapped block to an empty/missing rc file, sourcing the wsmrc file (not completion.<shell> directly)", () => {
      installCompletion("zsh");
      const contents = fs.readFileSync(rcFile, "utf8");
      expect(contents).toContain(getWsmRcScriptPath("zsh"));
      expect(contents).not.toContain(getCompletionScriptPath("zsh"));
      expect(contents).toMatch(/source/);
    });

    test("preserves existing rc file content, adding the block after it", () => {
      fs.writeFileSync(rcFile, 'export PATH="/usr/local/bin:$PATH"\n');
      installCompletion("zsh");
      const contents = fs.readFileSync(rcFile, "utf8");
      expect(contents.startsWith('export PATH="/usr/local/bin:$PATH"\n')).toBe(true);
      expect(contents).toContain(getWsmRcScriptPath("zsh"));
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

    test("migrates an old-style rc block (sourcing completion.<shell> directly) to the new wsmrc-sourcing block", () => {
      const oldBlock = `# >>> wsm completion >>>\n[ -f "${getCompletionScriptPath("zsh")}" ] && source "${getCompletionScriptPath("zsh")}"\n# <<< wsm completion <<<\n`;
      fs.writeFileSync(rcFile, `export PATH="/usr/local/bin:$PATH"\n\n${oldBlock}`);

      installCompletion("zsh");

      const contents = fs.readFileSync(rcFile, "utf8");
      expect(contents).toContain('export PATH="/usr/local/bin:$PATH"');
      expect(contents).not.toContain("# >>> wsm completion >>>");
      expect(contents).toContain(getWsmRcScriptPath("zsh"));
      // exactly one block after migration, not old-plus-new
      expect(contents.match(/source/g)?.length).toBe(1);
    });
  });

  describe("uninstallCompletion", () => {
    test("removes only the completion file, leaving the rc file and wsmrc file untouched", () => {
      const original = 'export PATH="/usr/local/bin:$PATH"\nalias ll="ls -la"\n';
      fs.writeFileSync(rcFile, original);
      installCompletion("zsh");
      const rcAfterInstall = fs.readFileSync(rcFile, "utf8");

      uninstallCompletion("zsh");

      expect(fs.existsSync(getCompletionScriptPath("zsh"))).toBe(false);
      // rc file (and the shared wsmrc pipe custom commands depend on) is left
      // alone — turning off tab-completion must not break custom commands.
      expect(fs.readFileSync(rcFile, "utf8")).toBe(rcAfterInstall);
      expect(fs.existsSync(getWsmRcScriptPath("zsh"))).toBe(true);
    });

    test("is a safe no-op when nothing was installed", () => {
      expect(() => uninstallCompletion("zsh")).not.toThrow();
    });
  });

  describe("ensureManagedShellFiles / installCompletionFilesOnly (manual rc-line insertion)", () => {
    test("ensureManagedShellFiles writes wsmrc + commands.sh without touching the rc file", () => {
      ensureManagedShellFiles("zsh");
      expect(fs.existsSync(getWsmRcScriptPath("zsh"))).toBe(true);
      expect(fs.existsSync(getCustomCommandsScriptPath())).toBe(true);
      expect(fs.existsSync(rcFile)).toBe(false);
    });

    test("installCompletionFilesOnly writes the completion file too, still without touching the rc file", () => {
      installCompletionFilesOnly("zsh");
      expect(fs.existsSync(getCompletionScriptPath("zsh"))).toBe(true);
      expect(fs.existsSync(getWsmRcScriptPath("zsh"))).toBe(true);
      expect(fs.existsSync(rcFile)).toBe(false);
    });
  });

  describe("shellIntegrationRcBlock", () => {
    test("returns the exact marker-wrapped block text installCompletion would write, for display", () => {
      const block = shellIntegrationRcBlock("zsh");
      expect(block).toContain(getWsmRcScriptPath("zsh"));
      expect(block).toContain("source");
      installCompletion("zsh");
      expect(fs.readFileSync(rcFile, "utf8")).toContain(block.trim());
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

    test("(re-)installs for the detected shell when autocomplete is enabled, including the shared wsmrc pipe", () => {
      process.env.SHELL = "/bin/zsh";
      refreshInstalledCompletion(true);
      expect(fs.existsSync(getCompletionScriptPath("zsh"))).toBe(true);
      expect(fs.existsSync(getWsmRcScriptPath("zsh"))).toBe(true);
      expect(fs.readFileSync(rcFile, "utf8")).toContain(getWsmRcScriptPath("zsh"));
    });
  });

  test("getRcFilePath resolves consistently with what installCompletion actually writes to", () => {
    process.env.SHELL = "/bin/zsh";
    installCompletion("zsh");
    expect(getRcFilePath("zsh")).toBe(rcFile);
    expect(fs.existsSync(rcFile)).toBe(true);
  });
});
