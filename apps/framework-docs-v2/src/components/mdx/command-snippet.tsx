"use client";

import * as React from "react";
import {
  Snippet,
  SnippetHeader,
  SnippetTabsList,
  SnippetTabsTrigger,
  SnippetTabsContent,
  SnippetCopyButton,
} from "@/components/ui/snippet";

interface CommandSnippetProps {
  initCommand?: string;
  listCommand?: string;
  initLabel?: string;
  listLabel?: string;
}

export function CommandSnippet({
  initCommand = "moose init PROJECT_NAME TEMPLATE_NAME",
  listCommand = "moose template list",
  initLabel = "Init",
  listLabel = "List",
}: CommandSnippetProps) {
  const [value, setValue] = React.useState("init");
  const currentCommand = value === "init" ? initCommand : listCommand;

  return (
    <Snippet value={value} onValueChange={setValue}>
      <SnippetHeader>
        <SnippetTabsList>
          <SnippetTabsTrigger value="init">{initLabel}</SnippetTabsTrigger>
          <SnippetTabsTrigger value="list">{listLabel}</SnippetTabsTrigger>
        </SnippetTabsList>
        <SnippetCopyButton value={currentCommand} />
      </SnippetHeader>
      <SnippetTabsContent value="init">{initCommand}</SnippetTabsContent>
      <SnippetTabsContent value="list">{listCommand}</SnippetTabsContent>
    </Snippet>
  );
}
