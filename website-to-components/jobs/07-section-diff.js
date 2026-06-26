#!/usr/bin/env node
// jobs/07-section-diff.js
//
// Per-section visual diff gate. After Storybook is up and a page story is
// assembled, this script:
//   1. Reads the source section images from
//      output/<host>/<page-slug>/sections/section-NN.png and their y-bounds.
//   2. Takes a full-page screenshot of the live Storybook page story.
//   3. For each section, extracts the corresponding y-range from the live
//      screenshot, resizes it to match the source section width, and runs
//      pixelmatch against the source section image.
//   4. Writes per-section diff PNGs + a summary report.
//   5. Exits non-zero if any section exceeds the diff threshold.
//
// Universal: works for any cloned site that follows the website-to-components
// conventions. No project-specific logic.
//
// Usage:
//   node website-to-components/jobs/07-section-diff.js <page-url> <storybook-story-url> [--threshold 0.05]
//
// Example:
//   node website-to-components/jobs/07-section-diff.js \
//     https://example.com/ \
//     "http://localhost:6007/iframe.html?id=pages-example-com-homepage--default&viewMode=story" \
//     --threshold 0.05

import { spawnSync } from "child_process";
import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs";
import { join } from "path";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { sitePaths, ensureDir } from "../lib/paths.js";
import { imageSize, cropPng, resizePngFill } from "../lib/image.js";

function browserScreenshot(path) {
  spawnSync("agent-browser", ["screenshot", "--full", path], { stdio: "inherit" });
}
function browserOpen(url) {
  spawnSync("agent-browser", ["open", url], { stdio: "inherit" });
}

function pad2(n) { return String(n).padStart(2, "0"); }

export async function run(pageUrl, storyUrl, opts = {}) {
  const threshold = typeof opts.threshold === "number" ? opts.threshold : 0.05;
  const { outputDir, sectionsDir } = sitePaths(pageUrl);

  if (!existsSync(sectionsDir)) {
    console.error(`No sections dir at ${sectionsDir}. Run the section splitter first.`);
    process.exit(1);
  }

  // Discover source sections in numeric order
  const sectionFiles = readdirSync(sectionsDir)
    .filter(f => /^section-\d+\.png$/.test(f))
    .sort();
  if (sectionFiles.length === 0) {
    console.error(`No section-NN.png images in ${sectionsDir}.`);
    process.exit(1);
  }

  // Take Storybook screenshot
  const liveShot = join(outputDir, "storybook-page.png");
  console.log(`Opening Storybook story: ${storyUrl}`);
  browserOpen(storyUrl);
  await new Promise(r => setTimeout(r, 1500));
  console.log(`Capturing Storybook screenshot → ${liveShot}`);
  browserScreenshot(liveShot);

  if (!existsSync(liveShot)) {
    console.error(`Storybook screenshot failed: ${liveShot} not written.`);
    process.exit(1);
  }

  // Source y-bounds: compute by cumulative heights since sections are sliced top→bottom
  // (each section file has its own intrinsic height — that IS its source height)
  // Source full-page screenshot lives at outputDir/screenshot.png
  const sourceFullPath = join(outputDir, "screenshot.png");
  if (!existsSync(sourceFullPath)) {
    console.error(`Source screenshot missing: ${sourceFullPath}`);
    process.exit(1);
  }
  const sourceFullMeta = imageSize(sourceFullPath);
  const sourceWidth = sourceFullMeta.width;
  const sourceHeight = sourceFullMeta.height;

  // Storybook screenshot meta
  const liveMeta = imageSize(liveShot);
  const liveWidth = liveMeta.width;
  const liveHeight = liveMeta.height;
  const heightScale = liveHeight / sourceHeight;
  const widthScale = liveWidth / sourceWidth;

  const diffsDir = join(outputDir, "diffs");
  ensureDir(diffsDir);

  const results = [];
  let yCursor = 0;

  for (let i = 0; i < sectionFiles.length; i++) {
    const fname = sectionFiles[i];
    const idx = pad2(i + 1);
    const sourcePath = join(sectionsDir, fname);
    const meta = imageSize(sourcePath);
    const sectionHeight = meta.height;
    const sectionWidth = meta.width;

    // Live equivalent slice — scale y by liveHeight/sourceHeight
    const liveY = Math.round(yCursor * heightScale);
    const liveH = Math.round(sectionHeight * heightScale);
    const liveSliceRaw = join(diffsDir, `section-${idx}-live.png`);
    cropPng(liveShot, { left: 0, top: liveY, width: liveWidth, height: Math.min(liveH, liveHeight - liveY) }, liveSliceRaw);

    // Resize live slice to source dimensions so pixelmatch can compare
    const liveSliceResized = join(diffsDir, `section-${idx}-live-resized.png`);
    resizePngFill(liveSliceRaw, sectionWidth, sectionHeight, liveSliceResized);

    // Pixel diff
    const sourcePng = PNG.sync.read(readFileSync(sourcePath));
    const livePng = PNG.sync.read(readFileSync(liveSliceResized));
    const { width, height } = sourcePng;
    const diffPng = new PNG({ width, height });
    const numDiff = pixelmatch(sourcePng.data, livePng.data, diffPng.data, width, height, { threshold: 0.1 });
    const total = width * height;
    const diffRatio = numDiff / total;
    const diffPath = join(diffsDir, `section-${idx}-diff.png`);
    writeFileSync(diffPath, PNG.sync.write(diffPng));

    results.push({
      section: fname,
      bounds: { y: yCursor, width: sectionWidth, height: sectionHeight },
      diffPixels: numDiff,
      totalPixels: total,
      diffRatio,
      passed: diffRatio <= threshold,
      diffImage: diffPath,
    });

    yCursor += sectionHeight;
  }

  // Markdown report
  const reportPath = join(outputDir, "section-diff-report.md");
  const md = [];
  md.push(`# Section diff report — ${pageUrl}\n`);
  md.push(`Threshold: ${(threshold * 100).toFixed(1)}% diff per section\n`);
  md.push(`Live screenshot: \`${liveShot}\``);
  md.push(`Source screenshot: \`${sourceFullPath}\`\n`);
  md.push(`| Section | Diff % | Status | Diff image |`);
  md.push(`|---|---|---|---|`);
  for (const r of results) {
    md.push(`| ${r.section} | ${(r.diffRatio * 100).toFixed(2)}% | ${r.passed ? "✅ PASS" : "❌ FAIL"} | \`${r.diffImage}\` |`);
  }
  const failed = results.filter(r => !r.passed);
  md.push(`\n## Summary\n`);
  md.push(`- Passed: ${results.length - failed.length}/${results.length}`);
  md.push(`- Failed: ${failed.length}/${results.length}`);
  if (failed.length > 0) {
    md.push(`\n### Failed sections — investigate and fix\n`);
    for (const r of failed) {
      md.push(`- **${r.section}** — ${(r.diffRatio * 100).toFixed(2)}% diff. Open \`${r.diffImage}\` to see where pixels differ, then update the matching component(s).`);
    }
  }
  writeFileSync(reportPath, md.join("\n") + "\n");

  console.log(`\nSection diff report: ${reportPath}`);
  for (const r of results) {
    const tag = r.passed ? "PASS" : "FAIL";
    console.log(`  [${tag}] ${r.section}  ${(r.diffRatio * 100).toFixed(2)}%`);
  }

  if (failed.length > 0) {
    console.error(`\n${failed.length} section(s) exceeded ${(threshold * 100).toFixed(1)}% diff threshold. See ${reportPath}.`);
    process.exit(1);
  }
  console.log(`\nAll sections within threshold. ✓`);
}

if (process.argv[1]?.endsWith("07-section-diff.js")) {
  const pageUrl = process.argv[2];
  const storyUrl = process.argv[3];
  const tIdx = process.argv.indexOf("--threshold");
  const threshold = tIdx > 0 ? Number(process.argv[tIdx + 1]) : 0.05;
  if (!pageUrl || !storyUrl) {
    console.error("Usage: node jobs/07-section-diff.js <page-url> <storybook-story-url> [--threshold 0.05]");
    process.exit(1);
  }
  await run(pageUrl, storyUrl, { threshold });
}
