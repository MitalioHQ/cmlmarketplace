import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@cml-marketplace/core",
    "@cml-marketplace/server",
  ],
};

export default nextConfig;
