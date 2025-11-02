import { TopNav } from "@/components/navigation/top-nav";
import { SideNav } from "@/components/navigation/side-nav";
import { buildNavigationTree } from "@/lib/content";
import { AnalyticsProvider } from "@/components/analytics-provider";

export default function PythonLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const navItems = buildNavigationTree("python");

  return (
    <AnalyticsProvider language="python">
      <TopNav language="python" />
      <div className="container flex-1 items-start md:grid md:grid-cols-[240px_minmax(0,1fr)] md:gap-6 lg:grid-cols-[240px_minmax(0,1fr)_240px] lg:gap-10">
        <SideNav items={navItems} language="python" />
        <main className="relative py-6 lg:gap-10 lg:py-8 xl:grid xl:grid-cols-[1fr_240px]">
          {children}
        </main>
      </div>
    </AnalyticsProvider>
  );
}
