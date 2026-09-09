import { createContext, useContext } from "react";
import type { ThemeColors } from "../theme.js";
import { DEFAULT_THEMES } from "../theme.js";

const ThemeContext = createContext<ThemeColors>(DEFAULT_THEMES[0]!.colors);

export const ThemeProvider = ThemeContext.Provider;

export function useTheme(): ThemeColors {
  return useContext(ThemeContext);
}
