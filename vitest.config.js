import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "payload/node";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

export default defineConfig(() => {
  loadEnv(path.resolve(dirname, "./dev"));

  return {
    plugins: [
      tsconfigPaths({
        ignoreConfigErrors: true,
      }),
    ],
    test: {
      environment: "node",
      exclude: [
        "**/e2e.spec.*",
        "**/*.eval.*",
        "**/node_modules/**",
        "**/.context/**",
        "**/site/**",
      ],
      // Integration specs each boot Payload against the same SQLite file, so
      // run test files sequentially to avoid SQLITE_BUSY lock contention.
      fileParallelism: false,
      hookTimeout: 30_000,
      testTimeout: 30_000,
    },
  };
});
