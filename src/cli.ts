#!/usr/bin/env node
import { Command } from "commander";
import { openWorkspace, closeWorkspaces, statusReport, pruneDeadSessions } from "./launcher.js";
import { loadConfig, workspaceNames, getSettings } from "./config.js";
import { loadState, saveState } from "./state.js";
import { runTui } from "./tui/index.js";
import { bashCompletionScript, zshCompletionScript } from "./completion.js";

const program = new Command();

program
  .name("wsm")
  .description("Fast CLI workspace switcher for coding projects (run with no args for the config TUI)")
  .version("1.0.0");

program
  .command("open <name>")
  .description(
    "Open a configured workspace (closes any currently open workspace first, unless configured otherwise)",
  )
  .option("--close", "close the currently open workspace(s) first, overriding the configured default")
  .option(
    "--no-close",
    "keep the currently open workspace(s) running instead of closing them, overriding the configured default",
  )
  .action(async (name: string, options: { close?: boolean }) => {
    try {
      await openWorkspace(name, { close: options.close });
    } catch (err) {
      console.error((err as Error).message);
      process.exitCode = 1;
    }
  });

program
  .command("close [name]")
  .description("Close the current open workspace, or a specific one by name")
  .option("--all", "close every currently open workspace")
  .action(async (name: string | undefined, options: { all?: boolean }) => {
    await closeWorkspaces({ name, all: options.all });
  });

program
  .command("list")
  .alias("ls")
  .description("List configured workspaces")
  .option("--names-only", "print just the workspace names, one per line (for shell completion)")
  .action((options: { namesOnly?: boolean }) => {
    const config = loadConfig();
    if (options.namesOnly) {
      for (const name of workspaceNames(config)) console.log(name);
      return;
    }
    if (config.workspaces.length === 0) {
      console.log('No workspaces configured yet. Run "wsm" to create one.');
      return;
    }
    for (const ws of config.workspaces) {
      console.log(`${ws.name}  (${ws.items.length} item(s))`);
    }
  });

program
  .command("status")
  .description("Show currently open workspace(s)")
  .action(() => {
    const settings = getSettings(loadConfig());
    let state = loadState();
    if (settings.autoPruneStaleSessions) {
      const result = pruneDeadSessions(state);
      state = result.state;
      if (result.pruned.length > 0) {
        saveState(state);
        for (const p of result.pruned) console.log(`Pruned stale session item: ${p.workspace} › ${p.item}`);
      }
    }
    console.log(statusReport(state));
  });

program
  .command("completion <shell>")
  .description("Print a shell completion script for bash or zsh (eval it in your rc file)")
  .action((shell: string) => {
    const commandNames = program.commands.map((c) => c.name());
    // Derived from each command's own declared arguments (rather than
    // hardcoded in the completion templates) so a future command taking a
    // workspace name picks up name-completion automatically.
    const nameArgCommands = program.commands
      .filter((c) => c.registeredArguments.some((a) => a.name() === "name"))
      .map((c) => c.name());
    if (shell === "bash") {
      console.log(bashCompletionScript(commandNames, nameArgCommands));
    } else if (shell === "zsh") {
      console.log(zshCompletionScript(commandNames, nameArgCommands));
    } else {
      console.error(`Unsupported shell "${shell}". Expected "bash" or "zsh".`);
      process.exitCode = 1;
    }
  });

async function main() {
  if (process.argv.length <= 2) {
    await runTui();
    return;
  }
  await program.parseAsync(process.argv);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
