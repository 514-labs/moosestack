"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { ChatPanel } from "@/features/chat";

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

function subscribeToViewportWidth(onStoreChange: () => void) {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener("resize", onStoreChange);
  return () => {
    window.removeEventListener("resize", onStoreChange);
  };
}

function getViewportWidth() {
  return typeof window === "undefined" ? 0 : window.innerWidth;
}

export default function ResizableChatLayout({
  children,
  minChatWidthPX = 400,
  maxChatWidthPercent = 40,
  defaultChatWidthPercent = 40,
  className = "h-full",
}: ResizableChatLayoutProps) {
  // Chat state management
  const [isChatOpen, setIsChatOpen] = useState(false);

  const toggleChat = () => {
    setIsChatOpen((current) => !current);
  };

  const closeChat = () => {
    setIsChatOpen(false);
    setLastChatSize(null);
  };

  // Panel sizing logic
  const chatPanelRef = useRef<ImperativePanelHandle | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [lastChatSize, setLastChatSize] = useState<number | null>(null);

  // Always use defaultChatWidthPercent (30%) when opening
  // Only use lastChatSize if user has manually resized
  const targetChatSize = lastChatSize ?? defaultChatWidthPercent;

  const initialDefaultSize =
    isChatOpen ? (lastChatSize ?? defaultChatWidthPercent) : 0;

  const mainPanelDefaultSize = isChatOpen ? 100 - initialDefaultSize : 100;

  const viewportWidth = useSyncExternalStore(
    subscribeToViewportWidth,
    getViewportWidth,
    () => 0,
  );
  const minChatPercent =
    viewportWidth > 0 ? Math.max(0, (minChatWidthPX / viewportWidth) * 100) : 0;

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

  const contextValue = {
    isChatOpen,
    toggleChat,
    closeChat,
  };

  return (
    <ChatLayoutContext.Provider value={contextValue}>
      <div className={className}>
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
              <ChatPanel onClose={closeChat} />
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>
    </ChatLayoutContext.Provider>
  );
}
