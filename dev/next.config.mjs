import path from "node:path";
import { fileURLToPath } from "node:url";
import { withPayload } from "@payloadcms/next/withPayload";

const _dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack: (webpackConfig) => {
    webpackConfig.resolve.extensionAlias = {
      ".cjs": [".cts", ".cjs"],
      ".js": [".ts", ".tsx", ".js", ".jsx"],
      ".mjs": [".mts", ".mjs"],
    };

    return webpackConfig;
  },
  serverExternalPackages: [
    "@tanstack/ai-code-mode",
    "@tanstack/ai-isolate-node",
    "esbuild",
    "isolated-vm",
  ],
};

export default withPayload(nextConfig, { devBundleServerPackages: false });
