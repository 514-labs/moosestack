import { ACCESS_ROLE_ADMIN_DEBUG, type AccessRole } from "agent-contracts";
import type { JSX } from "react";
import { signIn } from "@/auth";
import { LOCAL_ACCESS_OPTIONS } from "./local-auth";

function getAuthorizationCopy(accessRole: AccessRole): string {
  if (accessRole === ACCESS_ROLE_ADMIN_DEBUG) {
    return "Authorized to read all seeded records across both organizations. Local development only.";
  }

  return "Authorized only for the seeded records assigned to this organization.";
}

export function LocalAccessPicker(): JSX.Element {
  return (
    <div className="space-y-3">
      {LOCAL_ACCESS_OPTIONS.map((accessOption) => (
        <form
          key={accessOption.id}
          action={async () => {
            "use server";
            await signIn("local-access", {
              selectionId: accessOption.id,
              redirectTo: "/",
            });
          }}
          className="rounded-2xl border p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <div className="font-medium">{accessOption.name}</div>
                <div className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {accessOption.accessRole === ACCESS_ROLE_ADMIN_DEBUG ?
                    "Admin debug"
                  : "Org-scoped"}
                </div>
              </div>
              <div className="text-sm text-muted-foreground">
                {accessOption.description}
              </div>
              <div className="text-xs text-muted-foreground">
                {getAuthorizationCopy(accessOption.accessRole)}
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
