#!/usr/bin/env node
import { run as report } from "../jobs/04-report.js";
import { sitePaths, siteSlug } from "../lib/paths.js";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";

try {
  const { default: dotenv } = await import("dotenv");
  dotenv.config();
} catch {}

const url = process.argv[2] || process.env.TARGET_URL;
if (!url) {
  console.error("Usage: node finish-all.js <url>");
  process.exit(1);
}

// Read sitemap from root site's meta.json
const { metaPath } = sitePaths(url);
if (!existsSync(metaPath)) {
  console.error(`No meta.json found for ${url}. Run node run-all.js first.`);
  process.exit(1);
}

const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const pages = meta.sitemap ?? [];

if (pages.length === 0) {
  console.error("No sitemap entries found. Run node run-all.js first.");
  process.exit(1);
}

console.log(`\n==> Generating reports for ${pages.length} pages on ${siteSlug(url)}\n`);

const results = [];

for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  console.log(`\n==> [${i + 1}/${pages.length}] Report: ${page.href}`);

  const { componentsPath, reportPath } = sitePaths(page.href);
  if (!existsSync(componentsPath)) {
    console.warn(`  ⚠ No components.json for ${page.href} — skipping`);
    results.push({ page: page.href, status: "skipped" });
    continue;
  }

  await report(page.href);
  results.push({ page: page.href, status: "done", report: reportPath });
}

// Write a combined index report
const { outputDir } = sitePaths(url);
const indexPath = join(outputDir, "index.md");
const lines = [
  `# ${siteSlug(url)} — Full Site Component Report`,
  ``,
  `**Pages analyzed:** ${results.filter(r => r.status === "done").length} / ${pages.length}`,
  ``,
  `## Pages`,
  ``,
  ...results.map(r =>
    r.status === "done"
      ? `- ✅ [${r.page}](${r.report.replace(outputDir + "/", "")})`
      : `- ⚠️ ${r.page} — no components.json`
  ),
];
writeFileSync(indexPath, lines.join("\n"));
console.log(`\n==> Index saved to ${indexPath}`);
