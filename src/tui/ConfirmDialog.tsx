import React from "react";
import { Box, Text, useInput, useStdout } from "ink";

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
      borderColor="red"
      paddingX={2}
      paddingY={1}
      width={width}
    >
      <Text bold color="red">
        {title}
      </Text>
      <Box height={1} />
      <Text>{message}</Text>
      <Box height={1} />
      <Text dimColor>y confirm · n / esc cancel</Text>
    </Box>
  );
}
