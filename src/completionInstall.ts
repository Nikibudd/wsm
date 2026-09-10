import fs from "node:fs";
import path from "node:path";
import { ensureConfigDir, getCompletionScriptPath, getRcFilePath, type CompletionShell } from "./paths.js";

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

const MARKER_START = "# >>> wsm completion >>>";
const MARKER_END = "# <<< wsm completion <<<";

function completionFileContents(shell: CompletionShell): string {
  return `eval "$(wsm completion ${shell})"\n`;
}

// The eval line above is the only thing that ever needs to live in the rc
// file — it re-invokes `wsm completion <shell>` fresh every time a new
// shell starts, so the actual completion script always reflects whatever
// wsm version is currently installed with zero further rc-file edits. The
// completion *file* wsm writes to disk is what installCompletion refreshes
// going forward (e.g. from `wsm update`); the rc file's one line never has
// to change again.
function rcBlock(shell: CompletionShell): string {
  const scriptPath = getCompletionScriptPath(shell);
  return `${MARKER_START}\n[ -f "${scriptPath}" ] && source "${scriptPath}"\n${MARKER_END}\n`;
}

function withCompletionBlock(existing: string, shell: CompletionShell): string {
  if (existing.length === 0) return rcBlock(shell);
  const normalized = existing.endsWith("\n") ? existing : existing + "\n";
  return `${normalized}\n${rcBlock(shell)}`;
}

function withoutCompletionBlock(contents: string): string {
  const startIdx = contents.indexOf(MARKER_START);
  if (startIdx === -1) return contents;
  const endIdx = contents.indexOf(MARKER_END, startIdx);
  if (endIdx === -1) return contents;
  let head = contents.slice(0, startIdx);
  let tail = contents.slice(endIdx + MARKER_END.length);
  if (tail.startsWith("\n")) tail = tail.slice(1);
  // Undo the blank-line separator withCompletionBlock adds before the block.
  if (head.endsWith("\n\n")) head = head.slice(0, -1);
  return head + tail;
}

export interface CompletionInstallResult {
  shell: CompletionShell;
  completionFilePath: string;
  rcFilePath: string;
  rcFileChanged: boolean;
}

// Idempotent and safe to call repeatedly (e.g. from `wsm update`, every
// time): the completion file is always (re)written — cheap, deterministic,
// and how the completion mechanism stays current without ever touching the
// rc file again — while the rc file itself is only touched the first time,
// when its marker block isn't already present.
export function installCompletion(shell: CompletionShell): CompletionInstallResult {
  ensureConfigDir();
  const completionFilePath = getCompletionScriptPath(shell);
  fs.writeFileSync(completionFilePath, completionFileContents(shell), "utf8");

  const rcFilePath = getRcFilePath(shell);
  const existing = fs.existsSync(rcFilePath) ? fs.readFileSync(rcFilePath, "utf8") : "";
  const rcFileChanged = !existing.includes(MARKER_START);
  if (rcFileChanged) {
    fs.mkdirSync(path.dirname(rcFilePath), { recursive: true });
    fs.writeFileSync(rcFilePath, withCompletionBlock(existing, shell), "utf8");
  }

  return { shell, completionFilePath, rcFilePath, rcFileChanged };
}

export function uninstallCompletion(shell: CompletionShell): void {
  const rcFilePath = getRcFilePath(shell);
  if (fs.existsSync(rcFilePath)) {
    const contents = fs.readFileSync(rcFilePath, "utf8");
    const updated = withoutCompletionBlock(contents);
    if (updated !== contents) fs.writeFileSync(rcFilePath, updated, "utf8");
  }

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
