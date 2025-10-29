import {
  IconClock,
  IconDatabase,
  IconBroadcast,
  IconDownload,
  IconRectangleVertical,
  IconUpload,
  IconBrandSlack,
  IconMail,
  IconBrandGithub,
  IconBrandYoutube,
  IconRocket,
  IconFolder,
  IconPencil,
  IconBlocks,
  IconTable,
  IconStack,
  IconTerminal,
  IconLibrary,
  IconCalendar,
  IconBrandLinkedin,
  IconList,
  IconSettings,
  IconHelpCircle,
  IconFileCode,
  IconDeviceDesktop,
  IconCode,
  IconGitCompare,
  IconChartBar,
  IconHammer,
  IconGitBranch,
  IconDeviceLaptop,
} from "@tabler/icons-react";
import type { IconProps } from "@tabler/icons-react";

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

// Icon components mapping
export const Icons = {
  // Getting Started
  quickstart: IconRocket,
  fromClickhouse: ClickHouseIcon,
  dataModeling: IconPencil,
  localDev: IconDeviceLaptop,
  // Modules
  olap: IconDatabase,
  streaming: IconBroadcast,
  workflows: IconGitBranch,
  apis: IconCode,
  // Tools
  migrate: IconGitCompare,
  metrics: IconChartBar,
  deploying: IconHammer,
  // Reference
  mooseCli: IconTerminal,
  mooseLibrary: IconLibrary,
  configuration: IconSettings,
  help: IconHelpCircle,
  changelog: IconList,
  // Social
  calendly: IconCalendar,
  slack: IconBrandSlack,
  github: IconBrandGithub,
  twitter: XIcon,
  youtube: IconBrandYoutube,
  linkedin: IconBrandLinkedin,
};

// Helper function to create language-specific paths (now uses query params)
function createLanguagePaths(basePath: string) {
  // Paths are now the same, language is in query params
  return {
    typescript: `${basePath}?lang=typescript`,
    python: `${basePath}?lang=python`,
  };
}

// Base paths for different sections (without language prefix)
const basePaths = {
  overview: "",
  quickstart: "/quickstart",
  fromClickhouse: "/from-clickhouse",
  dataModeling: "/data-modeling",
  localDev: "/local-dev",
  // Modules
  olap: "/olap",
  streaming: "/streaming",
  workflows: "/workflows",
  apis: "/apis",
  // Tools
  migrate: "/migrate",
  metrics: "/metrics",
  deploying: "/deploying",
  // Reference
  mooseLib: "/api-reference",
  mooseCli: "/moose-cli",
  configuration: "/configuration",
  help: "/help",
  changelog: "/changelog",
};

type PathCategory =
  | "getting-started"
  | "modules"
  | "tools"
  | "reference"
  | "social";

interface PathInfo {
  typescript: string;
  python: string;
  icon:
    | React.ComponentType<IconProps>
    | React.FC<React.SVGProps<SVGSVGElement>>;
  title: string;
  category: PathCategory;
}

interface SocialPathInfo {
  path: string;
  icon:
    | React.ComponentType<IconProps>
    | React.FC<React.SVGProps<SVGSVGElement>>;
  title: string;
  category: "social";
}

// Combined paths with icons and metadata
export const PathConfig: Record<string, PathInfo | SocialPathInfo> = {
  // Getting Started
  overview: {
    ...createLanguagePaths(basePaths.overview),
    icon: Icons.quickstart,
    title: "Overview",
    category: "getting-started" as const,
  },
  quickstart: {
    ...createLanguagePaths(basePaths.quickstart),
    icon: Icons.quickstart,
    title: "Quickstart",
    category: "getting-started" as const,
  },
  dataModeling: {
    ...createLanguagePaths(basePaths.dataModeling),
    icon: Icons.dataModeling,
    title: "Data Modeling",
    category: "getting-started" as const,
  },
  localDev: {
    ...createLanguagePaths(basePaths.localDev),
    icon: Icons.localDev,
    title: "Local Development",
    category: "getting-started" as const,
  },
  fromClickhouse: {
    ...createLanguagePaths(basePaths.fromClickhouse),
    icon: Icons.fromClickhouse,
    title: "From ClickHouse",
    category: "getting-started" as const,
  },
  // Modules
  olap: {
    ...createLanguagePaths(basePaths.olap),
    icon: Icons.olap,
    title: "OLAP",
    category: "modules" as const,
  },
  streaming: {
    ...createLanguagePaths(basePaths.streaming),
    icon: Icons.streaming,
    title: "Streaming",
    category: "modules" as const,
  },
  workflows: {
    ...createLanguagePaths(basePaths.workflows),
    icon: Icons.workflows,
    title: "Workflows",
    category: "modules" as const,
  },
  apis: {
    ...createLanguagePaths(basePaths.apis),
    icon: Icons.apis,
    title: "APIs",
    category: "modules" as const,
  },
  // Tools
  migrate: {
    ...createLanguagePaths(basePaths.migrate),
    icon: Icons.migrate,
    title: "Migrate",
    category: "tools" as const,
  },
  metrics: {
    ...createLanguagePaths(basePaths.metrics),
    icon: Icons.metrics,
    title: "Metrics",
    category: "tools" as const,
  },
  deploying: {
    ...createLanguagePaths(basePaths.deploying),
    icon: Icons.deploying,
    title: "Deploying",
    category: "tools" as const,
  },
  // Reference
  mooseCli: {
    ...createLanguagePaths(basePaths.mooseCli),
    icon: Icons.mooseCli,
    title: "Moose CLI",
    category: "reference" as const,
  },
  mooseLibrary: {
    ...createLanguagePaths(basePaths.mooseLib),
    icon: Icons.mooseLibrary,
    title: "Moose Library",
    category: "reference" as const,
  },
  configuration: {
    ...createLanguagePaths(basePaths.configuration),
    icon: Icons.configuration,
    title: "Configuration",
    category: "reference" as const,
  },
  help: {
    ...createLanguagePaths(basePaths.help),
    icon: Icons.help,
    title: "Help",
    category: "reference" as const,
  },
  changelog: {
    ...createLanguagePaths(basePaths.changelog),
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

// Helper to get path for specific language
export function getPath(
  key: keyof typeof PathConfig,
  language: "typescript" | "python",
): string {
  const config = PathConfig[key];
  if (!config) {
    throw new Error(`Path configuration not found for key: ${key}`);
  }
  if ("path" in config) {
    return config.path;
  }
  // Extract base path and add language param
  const pathWithLang = config[language];
  // If it already has ?lang=, use it; otherwise ensure it has the param
  if (pathWithLang.includes("?lang=")) {
    return pathWithLang;
  }
  // If it has query params, append; otherwise add
  return pathWithLang.includes("?") ?
      `${pathWithLang}&lang=${language}`
    : `${pathWithLang}?lang=${language}`;
}
