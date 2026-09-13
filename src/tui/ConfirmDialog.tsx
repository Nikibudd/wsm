import React from "react";
import { Box, Text, useInput, useStdout } from "ink";
import { useTheme } from "./ThemeContext.js";

export function ConfirmDialog({
  title = "Confirm",
  message,
  onConfirm,
  onCancel,
}: {
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { stdout } = useStdout();
  const theme = useTheme();
  const width = Math.max(30, Math.min(54, (stdout?.columns || 80) - 4));

  useInput((input, key) => {
    if (key.return || input.toLowerCase() === "y") {
      onConfirm();
      return;
    }
    if (key.escape || input.toLowerCase() === "n") {
      onCancel();
    }
  });

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={theme.danger}
      paddingX={2}
      paddingY={1}
      width={width}
    >
      <Text bold color={theme.danger}>
        {title}
      </Text>
      <Box height={1} />
      <Text>{message}</Text>
      <Box height={1} />
      <Text dimColor>y confirm · n / esc cancel</Text>
    </Box>
  );
}

// The one-time, generalized shell-integration prompt (tab-completion +
// custom commands both depend on the same rc-file line — see AGENTS.md).
// Three outcomes, not two: wsm can add the line itself, the user can copy
// rcBlock and add it themselves (shown inline so there's something to
// select/copy from the terminal), or they can skip entirely — any of the
// three sets shellIntegrationPrompted so this never fires again.
export function ShellIntegrationPrompt({
  rcFileName,
  rcBlock,
  onInsert,
  onManual,
  onSkip,
}: {
  rcFileName: string;
  rcBlock: string;
  onInsert: () => void;
  onManual: () => void;
  onSkip: () => void;
}) {
  const { stdout } = useStdout();
  const theme = useTheme();
  const width = Math.max(40, Math.min(70, (stdout?.columns || 80) - 4));

  useInput((input, key) => {
    const lower = input.toLowerCase();
    if (lower === "y") {
      onInsert();
      return;
    }
    if (lower === "m") {
      onManual();
      return;
    }
    if (key.escape || lower === "n") {
      onSkip();
    }
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor={theme.accent} paddingX={2} paddingY={1} width={width}>
      <Text bold color={theme.accent}>
        Shell integration
      </Text>
      <Box height={1} />
      <Text>
        wsm can enable tab-completion and custom shell commands (see the "Custom Commands" screen) by
        sourcing one managed file from {rcFileName}. It's the only line ever added there — everything
        wsm changes afterward happens in files it manages itself.
      </Text>
      <Box height={1} />
      {rcBlock
        .trim()
        .split("\n")
        .map((line, i) => (
          <Text key={i} dimColor>
            {line}
          </Text>
        ))}
      <Box height={1} />
      <Text dimColor>y insert it for me · m I'll insert it myself · n / esc skip for now</Text>
    </Box>
  );
}
