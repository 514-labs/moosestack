/**
 * Generates a JSON file with draft and beta slugs to exclude from the sitemap.
 * This script runs during prebuild so the sitemap config (CommonJS) can read the output.
 */

import { sectionNavigationConfigs } from "../src/config/navigation";
import { writeFileSync } from "fs";
import { join } from "path";

interface NavItem {
  type: string;
  slug?: string;
  status?: string;
  children?: NavItem[];
  items?: NavItem[];
}

function getDraftAndBetaSlugs(): string[] {
  const slugs: string[] = [];

  function processNavItems(items: NavItem[]) {
    for (const item of items) {
      if (item.type === "page") {
        // Check if page is draft or beta
        if (item.status === "draft" || item.status === "beta") {
          // Add leading slash if not present
          const slug = item.slug?.startsWith("/") ? item.slug : `/${item.slug}`;
          // Add exact path and wildcard for nested pages
          slugs.push(slug);
          slugs.push(`${slug}/*`);
        }
        // Process children if they exist
        if (item.children) {
          processNavItems(item.children);
        }
      } else if (item.type === "section") {
        // Process section items
        if (item.items) {
          processNavItems(item.items);
        }
      }
    }
  }

  // Process all section navigation configs
  for (const sectionConfig of Object.values(sectionNavigationConfigs)) {
    processNavItems(sectionConfig.nav as NavItem[]);
  }

  return slugs;
}

const slugs = getDraftAndBetaSlugs();
const outputPath = join(__dirname, "../generated/sitemap-excludes.json");

// Ensure the generated directory exists
import { mkdirSync } from "fs";
mkdirSync(join(__dirname, "../generated"), { recursive: true });

writeFileSync(outputPath, JSON.stringify(slugs, null, 2));

console.log(
  `Generated sitemap excludes: ${slugs.length} draft/beta paths written to ${outputPath}`,
);
