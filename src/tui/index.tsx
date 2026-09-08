import React from "react";
import { render } from "ink";
import { App } from "./App.js";

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[2J\x1b[H\x1b[?25l";
const EXIT_ALT_SCREEN = "\x1b[?25h\x1b[?1049l";

export async function runTui(): Promise<void> {
  const isTty = process.stdout.isTTY;
  if (isTty) process.stdout.write(ENTER_ALT_SCREEN);

  const restore = () => {
    if (isTty) process.stdout.write(EXIT_ALT_SCREEN);
  };
  process.once("exit", restore);

  const { waitUntilExit } = render(<App />);
  try {
    await waitUntilExit();
  } finally {
    restore();
  }
}
