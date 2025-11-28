import fs from "fs";
import path from "path";
import TOML from "@iarna/toml";
import { cacheLife } from "next/cache";
import {
  GuideManifestSchema,
  type GuideManifest,
  type GuideStep,
} from "./guide-types";
import { parseMarkdownContent } from "./content";

const CONTENT_ROOT = path.join(process.cwd(), "content");

/**
 * Parse the guide.toml manifest for a given guide slug
 */
export async function parseGuideManifest(
  slug: string,
): Promise<GuideManifest | null> {
  const dirPath = path.join(CONTENT_ROOT, slug);
  const manifestPath = path.join(dirPath, "guide.toml");

  if (!fs.existsSync(manifestPath)) {
    return null;
  }

  try {
    const manifestContent = fs.readFileSync(manifestPath, "utf8");
    const rawManifest = TOML.parse(manifestContent);
    const manifest = GuideManifestSchema.parse(rawManifest);
    return manifest;
  } catch (error) {
    console.error(`Failed to parse guide manifest for ${slug}:`, error);
    return null;
  }
}

/**
 * Get guide steps based on selected options, cached for performance
 */
export async function getCachedGuideSteps(
  slug: string,
  params: Record<string, string>,
): Promise<GuideStep[]> {
  "use cache";
  cacheLife("max");

  const manifest = await parseGuideManifest(slug);
  if (!manifest) {
    return [];
  }

  // Determine which flow to use based on 'starting-point' (or primary option)
  // We assume the first option in the manifest acts as the primary flow key if 'starting-point' isn't explicit
  // But per plan, we expect 'starting-point' to map to flows.
  const startingPoint = params["starting-point"];

  // If no starting point selected or invalid, we can't determine steps.
  // However, for initial render or if flow not found, maybe return empty or default?
  // The plan implies 'flows' keys match 'starting-point' values.

  const flow = startingPoint ? manifest.flows[startingPoint] : undefined;

  if (!flow) {
    // If we can't find a flow, we return empty steps.
    // The UI should handle the case where steps aren't loaded yet (e.g. form incomplete)
    return [];
  }

  const stepsDir = path.join(CONTENT_ROOT, slug, flow.stepsDir);

  if (!fs.existsSync(stepsDir)) {
    console.warn(`Steps directory not found: ${stepsDir}`);
    return [];
  }

  const files = fs.readdirSync(stepsDir);
  const steps: GuideStep[] = [];

  for (const file of files) {
    // Filter only .md or .mdx files
    if (!file.endsWith(".md") && !file.endsWith(".mdx")) continue;

    // Parse filename: {number}-{name}[@{key}={value}].mdx
    // Regex to capture: number, name, condition (optional)
    // Example: 2-analytics[@scope=initiative].mdx
    const match = file.match(
      /^(\d+)-([^\[]+)(?:\[@([^=]+)=([^\]]+)\])?\.(mdx?)$/,
    );

    if (!match) continue;

    const [, stepNumStr, stepName, condKey, condValue] = match;
    const stepNumber = parseInt(stepNumStr, 10);

    // Check condition if present
    if (condKey && condValue) {
      const userValue = params[condKey];
      if (userValue !== condValue) {
        continue; // Skip this step as it doesn't match user selection
      }
    }

    // Load content
    const stepSlug = path
      .relative(CONTENT_ROOT, path.join(stepsDir, file))
      .replace(/\.mdx?$/, "");
    // We use the full slug relative to content root so parseMarkdownContent works

    try {
      const parsedContent = await parseMarkdownContent(stepSlug);

      steps.push({
        stepNumber,
        title:
          (parsedContent.frontMatter.title as string) ||
          stepName.replace(/-/g, " "),
        slug: stepSlug,
        content: parsedContent.content,
        isMDX: parsedContent.isMDX,
      });
    } catch (error) {
      console.error(`Failed to load step content for ${stepSlug}:`, error);
      // We might skip or include with error? Let's skip broken steps to avoid crashing UI
    }
  }

  // Sort by step number
  return steps.sort((a, b) => a.stepNumber - b.stepNumber);
}
