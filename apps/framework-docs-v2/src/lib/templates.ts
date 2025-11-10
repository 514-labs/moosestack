import fs from "fs";
import path from "path";
import { parse } from "@iarna/toml";
import type {
  TemplateConfig,
  TemplateMetadata,
  AppMetadata,
  ItemMetadata,
} from "./template-types";

// Re-export types for convenience
export type { TemplateConfig, TemplateMetadata, AppMetadata, ItemMetadata };

/**
 * Find the workspace root by traversing up from current directory
 * Looks for pnpm-workspace.yaml or root package.json
 */
function findWorkspaceRoot(): string {
  let currentDir = process.cwd();

  // In Next.js build, process.cwd() is the app directory
  // We need to go up to find the monorepo root
  while (currentDir !== path.dirname(currentDir)) {
    const workspaceFile = path.join(currentDir, "pnpm-workspace.yaml");
    const rootPackageJson = path.join(currentDir, "package.json");

    if (fs.existsSync(workspaceFile) || fs.existsSync(rootPackageJson)) {
      // Check if templates directory exists here
      const templatesDir = path.join(currentDir, "templates");
      if (fs.existsSync(templatesDir)) {
        return currentDir;
      }
    }

    currentDir = path.dirname(currentDir);
  }

  // Fallback: assume templates is two levels up from apps/framework-docs-v2
  const fallbackRoot = path.resolve(process.cwd(), "../..");
  const fallbackTemplates = path.join(fallbackRoot, "templates");
  if (fs.existsSync(fallbackTemplates)) {
    return fallbackRoot;
  }

  throw new Error(
    "Could not find workspace root. Make sure templates directory exists.",
  );
}

/**
 * Infer template category from name
 */
function inferCategory(name: string): "starter" | "framework" | "example" {
  const starterTemplates = [
    "typescript",
    "python",
    "typescript-empty",
    "python-empty",
  ];
  const frameworkTemplates = [
    "typescript-express",
    "python-fastapi",
    "next-app-empty",
    "typescript-mcp",
    "python-fastapi-client-only",
  ];

  if (starterTemplates.includes(name)) {
    return "starter";
  }
  if (frameworkTemplates.includes(name)) {
    return "framework";
  }
  return "example";
}

/**
 * Infer frameworks from template name and structure
 */
function inferFrameworks(name: string): string[] {
  const frameworks: string[] = [];

  if (name.includes("express")) {
    frameworks.push("Express");
  }
  if (name.includes("fastapi")) {
    frameworks.push("FastAPI");
  }
  if (name.includes("next") || name.includes("nextjs")) {
    frameworks.push("Next.js");
  }
  if (name.includes("streamlit")) {
    frameworks.push("Streamlit");
  }
  if (name.includes("mcp")) {
    frameworks.push("MCP");
  }

  return frameworks;
}

/**
 * Infer features from template name
 */
function inferFeatures(name: string, description: string): string[] {
  const features: string[] = [];
  const lowerName = name.toLowerCase();
  const lowerDesc = description.toLowerCase();

  // Default features for most templates
  features.push("Moose OLAP");
  features.push("Moose APIs");

  if (lowerName.includes("mcp")) {
    features.push("MCP");
  }
  if (lowerName.includes("frontend") || lowerName.includes("next")) {
    features.push("Frontend");
  }
  if (lowerDesc.includes("streaming") || lowerDesc.includes("stream")) {
    features.push("Moose Streaming");
  }
  if (lowerDesc.includes("workflow") || lowerDesc.includes("temporal")) {
    features.push("Moose Workflows");
  }
  if (lowerName.includes("streamlit")) {
    features.push("Streamlit");
  }

  return features;
}

/**
 * Get all template metadata
 * This function reads template.config.toml files at build time
 */
export function getAllTemplates(): TemplateMetadata[] {
  const workspaceRoot = findWorkspaceRoot();
  const templatesDir = path.join(workspaceRoot, "templates");

  if (!fs.existsSync(templatesDir)) {
    console.warn(`Templates directory not found at: ${templatesDir}`);
    return [];
  }

  const templateDirs = fs.readdirSync(templatesDir, { withFileTypes: true });
  const templates: TemplateMetadata[] = [];

  for (const dir of templateDirs) {
    if (!dir.isDirectory()) {
      continue;
    }

    const templateName = dir.name;
    const configPath = path.join(
      templatesDir,
      templateName,
      "template.config.toml",
    );

    if (!fs.existsSync(configPath)) {
      continue;
    }

    try {
      const configContent = fs.readFileSync(configPath, "utf-8");
      const config = parse(configContent) as unknown as TemplateConfig;

      // Skip if visible is explicitly false
      if (config.visible === false) {
        continue;
      }

      const category = inferCategory(templateName);
      const frameworks = inferFrameworks(templateName);
      const features = inferFeatures(templateName, config.description);

      // Generate GitHub URL
      const githubUrl = `https://github.com/514-labs/moosestack/tree/main/templates/${templateName}`;

      // Generate init command
      const initCommand = `moose init PROJECT_NAME ${templateName}`;

      templates.push({
        name: templateName,
        slug: templateName,
        language: config.language,
        description: config.description,
        visible: config.visible ?? true,
        category,
        frameworks,
        features,
        githubUrl,
        initCommand,
        type: "template",
      });
    } catch (error) {
      console.warn(
        `Failed to parse template config for ${templateName}:`,
        error,
      );
    }
  }

  // Sort templates: starters first, then frameworks, then examples
  const categoryOrder = { starter: 0, framework: 1, example: 2 };
  templates.sort((a, b) => {
    const categoryDiff = categoryOrder[a.category] - categoryOrder[b.category];
    if (categoryDiff !== 0) {
      return categoryDiff;
    }
    return a.name.localeCompare(b.name);
  });

  return templates;
}

/**
 * Get templates filtered by language
 */
export function getTemplatesByLanguage(
  language: "typescript" | "python" | "all",
): TemplateMetadata[] {
  const all = getAllTemplates();
  if (language === "all") {
    return all;
  }
  return all.filter((t) => t.language === language);
}

/**
 * Get all demo apps metadata
 * Apps are manually defined since they don't have config files
 */
export function getAllApps(): AppMetadata[] {
  return [
    {
      name: "Nextjs + Express + MCP demo app: Aircraft data",
      slug: "plane-transponder-demo",
      description:
        "Complete demo application featuring real-time aircraft transponder data with MCP chat integration.",
      githubUrl: "https://github.com/514-labs/planes",
      features: ["Next.js", "Express", "MCP", "Moose OLAP", "ClickHouse"],
      frameworks: ["Next.js", "Express", "MCP"],
      language: "typescript",
      type: "app",
    },
    {
      name: "Postgres to ClickHouse CDC with Debezium",
      slug: "postgres-clickhouse-cdc",
      description:
        "Easy-to-run demo of a CDC pipeline using Debezium, PostgreSQL, Redpanda, and ClickHouse.",
      githubUrl: "https://github.com/514-labs/debezium-cdc",
      features: [
        "CDC",
        "Debezium",
        "PostgreSQL",
        "Redpanda",
        "ClickHouse",
        "Drizzle ORM",
      ],
      frameworks: ["Debezium", "Drizzle"],
      blogPost:
        "https://www.fiveonefour.com/blog/cdc-postgres-to-clickhouse-debezium-drizzle",
      type: "app",
    },
    {
      name: "User-facing analytics reference app (Postgres + Clickhouse + React)",
      slug: "foobar-ufa",
      description:
        "A complete reference architecture showing how to add a dedicated analytics microservice to an existing application without impacting your primary database. Features Postgres + ClickHouse + React frontend with chat analytics.",
      githubUrl: "https://github.com/514-labs/area-code/tree/main/ufa",
      features: [
        "PostgreSQL",
        "ClickHouse",
        "React",
        "TanStack Query",
        "Supabase",
        "Moose OLAP",
        "Moose Streaming",
        "Moose APIs",
        "Elasticsearch",
        "Temporal",
      ],
      frameworks: ["React", "TanStack Query", "Supabase"],
      language: "typescript",
      type: "app",
    },
    {
      name: "User-facing analytics reference app (Clickhouse Cloud + React)",
      slug: "foobar-ufa-lite",
      description:
        "A simplified version of the UFA architecture using ClickHouse Cloud + React frontend with chat analytics. This version demonstrates a cloud-native approach without local infrastructure dependencies.",
      githubUrl: "https://github.com/514-labs/area-code/tree/main/ufa-lite",
      features: ["ClickHouse Cloud", "React", "Moose OLAP", "Moose APIs"],
      frameworks: ["React"],
      language: "typescript",
      type: "app",
    },
  ];
}

/**
 * Get all items (templates and apps combined)
 */
export function getAllItems(): ItemMetadata[] {
  return [...getAllTemplates(), ...getAllApps()];
}
