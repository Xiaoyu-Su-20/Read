import { execFileSync, spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function invocation(command, args) {
  if (process.platform === "win32" && command === "npm") {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
      throw new Error("npm_execpath is unavailable; run release commands through npm run.");
    }
    return {
      executable: process.execPath,
      args: [npmCli, ...args]
    };
  }

  return { executable: command, args };
}

export function run(command, args, options = {}) {
  const label = [command, ...args].join(" ");
  const resolved = invocation(command, args);
  console.log(`\n> ${label}`);
  execFileSync(resolved.executable, resolved.args, {
    cwd: root,
    stdio: "inherit",
    ...options
  });
}

export function capture(command, args) {
  const resolved = invocation(command, args);
  return execFileSync(resolved.executable, resolved.args, {
    cwd: root,
    encoding: "utf8"
  }).trim();
}

export function succeeds(command, args) {
  const resolved = invocation(command, args);
  return spawnSync(resolved.executable, resolved.args, {
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
