"use client";

import React from "react";
import {
  Snippet,
  SnippetCopyButton,
  SnippetHeader,
  SnippetTabsContent,
  SnippetTabsList,
  SnippetTabsTrigger,
} from "@/components/ui/snippet";

interface ShellSnippetProps {
  code: string;
  language: string;
}

/**
 * Client component for shell/terminal code snippets
 * Displays with "Terminal" label and copy button
 */
export function ShellSnippet({ code, language }: ShellSnippetProps) {
  const [value, setValue] = React.useState("terminal");

  return (
    <Snippet value={value} onValueChange={setValue}>
      <SnippetHeader>
        <SnippetTabsList>
          <SnippetTabsTrigger value="terminal">Terminal</SnippetTabsTrigger>
        </SnippetTabsList>
        <SnippetCopyButton value={code} />
      </SnippetHeader>
      <SnippetTabsContent value="terminal">{code}</SnippetTabsContent>
    </Snippet>
  );
}
