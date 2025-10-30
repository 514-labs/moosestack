/** @type {import('next-sitemap').IConfig} */
module.exports = {
  siteUrl: process.env.SITE_URL || "https://docs.moosestack.com",
  generateRobotsTxt: true,
  exclude: ["/api/*", "/components"],
};
