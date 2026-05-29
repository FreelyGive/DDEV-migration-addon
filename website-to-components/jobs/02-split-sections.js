import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { sitePaths, ensureDir } from "../lib/paths.js";

// Section detection is handled by Claude using the visual-page-section-segmentation skill.
// See .claude/skills/webpage-sections-splitter/SKILL.md for the prompt.

function parseMarkdownSections(markdown, imageWidth) {
  const sections = [];
  const blocks = markdown.split(/(?=### Section \d+:)/g).filter(b => b.trim());

  for (const block of blocks) {
    const labelMatch = block.match(/### Section \d+:\s*(.+)/);
    const boundsMatch = block.match(/\*\*Bounds:\*\*\s*x=(\d+),\s*y=(\d+),\s*width=(\d+),\s*height=(\d+)/);
    const fileMatch = block.match(/\*\*File:\*\*\s*(\S+\.png)/);
    const reasonMatch = block.match(/\*\*Reason:\*\*\s*(.+)/);

    if (!boundsMatch || !fileMatch) continue;

    sections.push({
      label: labelMatch?.[1]?.trim() ?? "Section",
      reason: reasonMatch?.[1]?.trim() ?? "",
      x: parseInt(boundsMatch[1], 10),
      y: parseInt(boundsMatch[2], 10),
      width: parseInt(boundsMatch[3], 10) || imageWidth,
      height: parseInt(boundsMatch[4], 10),
      filename: fileMatch[1],
    });
  }

  return sections.sort((a, b) => a.y - b.y);
}

export async function cropSections(screenshotPath, sections, outputDir, imageWidth) {
  ensureDir(outputDir);
  const sectionPaths = [];

  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    const label = String(i + 1).padStart(2, "0");
    const outPath = join(outputDir, `section-${label}.png`);

    const top = Math.max(0, s.y);
    const cropHeight = s.height;
    if (cropHeight < 1) continue;

    await sharp(screenshotPath)
      .extract({ left: 0, top, width: imageWidth, height: cropHeight })
      .toFile(outPath);

    sectionPaths.push(outPath);
    console.log(`  Saved ${outPath} (${s.label}, y:${top}–${top + cropHeight})`);
  }

  return sectionPaths;
}

// Called by Claude after it has detected sections and written section markdown.
// sections: array parsed from Claude's visual-page-section-segmentation output.
export async function applySections(url, desktopSections, mobileSections) {
  const { screenshotPath, sectionsDir, metaPath } = sitePaths(url);
  const savedMeta = JSON.parse(readFileSync(metaPath, "utf8"));

  const imgMeta = await sharp(screenshotPath).metadata();
  const sectionPaths = await cropSections(screenshotPath, desktopSections, sectionsDir, imgMeta.width);
  savedMeta.sections = sectionPaths;

  if (mobileSections?.length && savedMeta.mobile?.screenshotPath) {
    const mobileSectionsDir = join(sitePaths(url).outputDir, "mobile-sections");
    const mobileImg = await sharp(savedMeta.mobile.screenshotPath).metadata();
    const mobileSectionPaths = await cropSections(savedMeta.mobile.screenshotPath, mobileSections, mobileSectionsDir, mobileImg.width);
    savedMeta.mobile.sections = mobileSectionPaths;
  }

  writeFileSync(metaPath, JSON.stringify(savedMeta, null, 2));
  console.log(`Cropped ${sectionPaths.length} desktop sections.`);
  return sectionPaths.length;
}

// Stub run() — section detection is done by Claude via CLAUDE_HANDOFF.md.
// Claude calls applySections() after detecting bounds from the screenshots.
export async function run(url) {
  const { metaPath } = sitePaths(url);
  const savedMeta = JSON.parse(readFileSync(metaPath, "utf8"));
  // Return 0 — the handoff file written by run.js tells Claude to do this step.
  // Actual section count is written to meta.json by applySections() later.
  return savedMeta.sections?.length ?? 0;
}

if (process.argv[1]?.endsWith("02-split-sections.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/02-split-sections.js <url>"); process.exit(1); }
  await run(url);
}
