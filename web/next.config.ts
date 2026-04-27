import webpack from "webpack";
import type { NextConfig } from "next";

/** Optional wagmi tempo connectors; not used by Clarity / AppKit on Base Sepolia. */
const nextConfig: NextConfig = {
  webpack: (config) => {
    config.plugins.push(
      new webpack.IgnorePlugin({
        resourceRegExp: /^accounts$/,
      }),
    );
    return config;
  },
};

export default nextConfig;
