import { isValidCustomCommandName, customCommandsScript } from "../src/customCommands.js";

describe("customCommands", () => {
  describe("isValidCustomCommandName", () => {
    test("accepts letters, digits, and underscores not starting with a digit", () => {
      expect(isValidCustomCommandName("logs")).toBe(true);
      expect(isValidCustomCommandName("db_logs2")).toBe(true);
      expect(isValidCustomCommandName("_private")).toBe(true);
    });

    test("rejects names that aren't valid shell function identifiers", () => {
      expect(isValidCustomCommandName("2fast")).toBe(false);
      expect(isValidCustomCommandName("has space")).toBe(false);
      expect(isValidCustomCommandName("has-dash")).toBe(false);
      expect(isValidCustomCommandName("")).toBe(false);
    });
  });

  describe("customCommandsScript", () => {
    test("generates one shell function per command, forwarding extra args via \"$@\"", () => {
      const script = customCommandsScript([
        { name: "logs", command: "docker compose logs -f" },
        { name: "psql", command: "psql -h localhost mydb" },
      ]);
      expect(script).toContain('logs() {\n  docker compose logs -f "$@"\n}');
      expect(script).toContain('psql() {\n  psql -h localhost mydb "$@"\n}');
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
      expect(script).toContain('ok() {\n  echo fine "$@"\n}');
    });
  });
});
