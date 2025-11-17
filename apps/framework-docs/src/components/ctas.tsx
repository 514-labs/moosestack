import {
  Clock,
  Database,
  Waves,
  HardDriveDownload,
  MoreHorizontal,
  HardDriveUpload,
  Slack,
  Contact,
  Github,
  Youtube,
  Rocket,
  FolderTree,
  PencilRuler,
  Blocks,
  Table,
  Layers,
  Terminal,
  Library,
  Calendar,
  Linkedin,
  List,
  Settings,
  HelpCircle,
  FileJson,
  Monitor,
  Code,
  GitCompare,
  BarChart3,
  Hammer,
  Workflow,
  Laptop,
} from "lucide-react";

const XIcon = ({ className, ...props }: React.SVGProps<SVGSVGElement>) => (
  <svg
    className={className}
    fill="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
    {...props}
  >
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

const ClickHouseIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 50.6 50.6"
    fill="currentColor"
    {...props}
  >
    <path d="M0.6,0H5c0.3,0,0.6,0.3,0.6,0.6V50c0,0.3-0.3,0.6-0.6,0.6H0.6C0.3,50.6,0,50.4,0,50V0.6C0,0.3,0.3,0,0.6,0z" />
    <path d="M11.8,0h4.4c0.3,0,0.6,0.3,0.6,0.6V50c0,0.3-0.3,0.6-0.6,0.6h-4.4c-0.3,0-0.6-0.3-0.6-0.6V0.6C11.3,0.3,11.5,0,11.8,0z" />
    <path d="M23.1,0h4.4c0.3,0,0.6,0.3,0.6,0.6V50c0,0.3-0.3,0.6-0.6,0.6h-4.4c-0.3,0-0.6-0.3-0.6-0.6V0.6C22.5,0.3,22.8,0,23.1,0z" />
    <path d="M34.3,0h4.4c0.3,0,0.6,0.3,0.6,0.6V50c0,0.3-0.3,0.6-0.6,0.6h-4.4c-0.3,0-0.6-0.3-0.6-0.6V0.6C33.7,0.3,34,0,34.3,0z" />
    <path d="M45.6,19.7H50c0.3,0,0.6,0.3,0.6,0.6v10.1c0,0.3-0.3,0.6-0.6,0.6h-4.4c-0.3,0-0.6-0.3-0.6-0.6V20.3C45,20,45.3,19.7,45.6,19.7z" />
  </svg>
);

// Base paths for different sections
const basePaths = {
  quickstart: "/moose/getting-started/quickstart",
  addExistingApp: "/moose/getting-started/add-to-app",
  fromClickhouse: "/moose/getting-started/from-clickhouse",
  dataModeling: "/moose/data-modeling",
  localDev: "/moose/local-dev",
  // Modules
  olap: "/moose/olap",
  streaming: "/moose/streaming",
  workflows: "/moose/workflows",
  apis: "/moose/apis",
  // Tools
  migrate: "/moose/migrate",
  metrics: "/moose/metrics",
  deploying: "/moose/deploying",
  // Reference
  mooseLib: "/moose/api-reference",
  mooseCli: "/moose/moose-cli",
  configuration: "/moose/configuration",
  help: "/moose/help",
  changelog: "/moose/changelog",
};

// Icon components mapping
export const Icons = {
  // Getting Started
  quickstart: Rocket,
  fromClickhouse: ClickHouseIcon,
  addExistingApp: Library,
  dataModeling: PencilRuler,
  localDev: Laptop,
  // Modules
  olap: Database,
  streaming: Waves,
  workflows: Workflow,
  apis: Code,
  // Tools
  migrate: GitCompare,
  metrics: BarChart3,
  deploying: Hammer,
  // Reference
  mooseCli: Terminal,
  mooseLibrary: Library,
  configuration: Settings,
  help: HelpCircle,
  changelog: List,
  // Social
  calendly: Calendar,
  slack: Slack,
  github: Github,
  twitter: XIcon,
  youtube: Youtube,
  linkedin: Linkedin,
  // Legacy mappings for backward compatibility
  models: MoreHorizontal,
  db: Database,
  api: HardDriveUpload,
  contact: Contact,

  // Sloan
  cli: Terminal,
  json: FileJson,
  computer: Monitor,
};

// Combined paths with icons and metadata
export const PathConfig = {
  // Getting Started
  quickstart: {
    path: `${basePaths.quickstart}`,
    icon: Icons.quickstart,
    title: "Quickstart",
    category: "getting-started" as const,
  },
  addExistingApp: {
    path: `${basePaths.addExistingApp}`,
    icon: Icons.addExistingApp,
    title: "Add to Existing Application",
    category: "getting-started" as const,
  },
  dataModeling: {
    path: `${basePaths.dataModeling}`,
    icon: Icons.dataModeling,
    title: "Data Modeling",
    category: "getting-started" as const,
  },
  localDev: {
    path: `${basePaths.localDev}`,
    icon: Icons.localDev,
    title: "Local Development",
    category: "getting-started" as const,
  },
  fromClickhouse: {
    path: `${basePaths.fromClickhouse}`,
    icon: Icons.fromClickhouse,
    title: "From ClickHouse",
    category: "getting-started" as const,
  },
  // Modules
  olap: {
    path: `${basePaths.olap}`,
    icon: Icons.olap,
    title: "OLAP",
    category: "modules" as const,
  },
  streaming: {
    path: `${basePaths.streaming}`,
    icon: Icons.streaming,
    title: "Streaming",
    category: "modules" as const,
  },
  workflows: {
    path: `${basePaths.workflows}`,
    icon: Icons.workflows,
    title: "Workflows",
    category: "modules" as const,
  },
  apis: {
    path: `${basePaths.apis}`,
    icon: Icons.apis,
    title: "APIs",
    category: "modules" as const,
  },
  // Tools
  migrate: {
    path: `${basePaths.migrate}`,
    icon: Icons.migrate,
    title: "Migrate",
    category: "tools" as const,
  },
  metrics: {
    path: `${basePaths.metrics}`,
    icon: Icons.metrics,
    title: "Metrics",
    category: "tools" as const,
  },
  deploying: {
    path: `${basePaths.deploying}`,
    icon: Icons.deploying,
    title: "Deploying",
    category: "tools" as const,
  },
  // Reference
  mooseCli: {
    path: `${basePaths.mooseCli}`,
    icon: Icons.mooseCli,
    title: "Moose CLI",
    category: "reference" as const,
  },
  mooseLibrary: {
    path: `${basePaths.mooseLib}`,
    icon: Icons.mooseLibrary,
    title: "Moose Library",
    category: "reference" as const,
  },
  configuration: {
    path: `${basePaths.configuration}`,
    icon: Icons.configuration,
    title: "Configuration",
    category: "reference" as const,
  },
  help: {
    path: `${basePaths.help}`,
    icon: Icons.help,
    title: "Help",
    category: "reference" as const,
  },
  changelog: {
    path: `${basePaths.changelog}`,
    icon: Icons.changelog,
    title: "Changelog",
    category: "reference" as const,
  },
  // Social
  calendly: {
    path: "https://cal.com/team/514/talk-to-eng",
    icon: Icons.calendly,
    title: "Schedule a Call",
    category: "social" as const,
  },
  slack: {
    path: "https://join.slack.com/t/moose-community/shared_invite/zt-2fjh5n3wz-cnOmM9Xe9DYAgQrNu8xKxg",
    icon: Icons.slack,
    title: "Join Slack",
    category: "social" as const,
  },
  github: {
    path: "https://github.com/514-labs/moose",
    icon: Icons.github,
    title: "GitHub",
    category: "social" as const,
  },
  twitter: {
    path: "https://x.com/514hq",
    icon: Icons.twitter,
    title: "Twitter",
    category: "social" as const,
  },
  youtube: {
    path: "https://www.youtube.com/channel/UCmIj6NoAAP7kOSNYk77u4Zw",
    icon: Icons.youtube,
    title: "YouTube",
    category: "social" as const,
  },
  linkedin: {
    path: "https://www.linkedin.com/company/fiveonefour",
    icon: Icons.linkedin,
    title: "LinkedIn",
    category: "social" as const,
  },
} as const;
