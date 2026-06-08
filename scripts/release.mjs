// Release the current package.json version end-to-end, so the npm publish, the
// git tag, and the GitHub release can never drift apart again (they did for
// 0.9.0 and 0.10.0, which reached npm but were never tagged or released).
//
//   pnpm release             release the current version
//   pnpm release "summary"   ...with a custom GitHub release title
//   pnpm release --dry-run   run every check and print the plan, change nothing
//
// Workflow: bump `version` in package.json and add the matching CHANGELOG.md
// section in your feature PR, merge to main, then run this from a clean main.
// All read-only checks run before the irreversible publish; the tag and release
// (both undoable) run after it.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import process from "node:process";

const REPO_RE = /github\.com[:/](.+?)(?:\.git)?$/;
const SECTION_RE = /^## \[/;

const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const summary = args.find((a) => !a.startsWith("--"));

let problems = 0;

class Abort extends Error {}

function capture(cmd, cmdArgs) {
  return execFileSync(cmd, cmdArgs, { encoding: "utf8" }).trim();
}

function tryCapture(cmd, cmdArgs) {
  try {
    return capture(cmd, cmdArgs);
  } catch {
    return "";
  }
}

function commandSucceeds(cmd, cmdArgs) {
  try {
    execFileSync(cmd, cmdArgs, { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function step(label) {
  console.log(`\n• ${label}`);
}

// Pass when `ok`; otherwise abort a real run, or note the problem in a dry run.
function guard(ok, message) {
  if (ok) {
    return;
  }
  if (DRY) {
    problems += 1;
    console.log(`  ✗ would abort: ${message}`);
    return;
  }
  throw new Abort(message);
}

function readPackage() {
  const pkg = JSON.parse(readFileSync("package.json", "utf8"));
  return { version: pkg.version, repoUrl: pkg.repository?.url ?? "" };
}

// Extract the body of the `## [version]` section from CHANGELOG.md.
function changelogNotes(version) {
  const lines = readFileSync("CHANGELOG.md", "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## [${version}]`));
  if (start === -1) {
    return "";
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => SECTION_RE.test(l));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n").trim();
}

// Highest existing version tag that is not the one we are about to create.
function previousTag(tag) {
  const tags = tryCapture("git", ["tag", "-l", "v*", "--sort=-v:refname"])
    .split("\n")
    .filter(Boolean);
  return tags.find((t) => t !== tag) ?? "";
}

function preflight(version, tag) {
  step("Preflight checks");

  const branch = capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  guard(branch === "main", `must release from main (currently on ${branch})`);

  guard(
    capture("git", ["status", "--porcelain"]) === "",
    "working tree is not clean"
  );

  execFileSync("git", ["fetch", "origin", "main", "--tags"], {
    stdio: "ignore",
  });
  guard(
    capture("git", ["rev-parse", "HEAD"]) ===
      capture("git", ["rev-parse", "origin/main"]),
    "local main is not in sync with origin/main (pull/push first)"
  );

  guard(
    tryCapture("git", ["tag", "-l", tag]) === "",
    `tag ${tag} already exists locally`
  );
  guard(
    tryCapture("git", ["ls-remote", "--tags", "origin", tag]) === "",
    `tag ${tag} already exists on origin`
  );

  guard(
    tryCapture("npm", ["view", `payload-agent@${version}`, "version"]) === "",
    `payload-agent@${version} is already published to npm`
  );

  guard(
    commandSucceeds("gh", ["--version"]),
    "GitHub CLI (gh) is not installed"
  );
  guard(
    commandSucceeds("gh", ["auth", "status"]),
    "GitHub CLI is not authenticated (run: gh auth login)"
  );
}

function buildBody(version, repoUrl, tag) {
  const notes = changelogNotes(version);
  guard(notes !== "", `no CHANGELOG.md section found for [${version}]`);

  const prev = previousTag(tag);
  const repoMatch = REPO_RE.exec(repoUrl);
  const slug = repoMatch ? repoMatch[1] : "";
  if (prev && slug) {
    return `${notes}\n\n**Full changelog:** https://github.com/${slug}/compare/${prev}...${tag}`;
  }
  return notes;
}

function publishAndRelease(version, tag, title, body) {
  step(`Publishing payload-agent@${version}`);
  execFileSync("pnpm", ["publish"], { stdio: "inherit" });

  step(`Tagging ${tag} and pushing to origin`);
  execFileSync("git", ["tag", "-a", tag, "-m", title], { stdio: "inherit" });
  execFileSync("git", ["push", "origin", tag], { stdio: "inherit" });

  step(`Creating GitHub release ${tag}`);
  execFileSync(
    "gh",
    [
      "release",
      "create",
      tag,
      "--title",
      title,
      "--notes-file",
      "-",
      "--latest",
      "--verify-tag",
    ],
    { input: body, stdio: ["pipe", "inherit", "inherit"] }
  );

  console.log(`\nReleased ${tag}.`);
}

function main() {
  const { version, repoUrl } = readPackage();
  const tag = `v${version}`;
  const title = summary ? `${version} — ${summary}` : tag;

  console.log(`Releasing ${tag}${DRY ? "  (dry run)" : ""}`);

  preflight(version, tag);
  const body = buildBody(version, repoUrl, tag);

  step("Release notes (from CHANGELOG.md)");
  console.log(`  title: ${title}`);
  console.log(
    body
      .split("\n")
      .map((l) => `  | ${l}`)
      .join("\n")
  );

  if (DRY) {
    step("Dry run — nothing was changed");
    console.log(
      problems === 0
        ? "  all checks passed; a real run would publish, tag, and release"
        : `  ${problems} check(s) would abort a real run (see above)`
    );
    return;
  }

  publishAndRelease(version, tag, title, body);
}

try {
  main();
} catch (error) {
  console.error(
    `\nRelease ${error instanceof Abort ? "aborted" : "failed"}: ${error.message}\n`
  );
  process.exitCode = 1;
}
