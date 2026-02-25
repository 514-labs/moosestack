import { TierNav } from "@/features/tier/tier-nav";

export default function Tier1Page() {
  return (
    <>
      <TierNav />
      <div className="flex min-h-screen items-center justify-center p-8 pt-20">
        <div className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-bold">Tier 1: API Key Auth</h1>
          <p className="text-muted-foreground">
            Shared PBKDF2 secret protects the MCP backend. No login required —
            open the chat panel to start querying.
          </p>
          <ul className="text-sm text-muted-foreground text-left space-y-1">
            <li>- No user identity</li>
            <li>- No audit trail</li>
            <li>- Everyone sees all data</li>
            <li>- Best for internal demos and prototyping</li>
          </ul>
        </div>
      </div>
    </>
  );
}
