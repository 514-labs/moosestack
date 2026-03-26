"use client";

import ResizableChatLayout from "@/components/layout/resizable-chat-layout";
import { ChatButton } from "@/features/chat";
import { ContentHeader } from "./content-header";

export function ChatLayoutWrapper({ children }: { children: React.ReactNode }) {
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
