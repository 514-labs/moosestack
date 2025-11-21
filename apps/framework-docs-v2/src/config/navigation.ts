import type { Language } from "@/lib/content-types";
import {
  IconChartArea,
  IconDatabase,
  IconBolt,
  IconRoute,
  IconCode,
  IconGitMerge,
  IconChartBar,
  IconHammer,
  IconTerminal,
  IconLayoutGrid,
  IconAtom,
  IconDeviceLaptop,
  IconSettings,
  IconHelpCircle,
  IconList,
  IconFolderPlus,
  IconStars,
  IconFileCode,
  IconStack,
  IconCloudUpload,
  IconBook,
  IconHistory,
  IconRocket,
  IconHandStop,
  IconGitCompare,
  IconApps,
  IconServer,
  IconTarget,
  IconChartLine,
  IconMessageChatbot,
  IconFileReport,
  IconDatabaseImport,
  IconChartDots,
  IconUsers,
  IconChartBarOff,
  IconBrain,
  IconTrendingUp,
  type IconProps,
} from "@tabler/icons-react";

// Tabler icon component type
type TablerIcon = React.ComponentType<IconProps>;

/**
 * Individual page in navigation
 */
export interface NavPage {
  type: "page";
  slug: string;
  title: string;
  languages: Language[];
  icon?: TablerIcon;
  children?: NavItem[]; // Allow NavItem[] to support labels/separators within children
  external?: boolean; // If true, indicates this is a standalone page (not part of the current section)
}

/**
 * Section label (non-clickable label for grouping)
 */
export interface NavSectionLabel {
  type: "label";
  title: string;
}

/**
 * Separator between sections
 */
export interface NavSeparator {
  type: "separator";
}

/**
 * Section container for grouping pages
 */
export interface NavSection {
  type: "section";
  title: string;
  icon?: TablerIcon;
  items: NavItem[];
}

/**
 * Union type for navigation items
 */
export type NavItem = NavPage | NavSection | NavSectionLabel | NavSeparator;

/**
 * Root navigation configuration array
 * Order is determined by array position
 */
export type NavigationConfig = NavItem[];

/**
 * Top-level documentation section
 */
export type DocumentationSection =
  | "moosestack"
  | "hosting"
  | "ai"
  | "guides"
  | "templates";

/**
 * Navigation configuration for each documentation section
 */
export interface SectionNavigationConfig {
  id: DocumentationSection;
  title: string;
  nav: NavigationConfig;
}

/**
 * MooseStack navigation configuration
 * Order is determined by array position - items appear in the order listed
 */
const moosestackNavigationConfig: NavigationConfig = [
  // Overview
  {
    type: "page",
    slug: "moosestack/index",
    title: "Overview",
    icon: IconChartArea,
    languages: ["typescript", "python"],
  },

  // Quick Start (moved to top level)
  {
    type: "page",
    slug: "moosestack/quickstart",
    title: "Quick Start",
    icon: IconDatabase,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/getting-started/quickstart",
        title: "5-Minute Quickstart",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/getting-started/from-clickhouse",
        title: "Use with Existing ClickHouse",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Templates / Examples (standalone page, shown in MooseStack nav with arrow)
  {
    type: "page",
    slug: "templates",
    title: "Templates / Examples",
    icon: IconCode,
    languages: ["typescript", "python"],
    external: true,
  },

  // Separator
  { type: "separator" },

  // Fundamentals section (renamed from Getting Started)
  { type: "label", title: "Fundamentals" },
  {
    type: "page",
    slug: "moosestack/local-dev-environment",
    title: "Local Dev Environment",
    icon: IconRoute,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/moosedev-mcp",
    title: "MooseDev MCP",
    icon: IconStars,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/data-modeling",
    title: "Data Modeling",
    icon: IconDatabase,
    languages: ["typescript", "python"],
  },

  // Separator
  { type: "separator" },

  // MooseStack in your App section
  { type: "label", title: "MooseStack in your App" },
  {
    type: "page",
    slug: "moosestack/data-sources",
    title: "Data sources",
    icon: IconGitCompare,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/app-api-frameworks",
    title: "App / API frameworks",
    icon: IconCode,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/app-api-frameworks/nextjs",
        title: "Next.js",
        languages: ["typescript"],
      },
      {
        type: "page",
        slug: "moosestack/app-api-frameworks/express",
        title: "Express",
        languages: ["typescript"],
      },
      {
        type: "page",
        slug: "moosestack/app-api-frameworks/fastify",
        title: "Fastify",
        languages: ["typescript"],
      },
      {
        type: "page",
        slug: "moosestack/app-api-frameworks/koa",
        title: "Koa",
        languages: ["typescript"],
      },
      {
        type: "page",
        slug: "moosestack/app-api-frameworks/raw-nodejs",
        title: "Raw Node.js",
        languages: ["typescript"],
      },
      {
        type: "page",
        slug: "moosestack/app-api-frameworks/fastapi",
        title: "FastAPI",
        languages: ["python"],
      },
    ],
  },

  // Separator
  { type: "separator" },

  // Modules section
  { type: "label", title: "Modules" },
  {
    type: "page",
    slug: "moosestack/olap",
    title: "Moose OLAP",
    icon: IconDatabase,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Data Modeling" },
      {
        type: "page",
        slug: "moosestack/olap/model-table",
        title: "Tables",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-view",
        title: "Views",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-materialized-view",
        title: "Materialized Views",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/supported-types",
        title: "Supported Types",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "External Data & Introspection" },
      {
        type: "page",
        slug: "moosestack/olap/external-tables",
        title: "External Tables",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/db-pull",
        title: "Introspecting Tables",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Data Access" },
      {
        type: "page",
        slug: "moosestack/olap/insert-data",
        title: "Inserting Data",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/read-data",
        title: "Reading Data",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Performance & Optimization" },
      {
        type: "page",
        slug: "moosestack/olap/schema-optimization",
        title: "Schema Optimization",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/indexes",
        title: "Secondary & Data-skipping Indexes",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/ttl",
        title: "TTL (Time-to-Live)",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/schema-versioning",
        title: "Schema Versioning",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/streaming",
    title: "Moose Streaming",
    icon: IconBolt,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Manage Streams" },
      {
        type: "page",
        slug: "moosestack/streaming/create-stream",
        title: "Create Streams",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/sync-to-table",
        title: "Sync to OLAP",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/dead-letter-queues",
        title: "Dead Letter Queues",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Functions" },
      {
        type: "page",
        slug: "moosestack/streaming/consumer-functions",
        title: "Consumer Functions",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/transform-functions",
        title: "Transformation Functions",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Writing to Streams" },
      {
        type: "page",
        slug: "moosestack/streaming/from-your-code",
        title: "From Your Code",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/schema-registry",
        title: "Schema Registry",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/connect-cdc",
        title: "From CDC Services",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/workflows",
    title: "Moose Workflows",
    icon: IconRoute,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/workflows/define-workflow",
        title: "Define Workflows",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/workflows/schedule-workflow",
        title: "Scheduling",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/workflows/trigger-workflow",
        title: "Triggers",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/workflows/retries-and-timeouts",
        title: "Retries and Timeouts",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/workflows/cancel-workflow",
        title: "Cancelling Running Workflows",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/apis",
    title: "Moose APIs",
    icon: IconCode,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/apis/auth",
        title: "Auth",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/ingest-api",
        title: "Ingest New Data",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/analytics-api",
        title: "Expose Analytics",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/trigger-api",
        title: "Trigger Workflows",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Client Libraries" },
      {
        type: "page",
        slug: "moosestack/apis/openapi-sdk",
        title: "OpenAPI SDK",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/admin-api",
        title: "Admin APIs",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Separator
  { type: "separator" },

  // Deployment & Lifecycle section
  { type: "label", title: "Deployment & Lifecycle" },
  {
    type: "page",
    slug: "moosestack/migrate",
    title: "Moose Migrate",
    icon: IconGitMerge,
    languages: ["typescript", "python"],
    children: [
      { type: "separator" },
      { type: "label", title: "Lifecycle Management" },
      {
        type: "page",
        slug: "moosestack/migrate/lifecycle",
        title: "Overview",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/lifecycle-fully-managed",
        title: "Fully Managed",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/lifecycle-deletion-protected",
        title: "Deletion Protected",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/lifecycle-externally-managed",
        title: "Externally Managed",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Generating Migrations" },
      {
        type: "page",
        slug: "moosestack/migrate/modes",
        title: "Overview",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/auto-inferred",
        title: "Auto-Inferred",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/planned-migrations",
        title: "Planned",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/plan-format",
        title: "Plan Format",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Applying Migrations" },
      {
        type: "page",
        slug: "moosestack/migrate/apply-planned-migrations-cli",
        title: "Serverless (moose migrate)",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/apply-planned-migrations-service",
        title: "Server Runtime",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Advanced Topics" },
      {
        type: "page",
        slug: "moosestack/migrate/failed-migrations",
        title: "Failed Migrations",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/metrics",
    title: "Moose Observability",
    icon: IconChartBar,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/deploying",
    title: "Moose Deploy",
    icon: IconCloudUpload,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/deploying/packaging-moose-for-deployment",
        title: "Packaging Moose for deployment",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/preparing-clickhouse-redpanda",
        title: "Preparing Infrastructure",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/configuring-moose-for-cloud",
        title: "Cloud Configuration",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-on-kubernetes",
        title: "Kubernetes Deployment",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-on-ecs",
        title: "AWS ECS Deployment",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-on-an-offline-server",
        title: "Offline Deployment",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-with-docker-compose",
        title: "Docker Compose Deployment",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/monitoring",
        title: "Monitoring (moved)",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Separator
  { type: "separator" },

  // Reference section
  { type: "label", title: "Reference" },
  {
    type: "page",
    slug: "moosestack/reference",
    title: "API Reference",
    icon: IconBook,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/moose-cli",
    title: "CLI",
    icon: IconTerminal,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/configuration",
    title: "Project Configuration",
    icon: IconSettings,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/help",
    title: "Help",
    icon: IconHelpCircle,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/help/troubleshooting",
        title: "Troubleshooting",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/help/minimum-requirements",
        title: "Minimum Requirements",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/changelog",
    title: "Changelog",
    icon: IconHistory,
    languages: ["typescript", "python"],
  },
  { type: "separator" },
  { type: "label", title: "Contribution" },
  {
    type: "page",
    slug: "moosestack/contribution/documentation",
    title: "Documentation",
    icon: IconBook,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/contribution/framework",
    title: "Framework",
    icon: IconGitMerge,
    languages: ["typescript", "python"],
  },
];

/**
 * Hosting navigation configuration (placeholder)
 */
const hostingNavigationConfig: NavigationConfig = [
  {
    type: "page",
    slug: "hosting/overview",
    title: "Overview",
    icon: IconChartArea,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "hosting/getting-started",
    title: "Getting Started",
    icon: IconDatabase,
    languages: ["typescript", "python"],
  },
  { type: "separator" },
  { type: "label", title: "Deployment" },
  {
    type: "page",
    slug: "hosting/deployment",
    title: "Deployment Guide",
    icon: IconHammer,
    languages: ["typescript", "python"],
  },
];

/**
 * AI navigation configuration (Sloan)
 */
const aiNavigationConfig: NavigationConfig = [
  {
    type: "page",
    slug: "ai/index",
    title: "Introduction",
    icon: IconChartArea,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "ai/getting-started",
    title: "Getting Started",
    icon: IconRocket,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "ai/getting-started/claude",
        title: "Claude Desktop",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/getting-started/cursor",
        title: "Cursor",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/getting-started/windsurf",
        title: "Windsurf",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/getting-started/vs-code",
        title: "VS Code",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/getting-started/other-clients",
        title: "Other Clients",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "ai/guides",
    title: "Guides",
    icon: IconHandStop,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "ai/guides/clickhouse-chat",
        title: "AI Chat with ClickHouse",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/guides/clickhouse-proj",
        title: "AI analytics engineering from your ClickHouse",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/guides/from-template",
        title: "AI powered OLAP templates",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "ai/reference",
    title: "Reference",
    icon: IconBook,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "ai/reference/cli-reference",
        title: "CLI reference",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/reference/tool-reference",
        title: "Tools reference",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/reference/mcp-json-reference",
        title: "MCP.json reference",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "ai/data-collection-policy",
    title: "Data collection policy",
    icon: IconHistory,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "ai/demos",
    title: "Demos",
    icon: IconCode,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "ai/demos/ingest",
        title: "Ingest",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/demos/model-data",
        title: "Model Data",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/demos/mvs",
        title: "Materialized Views",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/demos/dlqs",
        title: "Dead Letter Queues",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/demos/egress",
        title: "Egress",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "ai/demos/context",
        title: "Context",
        languages: ["typescript", "python"],
      },
    ],
  },
];

/**
 * Templates navigation configuration (empty - templates is a standalone page)
 */
const templatesNavigationConfig: NavigationConfig = [];

/**
 * Guides navigation configuration
 */
const guidesNavigationConfig: NavigationConfig = [
  {
    type: "page",
    slug: "guides/index",
    title: "Overview",
    icon: IconChartArea,
    languages: ["typescript", "python"],
  },
  { type: "separator" },
  {
    type: "section",
    title: "Applications",
    items: [
      {
        type: "page",
        slug: "guides/applications/performant-dashboards",
        title: "Performant Dashboards",
        icon: IconChartLine,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/applications/in-app-chat-analytics",
        title: "In-App Chat Analytics",
        icon: IconMessageChatbot,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/applications/automated-reports",
        title: "Automated Reports",
        icon: IconFileReport,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/applications/going-to-production",
        title: "Going to Production",
        icon: IconCloudUpload,
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "section",
    title: "Data Management",
    items: [
      {
        type: "page",
        slug: "guides/data-management/migrations",
        title: "Migrations",
        icon: IconDatabaseImport,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/data-management/impact-analysis",
        title: "Impact Analysis",
        icon: IconChartDots,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/data-management/change-data-capture",
        title: "Change Data Capture",
        icon: IconBolt,
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "section",
    title: "Data Warehousing",
    items: [
      {
        type: "page",
        slug: "guides/data-warehousing/customer-data-platform",
        title: "Customer Data Platform",
        icon: IconUsers,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/operational-analytics",
        title: "Operational Analytics",
        icon: IconChartBarOff,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/startup-metrics",
        title: "Startup Metrics",
        icon: IconChartBar,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/connectors",
        title: "Connectors",
        icon: IconStack,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/pipelines",
        title: "Pipelines",
        icon: IconRoute,
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "section",
    title: "Methodology",
    items: [
      {
        type: "page",
        slug: "guides/methodology/data-as-code",
        title: "Data as Code",
        icon: IconCode,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/methodology/dora-for-data",
        title: "DORA for Data",
        icon: IconTrendingUp,
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "section",
    title: "Strategy",
    items: [
      {
        type: "page",
        slug: "guides/strategy/ai-enablement",
        title: "AI Enablement",
        icon: IconBrain,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/strategy/data-foundation",
        title: "Data Foundation",
        icon: IconDatabase,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/strategy/platform-engineering",
        title: "Platform Engineering",
        icon: IconServer,
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/strategy/olap-evaluation",
        title: "OLAP Evaluation",
        icon: IconDatabase,
        languages: ["typescript", "python"],
      },
    ],
  },
];

/**
 * All section navigation configurations
 */
export const sectionNavigationConfigs: Record<
  DocumentationSection,
  SectionNavigationConfig
> = {
  moosestack: {
    id: "moosestack",
    title: "MooseStack",
    nav: moosestackNavigationConfig,
  },
  hosting: {
    id: "hosting",
    title: "Hosting",
    nav: hostingNavigationConfig,
  },
  ai: {
    id: "ai",
    title: "AI",
    nav: aiNavigationConfig,
  },
  guides: {
    id: "guides",
    title: "Guides",
    nav: guidesNavigationConfig,
  },
  templates: {
    id: "templates",
    title: "Templates",
    nav: templatesNavigationConfig,
  },
};

/**
 * Default navigation configuration (backward compatibility)
 * Uses MooseStack navigation
 */
export const navigationConfig: NavigationConfig = moosestackNavigationConfig;

/**
 * Get navigation config for a specific section
 */
export function getNavigationConfig(
  section: DocumentationSection,
): NavigationConfig {
  return sectionNavigationConfigs[section].nav;
}

/**
 * Get the documentation section from a pathname
 * Returns null for the root path (/)
 */
export function getSectionFromPathname(
  pathname: string,
): DocumentationSection | null {
  // Remove leading slash and split
  const path = pathname.startsWith("/") ? pathname.slice(1) : pathname;

  // Return null for root path
  if (path === "" || path === "/") {
    return null;
  }

  const segments = path.split("/");

  // Check if path starts with a section prefix
  if (segments[0] === "hosting") {
    return "hosting";
  }
  if (segments[0] === "ai") {
    return "ai";
  }
  if (segments[0] === "guides") {
    return "guides";
  }
  if (segments[0] === "templates") {
    return "templates";
  }
  if (segments[0] === "moosestack") {
    return "moosestack";
  }

  // Default to moosestack (for backward compatibility with old URLs)
  return "moosestack";
}

/**
 * Build navigation items filtered by language
 * Filters out pages that don't support the selected language
 * Maintains array order and structure
 */
export function buildNavItems(
  config: NavigationConfig,
  language: Language,
): NavItem[] {
  function filterNavItem(item: NavItem): NavItem | null {
    if (item.type === "separator" || item.type === "label") {
      return item;
    }
    if (item.type === "section") {
      const filteredItems = item.items
        .map(filterNavItem)
        .filter((i): i is NavItem => i !== null);
      const hasRealItems = filteredItems.some(
        (i) =>
          i.type === "page" || (i.type === "section" && i.items.length > 0),
      );
      if (!hasRealItems) {
        return null;
      }
      return {
        ...item,
        items: filteredItems,
      };
    }
    // item.type === "page"
    const page = item as NavPage;
    // Filter by language
    if (!page.languages.includes(language)) {
      return null;
    }

    // Filter children recursively (now can be NavItem[])
    const filteredChildren = page.children
      ?.map(filterNavItem)
      .filter((child): child is NavItem => child !== null);

    return {
      ...page,
      children:
        filteredChildren && filteredChildren.length > 0 ?
          filteredChildren
        : undefined,
    };
  }

  return config
    .map(filterNavItem)
    .filter((item): item is NavItem => item !== null);
}

/**
 * Filter navigation items based on feature flags
 * Removes pages that should be hidden based on flags
 */
export function filterNavItemsByFlags(
  items: NavItem[],
  flags: { showDataSourcesPage?: boolean },
): NavItem[] {
  function filterNavItem(item: NavItem): NavItem | null {
    if (item.type === "separator" || item.type === "label") {
      return item;
    }
    if (item.type === "section") {
      const filteredItems = item.items
        .map(filterNavItem)
        .filter((i): i is NavItem => i !== null);
      const hasRealItems = filteredItems.some(
        (i) =>
          i.type === "page" || (i.type === "section" && i.items.length > 0),
      );
      if (!hasRealItems) {
        return null;
      }
      return {
        ...item,
        items: filteredItems,
      };
    }
    // item.type === "page"
    const page = item as NavPage;

    // Filter data-sources page if flag is off
    if (page.slug === "moosestack/data-sources" && !flags.showDataSourcesPage) {
      return null;
    }

    // Filter children recursively
    const filteredChildren = page.children
      ?.map(filterNavItem)
      .filter((child): child is NavItem => child !== null);

    return {
      ...page,
      children:
        filteredChildren && filteredChildren.length > 0 ?
          filteredChildren
        : undefined,
    };
  }

  return items
    .map(filterNavItem)
    .filter((item): item is NavItem => item !== null);
}
