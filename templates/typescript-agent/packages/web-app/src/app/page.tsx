import { redirect } from "next/navigation";
import type { JSX } from "react";
import { auth, signIn, signOut } from "@/auth";
import { LocalTenantPicker } from "@/dev/local-tenant-picker";
import {
  getAiProvider,
  getAuthMode,
  getLangfuseConfig,
  getOidcConfig,
} from "@/env-vars";
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
                  Production-shaped agent starter with tenant RLS, MCP tools,
                  and Langfuse tracing built in.
                </h1>
                <p className="max-w-2xl text-lg text-muted-foreground">
                  Sign in as a seeded tenant to explore Moose-owned dashboard
                  APIs, tenant-scoped metrics, and the chat-over-data workflow.
                  Swap the local login for your OIDC provider when you move to
                  production.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <MetricCard
                  label="Chat Surface"
                  value="MCP"
                  helper="JWT-scoped tool calls against ClickHouse."
                />
                <MetricCard
                  label="Auth"
                  value="OIDC"
                  helper="Local mock issuer for dev, generic OIDC for prod."
                />
                <MetricCard
                  label="Tracing"
                  value="Langfuse"
                  helper="Trace model and tool activity in Langfuse."
                />
              </div>
            </section>

            <section className="rounded-3xl border bg-card/85 p-6 shadow-xl backdrop-blur">
              <div className="space-y-5">
                <div>
                  <h2 className="text-xl font-semibold">Choose a tenant</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Local dev mode signs a short-lived JWT carrying the
                    `tenant_id` claim used by Moose row policies.
                  </p>
                </div>

                {sessionNotice === "expired" && (
                  <div className="rounded-2xl border border-amber-400/60 bg-amber-500/10 p-4 text-sm text-amber-950 dark:text-amber-100">
                    Your previous session expired or is no longer valid. Sign in
                    again to refresh the tenant-scoped token.
                  </div>
                )}

                {authMode === "local" && <LocalTenantPicker />}

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
                  Default provider:{" "}
                  <span className="font-medium text-foreground">
                    {getAiProvider()}
                  </span>
                  . Run `pnpm env:prepare` to create local env files, then edit
                  `.env.local` values to switch LLMs, enable Langfuse, or
                  connect Bedrock Guardrails.
                </div>
              </div>
            </section>
          </div>
        </main>
      </div>
    );
  }

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
  const langfuseEnabled = !!getLangfuseConfig();

  return (
    <div className="min-h-[calc(100vh-56px)] bg-[radial-gradient(circle_at_top_right,_rgba(59,130,246,0.12),_transparent_30%),linear-gradient(180deg,_hsl(var(--background)),_hsl(var(--muted)/0.18))]">
      <main className="mx-auto max-w-6xl px-6 py-10">
        <section className="flex flex-col gap-6 rounded-3xl border bg-card/85 p-8 shadow-lg lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="inline-flex rounded-full border px-3 py-1 text-sm text-muted-foreground">
              Signed in as {session.user.tenantName}
            </div>
            <div>
              <h1 className="text-4xl font-semibold tracking-tight">
                Tenant-scoped agent dashboard
              </h1>
              <p className="mt-2 max-w-3xl text-muted-foreground">
                Moose-owned dashboard APIs and MCP chat tool calls share the
                same tenant-scoped data contract. Langfuse captures traces
                externally when configured.
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
            label="Knowledge Records"
            value={String(snapshot.knowledgeMetrics.totalRecords)}
            helper="Seeded records available to the dashboard and MCP tools"
          />
          <MetricCard
            label="High Priority"
            value={String(snapshot.knowledgeMetrics.highPriorityRecords)}
            helper="Signals marked high priority in the last 7 days"
          />
          <MetricCard
            label="AI Provider"
            value={aiProvider}
            helper="Switch providers with `AI_PROVIDER` in `.env.local` after running `pnpm env:prepare`"
          />
          <MetricCard
            label="Langfuse"
            value={langfuseEnabled ? "Enabled" : "Optional"}
            helper={
              langfuseEnabled ?
                "Tracing keys detected for external observability"
              : "Add Langfuse keys to capture traces outside Moose"
            }
          />
        </section>

        <section className="mt-8 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="rounded-3xl border bg-card/85 p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold">
                  Recent tenant knowledge
                </h2>
                <p className="text-sm text-muted-foreground">
                  Seeded starter data available through both the dashboard and
                  MCP tools.
                </p>
              </div>
            </div>

            <div className="space-y-4">
              {snapshot.recentKnowledge.map((row) => (
                <div
                  key={`${row.category}-${row.timestamp}-${row.headline}`}
                  className="rounded-2xl border p-4"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground">
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
              <h2 className="text-xl font-semibold">Try in chat</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                The chat runtime uses the same tenant JWT as the dashboard and
                answers with tenant-scoped semantic tools. If Langfuse is
                configured, model and tool traces are emitted there.
              </p>

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border p-3 text-sm text-muted-foreground">
                  “Summarize the highest-priority signals for this tenant.”
                </div>
                <div className="rounded-2xl border p-3 text-sm text-muted-foreground">
                  “Break down the high-priority records by category for this
                  tenant.”
                </div>
                <div className="rounded-2xl border p-3 text-sm text-muted-foreground">
                  “Which categories changed most recently for this tenant?”
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
