#!/usr/bin/env node
import { Command } from "commander";
import { openWorkspace, closeWorkspaces, statusReport } from "./launcher.js";
import { loadConfig, workspaceNames } from "./config.js";
import { runTui } from "./tui/index.js";
import { bashCompletionScript, zshCompletionScript } from "./completion.js";

const program = new Command();

program
  .name("wsm")
  .description("Fast CLI workspace switcher for coding projects (run with no args for the config TUI)")
  .version("1.0.0");

program
  .command("open <name>")
  .description("Open a configured workspace, closing any currently open workspace first")
  .option("--no-close", "keep the currently open workspace(s) running instead of closing them")
  .action(async (name: string, options: { close: boolean }) => {
    try {
      await openWorkspace(name, { noClose: !options.close });
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
    console.log(statusReport());
  });

program
  .command("completion <shell>")
  .description("Print a shell completion script for bash or zsh (eval it in your rc file)")
  .action((shell: string) => {
    const commandNames = program.commands.map((c) => c.name());
    if (shell === "bash") {
      console.log(bashCompletionScript(commandNames));
    } else if (shell === "zsh") {
      console.log(zshCompletionScript(commandNames));
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
