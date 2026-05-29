#!/usr/bin/env node
import { run as discoverSitemap } from "../jobs/05-sitemap.js";
import { run as screenshot } from "../jobs/01-screenshot.js";
import { run as split } from "../jobs/02-split-sections.js";
import { siteSlug, cleanSite } from "../lib/paths.js";

try {
  const { default: dotenv } = await import("dotenv");
  dotenv.config();
} catch {}

const url = process.argv[2] || process.env.TARGET_URL;
if (!url) {
  console.error("Usage: node run-all.js <url>");
  console.error("  e.g. node run-all.js https://freelygive.io");
  process.exit(1);
}

const sectionCount = parseInt(process.env.SECTION_COUNT ?? "5", 10);
const slug = siteSlug(url);
const doClean = process.argv.includes('--clean') || process.env.CLEAN === '1';

if (doClean) {
  console.log(`\n==> [0/5] Clean previous output for: ${url}`);
  cleanSite(url);
} else {
  console.log(`\n==> [0/5] Keeping existing output (pass --clean to wipe and start fresh)`);
}

console.log(`\n==> [1/5] Discover sitemap: ${url}`);
const pages = await discoverSitemap(url);

console.log(`\n==> Found ${pages.length} pages on ${slug}. Starting pipeline...\n`);

const handoffs = [];

for (let i = 0; i < pages.length; i++) {
  const page = pages[i];
  console.log(`\n${"=".repeat(60)}`);
  console.log(`==> Page ${i + 1}/${pages.length}: ${page.href}`);
  console.log(`${"=".repeat(60)}`);

  console.log(`\n==> [1/4] Screenshot: ${page.href}`);
  await screenshot(page.href);

  console.log("\n==> [2/4] Split sections");
  const numSections = await split(page.href, sectionCount);

  console.log("\n==> [3/4] Component detection — hand off to Claude Code agent");
  const handoffMsg = `analyze ${numSections} sections for ${siteSlug(page.href)} page ${page.href} and write components.json`;
  console.log(`CLAUDE_AGENT_HANDOFF: ${handoffMsg}`);

  handoffs.push({ page: page.href, numSections });
}

console.log(`\n${"=".repeat(60)}`);
console.log(`==> ALL PAGES SCREENSHOTTED (${pages.length} total)`);
console.log(`==> Now analyze each page's sections and write its components.json,`);
console.log(`==> then run: node finish-all.js ${url}`);
console.log(`${"=".repeat(60)}\n`);

console.log("CLAUDE_AGENT_HANDOFF_ALL: " + JSON.stringify(handoffs));
