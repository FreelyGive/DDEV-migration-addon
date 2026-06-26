/**
 * Job 01c — Measure section boundaries from the live DOM
 *
 * Instead of having the vision agent ESTIMATE pixel boundaries off a downscaled
 * full-page screenshot (which cuts through components and occasionally grabs the
 * whole page), this job reads the REAL geometry of the page's top-level layout
 * blocks via getBoundingClientRect. The result is a set of contiguous,
 * non-overlapping candidate boundaries that never slice a component in half —
 * because they ARE the component containers.
 *
 * The vision agent (Step 3) then REFINES these: merges navbar into the hero,
 * splits an over-large block, and labels each one. It does not invent pixels.
 *
 * Output: output/<site>/<page>/dom-sections.json
 *   { pageWidth, pageHeight, container, coverage, sections: [{ y, height, top, bottom, tag, cls }] }
 *
 * This MUST run while the browser is still open on the page (called from
 * 01-screenshot.js after the page is fully scrolled/loaded), so it shares the
 * already-rendered, lazy-loaded DOM.
 *
 * Usage (standalone, requires an open agent-browser session on the page):
 *   node jobs/01c-measure-sections.js <url>
 */

import { spawnSync, execSync } from "child_process";
import { writeFileSync } from "fs";
import { sitePaths, ensureDir } from "../lib/paths.js";

function browserEval(js) {
  const result = spawnSync("agent-browser", ["eval", "--stdin"], {
    input: js,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.stdout?.trim() ?? "";
}

// The measurement script, run in the page context. Picks the container whose
// direct children best tile the page vertically, returns those children as
// contiguous sections covering the full page height (top→footer→bottom).
const MEASURE_JS = `(() => {
  const PW = document.documentElement.scrollWidth;
  const PH = document.documentElement.scrollHeight;

  // Score a container by how well its wide, non-trivial direct children tile
  // the page vertically. Returns null if it has fewer than 2 usable children.
  function score(container) {
    if (!container) return null;
    const kids = [...container.children].map(el => {
      const r = el.getBoundingClientRect();
      return {
        el,
        top: Math.round(r.top + window.scrollY),
        h: Math.round(r.height),
        w: r.width,
      };
    }).filter(k => k.h >= 30 && k.w >= PW * 0.5);
    if (kids.length < 2) return null;
    kids.sort((a, b) => a.top - b.top);
    const covered = kids.reduce((s, k) => s + k.h, 0);
    return { container, kids, coverage: covered / PH, n: kids.length };
  }

  // Candidate containers, broad to narrow. We prefer the one with the best
  // vertical coverage and a sane section count (avoid a wrapper that is just
  // ONE full-page child — that is the "grabbed the whole page" failure mode).
  const cands = [
    ...document.querySelectorAll('main, [role="main"], article, .sections, [class*="page-section"], #content, .content, .site-content, .region-content'),
    document.body,
  ];
  let best = null;
  for (const c of cands) {
    const s = score(c);
    if (!s) continue;
    // Reject containers whose single biggest child is basically the whole page.
    const maxChild = Math.max(...s.kids.map(k => k.h));
    if (maxChild > PH * 0.85 && s.n <= 2) continue;
    if (!best ||
        s.coverage > best.coverage + 0.05 ||
        (Math.abs(s.coverage - best.coverage) <= 0.05 && s.n > best.n)) {
      best = s;
    }
  }
  if (!best) return JSON.stringify({ error: 'no-suitable-container', pageWidth: PW, pageHeight: PH });

  // Build contiguous, gap-free, full-page-covering sections from the chosen
  // children: each section spans from its own top to the NEXT child's top, and
  // the last one extends to the page bottom (captures the footer too).
  const tops = best.kids.map(k => k.top);
  const sections = best.kids.map((k, i) => {
    const top = Math.max(0, i === 0 ? 0 : tops[i]);
    const bottom = i === best.kids.length - 1 ? PH : tops[i + 1];
    return {
      y: top,
      height: Math.max(1, bottom - top),
      top,
      bottom,
      tag: k.el.tagName.toLowerCase(),
      cls: (k.el.className || '').toString().replace(/\\s+/g, ' ').trim().slice(0, 60),
    };
  });

  return JSON.stringify({
    pageWidth: PW,
    pageHeight: PH,
    container: (best.container.tagName + '.' + (best.container.className || '')).replace(/\\s+/g, '.').slice(0, 60),
    coverage: +best.coverage.toFixed(2),
    sectionCount: sections.length,
    sections,
  });
}())`;

/**
 * Measure sections from the currently-open page and write dom-sections.json.
 * Assumes an agent-browser session is already open on the target URL.
 */
export function measureSections(url) {
  const { outputDir } = sitePaths(url);
  ensureDir(outputDir);
  const outPath = `${outputDir}/dom-sections.json`;

  const raw = browserEval(MEASURE_JS);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.log(`  DOM section measurement returned no parseable result; vision will fall back to estimation.`);
    parsed = { error: "measure-failed", raw: raw.slice(0, 200) };
  }

  writeFileSync(outPath, JSON.stringify(parsed, null, 2));

  if (parsed.sections?.length) {
    console.log(
      `  Measured ${parsed.sections.length} DOM section(s) from ${parsed.container} ` +
      `(coverage ${Math.round((parsed.coverage ?? 0) * 100)}%): ` +
      parsed.sections.map(s => `${s.y}–${s.bottom}`).join(", "),
    );
  } else {
    console.log(`  No reliable DOM sections measured (${parsed.error ?? "unknown"}); vision will estimate.`);
  }
  return parsed;
}

// Standalone entry: requires an already-open session. Opens the URL if asked.
export async function run(url, { open = false } = {}) {
  if (open) {
    execSync(`agent-browser open "${url}"`, { stdio: "inherit" });
    execSync("agent-browser wait --load networkidle", { stdio: "inherit" });
  }
  return measureSections(url);
}

if (process.argv[1]?.endsWith("01c-measure-sections.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/01c-measure-sections.js <url> [--open]"); process.exit(1); }
  await run(url, { open: process.argv.includes("--open") });
}
