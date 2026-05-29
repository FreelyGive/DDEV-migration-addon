// jobs/00-sitemap.js
//
// Detect a site's main navigation menu and write a JSON sitemap of pages to
// process. This is Step 0 of the multi-page pipeline — it runs before any
// per-page work so the orchestrator can iterate.
//
// Output: website-to-components/output/<host>/sitemap.json
//
// Same-domain only. Excludes footer-only links, anchors (#…), file downloads,
// and language switchers (heuristic).

import { spawnSync, execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { sitePaths, siteSlug, pageSlug, ensureDir } from "../lib/paths.js";

function browserEval(js) {
  const result = spawnSync("agent-browser", ["eval", "--stdin"], {
    input: js,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.stdout?.trim() ?? "";
}

function browserSnapshot() {
  const result = spawnSync("agent-browser", ["snapshot"], {
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.stdout ?? "";
}

// Parse the accessibility-tree snapshot for navigation regions and pick the
// most likely "main menu". Returns the aria-label of the chosen nav (so we can
// scope the URL extraction to it) or null if no primary nav is detectable.
function pickMainNavLabelFromSnapshot(snap) {
  if (!snap) return null;
  const navLines = snap
    .split("\n")
    .map(l => l.trim())
    .filter(l => /^-?\s*navigation\s+"/.test(l));

  if (navLines.length === 0) return null;

  // Score each nav: prefer "main"/"primary"/"site" labels; demote "skip"/"footer".
  function score(line) {
    const m = line.match(/navigation\s+"([^"]+)"/);
    const label = (m?.[1] ?? "").toLowerCase();
    if (/skip|footer|breadcrumb|social|utility/.test(label)) return -100;
    if (/\bmain\b/.test(label)) return 100;
    if (/\bprimary\b/.test(label)) return 90;
    if (/\bsite\b|\bglobal\b|\btop\b|\bheader\b/.test(label)) return 70;
    return 10;
  }

  const ranked = navLines
    .map(l => ({ line: l, label: l.match(/navigation\s+"([^"]+)"/)?.[1] ?? "", score: score(l) }))
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0];
  if (!winner || winner.score < 0) return null;
  return winner.label;
}

function parseBrowserJson(raw) {
  try {
    let parsed = JSON.parse(raw);
    // agent-browser sometimes wraps string return values in quotes
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    return parsed;
  } catch {
    return null;
  }
}

export async function run(url) {
  const { siteDir, metaPath } = sitePaths(url);
  ensureDir(siteDir);

  const origin = new URL(url).origin;
  const host = siteSlug(url);

  console.log(`Detecting main menu for ${host} …`);

  execSync("agent-browser set viewport 1440 900", { stdio: "inherit" });
  execSync(`agent-browser open "${url}"`, { stdio: "inherit" });
  execSync("agent-browser wait --load networkidle", { stdio: "inherit" });

  // First pass: ask agent-browser for the accessibility snapshot so we can pick
  // the main nav region semantically (aria-label "main nav" beats a "Skip to
  // content navigation" or a footer nav). This is the most reliable signal.
  const snap = browserSnapshot();
  const mainNavLabel = pickMainNavLabelFromSnapshot(snap);
  if (mainNavLabel) {
    console.log(`  Accessibility snapshot found main nav: "${mainNavLabel}"`);
  } else {
    console.log(`  No labeled main nav in snapshot — falling back to CSS heuristics.`);
  }

  // Second pass: scoped eval that extracts <a href> children of the chosen nav.
  // Pass the aria-label through so the DOM query can target the same region.
  const raw = browserEval(`
    (function() {
      const origin = ${JSON.stringify(origin)};
      const mainNavLabel = ${JSON.stringify(mainNavLabel)};

      // Candidate roots for the main menu, in priority order. If the
      // accessibility snapshot identified a specific main-nav label, try it
      // first via [aria-label].
      const labelSelectors = mainNavLabel
        ? [
            'nav[aria-label="' + mainNavLabel.replace(/"/g, '\\\\"') + '"]',
            '[role="navigation"][aria-label="' + mainNavLabel.replace(/"/g, '\\\\"') + '"]',
          ]
        : [];

      const candidates = [
        ...labelSelectors.flatMap(sel => [...document.querySelectorAll(sel)]),
        ...document.querySelectorAll('header nav'),
        ...document.querySelectorAll('nav[aria-label*="main" i]'),
        ...document.querySelectorAll('nav[aria-label*="primary" i]'),
        ...document.querySelectorAll('[role="navigation"]'),
        ...document.querySelectorAll('nav'),
        ...document.querySelectorAll('header'),
      ];

      function insideFooter(el) {
        return !!el.closest('footer');
      }

      function isJunk(href, text) {
        if (!href || !text) return true;
        if (/^(mailto:|tel:|javascript:)/i.test(href)) return true;
        if (/\\.(pdf|zip|docx?|xlsx?|pptx?|jpe?g|png|gif|mp4|mov)(\\?|$)/i.test(href)) return true;
        if (text.length < 1 || text.length > 80) return true;
        // Common cookie / lang / search anchors
        if (/^(skip|cookie|search|language|change region|login|sign in|sign up)$/i.test(text)) return true;
        return false;
      }

      // Pick the first non-footer candidate that contains at least 2 same-origin links
      let chosenRoot = null;
      for (const c of candidates) {
        if (insideFooter(c)) continue;
        const links = [...c.querySelectorAll('a[href]')];
        const sameOrigin = links.filter(a => {
          try { return new URL(a.href, location.href).origin === origin; } catch(e) { return false; }
        });
        if (sameOrigin.length >= 2) { chosenRoot = c; break; }
      }

      if (!chosenRoot) {
        return JSON.stringify({ error: 'no-main-nav-detected', candidates: candidates.length });
      }

      const seen = new Set();
      const pages = [];
      let order = 0;
      const rootKind = chosenRoot.tagName.toLowerCase();

      chosenRoot.querySelectorAll('a[href]').forEach(function(a) {
        if (insideFooter(a)) return;
        let u;
        try { u = new URL(a.href, location.href); } catch(e) { return; }
        if (u.origin !== origin) return;
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
        // Drop the fragment so /about#team === /about
        const path = u.pathname.replace(/\\/+$/, '') || '/';
        const key = path;
        const text = a.textContent.trim().replace(/\\s+/g, ' ');
        if (isJunk(a.href, text)) return;
        if (seen.has(key)) return;
        seen.add(key);
        pages.push({
          order: order++,
          label: text.substring(0, 80),
          url: u.origin + path,
          path,
        });
      });

      return JSON.stringify({ rootKind, pages });
    })()
  `);

  execSync("agent-browser close", { stdio: "inherit" });

  const parsed = parseBrowserJson(raw);
  if (!parsed) {
    console.error("Failed to parse menu, raw value:", raw.substring(0, 300));
    process.exit(1);
  }
  if (parsed.error) {
    console.warn(`! No main menu detected (${parsed.error}). Falling back to just the root URL.`);
  }

  const found = (parsed.pages || []).filter(p => p.url !== origin && p.url !== origin + "/");

  // Always include the root as the homepage
  const homepage = { order: -1, label: "Home", url: origin + "/", path: "/" };
  const pages = [homepage, ...found].map((p, i) => ({
    order: i,
    label: p.label,
    url: p.url,
    path: p.path,
    slug: pageSlug(p.url),
  }));

  const sitemap = {
    host,
    origin,
    detectedAt: new Date().toISOString(),
    rootKind: parsed.rootKind ?? null,
    pages,
  };

  const sitemapPath = `${siteDir}/sitemap.json`;
  writeFileSync(sitemapPath, JSON.stringify(sitemap, null, 2));

  // Mirror into meta.json for backwards compatibility with 05-sitemap.js consumers
  let meta = {};
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
  }
  meta.sitemap = pages.map(p => ({ href: p.url, text: p.label }));
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`Sitemap written → ${sitemapPath}`);
  console.log(`Pages discovered (${pages.length}):`);
  pages.forEach(p => console.log(`  [${p.order}] ${p.slug.padEnd(20)} ${p.url}  (${p.label})`));

  return sitemap;
}

if (process.argv[1]?.endsWith("00-sitemap.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/00-sitemap.js <url>"); process.exit(1); }
  await run(url);
}
