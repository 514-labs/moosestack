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
  // webpack: (config, { isServer }) => {
  //   if (isServer) {
  //     config.externals = config.externals || [];
  //     config.externals.push({
  //       moose: "commonjs moose",
  //       "@514labs/moose-lib": "commonjs @514labs/moose-lib",
  //       "@confluentinc/kafka-javascript": "commonjs @confluentinc/kafka-javascript",
  //       "@514labs/kafka-javascript": "commonjs @514labs/kafka-javascript",
  //     });
  //   }
  //   return config;
  // },
};

export default nextConfig;
