"use client";

import ResizableChatLayout from "@/components/layout/resizable-chat-layout";
import { ContentHeader } from "./content-header";
import { ChatButton } from "@/features/chat/chat-button";

export function ChatLayoutWrapper({ children }: { children: React.ReactNode }) {
  return (
    <ResizableChatLayout className="h-screen">
      <div className="flex flex-col min-h-screen">
        <ContentHeader />
        <main className="bg-background">{children}</main>
        <ChatButton />
      </div>
    </ResizableChatLayout>
  );
}
