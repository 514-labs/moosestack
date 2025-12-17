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
  // ===========================================
  // GET STARTED
  // ===========================================
  {
    type: "page",
    slug: "moosestack/index",
    title: "Overview",
    icon: IconChartArea,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/getting-started",
    title: "Getting Started",
    icon: IconRocket,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "New Project" },
      {
        type: "page",
        slug: "moosestack/getting-started/quickstart",
        title: "5-Minute Quickstart",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "templates",
        title: "Browse Templates →",
        languages: ["typescript", "python"],
        external: true,
      },
      { type: "separator" },
      { type: "label", title: "Existing App" },
      {
        type: "page",
        slug: "moosestack/getting-started/existing-app/next-js",
        title: "Next.js",
        languages: ["typescript"],
      },
      {
        type: "page",
        slug: "moosestack/getting-started/existing-app/fastify",
        title: "Fastify",
        languages: ["typescript"],
      },
      { type: "separator" },
      {
        type: "page",
        slug: "moosestack/getting-started/from-clickhouse",
        title: "From Existing ClickHouse",
        languages: ["typescript", "python"],
      },
    ],
  },
  { type: "separator" },

  // ===========================================
  // CONCEPTS
  // ===========================================
  { type: "label", title: "Concepts" },
  {
    type: "page",
    slug: "moosestack/runtime",
    title: "Moose Runtime",
    icon: IconRoute,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/data-modeling",
    title: "Data Modeling",
    icon: IconDatabase,
    languages: ["typescript", "python"],
  },
  {
    type: "page",
    slug: "moosestack/moosedev-mcp",
    title: "MooseDev MCP",
    icon: IconStars,
    languages: ["typescript", "python"],
  },

  { type: "separator" },

  // ===========================================
  // HOW-TO TUTORIALS
  // ===========================================
  { type: "label", title: "How-To Tutorials" },

  // Model Your Data
  {
    type: "page",
    slug: "moosestack/olap/model-table",
    title: "Model Your Data",
    icon: IconDatabase,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/olap/model-table",
        title: "Define Tables",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-view",
        title: "Create Views",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-materialized-view",
        title: "Create Materialized Views",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Optimize Schema" },
      {
        type: "page",
        slug: "moosestack/olap/schema-optimization",
        title: "Schema Optimization",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/indexes",
        title: "Indexes",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/ttl",
        title: "TTL (Time-to-Live)",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "External Tables" },
      {
        type: "page",
        slug: "moosestack/olap/external-tables",
        title: "Work with External Tables",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/db-pull",
        title: "Introspect from Database",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Ingest Data
  {
    type: "page",
    slug: "moosestack/apis/ingest-api",
    title: "Ingest Data",
    icon: IconDatabaseImport,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/apis/ingest-api",
        title: "Via Ingest API",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/from-your-code",
        title: "Via Streams",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/connect-cdc",
        title: "From CDC Sources",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/insert-data",
        title: "Batch Insert from Code",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Process Data
  {
    type: "page",
    slug: "moosestack/streaming/transform-functions",
    title: "Process Data",
    icon: IconBolt,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/streaming/transform-functions",
        title: "Transform Streams",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/consumer-functions",
        title: "Consume Stream Events",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/sync-to-table",
        title: "Sync Streams to Tables",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      {
        type: "page",
        slug: "moosestack/workflows/define-workflow",
        title: "Build ETL Workflows",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/workflows/schedule-workflow",
        title: "Schedule Background Jobs",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Expose Data to Apps
  {
    type: "page",
    slug: "moosestack/apis/analytics-api",
    title: "Expose Data to Apps",
    icon: IconCode,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/apis/analytics-api",
        title: "Build Analytics APIs",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/read-data",
        title: "Query Data from Code",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/openapi-sdk",
        title: "Generate Client SDKs",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Web Frameworks" },
      {
        type: "page",
        slug: "moosestack/app-api-frameworks",
        title: "Overview",
        languages: ["typescript", "python"],
      },
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
        slug: "moosestack/app-api-frameworks/fastapi",
        title: "FastAPI",
        languages: ["python"],
      },
    ],
  },

  { type: "separator" },

  // ===========================================
  // MODULE REFERENCE
  // ===========================================
  { type: "label", title: "Module Reference" },

  // OLAP
  {
    type: "page",
    slug: "moosestack/olap",
    title: "OLAP",
    icon: IconDatabase,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/olap/model-table",
        title: "OlapTable",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-view",
        title: "View",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/olap/model-materialized-view",
        title: "MaterializedView",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      {
        type: "page",
        slug: "moosestack/data-types",
        title: "Column Types",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines",
        title: "Table Engines",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Streams
  {
    type: "page",
    slug: "moosestack/streaming",
    title: "Streams",
    icon: IconBolt,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Primitives" },
      {
        type: "page",
        slug: "moosestack/streaming/create-stream",
        title: "Stream",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/consumer-functions",
        title: "ConsumerFunction",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/streaming/transform-functions",
        title: "TransformFunction",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Configuration" },
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
      {
        type: "page",
        slug: "moosestack/streaming/schema-registry",
        title: "Schema Registry",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Workflows
  {
    type: "page",
    slug: "moosestack/workflows",
    title: "Workflows",
    icon: IconRoute,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Primitives" },
      {
        type: "page",
        slug: "moosestack/workflows/define-workflow",
        title: "Workflow",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/workflows/define-workflow",
        title: "Task",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Configuration" },
      {
        type: "page",
        slug: "moosestack/workflows/trigger-workflow",
        title: "Triggers",
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
        slug: "moosestack/workflows/retries-and-timeouts",
        title: "Retries & Timeouts",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/workflows/cancel-workflow",
        title: "Cancellation",
        languages: ["typescript", "python"],
      },
    ],
  },

  // APIs
  {
    type: "page",
    slug: "moosestack/apis",
    title: "APIs",
    icon: IconCode,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Primitives" },
      {
        type: "page",
        slug: "moosestack/apis/ingest-api",
        title: "IngestApi",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/apis/analytics-api",
        title: "Api (Analytics)",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Configuration" },
      {
        type: "page",
        slug: "moosestack/apis/auth",
        title: "Auth",
        languages: ["typescript", "python"],
      },
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

  { type: "separator" },

  // ===========================================
  // DEPLOYMENT
  // ===========================================
  { type: "label", title: "Deployment" },

  // Migrations
  {
    type: "page",
    slug: "moosestack/migrate",
    title: "Migrations",
    icon: IconGitMerge,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Generation" },
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
      { type: "label", title: "Execution" },
      {
        type: "page",
        slug: "moosestack/migrate/apply-planned-migrations-cli",
        title: "moose migrate",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/migrate/apply-planned-migrations-service",
        title: "moose prod",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      {
        type: "page",
        slug: "moosestack/migrate/lifecycle",
        title: "Schema Lifecycle",
        languages: ["typescript", "python"],
        children: [
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
        ],
      },
      { type: "separator" },
      {
        type: "page",
        slug: "moosestack/migrate/failed-migrations",
        title: "Failed Migrations",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Deploy
  {
    type: "page",
    slug: "moosestack/deploying",
    title: "Deploy",
    icon: IconCloudUpload,
    languages: ["typescript", "python"],
    children: [
      {
        type: "page",
        slug: "moosestack/deploying/packaging-moose-for-deployment",
        title: "Packaging",
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
      { type: "separator" },
      { type: "label", title: "Platforms" },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-on-kubernetes",
        title: "Kubernetes",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-on-ecs",
        title: "AWS ECS",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-with-docker-compose",
        title: "Docker Compose",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/deploying/deploying-on-an-offline-server",
        title: "Offline Server",
        languages: ["typescript", "python"],
      },
    ],
  },

  // Observability
  {
    type: "page",
    slug: "moosestack/metrics",
    title: "Observability",
    icon: IconChartBar,
    languages: ["typescript", "python"],
  },

  { type: "separator" },

  // ===========================================
  // REFERENCE
  // ===========================================
  { type: "label", title: "Reference" },
  {
    type: "page",
    slug: "moosestack/data-types",
    title: "Column Types",
    icon: IconAtom,
    languages: ["typescript", "python"],
    children: [
      { type: "label", title: "Primitive Types" },
      {
        type: "page",
        slug: "moosestack/data-types/strings",
        title: "Strings",
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
      { type: "separator" },
      { type: "label", title: "Complex Types" },
      {
        type: "page",
        slug: "moosestack/data-types/arrays",
        title: "Arrays",
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
        slug: "moosestack/data-types/json",
        title: "JSON",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Special Types" },
      {
        type: "page",
        slug: "moosestack/data-types/nullable",
        title: "Nullable",
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
        slug: "moosestack/data-types/enums",
        title: "Enums",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/aggregates",
        title: "Aggregates",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Domain Types" },
      {
        type: "page",
        slug: "moosestack/data-types/network",
        title: "Network",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/data-types/geometry",
        title: "Geometry",
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
      { type: "label", title: "MergeTree Family" },
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
        slug: "moosestack/engines/collapsing-merge-tree",
        title: "CollapsingMergeTree",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/versioned-collapsing-merge-tree",
        title: "VersionedCollapsingMergeTree",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/replicated",
        title: "Replicated Engines",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Special Engines" },
      {
        type: "page",
        slug: "moosestack/engines/buffer",
        title: "Buffer",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/distributed",
        title: "Distributed",
        languages: ["typescript", "python"],
      },
      { type: "separator" },
      { type: "label", title: "Integration Engines" },
      {
        type: "page",
        slug: "moosestack/engines/kafka",
        title: "Kafka",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/s3",
        title: "S3",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/s3queue",
        title: "S3Queue",
        languages: ["typescript", "python"],
      },
      {
        type: "page",
        slug: "moosestack/engines/iceberg-s3",
        title: "Iceberg (S3)",
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
      { type: "label", title: "Core" },
      {
        type: "page",
        slug: "moosestack/configuration/project-settings",
        title: "Project Settings",
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
        slug: "moosestack/configuration/temporal",
        title: "Temporal",
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
        slug: "moosestack/configuration/http-server",
        title: "HTTP Server",
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
    ],
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

  // ===========================================
  // CONTRIBUTION
  // ===========================================
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
