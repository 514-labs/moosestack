// Create a component that displays a heading with the mooseJS display style

import React from "react";

export default function Display({ children }: { children: React.ReactNode }) {
  return (
    <div className="text-6xl leading-10 tracking-tight sm:leading-none sm:text-9xl">
      {children}
    </div>
  );
}
