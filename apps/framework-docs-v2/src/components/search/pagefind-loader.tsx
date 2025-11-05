"use client";

import { useEffect } from "react";
import Script from "next/script";

export function PagefindLoader() {
  return (
    <Script
      src="/pagefind/pagefind.js"
      strategy="lazyOnload"
      onLoad={() => {
        console.log("Pagefind loaded");
      }}
    />
  );
}
