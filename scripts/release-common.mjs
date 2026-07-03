import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function executable(command) {
  return process.platform === "win32" && command === "npm" ? "npm.cmd" : command;
}

export function run(command, args, options = {}) {
  const label = [command, ...args].join(" ");
  console.log(`\n> ${label}`);
  execFileSync(executable(command), args, {
    cwd: root,
    stdio: "inherit",
    ...options
  });
}

export function capture(command, args) {
  return execFileSync(executable(command), args, {
    cwd: root,
    encoding: "utf8"
  }).trim();
}

export function succeeds(command, args) {
  return spawnSync(executable(command), args, {
    cwd: root,
    stdio: "ignore"
  }).status === 0;
}

export async function packageVersion() {
  const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (typeof packageJson.version !== "string") {
    throw new Error("package.json does not contain a valid version.");
  }
  return packageJson.version;
}

export function parseRcVersion(version) {
  const match = /^(\d+\.\d+\.\d+)-rc\.(\d+)$/.exec(version);
  if (!match) {
    throw new Error(`Expected an RC version such as 0.9.0-rc.3, received ${version}.`);
  }
  return {
    baseVersion: match[1],
    rcNumber: Number.parseInt(match[2], 10)
  };
}

export function releaseBaseVersion(version) {
  const match = /^(\d+\.\d+\.\d+)(?:-rc\.\d+)?$/.exec(version);
  if (!match) {
    throw new Error(`Unsupported release version: ${version}.`);
  }
  return match[1];
}

export function nextRcVersion(version) {
  const parsed = parseRcVersion(version);
  return `${parsed.baseVersion}-rc.${parsed.rcNumber + 1}`;
}

export function assertReleaseBranch(baseVersion) {
  const branch = capture("git", ["branch", "--show-current"]);
  const expected = `release-${baseVersion}`;
  if (branch !== expected) {
    throw new Error(`Release automation requires branch ${expected}; current branch is ${branch || "detached HEAD"}.`);
  }
  return branch;
}

export function assertCleanWorktree() {
  const status = capture("git", ["status", "--porcelain"]);
  if (status) {
    throw new Error(`Commit or stash current changes before preparing a release:\n${status}`);
  }
}

export function assertTagAtHead(tag) {
  if (!succeeds("git", ["rev-parse", "--verify", `refs/tags/${tag}`])) {
    throw new Error(`Local tag ${tag} does not exist.`);
  }
  const head = capture("git", ["rev-parse", "HEAD"]);
  const taggedCommit = capture("git", ["rev-list", "-n", "1", tag]);
  if (head !== taggedCommit) {
    throw new Error(`${tag} points to ${taggedCommit}, but HEAD is ${head}.`);
  }
}

export function printCommands(commands) {
  for (const [command, args] of commands) {
    console.log(`> ${[command, ...args].join(" ")}`);
  }
}
