"use client";

import type { JSX, ReactNode } from "react";
import ResizableChatLayout from "@/components/layout/resizable-chat-layout";
import { ChatButton } from "@/features/chat";
import { ContentHeader } from "./content-header";

interface ChatLayoutWrapperProps {
  children: ReactNode;
}

export function ChatLayoutWrapper({
  children,
}: ChatLayoutWrapperProps): JSX.Element {
  return (
    <ResizableChatLayout className="h-screen">
      <div className="flex flex-col h-full overflow-y-auto">
        <ContentHeader />
        <main className="bg-background">{children}</main>
        <ChatButton />
      </div>
    </ResizableChatLayout>
  );
}
