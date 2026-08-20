import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["playwright", "playwright-core"],
  outputFileTracingIncludes: {
    "/api/google-ad-transparency": [
      "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*",
      "./node_modules/.pnpm/playwright@*/node_modules/playwright/**/*",
    ],
    "/api/meta-ad-library": [
      "./node_modules/.pnpm/playwright-core@*/node_modules/playwright-core/**/*",
      "./node_modules/.pnpm/playwright@*/node_modules/playwright/**/*",
    ],
  },
};

export default nextConfig;
