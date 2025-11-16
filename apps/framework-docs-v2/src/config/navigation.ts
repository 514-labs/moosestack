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
      { type: "label", title: "Schema" },
      {
        type: "page",
        slug: "moosestack/olap/model-table",
        title: "Modeling Tables",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-materialized-view",
        title: "Modeling Materialized Views",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-view",
        title: "Modeling Views",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/supported-types",
        title: "Supported Types",
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
      { type: "separator" },
      { type: "label", title: "Remote ClickHouse" },
      {
        type: "page",
        slug: "moosestack/olap/external-tables",
        title: "External Tables",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/db-pull",
        title: "Syncing External Tables",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Migrations" },
      {
        type: "page",
        slug: "moosestack/olap/apply-migrations",
        title: "Applying Migrations",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/planned-migrations",
        title: "Generating Migrations",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/schema-versioning",
        title: "Table Versioning",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/schema-change",
        title: "Failed Migrations",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Accessing Data" },
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
    ],
  },
  {
    type: "page",
    slug: "moosestack/streaming",
    title: "Moose Streaming",
    icon: IconBolt,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Managing Streams" },
      {
        type: "page",
        slug: "moosestack/streaming/create-stream",
        title: "Creating Streams",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/sync-to-table",
        title: "Syncing Streams to Tables",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/dead-letter-queues",
        title: "Configuring Dead Letter Queues",
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

  // Deployment Tools & Guides section
  { type: "label", title: "Deployment Tools & Guides" },
  {
    type: "page",
    slug: "moosestack/migrate",
    title: "Moose Migrate",
    icon: IconGitMerge,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/migrate/migration-types",
        title: "Migration Types",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/lifecycle",
        title: "Lifecycle Management",
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
 * Structure: Guide → Overview → Starting Point → Overview/Requirements/Steps
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
        slug: "guides/applications/performant-dashboards/overview",
        title: "Performant Dashboards",
        icon: IconChartLine,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/applications/performant-dashboards/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Existing OLTP DB",
            items: [
              {
                type: "page",
                slug: "guides/applications/performant-dashboards/existing-oltp-db/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/performant-dashboards/existing-oltp-db/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/performant-dashboards/existing-oltp-db/1-setup-connection",
                title: "Setup Connection",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/performant-dashboards/existing-oltp-db/2-create-materialized-view",
                title: "Create Materialized View",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "New Application",
            items: [
              {
                type: "page",
                slug: "guides/applications/performant-dashboards/new-application/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/performant-dashboards/new-application/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/performant-dashboards/new-application/1-initialize-project",
                title: "Initialize Project",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/applications/in-app-chat-analytics/overview",
        title: "In-App Chat Analytics",
        icon: IconMessageChatbot,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/applications/in-app-chat-analytics/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Existing Chat System",
            items: [
              {
                type: "page",
                slug: "guides/applications/in-app-chat-analytics/existing-chat-system/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/in-app-chat-analytics/existing-chat-system/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/in-app-chat-analytics/existing-chat-system/1-integrate-event-tracking",
                title: "Integrate Event Tracking",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "New Chat Feature",
            items: [
              {
                type: "page",
                slug: "guides/applications/in-app-chat-analytics/new-chat-feature/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/in-app-chat-analytics/new-chat-feature/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/in-app-chat-analytics/new-chat-feature/1-setup-chat-schema",
                title: "Setup Chat Schema",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/applications/automated-reports/overview",
        title: "Automated Reports",
        icon: IconFileReport,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/applications/automated-reports/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Scheduled Reports",
            items: [
              {
                type: "page",
                slug: "guides/applications/automated-reports/scheduled-reports/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/automated-reports/scheduled-reports/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/automated-reports/scheduled-reports/1-create-report-template",
                title: "Create Report Template",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "Event-Driven Reports",
            items: [
              {
                type: "page",
                slug: "guides/applications/automated-reports/event-driven-reports/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/automated-reports/event-driven-reports/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/automated-reports/event-driven-reports/1-setup-event-triggers",
                title: "Setup Event Triggers",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/applications/going-to-production/overview",
        title: "Going to Production",
        icon: IconCloudUpload,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/applications/going-to-production/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Local Development",
            items: [
              {
                type: "page",
                slug: "guides/applications/going-to-production/local-development/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/going-to-production/local-development/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/going-to-production/local-development/1-prepare-environment",
                title: "Prepare Environment",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "Staging Environment",
            items: [
              {
                type: "page",
                slug: "guides/applications/going-to-production/staging-environment/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/going-to-production/staging-environment/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/applications/going-to-production/staging-environment/1-deploy-infrastructure",
                title: "Deploy Infrastructure",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "section",
    title: "Data Management",
    items: [
      {
        type: "page",
        slug: "guides/data-management/migrations/overview",
        title: "Migrations",
        icon: IconDatabaseImport,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-management/migrations/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Schema Changes",
            items: [
              {
                type: "page",
                slug: "guides/data-management/migrations/schema-changes/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/migrations/schema-changes/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/migrations/schema-changes/1-create-migration-script",
                title: "Create Migration Script",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "Data Migration",
            items: [
              {
                type: "page",
                slug: "guides/data-management/migrations/data-migration/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/migrations/data-migration/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/migrations/data-migration/1-backup-existing-data",
                title: "Backup Existing Data",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "Version Upgrades",
            items: [
              {
                type: "page",
                slug: "guides/data-management/migrations/version-upgrades/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/migrations/version-upgrades/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/migrations/version-upgrades/1-review-changelog",
                title: "Review Changelog",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/data-management/impact-analysis/overview",
        title: "Impact Analysis",
        icon: IconChartDots,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-management/impact-analysis/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Schema Changes",
            items: [
              {
                type: "page",
                slug: "guides/data-management/impact-analysis/schema-changes/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/impact-analysis/schema-changes/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/impact-analysis/schema-changes/1-identify-dependencies",
                title: "Identify Dependencies",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "Query Changes",
            items: [
              {
                type: "page",
                slug: "guides/data-management/impact-analysis/query-changes/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/impact-analysis/query-changes/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/impact-analysis/query-changes/1-analyze-query-performance",
                title: "Analyze Query Performance",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/data-management/change-data-capture/overview",
        title: "Change Data Capture",
        icon: IconBolt,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-management/change-data-capture/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Database CDC",
            items: [
              {
                type: "page",
                slug: "guides/data-management/change-data-capture/database-cdc/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/change-data-capture/database-cdc/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/change-data-capture/database-cdc/1-enable-cdc-logging",
                title: "Enable CDC Logging",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "Application Events",
            items: [
              {
                type: "page",
                slug: "guides/data-management/change-data-capture/application-events/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/change-data-capture/application-events/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-management/change-data-capture/application-events/1-implement-event-emitter",
                title: "Implement Event Emitter",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "section",
    title: "Data Warehousing",
    items: [
      {
        type: "page",
        slug: "guides/data-warehousing/customer-data-platform/overview",
        title: "Customer Data Platform",
        icon: IconUsers,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-warehousing/customer-data-platform/guide-overview",
            title: "Overview",
            languages: ["typescript", "python"],
          },
          {
            type: "section",
            title: "Existing Customer Data",
            items: [
              {
                type: "page",
                slug: "guides/data-warehousing/customer-data-platform/existing-customer-data/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/customer-data-platform/existing-customer-data/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/customer-data-platform/existing-customer-data/1-consolidate-data-sources",
                title: "Consolidate Data Sources",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "section",
            title: "Multi-Source Integration",
            items: [
              {
                type: "page",
                slug: "guides/data-warehousing/customer-data-platform/multi-source-integration/overview",
                title: "Implementation Overview",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/customer-data-platform/multi-source-integration/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/customer-data-platform/multi-source-integration/1-setup-connectors",
                title: "Setup Connectors",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/operational-analytics/overview",
        title: "Operational Analytics",
        icon: IconChartBarOff,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-warehousing/operational-analytics/application-metrics/overview",
            title: "Application Metrics",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/operational-analytics/application-metrics/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/operational-analytics/application-metrics/1-instrument-application",
                title: "Instrument Application",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/data-warehousing/operational-analytics/infrastructure-monitoring/overview",
            title: "Infrastructure Monitoring",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/operational-analytics/infrastructure-monitoring/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/operational-analytics/infrastructure-monitoring/1-collect-system-metrics",
                title: "Collect System Metrics",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/startup-metrics/overview",
        title: "Startup Metrics",
        icon: IconChartBar,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-warehousing/startup-metrics/product-metrics/overview",
            title: "Product Metrics",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/startup-metrics/product-metrics/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/startup-metrics/product-metrics/1-define-kpis",
                title: "Define KPIs",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/data-warehousing/startup-metrics/business-metrics/overview",
            title: "Business Metrics",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/startup-metrics/business-metrics/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/startup-metrics/business-metrics/1-setup-revenue-tracking",
                title: "Setup Revenue Tracking",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/connectors/overview",
        title: "Connectors",
        icon: IconStack,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-warehousing/connectors/database-connector/overview",
            title: "Database Connector",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/connectors/database-connector/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/connectors/database-connector/1-configure-connection",
                title: "Configure Connection",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/data-warehousing/connectors/api-connector/overview",
            title: "API Connector",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/connectors/api-connector/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/connectors/api-connector/1-setup-authentication",
                title: "Setup Authentication",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/data-warehousing/connectors/custom-connector/overview",
            title: "Custom Connector",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/connectors/custom-connector/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/connectors/custom-connector/1-create-connector-class",
                title: "Create Connector Class",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/data-warehousing/pipelines/overview",
        title: "Pipelines",
        icon: IconRoute,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/data-warehousing/pipelines/etl-pipeline/overview",
            title: "ETL Pipeline",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/pipelines/etl-pipeline/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/pipelines/etl-pipeline/1-extract-data",
                title: "Extract Data",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/data-warehousing/pipelines/streaming-pipeline/overview",
            title: "Streaming Pipeline",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/data-warehousing/pipelines/streaming-pipeline/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/data-warehousing/pipelines/streaming-pipeline/1-setup-stream-source",
                title: "Setup Stream Source",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "section",
    title: "Methodology",
    items: [
      {
        type: "page",
        slug: "guides/methodology/data-as-code/overview",
        title: "Data as Code",
        icon: IconCode,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/methodology/data-as-code/version-control-setup/overview",
            title: "Version Control Setup",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/methodology/data-as-code/version-control-setup/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/methodology/data-as-code/version-control-setup/1-initialize-repository",
                title: "Initialize Repository",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/methodology/data-as-code/cicd-integration/overview",
            title: "CI/CD Integration",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/methodology/data-as-code/cicd-integration/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/methodology/data-as-code/cicd-integration/1-create-pipeline-config",
                title: "Create Pipeline Config",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/methodology/dora-for-data/overview",
        title: "DORA for Data",
        icon: IconTrendingUp,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/methodology/dora-for-data/deployment-frequency/overview",
            title: "Deployment Frequency",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/methodology/dora-for-data/deployment-frequency/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/methodology/dora-for-data/deployment-frequency/1-measure-current-frequency",
                title: "Measure Current Frequency",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/methodology/dora-for-data/lead-time/overview",
            title: "Lead Time",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/methodology/dora-for-data/lead-time/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/methodology/dora-for-data/lead-time/1-track-change-lifecycle",
                title: "Track Change Lifecycle",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
    ],
  },
  {
    type: "section",
    title: "Strategy",
    items: [
      {
        type: "page",
        slug: "guides/strategy/ai-enablement/overview",
        title: "AI Enablement",
        icon: IconBrain,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/strategy/ai-enablement/llm-integration/overview",
            title: "LLM Integration",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/ai-enablement/llm-integration/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/ai-enablement/llm-integration/1-choose-llm-provider",
                title: "Choose LLM Provider",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/strategy/ai-enablement/vector-search/overview",
            title: "Vector Search",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/ai-enablement/vector-search/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/ai-enablement/vector-search/1-setup-vector-database",
                title: "Setup Vector Database",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/strategy/data-foundation/overview",
        title: "Data Foundation",
        icon: IconDatabase,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/strategy/data-foundation/greenfield-project/overview",
            title: "Greenfield Project",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/data-foundation/greenfield-project/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/data-foundation/greenfield-project/1-design-data-architecture",
                title: "Design Data Architecture",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/strategy/data-foundation/legacy-system-migration/overview",
            title: "Legacy System Migration",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/data-foundation/legacy-system-migration/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/data-foundation/legacy-system-migration/1-assess-current-state",
                title: "Assess Current State",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/strategy/platform-engineering/overview",
        title: "Platform Engineering",
        icon: IconServer,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/strategy/platform-engineering/internal-platform/overview",
            title: "Internal Platform",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/platform-engineering/internal-platform/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/platform-engineering/internal-platform/1-define-platform-scope",
                title: "Define Platform Scope",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/strategy/platform-engineering/self-service-tools/overview",
            title: "Self-Service Tools",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/platform-engineering/self-service-tools/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/platform-engineering/self-service-tools/1-create-developer-portal",
                title: "Create Developer Portal",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
      },
      {
        type: "page",
        slug: "guides/strategy/olap-evaluation/overview",
        title: "OLAP Evaluation",
        icon: IconDatabase,
        languages: ["typescript", "python"],
        children: [
          {
            type: "page",
            slug: "guides/strategy/olap-evaluation/performance-requirements/overview",
            title: "Performance Requirements",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/olap-evaluation/performance-requirements/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/olap-evaluation/performance-requirements/1-benchmark-queries",
                title: "Benchmark Queries",
                languages: ["typescript", "python"],
              },
            ],
          },
          {
            type: "page",
            slug: "guides/strategy/olap-evaluation/scale-requirements/overview",
            title: "Scale Requirements",
            languages: ["typescript", "python"],
            children: [
              {
                type: "page",
                slug: "guides/strategy/olap-evaluation/scale-requirements/requirements",
                title: "Requirements",
                languages: ["typescript", "python"],
              },
              {
                type: "page",
                slug: "guides/strategy/olap-evaluation/scale-requirements/1-estimate-data-volume",
                title: "Estimate Data Volume",
                languages: ["typescript", "python"],
              },
            ],
          },
        ],
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
