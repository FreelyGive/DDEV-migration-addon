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

/**
 * Decode the raw stdout of `agent-browser eval` into the measurement object.
 *
 * `agent-browser eval` JSON-encodes the page's return value, and the page
 * script itself returns a JSON string — so the result arrives DOUBLE-encoded.
 * A single JSON.parse yields a *string*, whose `.sections` is undefined, which
 * is what made the job report "No reliable DOM sections" even on a successful
 * measurement and push vision into estimating bounds off the screenshot.
 * Parse up to twice and accept whichever pass produces an object; on anything
 * unparseable, return a `measure-failed` marker (vision then estimates).
 */
export function parseMeasureResult(raw) {
  try {
    let v = JSON.parse(raw);
    if (typeof v === "string") v = JSON.parse(v);
    if (typeof v !== "object" || v === null) throw new Error("not an object");
    return v;
  } catch {
    return { error: "measure-failed", raw: (raw ?? "").slice(0, 200) };
  }
}

// The measurement script, run in the page context. Picks the container whose
// direct children best tile the page vertically, then captures any full-width
// sibling blocks (header/footer) that sit OUTSIDE that container above or below
// it — so the footer becomes its own section instead of being swallowed by the
// last child. Returns contiguous, gap-free sections covering the full page.
//
// NOTE: this is wrapped as a `function`-keyword IIFE, NOT an arrow IIFE.
// `agent-browser eval` parses `(function(){…}())` but throws
// `SyntaxError: Unexpected token '('` on `(() => {…}())`. Using the arrow form
// made every measurement silently fail → dom-sections.json = "measure-failed"
// → vision fell back to estimating bounds off the downscaled screenshot, which
// is what produced merged/bleeding section crops. Keep this a `function` IIFE.
export const MEASURE_JS = `(function () {
  var PW = document.documentElement.scrollWidth;
  var PH = document.documentElement.scrollHeight;

  function measure(el) {
    var r = el.getBoundingClientRect();
    return {
      el: el,
      top: Math.round(r.top + window.scrollY),
      bottom: Math.round(r.bottom + window.scrollY),
      h: Math.round(r.height),
      w: r.width,
    };
  }
  function isWide(m) { return m.h >= 30 && m.w >= PW * 0.5; }

  // Score a container by how well its wide, non-trivial direct children tile
  // the page vertically. Returns null if it has fewer than 2 usable children.
  function score(container) {
    if (!container) return null;
    var kids = [].slice.call(container.children).map(measure).filter(isWide);
    if (kids.length < 2) return null;
    kids.sort(function (a, b) { return a.top - b.top; });
    var covered = kids.reduce(function (s, k) { return s + k.h; }, 0);
    return { container: container, kids: kids, coverage: covered / PH, n: kids.length };
  }

  // Candidate containers, broad to narrow. We prefer the one with the best
  // vertical coverage and a sane section count (avoid a wrapper that is just
  // ONE full-page child — that is the "grabbed the whole page" failure mode).
  var cands = [].slice.call(document.querySelectorAll(
    'main, [role="main"], article, .sections, [class*="page-section"], #content, .content, .site-content, .region-content'
  ));
  cands.push(document.body);

  var best = null;
  for (var ci = 0; ci < cands.length; ci++) {
    var s = score(cands[ci]);
    if (!s) continue;
    // Reject containers whose single biggest child is basically the whole page.
    var maxChild = Math.max.apply(null, s.kids.map(function (k) { return k.h; }));
    if (maxChild > PH * 0.85 && s.n <= 2) continue;
    if (!best ||
        s.coverage > best.coverage + 0.05 ||
        (Math.abs(s.coverage - best.coverage) <= 0.05 && s.n > best.n)) {
      best = s;
    }
  }
  if (!best) return JSON.stringify({ error: 'no-suitable-container', pageWidth: PW, pageHeight: PH });

  // Full-width blocks that live OUTSIDE the chosen container (siblings of it, or
  // of its ancestors) and sit above/below it. The footer is the common case:
  // it's a sibling of <article.sections>, so the scorer never saw it and the old
  // code extended the last child to PH, merging the footer into it. Collect them
  // so each becomes its own section. We only take blocks NOT contained in best.
  var containerRect = measure(best.container);
  var outerBlocks = [];
  var seen = [best.container];
  for (var node = best.container; node && node !== document.body && node.parentElement; node = node.parentElement) {
    var sibs = [].slice.call(node.parentElement.children);
    for (var si = 0; si < sibs.length; si++) {
      var sib = sibs[si];
      if (sib === node || best.container.contains(sib) || sib.contains(best.container)) continue;
      var m = measure(sib);
      if (!isWide(m)) continue;
      // Skip overlay/absolute chrome that overlaps the container's vertical span.
      if (m.bottom > containerRect.top && m.top < containerRect.bottom) continue;
      if (seen.indexOf(sib) !== -1) continue;
      seen.push(sib);
      outerBlocks.push(m);
    }
  }

  // Boundary list: each kid plus each outer block, as {top, bottom, tag, cls}.
  var blocks = best.kids.map(function (k) {
    return { top: k.top, bottom: k.bottom, el: k.el };
  }).concat(outerBlocks.map(function (m) {
    return { top: m.top, bottom: m.bottom, el: m.el };
  }));
  blocks.sort(function (a, b) { return a.top - b.top; });

  // Build contiguous, gap-free sections. Each section spans from its own top to
  // the NEXT block's top; the first starts at 0; the last extends to the larger
  // of its own DOM bottom and PH (so trailing whitespace/footer tail is covered)
  // — but it no longer swallows a real footer, because the footer is now its own
  // block in the list.
  var tops = blocks.map(function (b) { return b.top; });
  var sections = blocks.map(function (b, i) {
    var top = Math.max(0, i === 0 ? 0 : tops[i]);
    var bottom = i === blocks.length - 1 ? Math.max(b.bottom, PH) : tops[i + 1];
    return {
      y: top,
      height: Math.max(1, bottom - top),
      top: top,
      bottom: bottom,
      tag: b.el.tagName.toLowerCase(),
      cls: (b.el.className || '').toString().replace(/\\s+/g, ' ').trim().slice(0, 60),
      // Whether this block contains its own heading. Lets a downstream refiner
      // tell a real (compact) section from a headingless tail-fragment (a lone
      // CTA/divider the DOM split out) that should merge into the section above.
      hasHeading: !!(b.el.querySelector && b.el.querySelector('h1,h2,h3,h4,[role="heading"]')),
    };
  });

  var covered2 = sections.reduce(function (s, sec) { return s + sec.height; }, 0);
  return JSON.stringify({
    pageWidth: PW,
    pageHeight: PH,
    container: (best.container.tagName + '.' + (best.container.className || '')).replace(/\\s+/g, '.').slice(0, 60),
    coverage: +(covered2 / PH).toFixed(2),
    sectionCount: sections.length,
    sections: sections,
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
  const parsed = parseMeasureResult(raw);
  if (parsed.error === "measure-failed") {
    console.log(`  DOM section measurement returned no parseable result; vision will fall back to estimation.`);
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
