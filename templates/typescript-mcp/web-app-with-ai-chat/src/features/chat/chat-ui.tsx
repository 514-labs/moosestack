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
import { MessageSquare, X, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ChatOutputArea } from "./chat-output-area";
import { ChatInput } from "./chat-input";
import { SuggestedPrompt } from "./suggested-prompt";
import { useAnthropicStatus } from "./use-anthropic-status";

function MissingKeyMessage() {
  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 max-w-md mx-4 text-center shadow-lg">
        <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">Anthropic Key Missing</h3>
        <p className="text-muted-foreground mb-4">
          Please set the ANTHROPIC_API_KEY environment variable to use the chat
          feature.
        </p>
      </div>
    </div>
  );
}

type ChatUIProps = {
  onClose?: () => void;
};

export function ChatUI({ onClose }: ChatUIProps) {
  const { data: anthropicStatus, isLoading: isStatusLoading } =
    useAnthropicStatus();
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
  const showKeyMissingOverlay =
    !isStatusLoading &&
    anthropicStatus &&
    !anthropicStatus.anthropicKeyAvailable;

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
          <div className="space-y-4 py-4 pl-2 pr-6">
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

      {/* Overlay when Anthropic key is missing */}
      {showKeyMissingOverlay && <MissingKeyMessage />}
    </div>
  );
}
