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

// Generates plain POSIX shell function definitions, one per command. The
// command is the literal function *body*, embedded byte-for-byte — there
// is no automatic "$@" forwarding — so it can be anything from a single
// passthrough command (write `"$@"` yourself, same as a hand-written
// function) to a full multi-line function with local variables, control
// flow, or a heredoc (e.g. pasted straight out of an existing rc file).
// Deliberately not re-indented: an earlier version added a couple of
// spaces to every line for readability, but that's not safe for arbitrary
// shell — it silently breaks a heredoc's terminator (which must land at
// an exact, unindented-unless-`<<-` column) and would inject whitespace
// into any multi-line string literal's continuation lines. Invalid
// entries (e.g. from a hand-edited config.yaml) are silently skipped
// rather than throwing — this runs on every shell startup, and an
// exception here would break the eval and the user's whole shell prompt.
export function customCommandsScript(commands: CustomCommand[]): string {
  return commands
    .filter((c) => isValidCustomCommandName(c.name) && c.command.trim())
    .map((c) => `${c.name}() {\n${c.command}\n}\n`)
    .join("");
}
