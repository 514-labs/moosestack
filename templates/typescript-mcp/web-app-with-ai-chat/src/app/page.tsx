"use client";

import ResizableChatLayout, {
  useChatLayout,
} from "@/components/layout/resizable-chat-layout";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";

function MainContent() {
  const { toggleChat } = useChatLayout();

  return (
    <div className="flex min-h-screen items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <div className="text-center space-y-4">
        <h1 className="text-2xl font-semibold">This is where your app lives</h1>
        <Button onClick={toggleChat} variant="outline">
          <MessageSquare className="w-4 h-4 mr-2" />
          Open Chat
        </Button>
      </div>
    </div>
  );
}

export default function Home() {
  return (
    <ResizableChatLayout className="h-screen">
      <MainContent />
    </ResizableChatLayout>
  );
}
