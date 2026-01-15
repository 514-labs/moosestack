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
  // Based on the provided documentation, cacheComponents is a root-level option
  cacheComponents: true,

  experimental: {
    // Removing dynamicIO as it caused an error and might be implied or renamed
  },

  reactStrictMode: true,
  pageExtensions: ["js", "jsx", "ts", "tsx", "md", "mdx"],
  images: {
    unoptimized: true,
  },
  env: {
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
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
