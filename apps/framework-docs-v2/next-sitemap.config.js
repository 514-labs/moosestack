/**
 * Load draft and beta slugs from the generated JSON file.
 * This file is created by scripts/generate-sitemap-excludes.ts during prebuild.
 *
 * This ensures that test pages, work-in-progress guides, and beta features
 * are not discoverable by search engines in production.
 */
const draftAndBetaSlugs = require("./generated/sitemap-excludes.json");

/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://docs.fiveonefour.com",
  generateRobotsTxt: true,
  exclude: ["/api/*", "/components", "**/index", ...draftAndBetaSlugs],
};
