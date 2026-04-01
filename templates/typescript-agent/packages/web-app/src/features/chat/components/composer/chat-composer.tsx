"use client";

import type { ChatStatus } from "ai";
import { Trash2 } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputProvider,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
  usePromptInputController,
} from "@/components/ai-elements/prompt-input";

type ChatComposerProps = {
  onSubmit: (text: string) => void;
  onStop: () => void;
  status: ChatStatus;
  onClear?: () => void;
  hasMessages?: boolean;
};

function ChatComposerFrame({
  onSubmit,
  onStop,
  status,
  onClear,
  hasMessages = false,
}: ChatComposerProps) {
  const { textInput } = usePromptInputController();
  const canSubmit = textInput.value.trim().length > 0;
  const isStreaming = status === "submitted" || status === "streaming";

  return (
    <PromptInput
      className="w-full"
      onSubmit={({ text }) => {
        const nextMessage = text.trim();
        if (!nextMessage) {
          return;
        }

        onSubmit(nextMessage);
      }}
    >
      <PromptInputBody>
        <PromptInputTextarea
          className="min-h-20 bg-background/80"
          disabled={isStreaming}
          placeholder="Ask a question about this tenant..."
        />
      </PromptInputBody>

      <PromptInputFooter className="items-center gap-3 border-t border-border/70 px-3 py-2">
        <PromptInputTools>
          {onClear && hasMessages ?
            <PromptInputButton
              disabled={isStreaming}
              onClick={onClear}
              tooltip="Clear conversation"
            >
              <Trash2 className="size-4" />
            </PromptInputButton>
          : null}
        </PromptInputTools>

        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">
            Enter to send, Shift+Enter for new line
          </span>
          <PromptInputSubmit
            disabled={!isStreaming && !canSubmit}
            onStop={onStop}
            status={status}
          />
        </div>
      </PromptInputFooter>
    </PromptInput>
  );
}

export function ChatComposer(props: ChatComposerProps) {
  return (
    <PromptInputProvider>
      <ChatComposerFrame {...props} />
    </PromptInputProvider>
  );
}
