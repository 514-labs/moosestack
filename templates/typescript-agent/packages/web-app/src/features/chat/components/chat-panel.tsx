"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { AlertTriangle, MessageSquare, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useChatProviderStatus } from "../hooks/use-chat-provider-status";
import { useToolTimings } from "../hooks/use-tool-timings";
import { isToolTimingEvent } from "../types/message-parts";
import { ChatComposer } from "./composer/chat-composer";
import { SuggestedPrompts } from "./composer/suggested-prompts";
import { ChatThread } from "./transcript/chat-thread";

function MissingProviderMessage() {
  const { data: status } = useChatProviderStatus();

  return (
    <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-background border rounded-lg p-6 max-w-md mx-4 text-center shadow-lg">
        <AlertTriangle className="w-8 h-8 text-yellow-500 mx-auto mb-4" />
        <h3 className="text-lg font-semibold mb-2">
          {status?.providerLabel ?? "LLM Provider"} Configuration Missing
        </h3>
        <p className="text-muted-foreground mb-4">
          {status?.details ??
            "Configure the selected provider environment variables before using the chat feature."}
        </p>
      </div>
    </div>
  );
}

type ChatPanelProps = {
  onClose?: () => void;
};

export function ChatPanel({ onClose }: ChatPanelProps) {
  const { data: providerStatus, isLoading: isStatusLoading } =
    useChatProviderStatus();
  const { toolTimings, handleToolTimingData, resetToolTimings } =
    useToolTimings();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { messages, sendMessage, status, setMessages, stop } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
    }),
    onData: (data) => {
      if (isToolTimingEvent(data)) {
        handleToolTimingData(data.data);
      }
    },
    onError: (error) => {
      setErrorMessage(error.message);
    },
  });

  const handleSuggestedPromptClick = (prompt: string) => {
    setErrorMessage(null);
    sendMessage({ text: prompt });
  };

  const handleSendMessage = (text: string) => {
    setErrorMessage(null);
    sendMessage({ text });
  };

  const handleClearConversation = () => {
    setMessages([]);
    resetToolTimings();
    setErrorMessage(null);
  };

  const isEmptyState = messages.length === 0;
  const showProviderMissingOverlay =
    !isStatusLoading && providerStatus && !providerStatus.providerReady;

  return (
    <div className="w-full h-full flex flex-col bg-sidebar text-foreground overflow-hidden relative">
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

      <div className="flex-1 min-h-0 overflow-hidden py-3">
        <ChatThread
          errorMessage={errorMessage}
          messages={messages}
          status={status}
          toolTimings={toolTimings}
        />
      </div>

      {isEmptyState && (
        <SuggestedPrompts onPromptClick={handleSuggestedPromptClick} />
      )}

      <div className="flex-none border-t border-border/60 bg-sidebar/95 px-4 py-4 backdrop-blur">
        <ChatComposer
          hasMessages={messages.length > 0}
          onClear={handleClearConversation}
          onStop={stop}
          onSubmit={handleSendMessage}
          status={status}
        />
      </div>

      {showProviderMissingOverlay && <MissingProviderMessage />}
    </div>
  );
}
