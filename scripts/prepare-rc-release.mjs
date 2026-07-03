import {
  assertCleanWorktree,
  assertReleaseBranch,
  nextRcVersion,
  packageVersion,
  parseRcVersion,
  printCommands,
  run,
  succeeds
} from "./release-common.mjs";

const dryRun = process.argv.includes("--dry-run");
const currentVersion = await packageVersion();
const { baseVersion } = parseRcVersion(currentVersion);
const nextVersion = nextRcVersion(currentVersion);
const tag = `v${nextVersion}`;
const branch = assertReleaseBranch(baseVersion);
assertCleanWorktree();

if (succeeds("git", ["rev-parse", "--verify", `refs/tags/${tag}`])) {
  throw new Error(`Tag ${tag} already exists.`);
}

const checks = [
  ["npm", ["run", "version:check"]],
  ["npm", ["run", "test"]],
  ["npm", ["run", "build"]],
  ["cargo", ["test", "--locked", "--manifest-path", "src-tauri/Cargo.toml"]],
  ["git", ["diff", "--check"]]
];

console.log(`Preparing ${tag} from ${branch}.`);
if (dryRun) {
  console.log("Dry run only; no files, commits, or tags will be created.\n");
  printCommands([
    ["npm", ["version", nextVersion, "--no-git-tag-version"]],
    ...checks,
    ["git", ["add", "package.json", "package-lock.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock", "src-tauri/tauri.conf.json"]],
    ["git", ["commit", "-m", `Release ${nextVersion}`]],
    ["git", ["tag", "-a", tag, "-m", `Readr ${nextVersion}`]]
  ]);
  process.exit(0);
}

run("npm", ["version", nextVersion, "--no-git-tag-version"]);
for (const [command, args] of checks) {
  run(command, args);
}
run("git", [
  "add",
  "package.json",
  "package-lock.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json"
]);
run("git", ["commit", "-m", `Release ${nextVersion}`]);
run("git", ["tag", "-a", tag, "-m", `Readr ${nextVersion}`]);

console.log(`\nPrepared ${tag} locally. Review it, then run: npm run release:publish`);
