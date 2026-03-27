"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps, JSX } from "react";

type ThemeProviderProps = ComponentProps<typeof NextThemesProvider>;

export function ThemeProvider({
  children,
  ...props
}: ThemeProviderProps): JSX.Element {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
