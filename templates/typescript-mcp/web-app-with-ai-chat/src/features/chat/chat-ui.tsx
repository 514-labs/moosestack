/**
 * Chat UI Component
 *
 * The main chat interface with all chat logic and state management.
 * Handles useChat hook, message streaming, tool timings, and auto-scroll.
 */

"use client";

import * as React from "react";
import { useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { MessageSquare, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatOutputArea } from "./chat-output-area";
import { ChatInput } from "./chat-input";
import { SuggestedPrompt } from "./suggested-prompt";

type ChatUIProps = {
  onClose?: () => void;
};

export function ChatUI({ onClose }: ChatUIProps) {
  const [toolTimings, setToolTimings] = useState<Record<string, number>>({});
  const scrollAreaRef = React.useRef<HTMLDivElement>(null);

  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
    onData: (data: any) => {
      if (data.type === "data-tool-timing") {
        const { toolCallId, duration } = data.data as {
          toolCallId: string;
          duration: number;
        };
        setToolTimings((prev) => ({
          ...prev,
          [toolCallId]: duration,
        }));
      }
    },
  });

  // Scroll to bottom when new messages arrive
  React.useEffect(() => {
    if (scrollAreaRef.current) {
      const scrollContainer = scrollAreaRef.current.querySelector(
        "[data-radix-scroll-area-viewport]",
      );
      if (scrollContainer) {
        scrollContainer.scrollTop = scrollContainer.scrollHeight;
      }
    }
  }, [messages, status]);

  const handleSuggestedPromptClick = (prompt: string) => {
    sendMessage({ text: prompt });
  };

  const handleSendMessage = (text: string) => {
    sendMessage({ text });
  };

  const handleClearConversation = () => {
    setMessages([]);
    setToolTimings({});
  };

  const isEmptyState = messages.length === 0;

  return (
    <div className="w-full h-full flex flex-col bg-sidebar text-foreground overflow-hidden relative">
      {/* Header */}
      <div className="flex-none py-3 px-4">
        <div className="flex items-center justify-between text-sm font-medium">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-4 h-4 text-primary" />
            <span>Chat</span>
          </div>
          {onClose && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onClose}
              className="h-6 w-6 p-0 hover:bg-accent"
            >
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
      </div>

      {/* Messages Area */}
      <div className="flex-1 min-h-0 overflow-hidden py-3">
        <ScrollArea ref={scrollAreaRef} className="h-full">
          <div className="space-y-4 py-4 px-6">
            <ChatOutputArea
              messages={messages}
              status={status}
              toolTimings={toolTimings}
            />
          </div>
        </ScrollArea>
      </div>

      {isEmptyState && (
        <SuggestedPrompt onPromptClick={handleSuggestedPromptClick} />
      )}

      <ChatInput
        sendMessage={handleSendMessage}
        status={status}
        onClear={handleClearConversation}
        hasMessages={messages.length > 0}
      />
    </div>
  );
}
