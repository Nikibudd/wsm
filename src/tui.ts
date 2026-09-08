import { select, input, confirm } from "@inquirer/prompts";
import { loadConfig, saveConfig } from "./config.js";
import type { Config, Workspace, WorkspaceItem, ItemType } from "./types.js";

const BACK = "__back__";
const ADD = "__add__";
const EXIT = "__exit__";
const DELETE = "__delete__";
const RENAME = "__rename__";
const SET_CWD = "__set_cwd__";

function isExitPrompt(err: unknown): boolean {
  return err instanceof Error && err.name === "ExitPromptError";
}

async function promptItemFields(existing?: WorkspaceItem): Promise<WorkspaceItem | undefined> {
  try {
    const name = await input({
      message: "Item name",
      default: existing?.name,
      validate: (v) => (v.trim().length > 0 ? true : "Name cannot be empty"),
    });

    const type = (await select({
      message: "Type",
      default: existing?.type ?? "app",
      choices: [
        { name: "App (GUI app, e.g. VS Code, IntelliJ, Ghostty, MongoDB Compass)", value: "app" },
        { name: "Command (shell command, e.g. docker compose up -d)", value: "command" },
      ],
    })) as ItemType;

    const launch = await input({
      message:
        type === "app"
          ? 'Launch command (e.g. "code .", "open -a Ghostty", \'open -a IntelliJ\\ IDEA .\')'
          : "Launch command (e.g. docker compose up -d)",
      default: existing?.launch,
      validate: (v) => (v.trim().length > 0 ? true : "Launch command cannot be empty"),
    });

    const cwd = await input({
      message: "Working directory for this item (blank = use workspace default)",
      default: existing?.cwd ?? "",
    });

    const closeStrategy = await select({
      message: "How should this be closed when switching workspaces?",
      default: existing?.closeAppName ? "app" : existing?.close ? "command" : "process",
      choices: [
        { name: "Quit a macOS app by name (osascript)", value: "app" },
        { name: "Run a custom close/stop command", value: "command" },
        { name: "Terminate the launched process directly", value: "process" },
        { name: "Leave it running (don't auto-close)", value: "none" },
      ],
    });

    let close: string | undefined;
    let closeAppName: string | undefined;
    if (closeStrategy === "app") {
      closeAppName = await input({
        message: 'macOS application name, exactly as in Finder (e.g. "Visual Studio Code")',
        default: existing?.closeAppName ?? "",
      });
    } else if (closeStrategy === "command") {
      close = await input({
        message: "Close/stop command (e.g. docker compose down)",
        default: existing?.close ?? "",
      });
    }

    const delayStr = await input({
      message: "Delay after launching before starting the next item, in ms (blank = 0)",
      default: existing?.delayMs ? String(existing.delayMs) : "",
      validate: (v) => (v.trim() === "" || /^\d+$/.test(v.trim()) ? true : "Enter a number"),
    });

    const item: WorkspaceItem = {
      name: name.trim(),
      type,
      launch: launch.trim(),
    };
    if (cwd.trim()) item.cwd = cwd.trim();
    if (close && close.trim()) item.close = close.trim();
    if (closeAppName && closeAppName.trim()) item.closeAppName = closeAppName.trim();
    if (delayStr.trim()) item.delayMs = Number(delayStr.trim());

    return item;
  } catch (err) {
    if (isExitPrompt(err)) return undefined;
    throw err;
  }
}

async function editItemMenu(workspace: Workspace, index: number): Promise<void> {
  const item = workspace.items[index];
  const choice = await select({
    message: `Item "${item.name}"`,
    choices: [
      { name: "Edit fields", value: "edit" },
      { name: "Delete this item", value: DELETE },
      { name: "Back", value: BACK },
    ],
  });

  if (choice === BACK) return;
  if (choice === DELETE) {
    const sure = await confirm({ message: `Delete item "${item.name}"?`, default: false });
    if (sure) workspace.items.splice(index, 1);
    return;
  }
  if (choice === "edit") {
    const updated = await promptItemFields(item);
    if (updated) workspace.items[index] = updated;
  }
}

async function editWorkspaceMenu(config: Config, workspace: Workspace): Promise<void> {
  while (true) {
    const choice = await select({
      message: `Workspace "${workspace.name}"`,
      choices: [
        ...workspace.items.map((it, i) => ({
          name: `${i + 1}. ${it.name} [${it.type}] — ${it.launch}`,
          value: `item:${i}`,
        })),
        { name: "+ Add item", value: ADD },
        { name: "Set default working directory", value: SET_CWD },
        { name: "Rename workspace", value: RENAME },
        { name: "Delete workspace", value: DELETE },
        { name: "Back", value: BACK },
      ],
    });

    if (choice === BACK) return;

    if (choice === ADD) {
      const item = await promptItemFields();
      if (item) workspace.items.push(item);
      saveConfig(config);
      continue;
    }

    if (choice === SET_CWD) {
      const cwd = await input({
        message: "Default working directory for this workspace (e.g. ~/dev/my-project)",
        default: workspace.cwd ?? "",
      });
      workspace.cwd = cwd.trim() || undefined;
      saveConfig(config);
      continue;
    }

    if (choice === RENAME) {
      const name = await input({ message: "New name", default: workspace.name });
      if (name.trim()) workspace.name = name.trim();
      saveConfig(config);
      continue;
    }

    if (choice === DELETE) {
      const sure = await confirm({
        message: `Delete workspace "${workspace.name}"? This cannot be undone.`,
        default: false,
      });
      if (sure) {
        config.workspaces = config.workspaces.filter((w) => w !== workspace);
        saveConfig(config);
        return;
      }
      continue;
    }

    if (choice.startsWith("item:")) {
      const idx = Number(choice.slice(5));
      await editItemMenu(workspace, idx);
      saveConfig(config);
      continue;
    }
  }
}

async function addWorkspace(config: Config): Promise<void> {
  const name = await input({
    message: "New workspace name",
    validate: (v) => {
      if (!v.trim()) return "Name cannot be empty";
      if (config.workspaces.some((w) => w.name === v.trim())) return "A workspace with that name already exists";
      return true;
    },
  });
  const cwd = await input({
    message: "Default working directory for this workspace (e.g. ~/dev/my-project)",
    default: "",
  });
  const workspace: Workspace = { name: name.trim(), items: [] };
  if (cwd.trim()) workspace.cwd = cwd.trim();
  config.workspaces.push(workspace);
  saveConfig(config);
  await editWorkspaceMenu(config, workspace);
}

export async function runTui(): Promise<void> {
  const config = loadConfig();
  console.log("Workspace Manager — configuration TUI");
  console.log(`Config file: use "wsm open <name>" from any terminal to switch fast.\n`);

  try {
    while (true) {
      const choice = await select({
        message: "Select a workspace to edit, or:",
        choices: [
          ...config.workspaces.map((w) => ({
            name: `${w.name} (${w.items.length} item(s))`,
            value: `edit:${w.name}`,
          })),
          { name: "+ Add new workspace", value: ADD },
          { name: "Exit", value: EXIT },
        ],
      });

      if (choice === EXIT) return;
      if (choice === ADD) {
        await addWorkspace(config);
        continue;
      }
      if (choice.startsWith("edit:")) {
        const name = choice.slice(5);
        const workspace = config.workspaces.find((w) => w.name === name);
        if (workspace) await editWorkspaceMenu(config, workspace);
      }
    }
  } catch (err) {
    if (isExitPrompt(err)) {
      console.log("\nBye.");
      return;
    }
    throw err;
  }
}
