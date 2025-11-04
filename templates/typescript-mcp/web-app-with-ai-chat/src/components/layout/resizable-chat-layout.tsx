"use client";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import {
  ReactNode,
  useState,
  useRef,
  useEffect,
  useMemo,
  createContext,
  useContext,
} from "react";
import { ChatUI } from "@/features/chat/chat-ui";

type ResizableChatLayoutProps = {
  children: ReactNode;
  minChatWidthPX?: number;
  maxChatWidthPercent?: number;
  defaultChatWidthPercent?: number;
  className?: string;
};

type ChatLayoutContextType = {
  isChatOpen: boolean;
  toggleChat: () => void;
  closeChat: () => void;
};

const ChatLayoutContext = createContext<ChatLayoutContextType | null>(null);

export function useChatLayout() {
  const context = useContext(ChatLayoutContext);
  if (!context) {
    throw new Error("useChatLayout must be used within a ResizableChatLayout");
  }
  return context;
}

export default function ResizableChatLayout({
  children,
  minChatWidthPX = 400,
  maxChatWidthPercent = 40,
  defaultChatWidthPercent = 30,
  className = "h-full",
}: ResizableChatLayoutProps) {
  // Chat state management
  const [isChatOpen, setIsChatOpen] = useState(false);

  const toggleChat = () => {
    setIsChatOpen(!isChatOpen);
  };

  const closeChat = () => {
    setIsChatOpen(false);
    setLastChatSize(null);
  };

  // Panel sizing logic
  const chatPanelRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastChatSize, setLastChatSize] = useState<number | null>(null);

  // Always use defaultChatWidthPercent (30%) when opening
  // Only use lastChatSize if user has manually resized
  const targetChatSize = lastChatSize ?? defaultChatWidthPercent;

  const initialDefaultSize =
    isChatOpen ? (lastChatSize ?? defaultChatWidthPercent) : 0;

  const mainPanelDefaultSize = isChatOpen ? 100 - initialDefaultSize : 100;

  // Calculate minChatPercent only after mount to avoid hydration mismatch
  const [minChatPercent, setMinChatPercent] = useState(0);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setMinChatPercent(
        Math.max(0, (minChatWidthPX / window.innerWidth) * 100),
      );
    }
  }, [minChatWidthPX]);

  useEffect(() => {
    if (chatPanelRef.current) {
      if (isChatOpen) {
        chatPanelRef.current.resize(targetChatSize);
      } else {
        chatPanelRef.current.resize(0);
      }
    }
  }, [isChatOpen, targetChatSize]);

  const handlePanelResize = (size: number) => {
    if (isChatOpen && size > 0) {
      setLastChatSize(size);
    }
  };

  const contextValue = useMemo(
    () => ({
      isChatOpen,
      toggleChat,
      closeChat,
    }),
    [isChatOpen, toggleChat, closeChat],
  );

  return (
    <ChatLayoutContext.Provider value={contextValue}>
      <div ref={containerRef} className={className}>
        <style>
          {`
            .panel-group-animated [data-panel] {
              transition: all 300ms cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
            
            [data-panel-resize-handle] {
              transition: opacity 300ms cubic-bezier(0.4, 0, 0.2, 1) !important;
            }
          `}
        </style>
        <ResizablePanelGroup
          direction="horizontal"
          className={`relative ${!isDragging ? "panel-group-animated" : ""}`}
        >
          <ResizablePanel
            id="main-panel"
            defaultSize={mainPanelDefaultSize}
            order={1}
          >
            {children}
          </ResizablePanel>

          <ResizableHandle
            id="chat-handle"
            className={`transition-opacity duration-[300ms] ease-out w-[2px] ${
              isChatOpen ?
                "opacity-0 hover:opacity-100"
              : "opacity-0 pointer-events-none"
            }`}
            onDragging={setIsDragging}
          />

          <ResizablePanel
            ref={chatPanelRef}
            id="chat-panel"
            defaultSize={initialDefaultSize}
            minSize={isChatOpen ? minChatPercent : 0}
            maxSize={maxChatWidthPercent}
            order={2}
            onResize={handlePanelResize}
          >
            <div
              className="fixed h-screen"
              style={{
                width: `${targetChatSize}%`,
              }}
            >
              <ChatUI onClose={closeChat} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </ChatLayoutContext.Provider>
  );
}
