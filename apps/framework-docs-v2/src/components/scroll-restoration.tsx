"use client";

import { useEffect } from "react";

/**
 * Disables browser scroll restoration to prevent scroll bounce
 * when navigating to the top of the page.
 */
export function ScrollRestoration() {
  useEffect(() => {
    // Disable automatic scroll restoration
    if ("scrollRestoration" in history) {
      history.scrollRestoration = "manual";
    }
  }, []);

  return null;
}
