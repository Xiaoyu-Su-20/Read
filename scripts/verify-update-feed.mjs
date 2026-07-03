const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error("Usage: node scripts/verify-update-feed.mjs <version>");
}

const channels = version.includes("-rc.") ? ["rc"] : ["stable", "rc"];
const attempts = Number.parseInt(process.env.UPDATE_FEED_VERIFY_ATTEMPTS ?? "30", 10);
const delayMs = Number.parseInt(process.env.UPDATE_FEED_VERIFY_DELAY_MS ?? "10000", 10);
const siteRoot = "https://xiaoyu-su-20.github.io/Read/updates";

function delay(duration) {
  return new Promise((resolve) => setTimeout(resolve, duration));
}

async function verifyChannel(channel) {
  const manifestUrl = `${siteRoot}/${channel}/latest.json?verify=${Date.now()}`;
  const response = await fetch(manifestUrl, {
    headers: { "cache-control": "no-cache" }
  });
  if (!response.ok) {
    throw new Error(`${channel} manifest returned HTTP ${response.status}.`);
  }
  const manifest = await response.json();
  const windows = manifest?.platforms?.["windows-x86_64"];
  if (manifest?.version !== version) {
    throw new Error(`${channel} manifest reports ${String(manifest?.version)}, expected ${version}.`);
  }
  if (typeof windows?.url !== "string" || typeof windows?.signature !== "string") {
    throw new Error(`${channel} manifest is missing the Windows updater URL or signature.`);
  }
  const assetResponse = await fetch(windows.url, { method: "HEAD", redirect: "follow" });
  if (!assetResponse.ok) {
    throw new Error(`${channel} updater asset returned HTTP ${assetResponse.status}.`);
  }
}

let lastError = null;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    await Promise.all(channels.map(verifyChannel));
    console.log(`Verified ${channels.join(" and ")} updater feed for ${version}.`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    console.log(`Feed verification attempt ${attempt}/${attempts} failed: ${error.message}`);
    if (attempt < attempts) {
      await delay(delayMs);
    }
  }
}

throw lastError ?? new Error(`Unable to verify updater feed for ${version}.`);
