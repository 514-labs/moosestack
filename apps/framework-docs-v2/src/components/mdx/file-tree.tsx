"use client";

import React from "react";

interface FileTreeProps {
  children: React.ReactNode;
}

interface FileTreeFolderProps {
  name: string;
  children?: React.ReactNode;
}

interface FileTreeFileProps {
  name: string;
}

export function FileTree({ children }: FileTreeProps) {
  return <div className="my-4 font-mono text-sm">{children}</div>;
}

export function FileTreeFolder({ name, children }: FileTreeFolderProps) {
  return (
    <div className="ml-0">
      <div className="text-muted-foreground">{name}/</div>
      <div className="ml-4">{children}</div>
    </div>
  );
}

export function FileTreeFile({ name }: FileTreeFileProps) {
  return <div className="text-foreground">{name}</div>;
}

// Attach sub-components to FileTree for nested usage
(FileTree as any).Folder = FileTreeFolder;
(FileTree as any).File = FileTreeFile;
