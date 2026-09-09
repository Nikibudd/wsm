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
