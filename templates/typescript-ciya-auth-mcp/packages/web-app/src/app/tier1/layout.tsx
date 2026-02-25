import { TierProvider } from "@/features/tier/tier-provider";
import { ChatLayoutWrapper } from "@/components/layout/chat-layout-wrapper";

export default function Tier1Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <TierProvider tier={1}>
      <ChatLayoutWrapper>{children}</ChatLayoutWrapper>
    </TierProvider>
  );
}
