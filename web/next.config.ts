import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  webpack: (config) => {
    config.resolve ??= {};
    config.resolve.alias = {
      ...config.resolve.alias,
      // Avoid `wagmi/connectors` barrel (porto, accounts, …) and package `exports` blocking deep paths.
      "@clarity/wc-connector": path.join(
        process.cwd(),
        "node_modules/@wagmi/connectors/dist/esm/walletConnect.js",
      ),
    };
    return config;
  },
};

export default nextConfig;
