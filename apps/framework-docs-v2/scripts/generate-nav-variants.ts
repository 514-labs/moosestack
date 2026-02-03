#!/usr/bin/env tsx
/**
 * Generate static navigation variants at build time
 *
 * This script pre-computes all possible navigation configurations
 * based on feature flag combinations, enabling full static generation.
 *
 * Output: public/nav/{base,draft,beta,full}.json
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  sectionNavigationConfigs,
  type DocumentationSection,
  buildNavItems,
  filterNavItemsByFlags,
  type NavFilterFlags,
} from "../src/config/navigation";

// Define the 4 navigation variants
const variants = {
  base: {
    showDataSourcesPage: false,
    showDraftGuides: false,
    showBetaGuides: false,
  },
  draft: {
    showDataSourcesPage: true,
    showDraftGuides: true,
    showBetaGuides: false,
  },
  beta: {
    showDataSourcesPage: true,
    showDraftGuides: false,
    showBetaGuides: true,
  },
  full: {
    showDataSourcesPage: true,
    showDraftGuides: true,
    showBetaGuides: true,
  },
} satisfies Record<string, NavFilterFlags>;

type VariantName = keyof typeof variants;

// Generate navigation for a specific section and variant
function generateSectionNav(
  section: DocumentationSection,
  flags: NavFilterFlags,
  language: "typescript" | "python",
) {
  const config = sectionNavigationConfigs[section].nav;
  const langFiltered = buildNavItems(config, language);
  const flagFiltered = filterNavItemsByFlags(langFiltered, flags);
  return flagFiltered;
}

// Generate a complete variant file
function generateVariant(variantName: VariantName, flags: NavFilterFlags) {
  const variant = {
    variant: variantName,
    flags,
    sections: {} as Record<
      DocumentationSection,
      {
        typescript: ReturnType<typeof generateSectionNav>;
        python: ReturnType<typeof generateSectionNav>;
      }
    >,
  };

  // Generate nav for all sections and both languages
  const sections: DocumentationSection[] = [
    "moosestack",
    "hosting",
    "ai",
    "guides",
    "templates",
  ];

  for (const section of sections) {
    variant.sections[section] = {
      typescript: generateSectionNav(section, flags, "typescript"),
      python: generateSectionNav(section, flags, "python"),
    };
  }

  return variant;
}

// Main execution
function main() {
  const outputDir = join(process.cwd(), "public", "nav");

  // Ensure output directory exists
  mkdirSync(outputDir, { recursive: true });

  console.log("Generating navigation variants...");

  // Generate and write each variant
  for (const [variantName, flags] of Object.entries(variants)) {
    const variant = generateVariant(variantName as VariantName, flags);
    const outputPath = join(outputDir, `${variantName}.json`);

    writeFileSync(outputPath, JSON.stringify(variant, null, 2), "utf-8");

    console.log(
      `✓ Generated ${variantName} variant (${Object.keys(variant.sections).length} sections)`,
    );
  }

  console.log(`\nAll navigation variants written to ${outputDir}/`);
}

main();
