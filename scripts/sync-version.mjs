import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkOnly = process.argv.includes("--check");

const paths = {
  packageJson: path.join(root, "package.json"),
  packageLock: path.join(root, "package-lock.json"),
  cargoToml: path.join(root, "src-tauri", "Cargo.toml"),
  cargoLock: path.join(root, "src-tauri", "Cargo.lock"),
  tauriConfig: path.join(root, "src-tauri", "tauri.conf.json")
};

const packageJson = JSON.parse(await readFile(paths.packageJson, "utf8"));
const version = packageJson.version;
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`Invalid package version: ${String(version)}`);
}

const packageLock = JSON.parse(await readFile(paths.packageLock, "utf8"));
const tauriConfigRaw = await readFile(paths.tauriConfig, "utf8");
const cargoTomlRaw = await readFile(paths.cargoToml, "utf8");
const cargoLockRaw = await readFile(paths.cargoLock, "utf8");
const tauriConfig = JSON.parse(tauriConfigRaw);

const cargoTomlMatch = cargoTomlRaw.match(/\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m);
const cargoLockMatch = cargoLockRaw.match(/\[\[package\]\]\s*\r?\nname = "readr"\s*\r?\nversion = "([^"]+)"/);
const versions = {
  "package-lock.json": packageLock.version,
  "package-lock.json root package": packageLock.packages?.[""]?.version,
  "src-tauri/tauri.conf.json": tauriConfig.version,
  "src-tauri/Cargo.toml": cargoTomlMatch?.[1],
  "src-tauri/Cargo.lock": cargoLockMatch?.[1]
};

if (checkOnly) {
  const mismatches = Object.entries(versions)
    .filter(([, candidate]) => candidate !== version)
    .map(([file, candidate]) => `${file}: ${String(candidate)}`);
  if (mismatches.length > 0) {
    throw new Error(`Version ${version} is not synchronized:\n${mismatches.join("\n")}`);
  }
  console.log(`All release versions match ${version}.`);
  process.exit(0);
}

if (!cargoTomlMatch || !cargoLockMatch) {
  throw new Error("Could not locate the Readr package version in Cargo files.");
}

const nextTauriConfig = tauriConfigRaw.replace(
  /(^\s*"version"\s*:\s*")[^"]+("\s*,)/m,
  `$1${version}$2`
);
const nextCargoToml = cargoTomlRaw.replace(
  /(\[package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/m,
  `$1${version}$2`
);
const nextCargoLock = cargoLockRaw.replace(
  /(\[\[package\]\]\s*\r?\nname = "readr"\s*\r?\nversion = ")[^"]+("\s*)/,
  `$1${version}$2`
);

await Promise.all([
  writeFile(paths.tauriConfig, nextTauriConfig),
  writeFile(paths.cargoToml, nextCargoToml),
  writeFile(paths.cargoLock, nextCargoLock)
]);

console.log(`Synchronized Tauri and Cargo versions to ${version}.`);
