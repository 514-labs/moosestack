const { sectionNavigationConfigs } = require("./src/config/navigation.ts");

/**
 * Recursively collect all draft and beta guide slugs from navigation config
 * to exclude them from the sitemap and prevent search engine indexing.
 *
 * This ensures that test pages, work-in-progress guides, and beta features
 * are not discoverable by search engines in production.
 */
function getDraftAndBetaSlugs() {
  const slugs = [];

  function processNavItems(items) {
    for (const item of items) {
      if (item.type === "page") {
        // Check if page is draft or beta
        if (item.status === "draft" || item.status === "beta") {
          // Add leading slash if not present
          const slug = item.slug.startsWith("/") ? item.slug : `/${item.slug}`;
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
        processNavItems(item.items);
      }
    }
  }

  // Process all section navigation configs
  for (const sectionConfig of Object.values(sectionNavigationConfigs)) {
    processNavItems(sectionConfig.nav);
  }

  return slugs;
}

const draftAndBetaSlugs = getDraftAndBetaSlugs();

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://docs.fiveonefour.com",
  generateRobotsTxt: true,
  exclude: ["/api/*", "/components", "**/index", ...draftAndBetaSlugs],
};
