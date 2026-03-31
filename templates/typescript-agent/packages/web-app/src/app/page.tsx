import { redirect } from "next/navigation";
import type { JSX } from "react";
import { auth, signIn, signOut } from "@/auth";
import { getSessionAccess } from "@/authz/session-access";
import { LocalIdentityPicker } from "@/dev/local-identity-picker";
import { getAiProvider, getAuthMode, getOidcConfig } from "@/env-vars";
import {
  DashboardSnapshotUnauthorizedError,
  getDashboardSnapshot,
} from "@/lib/moose-service";

interface MetricCardProps {
  label: string;
  value: string;
  helper: string;
}

function MetricCard({ label, value, helper }: MetricCardProps): JSX.Element {
  return (
    <div className="rounded-2xl border bg-card/80 p-5 shadow-sm">
      <div className="text-sm text-muted-foreground">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight">{value}</div>
      <div className="mt-2 text-sm text-muted-foreground">{helper}</div>
    </div>
  );
}

interface HomePageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

function clearStaleSession(): never {
  redirect("/auth/session-expired");
}

function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return "No recent updates";
  }

  return new Date(value).toLocaleString();
}

export default async function Home({
  searchParams,
}: HomePageProps): Promise<JSX.Element> {
  const resolvedSearchParams = (await searchParams) ?? {};
  const sessionNotice =
    typeof resolvedSearchParams.session === "string" ?
      resolvedSearchParams.session
    : undefined;
  const session = await auth();
  const authMode = getAuthMode();
  const oidcConfig = getOidcConfig();

  if (!session) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(14,165,233,0.16),_transparent_38%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.2))] text-foreground">
        <main className="mx-auto flex min-h-screen max-w-5xl flex-col justify-center px-6 py-16">
          <div className="grid gap-10 lg:grid-cols-[1.2fr_0.8fr]">
            <section className="space-y-6">
              <div className="inline-flex rounded-full border px-3 py-1 text-sm text-muted-foreground">
                typescript-agent
              </div>
              <div className="space-y-4">
                <h1 className="max-w-3xl text-4xl font-semibold tracking-tight sm:text-5xl">
                  Local identities for development, tenant authorization for
                  real data access.
                </h1>
                <p className="max-w-2xl text-lg text-muted-foreground">
                  Authentication decides who you are. Authorization decides
                  whether you can read one tenant or every seeded record. Use
                  Tenant A or Tenant B for scoped access, or use Admin Debug for
                  local troubleshooting.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <MetricCard
                  label="Authentication"
                  value="Identity"
                  helper="Choose a local identity in development or use OIDC in production."
                />
                <MetricCard
                  label="Authorization"
                  value="RLS"
                  helper="Tenant identities stay scoped to their own records."
                />
                <MetricCard
                  label="Debugging"
                  value="Admin"
                  helper="Local Admin Debug bypasses tenant filters for investigation."
                />
              </div>
            </section>

            <section className="rounded-3xl border bg-card/85 p-6 shadow-xl backdrop-blur">
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold">
                    Choose a local identity
                  </h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Local development signs a short-lived JWT for the identity
                    you choose. Tenant identities carry a `tenant_id`; Admin
                    Debug carries an unrestricted local debug role instead.
                  </p>
                </div>

                {sessionNotice === "expired" && (
                  <div className="rounded-2xl border border-amber-400/60 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
                    Your previous session expired or is no longer valid. Sign in
                    again to refresh access.
                  </div>
                )}

                {authMode === "local" && <LocalIdentityPicker />}

                {authMode === "oidc" && oidcConfig && (
                  <form
                    action={async () => {
                      "use server";
                      await signIn("oidc", { redirectTo: "/" });
                    }}
                  >
                    <button
                      type="submit"
                      className="w-full rounded-full border px-4 py-3 text-sm font-medium"
                    >
                      Sign In With Your OIDC Provider
                    </button>
                  </form>
                )}

                <div className="rounded-2xl bg-muted/60 p-4 text-sm text-muted-foreground">
                  Local development includes seeded records for Tenant A and
                  Tenant B. Admin Debug is available only in local mode and is
                  intended for troubleshooting, not production access control.
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

  const access = getSessionAccess(session) ?? clearStaleSession();
  const idToken = session.idToken ?? clearStaleSession();
  let snapshot: Awaited<ReturnType<typeof getDashboardSnapshot>>;
  try {
    snapshot = await getDashboardSnapshot(idToken);
  } catch (error) {
    if (error instanceof DashboardSnapshotUnauthorizedError) {
      clearStaleSession();
    }

    throw error;
  }

  const aiProvider = getAiProvider();
  const adminView = access.kind === "admin";
  const latestUpdate = snapshot.recentKnowledge[0]?.timestamp;
  const recentCategoryCount = new Set(
    snapshot.recentKnowledge.map((row) => row.category),
  ).size;
  const accessCardValue =
    access.kind === "admin" ? "All data" : access.tenantName;

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_30%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.18))]">
      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="flex flex-col gap-6 rounded-3xl border bg-card/85 p-8 shadow-lg lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex rounded-full border px-3 py-1 text-sm text-muted-foreground">
              Signed in as {access.identityName}
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">
                {access.kind === "admin" ?
                  "Debug dashboard across all seeded data"
                : `${access.tenantName} knowledge dashboard`}
              </h1>
              <p className="mt-2 max-w-3xl text-muted-foreground">
                {access.scopeDescription} The dashboard and chat assistant share
                this same authorization scope.
              </p>
            </div>
          </div>

          <form
            action={async () => {
              "use server";
              await signOut({ redirectTo: "/" });
            }}
          >
            <button
              type="submit"
              className="rounded-full border px-4 py-2 text-sm font-medium"
            >
              Sign Out
            </button>
          </form>
        </section>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            label="Visible Records"
            value={String(snapshot.knowledgeMetrics.totalRecords)}
            helper="Records currently authorized for this identity"
          />
          <MetricCard
            label="High Priority"
            value={String(snapshot.knowledgeMetrics.highPriorityRecords)}
            helper="Signals marked high priority in the last 7 days"
          />
          <MetricCard
            label="Recent Categories"
            value={String(recentCategoryCount)}
            helper="Distinct categories represented in the recent feed"
          />
          <MetricCard
            label="Access"
            value={accessCardValue}
            helper={
              adminView ?
                "Local debug authorization across all seeded records"
              : "Tenant-scoped authorization"
            }
          />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border bg-card/85 p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">Recent knowledge</h2>
                <p className="text-sm text-muted-foreground">
                  {adminView ?
                    "Latest seeded records across both tenant datasets."
                  : "Latest seeded records currently visible to this tenant."}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {snapshot.recentKnowledge.map((row) => (
                <div
                  key={`${row.tenantId}-${row.category}-${row.timestamp}-${row.headline}`}
                  className="rounded-2xl border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                    {adminView && <span>{row.tenantId}</span>}
                    {adminView && <span>•</span>}
                    <span>{row.category}</span>
                    <span>•</span>
                    <span>{row.priority}</span>
                    <span>•</span>
                    <span>{row.source}</span>
                  </div>
                  <div className="mt-2 text-base font-medium">
                    {row.headline}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    {new Date(row.timestamp).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border bg-card/85 p-6 shadow-sm">
              <h2 className="text-xl font-semibold">Ask the assistant</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Chat uses the same authenticated access scope as the dashboard.
                The selected provider is currently{" "}
                <span className="font-medium text-foreground">
                  {aiProvider}
                </span>
                .
              </p>

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-dashed bg-muted/40 p-3 text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">
                    Current scope:
                  </span>{" "}
                  {access.scopeBadge}
                </div>
                <div className="rounded-2xl border p-3 text-sm text-muted-foreground">
                  “Summarize the highest-priority signals in view.”
                </div>
                <div className="rounded-2xl border p-3 text-sm text-muted-foreground">
                  “Which knowledge categories changed most recently?”
                </div>
                <div className="rounded-2xl border p-3 text-sm text-muted-foreground">
                  {adminView ?
                    "“Compare the newest signals across Tenant A and Tenant B.”"
                  : "“Compare the newest support updates with the fleet health changes.”"
                  }
                </div>
                <div className="rounded-2xl border bg-muted/40 p-3 text-sm text-muted-foreground">
                  Latest update in scope: {formatTimestamp(latestUpdate)}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
