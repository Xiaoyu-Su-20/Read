import {
  assertCleanWorktree,
  assertReleaseBranch,
  assertTagAtHead,
  packageVersion,
  printCommands,
  releaseBaseVersion,
  run
} from "./release-common.mjs";

const dryRun = process.argv.includes("--dry-run");
const version = await packageVersion();
const baseVersion = releaseBaseVersion(version);
const branch = assertReleaseBranch(baseVersion);
const tag = `v${version}`;

assertCleanWorktree();
assertTagAtHead(tag);
run("npm", ["run", "version:check"]);

const pushes = [
  ["git", ["push", "origin", branch]],
  ["git", ["push", "origin", tag]]
];

if (dryRun) {
  console.log("\nDry run only; nothing will be pushed.\n");
  printCommands(pushes);
  process.exit(0);
}

for (const [command, args] of pushes) {
  run(command, args);
}

console.log(`\nPublished ${tag}. GitHub Actions will build, sign, release, and update the feed.`);
