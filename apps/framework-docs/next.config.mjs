import nextra from "nextra";
import remarkMdxDisableExplicitJsx from "remark-mdx-disable-explicit-jsx";

// Disable Next.js telemetry
process.env.NEXT_TELEMETRY_DISABLED = "1";

const withNextra = nextra({
  theme: "nextra-theme-docs",
  themeConfig: "./theme.config.jsx",
  defaultShowCopyCode: true,
  staticImage: true,
  mdxOptions: {
    remarkPlugins: [
      [
        remarkMdxDisableExplicitJsx,
        { whiteList: ["table", "thead", "tbody", "tr", "th", "td"] },
      ],
    ],
    rehypePrettyCodeOptions: {
      theme: {
        dark: "github-dark",
        light: "min-light",
      },
    },
  },
});

// your existing module.exports or default export
const nextConfig = {
  transpilePackages: [],
  reactStrictMode: true,
  images: {
    unoptimized: true,
    domains: ["docs.fiveonefour.com"],
  },
  env: {
    // Make Athena token available on the client side
    NEXT_PUBLIC_ATHENA_TRACKING_TOKEN:
      process.env.NEXT_PUBLIC_ATHENA_TRACKING_TOKEN,
  },
  // Optional build-time configuration options
  async rewrites() {
    const baseRewrites = [
      {
        source: "/robots.txt",
        destination: "/api/robots.txt",
      },
      {
        source: "/ingest/static/:path*",
        destination: "https://us-assets.i.posthog.com/static/:path*",
      },
      {
        source: "/ingest/:path*",
        destination: "https://us.i.posthog.com/:path*",
      },
      {
        source: "/ingest/decide",
        destination: "https://us.i.posthog.com/decide",
      },
    ];

    const llmRewrites = [
      {
        source: "/llm-ts.txt",
        destination: "/api/llm/ts",
      },
      {
        source: "/llm-py.txt",
        destination: "/api/llm/py",
      },
      {
        source: "/:scope*/llm-ts.txt",
        destination: "/api/llm/ts?scope=:scope*",
      },
      {
        source: "/:scope*/llm-py.txt",
        destination: "/api/llm/py?scope=:scope*",
      },
    ];

    return [...baseRewrites, ...llmRewrites];
  },
  skipTrailingSlashRedirect: true,
};

// Make sure adding Sentry options is the last code to run before exporting
export default withNextra(nextConfig);

// Make sure adding Sentry options is the last code to run before exporting
// module.exports = withNextra(
//   withSentryConfig(nextConfig, sentryWebpackPluginOptions)
// );

// If you're using a next.config.mjs file:
// export default withSentryConfig(nextConfig, sentryWebpackPluginOptions);
