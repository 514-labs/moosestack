import { redirect } from "next/navigation";
import type { JSX } from "react";
import { auth, signIn, signOut } from "@/auth";
import { getSessionAccess } from "@/authz/session-access";
import { LocalLoginForm } from "@/dev/local-login-form";
import { getAiProvider, getAuthMode, getOidcConfig } from "@/env-vars";
import {
  DashboardSnapshotUnauthorizedError,
  getDashboardSnapshot,
} from "@/lib/moose-service";

// EXAMPLE_APP_ONLY: The seeded dashboard copy and prompts in this file assume
// the TenantKnowledge demo model. Replace or remove them when you swap out the
// example data model, then search the repo for EXAMPLE_APP_ONLY to find the
// downstream demo wiring.
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

  return new Date(value).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export default async function Home({
  searchParams,
}: HomePageProps): Promise<JSX.Element> {
  const resolvedSearchParams = (await searchParams) ?? {};
  const sessionNotice =
    typeof resolvedSearchParams.session === "string" ?
      resolvedSearchParams.session
    : undefined;
  const loginStatus =
    typeof resolvedSearchParams.login === "string" ?
      resolvedSearchParams.login
    : undefined;
  const session = await auth();
  const authMode = getAuthMode();
  const oidcConfig = getOidcConfig();

  if (!session) {
    return (
      <div className="min-h-screen bg-[radial-gradient(circle_at_top,_rgba(255,255,255,0.035),_transparent_28%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.12))] text-foreground">
        <main className="mx-auto flex min-h-screen max-w-lg items-center justify-center px-5 py-12 sm:px-6 sm:py-16">
          <section className="w-full rounded-[1.9rem] border border-border/70 bg-card/96 px-7 py-7 shadow-[0_22px_70px_rgba(0,0,0,0.28)] sm:px-8 sm:py-8">
            <div className="space-y-3">
              <div className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">
                typescript-agent
              </div>
              <h1 className="text-[2rem] font-semibold tracking-tight">
                Sign in
              </h1>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">
                Use one of the local mock accounts below to access the seeded
                dashboard and chat experience.
              </p>
            </div>

            <div className="mt-7 space-y-5">
              {sessionNotice === "expired" && (
                <div className="rounded-2xl border border-amber-400/60 bg-amber-500/10 px-4 py-3 text-sm leading-6 text-amber-950 dark:text-amber-100">
                  Your previous session expired or is no longer valid. Sign in
                  again to refresh access.
                </div>
              )}

              {authMode === "local" && (
                <LocalLoginForm
                  errorMessage={
                    loginStatus === "invalid" ?
                      "Invalid email or password."
                    : undefined
                  }
                />
              )}

              {authMode === "oidc" && oidcConfig && (
                <form
                  action={async () => {
                    "use server";
                    await signIn("oidc", { redirectTo: "/" });
                  }}
                >
                  <button
                    type="submit"
                    className="h-11 w-full rounded-xl border px-4 text-sm font-medium"
                  >
                    Sign in with your OIDC provider
                  </button>
                </form>
              )}
            </div>
          </section>
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
  const accessCardValue = access.kind === "admin" ? "All data" : access.orgName;
  const seedDatasetNote =
    access.kind === "admin" ?
      "Org A uses intentionally tiny counts (1 and 2), while Org B uses intentionally larger counts (50 and 1,024)."
    : access.orgId === "org_a" ?
      "This example organization uses intentionally tiny counts (1 and 2)."
    : "This example organization uses intentionally larger counts (50 and 1,024).";

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_30%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.18))]">
      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="flex flex-col gap-6 rounded-3xl border bg-card/85 p-8 shadow-lg lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex rounded-full border px-3 py-1 text-sm text-muted-foreground">
              Signed in as {access.displayName}
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">
                {access.kind === "admin" ?
                  "Debug dashboard across all seeded data"
                : `${access.orgName} knowledge dashboard`}
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
            helper="Records currently authorized for this access scope"
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
              : "Organization-scoped authorization"
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
                    `Latest seeded records across both organization datasets. ${seedDatasetNote}`
                  : `Latest seeded records currently visible to this organization. ${seedDatasetNote}`
                  }
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {snapshot.recentKnowledge.map((row) => (
                <div
                  key={`${row.orgId}-${row.category}-${row.timestamp}-${row.headline}`}
                  className="rounded-2xl border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
                    {adminView && <span>{row.orgId}</span>}
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
                    "\"Compare Org A's 1 and 2-count updates with Org B's 50 and 1,024-count spikes.\""
                  : access.orgId === "org_a" ?
                    '"Summarize why this example organization looks low-volume."'
                  : '"Summarize why this example organization looks high-volume."'
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
