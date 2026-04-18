const withMDX = require("@next/mdx")({
  extension: /\.mdx?$/,
  options: {
    remarkPlugins: [],
    rehypePlugins: [],
  },
});

const createWithVercelToolbar = require("@vercel/toolbar/plugins/next");

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {},

  reactStrictMode: true,
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  },
  async redirects() {
    return [
      {
        source: "/moosestack/quickstart",
        destination: "/moosestack/getting-started/quickstart",
        permanent: true,
      },
      {
        source: "/moosestack/overview",
        destination: "/moosestack",
        permanent: true,
      },
      {
        source: "/moosestack/migrate/automatic",
        destination: "/moosestack/migrate/generate",
        permanent: true,
      },
      {
        source: "/moosestack/migrate/planned-migrations",
        destination: "/moosestack/migrate/generate",
        permanent: true,
      },
      {
        source: "/moosestack/migrate/modes",
        destination: "/moosestack/migrate",
        permanent: true,
      },
      {
        source: "/moosestack/migrate/migration-types",
        destination: "/moosestack/migrate",
        permanent: true,
      },
      {
        source: "/moosestack/olap/apply-migrations",
        destination: "/moosestack/migrate/apply",
        permanent: true,
      },
      {
        source: "/moosestack/olap/planned-migrations",
        destination: "/moosestack/migrate/generate",
        permanent: true,
      },
      {
        source: "/moosestack/olap/schema-versioning",
        destination: "/moosestack/schema-versioning",
        permanent: true,
      },
      {
        source: "/moosestack/apis/trigger-api",
        destination: "/moosestack/workflows/trigger-workflow",
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
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
  },
};

const withVercelToolbar = createWithVercelToolbar();

module.exports = withVercelToolbar(withMDX(nextConfig));
