"use client";

import type { UIMessage } from "@ai-sdk/react";
import type { ChatStatus } from "ai";
import { AlertTriangle, Loader2, MessageSquareMore } from "lucide-react";
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
  Message,
  MessageContent,
  MessageResponse,
} from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import { cn } from "@/lib/utils";
import { ToolInvocation } from "../../renderers/tools/tool-invocation";
import {
  createMessagePartKeyFactory,
  extractTextFromParts,
  getReasoningText,
  isReasoningPart,
  isSourcePart,
  isToolPart,
  type SourcePart,
  type ToolTimingPayload,
} from "../../types/message-parts";

type ChatThreadProps = {
  messages: UIMessage[];
  status?: ChatStatus;
  errorMessage?: string | null;
  toolTimings?: Record<string, ToolTimingPayload>;
};

function MessageSources({ parts }: { parts: SourcePart[] }) {
  if (parts.length === 0) {
    return null;
  }

  return (
    <Sources className="rounded-2xl border border-border/70 bg-background/70 px-4 py-3 text-foreground">
      <SourcesTrigger count={parts.length} />
      <SourcesContent>
        {parts.map((part) => {
          const href = part.source?.url;
          if (!href) {
            return null;
          }

          let title = part.source?.title;
          if (!title) {
            try {
              title = new URL(href).hostname;
            } catch {
              title = "Source";
            }
          }

          return <Source key={`${href}:${title}`} href={href} title={title} />;
        })}
      </SourcesContent>
    </Sources>
  );
}

function collectParts<T>(
  parts: readonly unknown[],
  predicate: (part: unknown) => part is T,
) {
  const collected: T[] = [];

  for (const part of parts) {
    if (predicate(part)) {
      collected.push(part);
    }
  }

  return collected;
}

function UserBubble({ message }: { message: UIMessage }) {
  return (
    <Message from="user">
      <MessageContent>
        <div className="whitespace-pre-wrap leading-relaxed">
          {extractTextFromParts(message.parts) || "Message unavailable"}
        </div>
      </MessageContent>
    </Message>
  );
}

function AssistantBubble({
  message,
  toolTimings = {},
}: {
  message: UIMessage;
  toolTimings?: Record<string, ToolTimingPayload>;
}) {
  const parts = message.parts ?? [];
  const text = extractTextFromParts(parts);
  const sourceParts = collectParts(parts, isSourcePart);
  const reasoningParts = collectParts(parts, isReasoningPart);
  const toolParts = collectParts(parts, isToolPart);
  const getPartKey = createMessagePartKeyFactory(message.id);

  return (
    <Message from="assistant" className="max-w-full">
      <MessageSources parts={sourceParts} />

      {reasoningParts.map((part) => {
        const reasoningText = getReasoningText(part);
        if (!reasoningText) {
          return null;
        }

        return (
          <Reasoning key={getPartKey(part)} defaultOpen={false}>
            <ReasoningTrigger />
            <ReasoningContent>{reasoningText}</ReasoningContent>
          </Reasoning>
        );
      })}

      <MessageContent className="w-full max-w-full space-y-3">
        {text ?
          <MessageResponse>{text}</MessageResponse>
        : null}
        {toolParts.map((part) => {
          const timing =
            part.toolCallId ?
              toolTimings[part.toolCallId]?.duration
            : undefined;
          return (
            <ToolInvocation
              key={getPartKey(part)}
              part={part}
              timing={timing}
            />
          );
        })}
      </MessageContent>
    </Message>
  );
}

function StreamingIndicator() {
  return (
    <Message from="assistant">
      <MessageContent className="rounded-2xl border border-dashed border-border/70 bg-background/40 px-4 py-3 text-muted-foreground">
        <div className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" />
          <span>Waiting for the model response...</span>
        </div>
      </MessageContent>
    </Message>
  );
}

function ErrorBubble({ message }: { message: string }) {
  return (
    <Message from="assistant">
      <MessageContent className="w-full rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-red-900 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-100">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div className="space-y-1">
            <div className="font-medium">Chat request failed</div>
            <div className="text-sm leading-relaxed">{message}</div>
          </div>
        </div>
      </MessageContent>
    </Message>
  );
}

export function ChatThread({
  messages,
  status,
  errorMessage,
  toolTimings = {},
}: ChatThreadProps) {
  const showLoading =
    (status === "submitted" || status === "streaming") && messages.length > 0;

  return (
    <Conversation className="h-full min-h-0">
      <ConversationContent className="gap-6 px-4 py-5" scrollClassName="h-full">
        {messages.length === 0 ?
          <ConversationEmptyState
            icon={<MessageSquareMore className="size-5" />}
            title="Start a conversation..."
            description="Ask questions about the data that is currently in scope for this session."
          />
        : messages.map((message) => {
            if (message.role === "user") {
              return <UserBubble key={message.id} message={message} />;
            }

            return (
              <AssistantBubble
                key={message.id}
                message={message}
                toolTimings={toolTimings}
              />
            );
          })
        }

        {showLoading && <StreamingIndicator />}
        {errorMessage ?
          <ErrorBubble message={errorMessage} />
        : null}
      </ConversationContent>
      <ConversationScrollButton
        className={cn(
          "bottom-5 border-border/70 bg-background/90 text-foreground shadow-lg backdrop-blur",
        )}
      />
    </Conversation>
  );
}
