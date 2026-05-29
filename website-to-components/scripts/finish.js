#!/usr/bin/env node
// Steps 3b + 3c + 4: extract site assets, download resources, then generate report.
// Skips asset extraction if site-resources.json already exists (run.js already did it).
import { existsSync } from "fs";
import { run as extractAssets } from "../jobs/03b-extract-assets.js";
import { run as downloadResources } from "../jobs/03c-download-resources.js";
import { run as generateBrandKit } from "../jobs/03d-generate-brand-kit.js";
import { run as report } from "../jobs/04-report.js";
import { sitePaths, pageSlug } from "../lib/paths.js";
import { timed } from "../lib/timings.js";

try {
  const { default: dotenv } = await import("dotenv");
  dotenv.config();
} catch {}

const url = process.argv[2] || process.env.TARGET_URL;
if (!url) {
  console.error("Usage: node finish.js <url>");
  process.exit(1);
}

const { outputDir } = sitePaths(url);
const resourcesJson = `${outputDir}/site-resources.json`;
const manifestJson = `${outputDir}/resources-manifest.json`;

const slug = pageSlug(url);

if (existsSync(resourcesJson) && existsSync(manifestJson)) {
  console.log("\n==> [3b/4] Skipping asset extraction (already done by run.js)");
  console.log("\n==> [3c/4] Skipping resource download (already done by run.js)");
} else {
  console.log("\n==> [3b/4] Extract site assets (images, SVGs, base64, backgrounds)");
  await timed(url, { stage: "step-2b-extract-assets", page: slug }, () => extractAssets(url));

  console.log("\n==> [3c/4] Download resources (images, CSS, SVGs, fonts)");
  await timed(url, { stage: "step-2c-download-resources", page: slug }, () => downloadResources(url));
}

console.log("\n==> [3d/4] Generate brand kit + global.css");
await timed(url, { stage: "step-3d-brand-kit", page: slug }, () => generateBrandKit(url));

console.log("\n==> [4/4] Generate report");
await timed(url, { stage: "step-4-report", page: slug }, () => report(url));
