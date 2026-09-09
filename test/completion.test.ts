import { bashCompletionScript, zshCompletionScript } from "../src/completion.js";

describe("completion", () => {
  const commands = ["open", "close", "list", "status"];

  describe("bashCompletionScript", () => {
    test("completes the subcommand position from the given command list", () => {
      const script = bashCompletionScript(commands);
      expect(script).toContain('compgen -W "open close list status"');
    });

    test("completes workspace names after open/close via `wsm list --names-only`", () => {
      const script = bashCompletionScript(commands);
      expect(script).toMatch(/open\|close\)[\s\S]*wsm list --names-only/);
    });

    test("registers the completion function for the wsm command", () => {
      const script = bashCompletionScript(commands);
      expect(script).toContain("complete -F _wsm_completions wsm");
    });
  });

  describe("zshCompletionScript", () => {
    test("declares itself as a completion definition for wsm", () => {
      const script = zshCompletionScript(commands);
      expect(script).toContain("#compdef wsm");
    });

    test("offers the given subcommands and defers workspace names to `wsm list --names-only`", () => {
      const script = zshCompletionScript(commands);
      expect(script).toContain("'open' 'close' 'list' 'status'");
      expect(script).toContain("wsm list --names-only");
    });
  });
});
