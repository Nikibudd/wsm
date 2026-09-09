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

    test("registers _wsm with zsh's completion system via compdef, not just invoking it once", () => {
      // A bare `_wsm` call at eval time runs the function once outside any
      // completion context and does nothing useful; `compdef _wsm wsm` is
      // what actually wires it up so Tab triggers it later.
      const script = zshCompletionScript(commands);
      expect(script).toContain("compdef _wsm wsm");
    });

    test("guards the compdef call so it degrades gracefully when compinit hasn't run", () => {
      // `compdef` only exists once `autoload -Uz compinit && compinit` has
      // run; calling it unconditionally errors with "command not found:
      // compdef" on any zsh setup that hasn't initialized completion yet.
      const script = zshCompletionScript(commands);
      expect(script).toContain("(( $+functions[compdef] ))");
      expect(script).toContain("compinit");
    });

    test("offers the given subcommands and defers workspace names to `wsm list --names-only`", () => {
      const script = zshCompletionScript(commands);
      expect(script).toContain("'open' 'close' 'list' 'status'");
      expect(script).toContain("wsm list --names-only");
    });
  });
});
