import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import path from "path";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd()),
  serverExternalPackages: ["jose"],
  images: {
    unoptimized: true,
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
