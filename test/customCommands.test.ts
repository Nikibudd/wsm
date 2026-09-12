import { isValidCustomCommandName, customCommandsScript } from "../src/customCommands.js";

describe("customCommands", () => {
  describe("isValidCustomCommandName", () => {
    // Real shells are more permissive about function names than about
    // variable/identifier names — bash and zsh both accept hyphens (e.g.
    // `vscode-close-here`, a real function pulled from an rc file while
    // building this feature), so the allowed set has to match that, not the
    // stricter identifier rule variables use.
    test("accepts letters, digits, underscores, and hyphens not starting with a digit or hyphen", () => {
      expect(isValidCustomCommandName("logs")).toBe(true);
      expect(isValidCustomCommandName("db_logs2")).toBe(true);
      expect(isValidCustomCommandName("_private")).toBe(true);
      expect(isValidCustomCommandName("vscode-close-here")).toBe(true);
    });

    // Characters that could break out of the generated `name() { ... }`
    // line and inject arbitrary shell (parens, braces, quotes, whitespace,
    // semicolons, $) must stay rejected even though hyphens are now allowed.
    test("rejects names that aren't valid shell function names", () => {
      expect(isValidCustomCommandName("2fast")).toBe(false);
      expect(isValidCustomCommandName("-leading-hyphen")).toBe(false);
      expect(isValidCustomCommandName("has space")).toBe(false);
      expect(isValidCustomCommandName("semi;colon")).toBe(false);
      expect(isValidCustomCommandName("$(injection)")).toBe(false);
      expect(isValidCustomCommandName("")).toBe(false);
    });
  });

  describe("customCommandsScript", () => {
    // No automatic "$@" forwarding: `command` is the literal function body,
    // verbatim — this is what makes multi-line bodies (local vars, if/case,
    // the user's own $1/$@ handling) work at all. A simple passthrough
    // command just includes "$@" itself, same as writing a real shell
    // function by hand.
    test("wraps each command as the literal, indented function body", () => {
      const script = customCommandsScript([
        { name: "logs", command: 'docker compose logs -f "$@"' },
        { name: "psql", command: "psql -h localhost mydb" },
      ]);
      expect(script).toContain('logs() {\n  docker compose logs -f "$@"\n}');
      expect(script).toContain("psql() {\n  psql -h localhost mydb\n}");
    });

    test("preserves a multi-line body, indenting every non-blank line and leaving blank lines empty", () => {
      const script = customCommandsScript([
        {
          name: "greet",
          command: 'local who="${1:-world}"\n\nif [ -n "$who" ]; then\n  echo "hi $who"\nfi',
        },
      ]);
      expect(script).toBe(
        'greet() {\n  local who="${1:-world}"\n\n  if [ -n "$who" ]; then\n    echo "hi $who"\n  fi\n}\n',
      );
    });

    test("returns an empty string for no commands", () => {
      expect(customCommandsScript([])).toBe("");
    });

    // wsm commands runs on every shell startup via `eval "$(wsm commands)"` —
    // a bad entry here (e.g. hand-edited config.yaml) must never break the
    // whole eval and lock someone out of their shell, so invalid names are
    // silently dropped rather than throwing.
    test("silently skips entries with an invalid shell function name instead of throwing", () => {
      const script = customCommandsScript([
        { name: "2bad", command: "echo nope" },
        { name: "ok", command: "echo fine" },
      ]);
      expect(script).not.toContain("2bad");
      expect(script).toContain("ok() {\n  echo fine\n}");
    });
  });
});
