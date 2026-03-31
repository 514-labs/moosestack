import { ACCESS_ROLE_ADMIN_DEBUG, type AccessRole } from "agent-contracts";
import type { JSX } from "react";
import { signIn } from "@/auth";
import { LOCAL_IDENTITIES } from "./local-auth";

function getAuthorizationCopy(accessRole: AccessRole): string {
  if (accessRole === ACCESS_ROLE_ADMIN_DEBUG) {
    return "Authorized to read all seeded records across both tenants. Local development only.";
  }

  return "Authorized only for the seeded records assigned to this tenant identity.";
}

export function LocalIdentityPicker(): JSX.Element {
  return (
    <div className="space-y-3">
      {LOCAL_IDENTITIES.map((identity) => (
        <form
          key={identity.id}
          action={async () => {
            "use server";
            await signIn("local-identity", {
              identityId: identity.id,
              redirectTo: "/",
            });
          }}
          className="rounded-2xl border p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">{identity.name}</div>
                <div className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {identity.accessRole === ACCESS_ROLE_ADMIN_DEBUG ?
                    "Admin debug"
                  : "Tenant-scoped"}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {identity.description}
              </div>
              <div className="text-xs text-muted-foreground">
                {getAuthorizationCopy(identity.accessRole)}
              </div>
            </div>
            <button
              type="submit"
              className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
            >
              Sign In
            </button>
          </div>
        </form>
      ))}
    </div>
  );
}
