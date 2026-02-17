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
/**
 * Guide status for visibility control
 * - draft: Hidden by default, visible only with show-draft-guides flag
 * - beta: Hidden by default, visible only with show-beta-guides flag
 * - undefined/not set: Always visible (public)
 */
export type GuideStatus = "draft" | "beta";

export interface NavPage {
  type: "page";
  slug: string;
  title: string;
  description?: string; // Optional description for guides
  languages: Language[];
  icon?: TablerIcon;
  children?: NavItem[]; // Allow NavItem[] to support labels/separators within children
  external?: boolean; // If true, indicates this is a standalone page (not part of the current section)
  status?: GuideStatus; // Visibility level for guides (draft, beta, or public if not set)
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

  // Separator
  { type: "separator" },

  // Getting Started (top-level paths)
  { type: "label", title: "Build a New App" },

  // Build a new app
  {
    type: "page",
    slug: "moosestack/getting-started/quickstart",
    title: "5 Minute Quickstart",
    icon: IconRocket,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "templates",
    title: "Browse Templates",
    icon: IconCode,
    languages: ["typescript", "python"],
    external: true,
  },
  // Connect to an existing ClickHouse
  {
    type: "page",
    slug: "moosestack/getting-started/from-clickhouse",
    icon: IconDatabase,
    title: "Existing ClickHouse",
    languages: ["typescript", "python"],
  },
  // Embed in an existing app
  { type: "separator" },
  { type: "label", title: "Add to Existing App" },
  {
    type: "page",
    slug: "moosestack/getting-started/existing-app/next-js",
    title: "Next.js",
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/getting-started/existing-app/fastify",
    title: "Fastify",
    languages: ["typescript", "python"],
  },

  // Separator
  { type: "separator" },

  // Fundamentals section (renamed from Getting Started)
  { type: "label", title: "Fundamentals" },
  {
    type: "page",
    slug: "moosestack/runtime",
    title: "Moose Runtime",
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
    slug: "moosestack/language-server",
    title: "Language Server",
    icon: IconFileCode,
    languages: ["typescript"],
  },
  {
    type: "page",
    slug: "moosestack/data-modeling",
    title: "Data Modeling",
    icon: IconDatabase,
    languages: ["typescript", "python"],
  },
  { type: "separator" },
  { type: "label", title: "Moose Modules" },
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
        slug: "moosestack/olap/materialized-columns",
        title: "Materialized Columns",
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
    title: "Moose APIs & Web Apps",
    icon: IconCode,
    languages: ["typescript", "python"],
    children: [
      { type: "separator" },
      { type: "label", title: "Native APIs" },
      {
        type: "page",
        slug: "moosestack/apis/ingest-api",
        title: "Ingest API",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/analytics-api",
        title: "Analytics API",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/trigger-api",
        title: "Workflow Trigger",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/admin-api",
        title: "Admin APIs",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/auth",
        title: "Authentication",
        languages: ["typescript", "python"],
      },

      // Modules section
      { type: "separator" },
      { type: "label", title: "Use Your Web Framework" },
      {
        type: "page",
        slug: "moosestack/app-api-frameworks",
        title: "Overview",
        languages: ["typescript", "python"],
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

  // Deployment & Lifecycle section
  { type: "label", title: "Deployment & Lifecycle" },
  {
    type: "page",
    slug: "moosestack/dev",
    title: "Moose Dev",
    icon: IconDeviceLaptop,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/dev/cdc-managed-tables",
        title: "CDC Managed Tables",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/migrate",
    title: "Moose Migrate",
    icon: IconGitMerge,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Migration Modes" },
      {
        type: "page",
        slug: "moosestack/migrate/automatic",
        title: "Automatic Migrations",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/planned-migrations",
        title: "Planned Migrations",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/plan-format",
        title: "Plan Reference",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Executing Migrations" },
      {
        type: "page",
        slug: "moosestack/migrate/apply-planned-migrations-cli",
        title: "moose migrate (CLI)",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/apply-planned-migrations-service",
        title: "moose prod (Runtime)",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Lifecycle Management" },
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
    slug: "moosestack/data-types",
    title: "Data Types",
    icon: IconAtom,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/data-types/strings",
        title: "Strings",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/low-cardinality",
        title: "LowCardinality",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/integers",
        title: "Integers",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/floats",
        title: "Floats",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/decimals",
        title: "Decimals",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/booleans",
        title: "Booleans",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/datetime",
        title: "Date & Time",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/network",
        title: "Network",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/arrays",
        title: "Arrays",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/maps",
        title: "Maps",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/nested",
        title: "Nested",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/tuples",
        title: "Tuples",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/enums",
        title: "Enums",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/geometry",
        title: "Geometry",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/json",
        title: "JSON",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/nullable",
        title: "Nullable",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/aggregates",
        title: "Aggregates",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/engines",
    title: "Table Engines",
    icon: IconServer,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/engines/merge-tree",
        title: "MergeTree",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/replacing-merge-tree",
        title: "ReplacingMergeTree",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/aggregating-merge-tree",
        title: "AggregatingMergeTree",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/summing-merge-tree",
        title: "SummingMergeTree",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/replicated",
        title: "Replicated Engines",
        languages: ["typescript", "python"],
      },
    ],
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
    title: "Configuration",
    icon: IconSettings,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Core Settings" },
      {
        type: "page",
        slug: "moosestack/configuration/project-settings",
        title: "Project Settings",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/typescript",
        title: "TypeScript",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/telemetry",
        title: "Telemetry",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/git",
        title: "Git",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/features",
        title: "Features",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/migrations",
        title: "Migrations",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/docker",
        title: "Docker",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Infrastructure" },
      {
        type: "page",
        slug: "moosestack/configuration/clickhouse",
        title: "ClickHouse",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/redpanda",
        title: "Redpanda",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/redis",
        title: "Redis",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/temporal",
        title: "Temporal",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/http-server",
        title: "HTTP Server",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/state-storage",
        title: "State Storage",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Security" },
      {
        type: "page",
        slug: "moosestack/configuration/jwt",
        title: "JWT",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/configuration/admin-api",
        title: "Admin API",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Development" },
      {
        type: "page",
        slug: "moosestack/configuration/dev-environment",
        title: "Dev Environment",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/metrics",
    title: "Observability Metrics",
    icon: IconChartBar,
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
      {
        type: "page",
        slug: "moosestack/help/windows-setup",
        title: "Windows Setup",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "moosestack/release-notes",
    title: "Release Notes",
    icon: IconFileReport,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/release-notes/2026-02-12",
        title: "February 12, 2026",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2026-02-06",
        title: "February 6, 2026",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2026-01-30",
        title: "January 30, 2026",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2026-01-23",
        title: "January 23, 2026",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2026-01-16",
        title: "January 16, 2026",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2026-01-09",
        title: "January 9, 2026",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-12-22",
        title: "December 22, 2025",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-12-15",
        title: "December 15, 2025",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-12-05",
        title: "December 5, 2025",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-11-22",
        title: "November 22, 2025",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-11-14",
        title: "November 14, 2025",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-11-07",
        title: "November 7, 2025",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-11-01",
        title: "November 1, 2025",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/release-notes/2025-10-24",
        title: "October 24, 2025",
        languages: ["typescript", "python"],
      },
    ],
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
 * Hosting navigation configuration
 */
const hostingNavigationConfig: NavigationConfig = [
  {
    type: "page",
    slug: "hosting",
    title: "Hosting Overview",
    languages: ["typescript", "python"],
  },
  { type: "separator" },
  { type: "label", title: "CLI" },
  {
    type: "page",
    slug: "hosting/cli/auth",
    title: "auth",
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "hosting/cli/setup",
    title: "setup",
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "hosting/cli/link",
    title: "link",
    languages: ["typescript", "python"],
  },
  { type: "separator" },
  { type: "label", title: "Workflow" },
  {
    type: "page",
    slug: "hosting/workflow/fiveonefour-to-local-setup",
    title: "Fiveonefour to Local Setup",
    languages: ["typescript", "python"],
  },
  { type: "separator" },
  { type: "label", title: "Troubleshooting" },
  {
    type: "page",
    slug: "hosting/troubleshooting/setup-failures",
    title: "Setup Failures",
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
 * Note: No Overview page here - the guides index page handles its own content
 * (Coming Soon or Grid layout based on visible guides)
 *
 * Top-level pages (type: "page" at root) appear without a section header
 * Sectioned pages (inside type: "section") appear under their section title
 */
const guidesNavigationConfig: NavigationConfig = [
  // ===========================================
  // 5 Priority Guides (from Linear project)
  // https://linear.app/514/project/ship-the-first-iteration-of-guides-and-test-them-within-our-customers-d3b3d83562d9
  // ===========================================
  {
    type: "page",
    slug: "guides/performant-dashboards",
    title: "Improving the Performance of Your Dashboards",
    description:
      "Already have a dashboard or report running? Here's how to boost performance with OLAP best practices.",
    icon: IconChartLine,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "guides/performant-dashboards/overview",
        title: "Overview",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/performant-dashboards/tutorial",
        title: "Tutorial",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "guides/chat-in-your-app",
    title: "Chat in your app",
    description:
      "Build a data-aware chat on top of your ClickHouse database with Next.js and MooseStack.",
    icon: IconMessageChatbot,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "guides/chat-in-your-app/overview",
        title: "Overview",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/chat-in-your-app/build",
        title: "Build",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "guides/chat-in-your-app/tutorial",
        title: "Tutorial",
        languages: ["typescript", "python"],
      },
    ],
  },
  {
    type: "page",
    slug: "guides/customer-data-platform",
    title: "Customer Data Platform (CDP)",
    icon: IconUsers,
    languages: ["typescript", "python"],
    status: "draft",
  },
  {
    type: "page",
    slug: "guides/static-report-generation",
    title: "Static Report Generation",
    icon: IconFileReport,
    languages: ["typescript", "python"],
    status: "draft",
  },
  {
    type: "page",
    slug: "guides/data-warehouses",
    title: "Data Warehouses",
    icon: IconDatabase,
    languages: ["typescript", "python"],
    status: "draft",
  },

  // ===========================================
  // Additional Draft Guides (organized by section)
  // ===========================================
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
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/applications/in-app-chat-analytics",
        title: "In-App Chat Analytics",
        icon: IconMessageChatbot,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/applications/automated-reports",
        title: "Automated Reports",
        icon: IconFileReport,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/applications/going-to-production",
        title: "Going to Production",
        icon: IconCloudUpload,
        languages: ["typescript", "python"],
        status: "draft",
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
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/data-management/impact-analysis",
        title: "Impact Analysis",
        icon: IconChartDots,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/data-management/change-data-capture",
        title: "Change Data Capture",
        icon: IconBolt,
        languages: ["typescript", "python"],
        status: "draft",
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
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/data-warehousing/operational-analytics",
        title: "Operational Analytics",
        icon: IconChartBarOff,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/data-warehousing/startup-metrics",
        title: "Startup Metrics",
        icon: IconChartBar,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/data-warehousing/connectors",
        title: "Connectors",
        icon: IconStack,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/data-warehousing/pipelines",
        title: "Pipelines",
        icon: IconRoute,
        languages: ["typescript", "python"],
        status: "draft",
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
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/methodology/dora-for-data",
        title: "DORA for Data",
        icon: IconTrendingUp,
        languages: ["typescript", "python"],
        status: "draft",
      },
    ],
  },
  {
    type: "section",
    title: "Test Guides",
    items: [
      {
        type: "page",
        slug: "guides/test-guides/mermaid-test",
        title: "Mermaid Diagram Test",
        icon: IconFileCode,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/test-guides/content-components-demo",
        title: "Content Components Demo",
        icon: IconFileCode,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/test-guides/code-blocks",
        title: "Code Blocks Rendering Test",
        icon: IconFileCode,
        languages: ["typescript", "python"],
        status: "draft",
      },
      {
        type: "page",
        slug: "guides/test-guides/interactive-guide-demo",
        title: "Interactive Components Demo",
        icon: IconFileCode,
        languages: ["typescript", "python"],
        status: "draft",
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
 * Feature flags for navigation filtering
 */
export interface NavFilterFlags {
  showDataSourcesPage?: boolean;
  showDraftGuides?: boolean;
  showBetaGuides?: boolean;
}

/**
 * Filter navigation items based on feature flags
 * Removes pages that should be hidden based on flags
 */
export function filterNavItemsByFlags(
  items: NavItem[],
  flags: NavFilterFlags,
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

    // Filter draft pages if flag is off
    if (page.status === "draft" && !flags.showDraftGuides) {
      return null;
    }

    // Filter beta pages if flag is off
    if (page.status === "beta" && !flags.showBetaGuides) {
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

/**
 * Check if there are any visible guides after filtering
 * Used to determine whether to show Coming Soon page
 */
export function hasVisibleGuides(
  items: NavItem[],
  flags: { showDraftGuides: boolean; showBetaGuides: boolean },
): boolean {
  function checkItems(navItems: NavItem[]): boolean {
    for (const item of navItems) {
      if (item.type === "page") {
        // Skip draft pages if flag is off
        if (item.status === "draft" && !flags.showDraftGuides) {
          continue;
        }
        // Skip beta pages if flag is off
        if (item.status === "beta" && !flags.showBetaGuides) {
          continue;
        }
        // Found a visible guide page
        if (item.slug.startsWith("guides/") && item.slug !== "guides/index") {
          return true;
        }
      }
      if (item.type === "section") {
        if (checkItems(item.items)) {
          return true;
        }
      }
    }
    return false;
  }
  return checkItems(items);
}

/**
 * Serializable guide item for passing to client components
 * Does not include icon (which is a function/component)
 */
export interface SerializableGuideItem {
  slug: string;
  title: string;
  description?: string;
  iconName?: string;
  previewVariant?: string;
  previewImageIndexFile?: string;
  languages?: string[];
  tags?: string[];
}

/**
 * Serializable guide section for passing to client components
 */
export interface SerializableGuideSection {
  title: string;
  items: SerializableGuideItem[];
}

/**
 * Map of icon components to their string names for serialization
 * This is necessary because React components created with forwardRef
 * don't have a reliable .name property
 */
const iconToNameMap = new Map<TablerIcon, string>([
  [IconChartLine, "IconChartLine"],
  [IconMessageChatbot, "IconMessageChatbot"],
  [IconFileReport, "IconFileReport"],
  [IconCloudUpload, "IconCloudUpload"],
  [IconDatabaseImport, "IconDatabaseImport"],
  [IconChartDots, "IconChartDots"],
  [IconBolt, "IconBolt"],
  [IconUsers, "IconUsers"],
  [IconChartBarOff, "IconChartBarOff"],
  [IconChartBar, "IconChartBar"],
  [IconStack, "IconStack"],
  [IconRoute, "IconRoute"],
  [IconCode, "IconCode"],
  [IconTrendingUp, "IconTrendingUp"],
  [IconBrain, "IconBrain"],
  [IconDatabase, "IconDatabase"],
  [IconServer, "IconServer"],
  [IconRocket, "IconRocket"],
]);

/**
 * Get icon name from icon component for serialization
 */
function getIconName(icon?: TablerIcon): string | undefined {
  if (!icon) return undefined;
  return iconToNameMap.get(icon);
}

/**
 * Get visible guides sections for the grid layout
 * Returns serializable sections (without icon components) for client components
 * Supports both:
 * - Top-level guides (pages not inside a section) - shown first with null title
 * - Sectioned guides (pages inside a section) - shown with section title
 *
 * Note: This function does NOT load frontmatter. Languages and tags should be
 * loaded separately in server components using loadGuideFrontmatter utility.
 */
export function getVisibleGuideSections(flags: {
  showDraftGuides: boolean;
  showBetaGuides: boolean;
}): SerializableGuideSection[] {
  const sections: SerializableGuideSection[] = [];

  function isPageVisible(page: NavPage): boolean {
    if (page.status === "draft" && !flags.showDraftGuides) return false;
    if (page.status === "beta" && !flags.showBetaGuides) return false;
    return true;
  }

  // First, collect top-level guides (not inside a section)
  const topLevelGuides: SerializableGuideItem[] = [];

  for (const item of guidesNavigationConfig) {
    if (item.type === "page") {
      // Skip hidden pages
      if (!isPageVisible(item)) continue;
      // Skip index page
      if (item.slug === "guides/index") continue;

      topLevelGuides.push({
        slug: item.slug,
        title: item.title,
        description: item.description,
        iconName: getIconName(item.icon),
        // languages and tags will be populated by loadGuideFrontmatter in server component
      });
    }
  }

  // Add top-level guides as first section (no title header)
  if (topLevelGuides.length > 0) {
    sections.push({
      title: "",
      items: topLevelGuides,
    });
  }

  // Then collect sectioned guides
  for (const item of guidesNavigationConfig) {
    if (item.type === "section") {
      const visibleItems: SerializableGuideItem[] = [];

      for (const subItem of item.items) {
        if (subItem.type !== "page") continue;
        if (!isPageVisible(subItem)) continue;

        visibleItems.push({
          slug: subItem.slug,
          title: subItem.title,
          description: subItem.description,
          iconName: getIconName(subItem.icon),
          // languages and tags will be populated by loadGuideFrontmatter in server component
        });
      }

      if (visibleItems.length > 0) {
        sections.push({
          title: item.title,
          items: visibleItems,
        });
      }
    }
  }

  return sections;
}
