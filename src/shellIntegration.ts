import fs from "node:fs";
import path from "node:path";
import {
  ensureConfigDir,
  getCompletionScriptPath,
  getCustomCommandsScriptPath,
  getRcFilePath,
  getWsmRcScriptPath,
  type CompletionShell,
} from "./paths.js";

export type { CompletionShell };

// $SHELL's basename, same signal launcher.ts's USER_SHELL already trusts to
// mean "the user's actual login shell". Only bash/zsh are supported — same
// scope as completion.ts's script generators.
export function detectShell(): CompletionShell | null {
  const name = path.basename(process.env.SHELL || "");
  if (name === "zsh") return "zsh";
  if (name === "bash") return "bash";
  return null;
}

// Current marker. Generalized from the old completion-only marker (below)
// because the rc file's one line now sources the shared wsmrc umbrella file
// (completion + custom commands), not completion.<shell> directly — see
// AGENTS.md. installShellIntegrationRc migrates any old block it finds to
// this one rather than leaving a second, stale block behind.
const MARKER_START = "# >>> wsm >>>";
const MARKER_END = "# <<< wsm <<<";
const OLD_MARKER_START = "# >>> wsm completion >>>";
const OLD_MARKER_END = "# <<< wsm completion <<<";

function completionFileContents(shell: CompletionShell): string {
  return `eval "$(wsm completion ${shell})"\n`;
}

function customCommandsFileContents(): string {
  return `eval "$(wsm commands)"\n`;
}

// Sources both per-feature files, each independently guarded by [ -f ... ]
// so a feature that was never enabled (no completion.<shell>) or that has
// nothing to say yet (commands.sh always exists once installed, but `wsm
// commands` itself just prints nothing with no custom commands configured)
// never breaks shell startup.
function wsmRcFileContents(shell: CompletionShell): string {
  const completionPath = getCompletionScriptPath(shell);
  const commandsPath = getCustomCommandsScriptPath();
  return (
    `[ -f "${completionPath}" ] && source "${completionPath}"\n` +
    `[ -f "${commandsPath}" ] && source "${commandsPath}"\n`
  );
}

// The one line that ever needs to live in the rc file — it sources the
// wsmrc umbrella file, which in turn decides what to actually source.
// Because the rc line only ever points at that fixed path, adding a future
// managed file (beyond completion/commands) never requires a second rc-file
// edit: only wsmRcFileContents' own output changes, and that file is
// rewritten freely since wsm owns it entirely. See AGENTS.md.
export function shellIntegrationRcBlock(shell: CompletionShell): string {
  const wsmRcPath = getWsmRcScriptPath(shell);
  return `${MARKER_START}\n[ -f "${wsmRcPath}" ] && source "${wsmRcPath}"\n${MARKER_END}\n`;
}

function withBlock(existing: string, block: string): string {
  if (existing.length === 0) return block;
  const normalized = existing.endsWith("\n") ? existing : existing + "\n";
  return `${normalized}\n${block}`;
}

function withoutMarkedBlock(contents: string, start: string, end: string): string {
  const startIdx = contents.indexOf(start);
  if (startIdx === -1) return contents;
  const endIdx = contents.indexOf(end, startIdx);
  if (endIdx === -1) return contents;
  let head = contents.slice(0, startIdx);
  let tail = contents.slice(endIdx + end.length);
  if (tail.startsWith("\n")) tail = tail.slice(1);
  // Undo the blank-line separator withBlock adds before the block.
  if (head.endsWith("\n\n")) head = head.slice(0, -1);
  return head + tail;
}

// Writes wsmrc.<shell> and the shared commands.sh — everything shell
// integration needs *except* completion.<shell> itself (that stays
// exclusively owned by installCompletion/uninstallCompletion, since tab
// completion is independently toggleable) and the rc file (skipped
// entirely here — see installCompletionFilesOnly, used when the user chose
// to add the rc line themselves rather than have wsm do it).
export function ensureManagedShellFiles(shell: CompletionShell): void {
  ensureConfigDir();
  fs.writeFileSync(getCustomCommandsScriptPath(), customCommandsFileContents(), "utf8");
  fs.writeFileSync(getWsmRcScriptPath(shell), wsmRcFileContents(shell), "utf8");
}

// Migrates a pre-existing old-style block (which sourced completion.<shell>
// directly) to the current wsmrc-sourcing block, or appends the current
// block fresh if neither is present. Only touches the rc file when
// something actually needs to change — the rc file's whole point is to be
// edited at most once, ever.
function installShellIntegrationRc(shell: CompletionShell): { rcFilePath: string; rcFileChanged: boolean } {
  const rcFilePath = getRcFilePath(shell);
  const existing = fs.existsSync(rcFilePath) ? fs.readFileSync(rcFilePath, "utf8") : "";

  const hasCurrentBlock = existing.includes(MARKER_START);
  const hasOldBlock = existing.includes(OLD_MARKER_START);
  const rcFileChanged = !hasCurrentBlock;

  if (rcFileChanged) {
    const withoutOld = hasOldBlock ? withoutMarkedBlock(existing, OLD_MARKER_START, OLD_MARKER_END) : existing;
    fs.mkdirSync(path.dirname(rcFilePath), { recursive: true });
    fs.writeFileSync(rcFilePath, withBlock(withoutOld, shellIntegrationRcBlock(shell)), "utf8");
  }

  return { rcFilePath, rcFileChanged };
}

export interface CompletionInstallResult {
  shell: CompletionShell;
  completionFilePath: string;
  rcFilePath: string;
  rcFileChanged: boolean;
}

// Idempotent and safe to call repeatedly (e.g. from `wsm update`, every
// time): every managed file is always (re)written — cheap, deterministic,
// self-healing if deleted — while the rc file itself is only touched when
// its current-marker block isn't already present (including migrating a
// leftover old-style block automatically, see installShellIntegrationRc).
export function installCompletion(shell: CompletionShell): CompletionInstallResult {
  ensureManagedShellFiles(shell);
  const completionFilePath = getCompletionScriptPath(shell);
  fs.writeFileSync(completionFilePath, completionFileContents(shell), "utf8");
  const { rcFilePath, rcFileChanged } = installShellIntegrationRc(shell);
  return { shell, completionFilePath, rcFilePath, rcFileChanged };
}

// Used by the shell-integration prompt's "I'll insert it myself" choice:
// sets up every managed file completion depends on, without touching the
// user's rc file at all — they're adding shellIntegrationRcBlock's line
// themselves.
export function installCompletionFilesOnly(shell: CompletionShell): void {
  ensureManagedShellFiles(shell);
  fs.writeFileSync(getCompletionScriptPath(shell), completionFileContents(shell), "utf8");
}

// Removes only the completion file. Deliberately leaves the rc file (and
// wsmrc.<shell>/commands.sh) untouched — unlike the old completion-only
// mechanism this replaced, the shared pipe may still be serving custom
// commands even after tab-completion itself is turned off, so tearing it
// down here would silently break those. See AGENTS.md.
export function uninstallCompletion(shell: CompletionShell): void {
  const completionFilePath = getCompletionScriptPath(shell);
  if (fs.existsSync(completionFilePath)) fs.unlinkSync(completionFilePath);
}

// Used by `wsm update` after installing a new binary: re-applies the
// completion install only if the user has it enabled, and only for a
// detected shell — a no-op otherwise, so an update never fails or errors
// out over an unrelated/unsupported completion setup.
export function refreshInstalledCompletion(autocompleteEnabled: boolean): void {
  if (!autocompleteEnabled) return;
  const shell = detectShell();
  if (!shell) return;
  installCompletion(shell);
}
