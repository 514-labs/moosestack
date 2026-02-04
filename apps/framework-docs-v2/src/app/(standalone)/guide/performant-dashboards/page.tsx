"use client";

import * as React from "react";
import { IconChevronRight } from "@tabler/icons-react";

// Chapter data
const chapters = [
  { id: "why", number: 0, title: "Why" },
  { id: "how", number: 1, title: "How" },
];

export default function PerformantDashboardsGuide() {
  const [currentChapter, setCurrentChapter] = React.useState(0);
  const [isTransitioning, setIsTransitioning] = React.useState(false);

  // Sync with URL hash on mount
  React.useEffect(() => {
    const hash = window.location.hash.slice(1);
    if (hash) {
      const index = chapters.findIndex((c) => c.id === hash);
      if (index >= 0) setCurrentChapter(index);
    }
  }, []);

  const goToChapter = (index: number) => {
    if (index === currentChapter) return;
    setIsTransitioning(true);
    setTimeout(() => {
      setCurrentChapter(index);
      window.history.replaceState(null, "", `#${chapters[index].id}`);
      window.scrollTo({ top: 0, behavior: "instant" });
      setTimeout(() => setIsTransitioning(false), 50);
    }, 200);
  };

  return (
    <div className="min-h-screen bg-[#FAFAFA] dark:bg-[#0A0A0A] text-[#1a1a1a] dark:text-[#e5e5e5]">
      {/* Fixed Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-[#FAFAFA]/80 dark:bg-[#0A0A0A]/80 backdrop-blur-md border-b border-black/5 dark:border-white/5">
        <div className="max-w-[1200px] mx-auto px-6 h-14 flex items-center justify-between">
          <a
            href="/guides"
            className="text-xs uppercase tracking-[0.2em] text-neutral-500 hover:text-neutral-800 dark:hover:text-neutral-200 transition-colors"
          >
            ← Guides
          </a>
          {/* Chapter Navigation */}
          <nav className="flex items-center gap-1">
            {chapters.map((chapter, index) => (
              <button
                key={chapter.id}
                onClick={() => goToChapter(index)}
                className={`
                  px-4 py-2 text-sm transition-all duration-200
                  ${
                    index === currentChapter ?
                      "text-neutral-900 dark:text-white"
                    : "text-neutral-400 hover:text-neutral-600 dark:hover:text-neutral-300"
                  }
                `}
              >
                <span className="font-mono text-xs opacity-50 mr-1.5">
                  {chapter.number}.
                </span>
                <span className="font-medium">{chapter.title}</span>
              </button>
            ))}
          </nav>
          <div className="w-20" /> {/* Spacer for balance */}
        </div>
      </header>

      {/* Main Content */}
      <main className="pt-14">
        {/* Hero Section */}
        <section className="py-24 px-6">
          <div className="max-w-[720px] mx-auto text-center">
            <p className="text-xs uppercase tracking-[0.3em] text-neutral-400 mb-6">
              MooseStack Guide
            </p>
            <h1 className="text-4xl md:text-5xl font-light tracking-tight mb-6">
              Performant Dashboards
            </h1>
            <p className="text-lg text-neutral-500 dark:text-neutral-400 leading-relaxed">
              Build dashboards that load in milliseconds, not seconds.
            </p>
          </div>
        </section>

        {/* Chapter Progress Bar */}
        <div className="max-w-[720px] mx-auto px-6 mb-16">
          <div className="flex items-center gap-4">
            {chapters.map((chapter, index) => (
              <React.Fragment key={chapter.id}>
                <button
                  onClick={() => goToChapter(index)}
                  className="flex items-center gap-2 group"
                >
                  <span
                    className={`
                    w-8 h-8 rounded-full flex items-center justify-center text-sm font-mono transition-all duration-300
                    ${
                      index === currentChapter ?
                        "bg-neutral-900 dark:bg-white text-white dark:text-black"
                      : index < currentChapter ?
                        "bg-neutral-300 dark:bg-neutral-700 text-neutral-600 dark:text-neutral-300"
                      : "bg-neutral-100 dark:bg-neutral-800 text-neutral-400"
                    }
                  `}
                  >
                    {chapter.number}
                  </span>
                  <span
                    className={`
                    text-sm transition-colors duration-300
                    ${
                      index === currentChapter ?
                        "text-neutral-900 dark:text-white"
                      : "text-neutral-400 group-hover:text-neutral-600 dark:group-hover:text-neutral-300"
                    }
                  `}
                  >
                    {chapter.title}
                  </span>
                </button>
                {index < chapters.length - 1 && (
                  <div
                    className={`
                    flex-1 h-px transition-colors duration-300
                    ${index < currentChapter ? "bg-neutral-300 dark:bg-neutral-600" : "bg-neutral-200 dark:bg-neutral-800"}
                  `}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </div>

        {/* Chapter Content */}
        <div
          className={`transition-opacity duration-200 ${isTransitioning ? "opacity-0" : "opacity-100"}`}
        >
          {currentChapter === 0 && <WhyChapter />}
          {currentChapter === 1 && <HowChapter />}
        </div>

        {/* Bottom Navigation */}
        <section className="py-24 px-6 border-t border-neutral-200 dark:border-neutral-800 mt-24">
          <div className="max-w-[720px] mx-auto">
            <div className="flex items-center justify-between">
              {currentChapter > 0 ?
                <button
                  onClick={() => goToChapter(currentChapter - 1)}
                  className="group text-left"
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-400 mb-1">
                    Previous
                  </p>
                  <p className="text-lg font-light group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors">
                    {chapters[currentChapter - 1].title}
                  </p>
                </button>
              : <div />}

              {currentChapter < chapters.length - 1 ?
                <button
                  onClick={() => goToChapter(currentChapter + 1)}
                  className="group text-right"
                >
                  <p className="text-xs uppercase tracking-[0.2em] text-neutral-400 mb-1">
                    Next
                  </p>
                  <p className="text-lg font-light group-hover:text-neutral-600 dark:group-hover:text-neutral-300 transition-colors flex items-center gap-2">
                    {chapters[currentChapter + 1].title}
                    <IconChevronRight className="w-5 h-5 opacity-50" />
                  </p>
                </button>
              : <div />}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

// ============================================================================
// CHAPTER: WHY
// ============================================================================
function WhyChapter() {
  return (
    <article className="px-6">
      <div className="max-w-[720px] mx-auto">
        {/* Section */}
        <Section number="0.1" title="The Problem">
          <Paragraph>
            Traditional dashboards that query OLTP databases directly face
            fundamental performance challenges at scale. When you query your
            production PostgreSQL or MySQL database for dashboard data, you're
            competing with your application's transactional workload.
          </Paragraph>

          <Paragraph>This creates several issues:</Paragraph>

          <BulletList
            items={[
              {
                title: "Lock contention",
                description:
                  "Analytical queries that scan large tables can block or slow down transactional writes",
              },
              {
                title: "Resource competition",
                description:
                  "Your dashboard queries consume CPU, memory, and I/O that your application needs",
              },
              {
                title: "No query optimization",
                description:
                  "OLTP databases optimize for single-row lookups, not aggregations across millions of rows",
              },
            ]}
          />
        </Section>

        <Section number="0.2" title="Why Caching Falls Short">
          <Paragraph>
            You might think "I'll just add Redis caching" — but this approach
            has limits:
          </Paragraph>

          <BulletList
            items={[
              {
                title: "Cache invalidation complexity",
                description:
                  "When does your cache become stale? After every write? That defeats the purpose.",
              },
              {
                title: "Memory constraints",
                description:
                  "Caching pre-computed results for every possible filter combination explodes memory usage",
              },
              {
                title: "Cold start problem",
                description: "First query after cache expiration is still slow",
              },
            ]}
          />
        </Section>

        <Section number="0.3" title="The OLAP Approach">
          <Paragraph>MooseStack solves this by separating concerns:</Paragraph>

          <NumberedList
            items={[
              "Your OLTP database handles application transactions",
              "ClickHouse (OLAP) handles analytical queries",
              "Materialized views pre-aggregate data for common access patterns",
            ]}
          />

          <Callout>
            This isn't just "another database to manage" — it's purpose-built
            infrastructure that makes 100ms dashboard loads achievable even with
            billions of rows.
          </Callout>
        </Section>

        <Section number="0.4" title="When You Need This">
          <Paragraph>Consider this approach when:</Paragraph>

          <BulletList
            items={[
              { description: "Dashboard queries take more than 500ms" },
              {
                description:
                  "Your application database CPU spikes during dashboard usage",
              },
              { description: "Users complain about slow loading charts" },
              {
                description: "You need real-time or near-real-time analytics",
              },
            ]}
          />
        </Section>
      </div>
    </article>
  );
}

// ============================================================================
// CHAPTER: HOW
// ============================================================================
function HowChapter() {
  return (
    <article className="px-6">
      <div className="max-w-[720px] mx-auto">
        <Section number="1.1" title="Model Your Data">
          <Paragraph>
            First, define what data your dashboard needs. Create a data model in
            your Moose project:
          </Paragraph>

          <CodeBlock
            language="typescript"
            filename="datamodels/PageView.ts"
            code={`import { Key, DataModelConfig } from "@514labs/moose-lib";

export interface PageView {
  timestamp: Key<Date>;
  userId: string;
  pageUrl: string;
  sessionId: string;
  durationMs: number;
  country: string;
}

export const config: DataModelConfig<PageView> = {
  storage: {
    enabled: true,
    order_by_fields: ["timestamp", "userId"],
  },
};`}
          />
        </Section>

        <Section number="1.2" title="Create a Materialized View">
          <Paragraph>
            Materialized views pre-compute aggregations so your dashboard
            queries return instantly:
          </Paragraph>

          <CodeBlock
            language="typescript"
            filename="blocks/DailyPageViews.ts"
            code={`import { Blocks } from "@514labs/moose-lib";

export default {
  setup: Blocks.Materializations.materializedView({
    selectStatement: \`
      SELECT
        toDate(timestamp) as date,
        country,
        count() as views,
        uniq(userId) as unique_users,
        avg(durationMs) as avg_duration
      FROM PageView
      GROUP BY date, country
    \`,
    tableName: "DailyPageViewsByCountry",
    materializedViewName: "DailyPageViewsByCountry_mv",
  }),
};`}
          />
        </Section>

        <Section number="1.3" title="Create a Consumption API">
          <Paragraph>
            Expose your aggregated data through a type-safe API endpoint:
          </Paragraph>

          <CodeBlock
            language="typescript"
            filename="apis/dashboard.ts"
            code={`import { ConsumptionApi } from "@514labs/moose-lib";

interface DashboardParams {
  startDate: string;
  endDate: string;
  country?: string;
}

export default ConsumptionApi<DashboardParams>({
  path: "/dashboard/views",
  handler: async ({ startDate, endDate, country }, { client }) => {
    const countryFilter = country
      ? \`AND country = {country:String}\`
      : "";

    return client.query(\`
      SELECT date, country, views, unique_users, avg_duration
      FROM DailyPageViewsByCountry
      WHERE date >= {startDate:Date}
        AND date <= {endDate:Date}
      \${countryFilter}
      ORDER BY date DESC
    \`, { startDate, endDate, country });
  },
});`}
          />
        </Section>

        <Section number="1.4" title="Connect Your Frontend">
          <Paragraph>
            Query your consumption API from your dashboard frontend:
          </Paragraph>

          <CodeBlock
            language="typescript"
            filename="components/Dashboard.tsx"
            code={`const { data, isLoading } = useQuery({
  queryKey: ['dashboard', startDate, endDate, country],
  queryFn: () =>
    fetch(\`/consumption/dashboard/views?\${new URLSearchParams({
      startDate,
      endDate,
      ...(country && { country })
    })}\`)
      .then(res => res.json())
});`}
          />
        </Section>

        <Section number="1.5" title="Performance Expectations">
          <Paragraph>
            With this architecture in place, you can expect:
          </Paragraph>

          <Table
            headers={["Metric", "Before (OLTP)", "After (OLAP + MV)"]}
            rows={[
              ["Query latency", "2-10s", "10-100ms"],
              ["Concurrent users", "~10", "1000+"],
              ["Data freshness", "Real-time", "Near real-time (seconds)"],
            ]}
          />
        </Section>
      </div>
    </article>
  );
}

// ============================================================================
// COMPONENTS
// ============================================================================

function Section({
  number,
  title,
  children,
}: {
  number: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mb-20">
      <div className="flex items-baseline gap-3 mb-8">
        <span className="font-mono text-sm text-neutral-400">{number}</span>
        <h2 className="text-2xl font-light tracking-tight">{title}</h2>
      </div>
      <div className="space-y-6">{children}</div>
    </section>
  );
}

function Paragraph({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[17px] leading-[1.8] text-neutral-600 dark:text-neutral-400">
      {children}
    </p>
  );
}

function BulletList({
  items,
}: {
  items: { title?: string; description: string }[];
}) {
  return (
    <ul className="space-y-4 my-8">
      {items.map((item, i) => (
        <li key={i} className="flex gap-4">
          <span className="w-1.5 h-1.5 rounded-full bg-neutral-300 dark:bg-neutral-600 mt-3 flex-shrink-0" />
          <div>
            {item.title && (
              <span className="font-medium text-neutral-800 dark:text-neutral-200">
                {item.title}
              </span>
            )}
            {item.title && item.description && (
              <span className="text-neutral-400 mx-2">—</span>
            )}
            <span className="text-neutral-600 dark:text-neutral-400">
              {item.description}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function NumberedList({ items }: { items: string[] }) {
  return (
    <ol className="space-y-4 my-8">
      {items.map((item, i) => (
        <li key={i} className="flex gap-4">
          <span className="font-mono text-sm text-neutral-400 mt-0.5">
            {i + 1}.
          </span>
          <span className="text-neutral-600 dark:text-neutral-400">{item}</span>
        </li>
      ))}
    </ol>
  );
}

function Callout({ children }: { children: React.ReactNode }) {
  return (
    <div className="my-10 py-6 px-8 bg-neutral-100 dark:bg-neutral-900 border-l-2 border-neutral-300 dark:border-neutral-700">
      <p className="text-[17px] leading-[1.8] text-neutral-700 dark:text-neutral-300 italic">
        {children}
      </p>
    </div>
  );
}

function CodeBlock({
  language,
  filename,
  code,
}: {
  language: string;
  filename: string;
  code: string;
}) {
  return (
    <div className="my-8 rounded-lg overflow-hidden bg-[#1a1a1a] dark:bg-[#0d0d0d]">
      <div className="px-4 py-2 bg-[#252525] dark:bg-[#151515] border-b border-[#333] flex items-center justify-between">
        <span className="text-xs text-neutral-500 font-mono">{filename}</span>
        <span className="text-xs text-neutral-600 uppercase tracking-wider">
          {language}
        </span>
      </div>
      <pre className="p-4 overflow-x-auto">
        <code className="text-sm font-mono text-neutral-300 leading-relaxed">
          {code}
        </code>
      </pre>
    </div>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="my-8 overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-neutral-200 dark:border-neutral-800">
            {headers.map((header, i) => (
              <th
                key={i}
                className="py-3 pr-8 text-xs uppercase tracking-wider text-neutral-500 font-medium"
              >
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={i}
              className="border-b border-neutral-100 dark:border-neutral-800/50"
            >
              {row.map((cell, j) => (
                <td
                  key={j}
                  className={`py-4 pr-8 ${j === 0 ? "text-neutral-800 dark:text-neutral-200" : "text-neutral-600 dark:text-neutral-400"}`}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
