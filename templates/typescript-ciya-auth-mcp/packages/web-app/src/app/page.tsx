import Link from "next/link";

const tiers = [
  {
    href: "/tier1",
    title: "Tier 1: API Key",
    description:
      "Shared secret (PBKDF2) protects the backend. No login, no user identity. Everyone sees all data.",
    badge: "Current default",
  },
  {
    href: "/tier2",
    title: "Tier 2: JWT Passthrough",
    description:
      "Users sign in via Clerk. JWT carries identity to the backend for audit trails and personalization.",
    badge: "Requires Clerk",
  },
  {
    href: "/tier3",
    title: "Tier 3: Org-Scoped Data Isolation",
    description:
      "JWT + org_id scopes ClickHouse queries per tenant. Different orgs see different data.",
    badge: "Requires Clerk + Orgs",
  },
];

export default function Home() {
  return (
    <div className="flex min-h-screen items-center justify-center p-8">
      <div className="max-w-3xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl font-bold">Auth Tier Demo</h1>
          <p className="text-muted-foreground">
            Three authentication tiers, side by side. Open each in a separate
            tab to compare.
          </p>
        </div>

        <div className="grid gap-4">
          {tiers.map((tier) => (
            <Link
              key={tier.href}
              href={tier.href}
              className="block rounded-lg border p-6 hover:bg-accent transition-colors"
            >
              <div className="flex items-start justify-between gap-4">
                <div className="space-y-1">
                  <h2 className="text-lg font-semibold">{tier.title}</h2>
                  <p className="text-sm text-muted-foreground">
                    {tier.description}
                  </p>
                </div>
                <span className="shrink-0 rounded-full bg-muted px-3 py-1 text-xs font-medium">
                  {tier.badge}
                </span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
