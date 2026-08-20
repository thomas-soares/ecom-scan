import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["playwright", "playwright-core"],
};

export default nextConfig;
