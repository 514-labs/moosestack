"use client";

import { UserButton, useUser, SignOutButton } from "@clerk/nextjs";
import { TierNav } from "@/features/tier/tier-nav";

export default function Tier2Page() {
  const { user } = useUser();

  return (
    <>
      <TierNav />
      <div className="flex min-h-screen items-center justify-center p-8 pt-20">
        <div className="max-w-md text-center space-y-4">
          <div className="flex justify-center gap-4 items-center">
            <UserButton afterSignOutUrl="/" />
            <SignOutButton redirectUrl="/">
              <button className="text-sm text-muted-foreground hover:text-foreground underline">
                Sign out
              </button>
            </SignOutButton>
          </div>
          <h1 className="text-2xl font-bold">Tier 2: JWT Passthrough</h1>
          {user && (
            <p className="text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium">
                {user.fullName ?? user.primaryEmailAddress?.emailAddress}
              </span>
            </p>
          )}
          <p className="text-muted-foreground">
            Your JWT carries identity to the backend for audit trails and
            personalization. Open the chat panel and ask &quot;Who am I?&quot;
          </p>
          <ul className="text-sm text-muted-foreground text-left space-y-1">
            <li>- Per-user identity in every request</li>
            <li>- Audit trail with userId, tool, query, timestamp</li>
            <li>- LLM knows your name and email</li>
            <li>- Same data access as Tier 1</li>
          </ul>
        </div>
      </div>
    </>
  );
}
