// Refuse to publish with anything but pnpm.
//
// package.json uses a `publishConfig` block to swap the entry points from src/
// to dist/ at publish time. That field override is a pnpm/Yarn feature: `npm
// publish` ignores it and would publish a manifest still pointing at src/ --
// which is not in the tarball. The result is a broken, dead-on-arrival package.
//
// Runs from `prepublishOnly`, so it aborts before anything is built or uploaded.
const userAgent = process.env.npm_config_user_agent ?? "";

if (!userAgent.includes("pnpm")) {
  console.error(
    [
      "",
      "Publish with pnpm, not npm.",
      "",
      "  This package swaps src -> dist via a pnpm-only publishConfig.",
      "  npm ignores it and would ship a broken, source-pointing package.",
      "",
      "  Run:  pnpm publish",
      "",
    ].join("\n")
  );
  process.exitCode = 1;
}
