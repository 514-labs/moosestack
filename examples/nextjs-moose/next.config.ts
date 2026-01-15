import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    root: ".",
  },
  serverExternalPackages: [
    "@514labs/moose-lib",
    "@confluentinc/kafka-javascript",
    "@514labs/kafka-javascript",
  ],
};

export default nextConfig;
