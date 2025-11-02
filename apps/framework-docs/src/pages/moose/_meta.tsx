import { render } from "@/components";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SmallText } from "@/components/typography";
import {
  HandMetal,
  Code,
  BookMarked,
  History,
  Database,
  Workflow,
  Waves,
  GitCompare,
  HelpCircle,
  Settings,
  BarChart3,
  Hammer,
  Terminal,
  LayoutGrid,
  FileCode,
  Laptop,
  FolderPlus,
  Cloud,
  UploadCloud,
  FileStack,
  Sparkles,
} from "lucide-react";

// Raw meta object - more concise without repetitive rendering logic
const rawMeta = {
  index: {
    title: "Overview",
    theme: {
      breadcrumb: false,
    },
    Icon: LayoutGrid,
  },
  __fundamentals__: {
    title: "Getting Started",
    type: "separator",
  },
  "getting-started": {
    title: "Create Project",
    Icon: FolderPlus,
  },
  "local-dev": {
    title: "Local Dev Environment",
    Icon: Laptop,
  },
  "mcp-dev-server": {
    title: "MCP - AI Assisted Dev",
    Icon: Sparkles,
  },
  "data-modeling": {
    title: "Data Modeling",
    Icon: FileCode,
  },
  "in-your-stack": {
    title: "In Your Stack",
    Icon: FileStack,
  },
  __modules__: {
    type: "separator",
    title: "Modules",
  },
  olap: {
    title: "OLAP",
    Icon: Database,
    isMoose: true,
  },
  streaming: {
    title: "Streaming",
    Icon: Waves,
    isMoose: true,
  },
  workflows: {
    title: "Workflows",
    Icon: Workflow,
    isMoose: true,
  },
  apis: {
    title: "APIs",
    Icon: Code,
    isMoose: true,
  },
  __deployment__: {
    type: "separator",
    title: "Deployment Tools & Guides",
  },
  migrate: {
    title: "Migrate",
    Icon: GitCompare,
    isMoose: true,
  },
  metrics: {
    title: "Observability",
    Icon: BarChart3,
    isMoose: true,
  },
  deploying: {
    title: "Deploy",
    Icon: UploadCloud,
    isMoose: true,
  },
  "cloud-hosting": {
    title: "Cloud Hosting",
    href: "https://www.fiveonefour.com/boreal",
    newWindow: true,
    Icon: Cloud,
  },
  __reference__: {
    type: "separator",
    title: "Reference",
  },
  reference: {
    title: "API Reference",
    Icon: BookMarked,
  },
  "moose-cli": {
    title: "CLI",
    Icon: Terminal,
  },
  configuration: {
    title: "Project Configuration",
    Icon: Settings,
  },
  help: {
    title: "Help",
    Icon: HelpCircle,
  },
  changelog: {
    title: "Changelog",
    Icon: History,
  },
};

// Process the raw meta object to generate the final meta object with proper rendering
export default render(rawMeta);
