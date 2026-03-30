import type { JSX } from "react";
import { signIn } from "@/auth";
import { LOCAL_TENANTS } from "./local-auth";

export function LocalTenantPicker(): JSX.Element {
  return (
    <div className="space-y-3">
      {LOCAL_TENANTS.map((tenant) => (
        <form
          key={tenant.id}
          action={async () => {
            "use server";
            await signIn("local-tenant", {
              tenantId: tenant.id,
              redirectTo: "/",
            });
          }}
          className="rounded-2xl border p-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">{tenant.name}</div>
              <div className="mt-1 text-sm text-muted-foreground">
                {tenant.description}
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
