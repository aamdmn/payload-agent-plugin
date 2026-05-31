import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "payload/node";
import tsconfigPaths from "vite-tsconfig-paths";
import { defineConfig } from "vitest/config";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

// Agent behavior evals run the real agent loop against a live model, so they are
// kept out of the default suite (which never matches *.eval.ts) and run only via
// `pnpm test:eval`. Each scenario still self-skips unless RUN_AGENT_EVALS is set
// and a model API key is present, so running this config directly is free.
export default defineConfig(() => {
  loadEnv(path.resolve(dirname, "./dev"));
  // Evals construct their own agent and talk to the model directly. Blank the
  // Telegram token so the dev plugin sees no adapters and becomes a no-op,
  // rather than booting live Telegram polling and the plugin's own agent.
  process.env.TELEGRAM_BOT_TOKEN = "";

  return {
    plugins: [
      tsconfigPaths({
        ignoreConfigErrors: true,
      }),
    ],
    test: {
      environment: "node",
      exclude: ["**/node_modules/**"],
      fileParallelism: false,
      hookTimeout: 60_000,
      include: ["**/*.eval.ts"],
      testTimeout: 240_000,
    },
  };
});
