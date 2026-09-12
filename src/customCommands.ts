import type { CustomCommand } from "./types.js";

// Same character set a shell function name is actually allowed to use.
// Enforced both here (defensively, since this runs on every shell startup
// via `eval "$(wsm commands)"`) and in the TUI form that creates entries.
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function isValidCustomCommandName(name: string): boolean {
  return NAME_PATTERN.test(name);
}

// Generates plain POSIX shell function definitions, one per command,
// forwarding any extra args the user types after the command name via
// "$@" (e.g. `logs -n 50` when `logs` wraps `docker compose logs -f`).
// Invalid entries (e.g. from a hand-edited config.yaml) are silently
// skipped rather than throwing — this runs on every shell startup, and an
// exception here would break the eval and the user's whole shell prompt.
export function customCommandsScript(commands: CustomCommand[]): string {
  return commands
    .filter((c) => isValidCustomCommandName(c.name) && c.command.trim())
    .map((c) => `${c.name}() {\n  ${c.command} "$@"\n}\n`)
    .join("");
}
