import { ACCESS_ROLE_ADMIN_DEBUG } from "agent-contracts";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import type { JSX } from "react";
import { signIn } from "@/auth";
import {
  deriveLocalPassword,
  LOCAL_MOCK_USERS,
  LOCAL_PASSWORD_RULE,
} from "./local-auth";

interface LocalLoginFormProps {
  errorMessage?: string;
}

export function LocalLoginForm({
  errorMessage,
}: LocalLoginFormProps): JSX.Element {
  return (
    <div className="space-y-6">
      <form
        action={async (formData) => {
          "use server";

          const email = String(formData.get("email") ?? "");
          const password = String(formData.get("password") ?? "");

          try {
            await signIn("local-access", {
              email,
              password,
              redirectTo: "/",
            });
          } catch (error) {
            if (
              error instanceof AuthError &&
              (error.type === "CredentialsSignin" ||
                error.type === "CallbackRouteError")
            ) {
              redirect("/?login=invalid");
            }

            throw error;
          }
        }}
        className="space-y-4"
      >
        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            placeholder="user1@orgA.com"
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            placeholder="user1"
            className="h-11 w-full rounded-xl border bg-background px-3 text-sm outline-none ring-offset-background transition focus-visible:ring-2 focus-visible:ring-ring"
            required
          />
        </div>

        {errorMessage && (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {errorMessage}
          </div>
        )}

        <button
          type="submit"
          className="h-11 w-full rounded-xl bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-95"
        >
          Sign in
        </button>
      </form>

      <div className="rounded-2xl border bg-muted/35 p-4">
        <div className="text-sm font-medium">Mock accounts</div>
        <p className="mt-1 text-sm text-muted-foreground">
          {LOCAL_PASSWORD_RULE} For example,{" "}
          <code className="rounded bg-background px-1 py-0.5 text-xs">
            user1@orgA.com
          </code>{" "}
          uses{" "}
          <code className="rounded bg-background px-1 py-0.5 text-xs">
            user1
          </code>
          .
        </p>

        <div className="mt-4 space-y-2 text-sm">
          {LOCAL_MOCK_USERS.map((mockUser) => {
            const derivedPassword = deriveLocalPassword(mockUser.email) ?? "";
            const scopeLabel =
              mockUser.accessRole === ACCESS_ROLE_ADMIN_DEBUG ?
                "Admin access"
              : `${mockUser.orgName} access`;

            return (
              <div
                key={mockUser.id}
                className="rounded-xl border bg-background/80 px-3 py-2"
              >
                <div className="font-medium">{mockUser.email}</div>
                <div className="text-muted-foreground">
                  Password:{" "}
                  <code className="rounded bg-muted px-1 py-0.5 text-xs">
                    {derivedPassword}
                  </code>
                  {" · "}
                  {scopeLabel}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
