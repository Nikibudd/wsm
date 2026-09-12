import type { CustomCommand } from "./types.js";

// Real shells accept more in a function name than in a variable name —
// bash and zsh both allow hyphens (e.g. `vscode-close-here`), unlike a
// plain identifier. This still excludes anything that could break out of
// the generated `name() { ... }` line and inject shell syntax (parens,
// braces, quotes, whitespace, semicolons, $, backticks, ...). Enforced both
// here (defensively, since this runs on every shell startup via
// `eval "$(wsm commands)"`) and in the TUI form that creates entries.
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

export function isValidCustomCommandName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

// Two-space indent for every non-blank line of a command body, so the
// generated function reads like hand-written shell rather than a wall of
// unindented statements. Blank lines are left empty rather than padded, to
// avoid littering trailing whitespace through the generated script.
function indentBody(command: string): string {
  return command
    .split("\n")
    .map((line) => (line.trim() ? `  ${line}` : ""))
    .join("\n");
}

// Generates plain POSIX shell function definitions, one per command. The
// command is the literal function *body*, verbatim — there is no automatic
// "$@" forwarding — so it can be anything from a single passthrough command
// (write `"$@"` yourself, same as a hand-written function) to a full
// multi-line function with local variables and control flow (e.g. pasted
// straight out of an existing rc file). Invalid entries (e.g. from a
// hand-edited config.yaml) are silently skipped rather than throwing — this
// runs on every shell startup, and an exception here would break the eval
// and the user's whole shell prompt.
export function customCommandsScript(commands: CustomCommand[]): string {
  return commands
    .filter((c) => isValidCustomCommandName(c.name) && c.command.trim())
    .map((c) => `${c.name}() {\n${indentBody(c.command)}\n}\n`)
    .join("");
}
