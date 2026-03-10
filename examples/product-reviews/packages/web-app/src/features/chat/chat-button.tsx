"use client";

import { useChatLayout } from "@/components/layout/resizable-chat-layout";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";

export function ChatButton() {
  const { toggleChat, isChatOpen } = useChatLayout();

  // Hide chat button when chat is open
  if (isChatOpen) {
    return null;
  }

  return (
    <Button
      onClick={toggleChat}
      size="lg"
      className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-50"
      aria-label="Open chat"
    >
      <MessageSquare className="size-6" />
    </Button>
  );
}
