"use client";

import {
  UserButton,
  useUser,
  useOrganization,
  OrganizationSwitcher,
  SignOutButton,
} from "@clerk/nextjs";
import { TierNav } from "@/features/tier/tier-nav";

export default function Tier3Page() {
  const { user } = useUser();
  const { organization } = useOrganization();

  return (
    <>
      <TierNav />
      <div className="flex min-h-screen items-center justify-center p-8 pt-20">
        <div className="max-w-md text-center space-y-4">
          <div className="flex justify-center gap-4 items-center">
            <OrganizationSwitcher />
            <UserButton afterSignOutUrl="/" />
            <SignOutButton redirectUrl="/">
              <button className="text-sm text-muted-foreground hover:text-foreground underline">
                Sign out
              </button>
            </SignOutButton>
          </div>
          <h1 className="text-2xl font-bold">
            Tier 3: Org-Scoped Data Isolation
          </h1>
          {user && (
            <p className="text-sm text-muted-foreground">
              Signed in as{" "}
              <span className="font-medium">
                {user.fullName ?? user.primaryEmailAddress?.emailAddress}
              </span>
              {organization && (
                <>
                  {" "}
                  | Org:{" "}
                  <span className="font-medium">{organization.name}</span>
                </>
              )}
            </p>
          )}
          <p className="text-muted-foreground">
            JWT + org_id scopes every ClickHouse query to your organization. Try
            asking &quot;Show me all records&quot; — you&apos;ll only see your
            org&apos;s data.
          </p>
          <ul className="text-sm text-muted-foreground text-left space-y-1">
            <li>- Org-scoped query filtering at the application layer</li>
            <li>- Cross-tenant queries return empty results</li>
            <li>- Multi-tenant SaaS ready</li>
          </ul>
          <p className="text-xs text-muted-foreground italic">
            Database-level row-level security (ClickHouse row policies) coming
            soon.
          </p>
        </div>
      </div>
    </>
  );
}
