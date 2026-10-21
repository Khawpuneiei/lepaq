"use client";

import { usePathname } from "next/navigation";
import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ReactNode } from "react";

/**
 * Light is the default, dark is a toggle (spec 8.1). The persona reads long
 * summaries and transcripts in daytime offices; dark photographs better than
 * it reads.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // The /demo walkthrough is a film of the deck-matched light theme. Forcing
  // it here, rather than calling setTheme, leaves the viewer's saved choice
  // alone for the rest of the app.
  const forcedTheme = usePathname().startsWith("/demo") ? "light" : undefined;

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="light"
      enableSystem={false}
      forcedTheme={forcedTheme}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
