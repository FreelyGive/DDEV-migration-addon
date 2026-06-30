// Job 02b — Deterministic full-page capture + DOM-edge section split.
//
// This is the site-agnostic replacement for the brittle "screenshot --full then
// eyeball pixel boundaries" approach. It relies on two facts that hold on ANY
// page and removes all hand-tuned magic numbers:
//
//   1. A faithful full-page image (built by scroll-and-stitch, see
//      lib/capture-fullpage.js) whose pixel rows map 1:1×scale onto page-Y.
//   2. DOM-measured section bounds (jobs/01c) that are the real layout-block
//      edges — contiguous, gap-free, and by construction never cutting through
//      a component (they ARE the component containers).
//
// Cropping each DOM block (optionally merging adjacent ones, e.g. nav+hero) out
// of that image therefore CANNOT bleed or clip: every cut lands on a real
// container edge, where the blank inter-section band already lives. No per-site
// pixel tuning, no landmark text matching (which breaks on image-based bands).
//
// It also:
//   - crops to the document width (excludes the scrollbar gutter that otherwise
//     leaves a dark strip down the right edge),
//   - merges a bare top nav block into the hero (one header section),
//   - verifies every crop programmatically (non-blank, edges sit in calm bands)
//     and reports any section that fails so problems are caught, not shipped.
//
// Usage (an agent-browser session must already be open on the page):
//   node jobs/02b-capture-and-split.js <url>
// or programmatically: import { captureAndSplit } from "./02b-capture-and-split.js"

import { execFileSync } from "child_process";
import { mkdirSync } from "fs";
import { join } from "path";
import { sitePaths } from "../lib/paths.js";
import { captureFullPage } from "../lib/capture-fullpage.js";
import { measureSections } from "./01c-measure-sections.js";
import { imageSize, cropPng, readPng } from "../lib/image.js";

function ab(args, stdin) {
  return execFileSync("agent-browser", args, { input: stdin, encoding: "utf8" });
}

/**
 * Merge raw DOM blocks into visual sections. The ONLY structural refinement that
 * is safe to do deterministically (no vision) is merging a bare top navigation
 * block into the hero below it — the universal "navbar + hero share the top"
 * rule. Everything else stays on its own DOM edge: cutting on a real container
 * boundary can't slice a component, so leaving blocks un-merged is always safe
 * (worst case: one visual section arrives as two adjacent crops, never a bad cut).
 */
export function mergeNavIntoHero(sections) {
  if (sections.length >= 2 && sections[0].tag === "nav" && sections[0].y === 0) {
    const [nav, hero, ...rest] = sections;
    return [{ ...hero, y: 0, top: 0, height: hero.bottom - 0, tag: "header", _merged: "nav+hero" }, ...rest];
  }
  return sections;
}

/**
 * Merge tiny "tail-fragment" blocks into the section above them. The DOM
 * sometimes splits a section's trailing element (a lone CTA button, a divider,
 * a "see all" link) into its own short block. Such a block is a fragment of the
 * section above, not a section of its own. We merge a block into the PREVIOUS
 * one when it is short (< minH px) AND carries no heading of its own (provided
 * by 01c as `hasHeading`). This is conservative: a short block WITH a heading is
 * a real compact section (e.g. a CTA band) and is left alone. Works on any site
 * because it keys on relative size + heading presence, not site-specific text.
 */
export function mergeTailFragments(sections, { minH = 180 } = {}) {
  const out = [];
  for (const s of sections) {
    const prev = out[out.length - 1];
    const isFragment = (s.bottom - s.y) < minH && s.hasHeading === false && s.tag !== "footer";
    if (prev && isFragment && prev.tag !== "footer") {
      prev.bottom = s.bottom;
      prev.height = prev.bottom - prev.y;
      prev._merged = (prev._merged ? prev._merged + "+" : "") + "tail";
    } else {
      out.push({ ...s });
    }
  }
  return out;
}

/**
 * Verify a cropped section PNG. A crop is "ok" when it is not essentially blank
 * and its top/bottom edge rows are calm (not slicing through dense content).
 * Returns { ok, blankRatio, topEdgeBusy, bottomEdgeBusy, reason }.
 *
 * This is the programmatic stand-in for "look at every crop and ask: would I
 * ship this?" — it catches the failure modes (blank tiles, content sliced at the
 * very edge) without a human in the loop, on any site.
 */
export function verifyCrop(pngPath) {
  const png = readPng(pngPath);
  const { width: w, height: h, data } = png;
  if (h < 8) return { ok: false, reason: "degenerate height" };

  const bg = sampleBg(png); // dominant corner color = background
  function rowInk(y) {
    let ink = 0, n = 0;
    for (let x = 0; x < w; x += 3) {
      const i = (w * y + x) << 2;
      const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
      if (dr * dr + dg * dg + db * db > 900) ink++; // >30/channel-ish
      n++;
    }
    return ink / n;
  }
  // Horizontal "choppiness" of a row: how often the pixel flips between
  // background-like and ink-like across the row. TEXT and sliced components
  // flip many times (letters, gaps); a solid colour band or a photo edge stays
  // on one side (high ink but FEW flips). This is what tells a real slice apart
  // from a clean DOM-edge cut into a full-bleed band — the false positive that a
  // raw ink threshold can't distinguish.
  function rowChop(y) {
    let flips = 0, prev = null, n = 0;
    for (let x = 0; x < w; x += 2) {
      const i = (w * y + x) << 2;
      const dr = data[i] - bg[0], dg = data[i + 1] - bg[1], db = data[i + 2] - bg[2];
      const isInk = dr * dr + dg * dg + db * db > 900;
      if (prev !== null && isInk !== prev) flips++;
      prev = isInk; n++;
    }
    return flips / n; // ~0 for solid bands/photos, high for text rows
  }

  // Whole-image blankness: average ink across a sample of rows.
  let total = 0, rows = 0;
  for (let y = 0; y < h; y += Math.max(1, Math.floor(h / 60))) { total += rowInk(y); rows++; }
  const blankRatio = 1 - total / rows; // 1 = fully blank

  // A "sliced" edge = busy AND choppy (text/components cut mid-glyph). A clean
  // cut into a solid band or a photo is busy but NOT choppy, so it passes.
  const topChop = avg([rowChop(0), rowChop(1), rowChop(2)]);
  const bottomChop = avg([rowChop(h - 1), rowChop(h - 2), rowChop(h - 3)]);
  const topInk = avg([rowInk(0), rowInk(1), rowInk(2)]);
  const bottomInk = avg([rowInk(h - 1), rowInk(h - 2), rowInk(h - 3)]);
  const SLICE_INK = 0.18, SLICE_CHOP = 0.08; // both must trip → it's sliced text
  const topSliced = topInk > SLICE_INK && topChop > SLICE_CHOP;
  const bottomSliced = bottomInk > SLICE_INK && bottomChop > SLICE_CHOP;

  // Order matters: a sliced edge is a real defect even on an otherwise sparse
  // section, so check slicing BEFORE blankness (don't let "mostly whitespace"
  // mask a cut). Only call it blank when it is blank AND both edges are calm.
  const ok = !topSliced && !bottomSliced && blankRatio < 0.985;
  const reason = topSliced
    ? `top edge slices text/components (ink ${topInk.toFixed(2)}, chop ${topChop.toFixed(2)})`
    : bottomSliced
      ? `bottom edge slices text/components (ink ${bottomInk.toFixed(2)}, chop ${bottomChop.toFixed(2)})`
      : blankRatio >= 0.985
        ? "section is essentially blank"
        : null;
  return {
    ok, blankRatio: +blankRatio.toFixed(3),
    topInk: +topInk.toFixed(3), topChop: +topChop.toFixed(3),
    bottomInk: +bottomInk.toFixed(3), bottomChop: +bottomChop.toFixed(3),
    reason,
  };
}

function sampleBg(png) {
  // Background = the most common pixel colour (quantised). More robust than
  // corner-sampling, which breaks when content reaches a corner (e.g. a sliced
  // text row at the top edge would poison a corner estimate and hide the slice).
  const { width: w, height: h, data } = png;
  const counts = new Map();
  const stepX = Math.max(1, Math.floor(w / 60));
  const stepY = Math.max(1, Math.floor(h / 60));
  for (let y = 0; y < h; y += stepY) {
    for (let x = 0; x < w; x += stepX) {
      const i = (w * y + x) << 2;
      // quantise to 16-levels/channel to cluster near-identical bg pixels
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  let bestKey = 0, bestN = -1;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; bestKey = k; }
  const r = ((bestKey >> 8) & 0xf) << 4, g = ((bestKey >> 4) & 0xf) << 4, b = (bestKey & 0xf) << 4;
  return [r + 8, g + 8, b + 8]; // center of the quantisation bucket
}
function avg(a) { return a.reduce((s, v) => s + v, 0) / a.length; }

/**
 * Capture the open page and split it into section PNGs. Returns the per-section
 * report (paths, bounds, verification).
 */
export async function captureAndSplit(url, { outDir } = {}) {
  const { outputDir, sectionsDir } = sitePaths(url);
  const sectionsOut = outDir || sectionsDir;
  mkdirSync(sectionsOut, { recursive: true });

  // 1. Faithful full-page image (scale 1:1×scale, no whited-out bands).
  const ssPath = join(outputDir, "screenshot.png");
  mkdirSync(outputDir, { recursive: true });
  const cap = await captureFullPage({ outPath: ssPath, ab });
  console.log(`  Captured full page ${cap.width}x${cap.height} (scale ${cap.scale}, pageW ${cap.pageWidth})`);

  // 2. DOM section bounds, in page-Y; map to image-Y via cap.scale.
  const dom = measureSections(url);
  if (!dom.sections?.length) throw new Error(`No DOM sections measured (${dom.error || "unknown"})`);

  // 3. Refine (nav+hero merge only) and crop on DOM edges, to docWidth (drop the
  //    scrollbar gutter on the right).
  const merged = mergeTailFragments(mergeNavIntoHero(dom.sections));
  const cropW = Math.round(cap.pageWidth * cap.scale); // document content width in image px
  const imgH = imageSize(ssPath).height;

  const report = [];
  for (let i = 0; i < merged.length; i++) {
    const s = merged[i];
    const top = Math.round(s.y * cap.scale);
    const bottom = Math.min(imgH, Math.round(s.bottom * cap.scale));
    const height = bottom - top;
    if (height < 8) continue;
    const file = join(sectionsOut, `section-${String(i + 1).padStart(2, "0")}.png`);
    cropPng(ssPath, { left: 0, top, width: cropW, height }, file);
    const v = verifyCrop(file);
    report.push({ index: i + 1, file, tag: s.tag, yPage: s.y, bottomPage: s.bottom, ...v });
    const flag = v.ok ? "ok" : `⚠ ${v.reason}`;
    console.log(`  section-${String(i + 1).padStart(2, "0")} <${s.tag}> page ${s.y}-${s.bottom} → ${flag}`);
  }

  const bad = report.filter((r) => !r.ok);
  console.log(`Split ${report.length} sections (${bad.length} flagged).`);
  return { sections: report, capture: cap };
}

if (process.argv[1]?.endsWith("02b-capture-and-split.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/02b-capture-and-split.js <url>"); process.exit(1); }
  await captureAndSplit(url);
}
