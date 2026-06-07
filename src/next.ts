/**
 * Packages `payload-agent` needs Next.js to treat as server-external. Code Mode
 * runs in an `esbuild` + `isolated-vm` sandbox — native, server-only packages
 * that Next/Turbopack must not bundle. Without this, the app fails to boot with
 * `Unknown module type` / `invalid utf-8 sequence` errors pointing at `esbuild`.
 *
 * Spread these into your Next config's `serverExternalPackages`. The list lives
 * here so it stays correct across upgrades without you re-editing `next.config`.
 *
 * @example
 * // next.config.ts
 * import { withPayload } from "@payloadcms/next/withPayload";
 * import { serverExternalPackages } from "payload-agent/next";
 *
 * export default withPayload({
 *   serverExternalPackages, // or: [...serverExternalPackages, ...yourOwn]
 * });
 */
export const serverExternalPackages: string[] = [
  "@tanstack/ai-code-mode",
  "@tanstack/ai-isolate-node",
  "esbuild",
  "isolated-vm",
];
