#!/usr/bin/env node
// Capture + DOM-split every page in a site's sitemap using the deterministic
// 02b pipeline (scroll-stitch full-page capture + DOM-edge section split).
//
// For each page: navigate the open agent-browser session to the URL, wait for
// load, then run captureAndSplit (which scroll-settles, stitches, measures DOM
// sections, crops, and self-verifies). Writes per-page output/<host>/<slug>/.
//
// Usage: node scripts/capture-all-pages.js <site-url>
//   reads output/<host>/sitemap.json for the page list (falls back to the URL).

import { execFileSync } from "child_process";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "fs";
import { sitePaths } from "../lib/paths.js";
import { captureAndSplit } from "../jobs/02b-capture-and-split.js";

function ab(args, stdin) {
  return execFileSync("agent-browser", args, { input: stdin, encoding: "utf8" });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const siteUrl = process.argv[2];
if (!siteUrl) { console.error("Usage: node scripts/capture-all-pages.js <site-url>"); process.exit(1); }

const { siteDir } = sitePaths(siteUrl);
const sitemapPath = `${siteDir}/sitemap.json`;
let pages;
if (existsSync(sitemapPath)) {
  pages = JSON.parse(readFileSync(sitemapPath, "utf8")).pages;
} else {
  pages = [{ url: siteUrl, slug: "home" }];
}

// Consistent desktop viewport for every page (the sitemap job may have reset it).
try { ab(["set", "viewport", "1440", "900"]); } catch {}

// Navigate, tolerant of a slow `open`/`wait` that throws but still loads. We
// verify by reading the document URL/readyState rather than trusting the CLI's
// exit code — `open` times out on networkidle for pages with long-polling/ads
// even though the DOM is fully usable.
async function gotoVerified(url, attempts = 3) {
  for (let i = 0; i < attempts; i++) {
    try { ab(["open", url]); } catch {}
    try { ab(["wait", "--load", "domcontentloaded"]); } catch {}
    await sleep(1200);
    try {
      const st = ab(["eval", "--stdin"], `(function(){return JSON.stringify({u:location.href,r:document.readyState,h:document.documentElement.scrollHeight});})()`);
      const o = JSON.parse(JSON.parse(st.trim()));
      const onPage = o.u && o.u.replace(/\/$/, "") === url.replace(/\/$/, "");
      if (onPage && o.r !== "loading" && o.h > 200) return true;
    } catch {}
    await sleep(800);
  }
  return false;
}

console.log(`Capturing ${pages.length} page(s) for ${siteUrl}\n`);
const summary = [];
for (const p of pages) {
  console.log(`\n===== ${p.slug}  (${p.url}) =====`);
  const ok = await gotoVerified(p.url);
  if (!ok) {
    console.log(`  ! navigation failed after retries`);
    summary.push({ slug: p.slug, ok: false, error: "nav" });
    continue;
  }
  await sleep(600);
  // Ensure per-page meta.json exists (sitePaths/applySections consumers expect it).
  const pagePaths = sitePaths(p.url);
  mkdirSync(pagePaths.outputDir, { recursive: true });
  try {
    const res = await captureAndSplit(p.url);
    const flagged = res.sections.filter((s) => !s.ok);
    summary.push({ slug: p.slug, ok: true, sections: res.sections.length, flagged: flagged.length, flags: flagged.map((f) => `#${f.index}:${f.reason}`) });
  } catch (e) {
    console.log(`  ! capture failed: ${e.message}`);
    summary.push({ slug: p.slug, ok: false, error: e.message });
  }
}

console.log("\n\n===== SUMMARY =====");
for (const s of summary) {
  if (s.ok) console.log(`  ${s.slug.padEnd(24)} ${s.sections} sections, ${s.flagged} flagged${s.flags?.length ? " — " + s.flags.join("; ") : ""}`);
  else console.log(`  ${s.slug.padEnd(24)} FAILED (${s.error})`);
}
writeFileSync(`${siteDir}/capture-summary.json`, JSON.stringify(summary, null, 2));
console.log(`\nWrote ${siteDir}/capture-summary.json`);
