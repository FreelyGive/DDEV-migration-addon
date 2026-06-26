import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { sitePaths, ensureDir } from "../lib/paths.js";
import { imageSize, cropPng } from "../lib/image.js";

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
    const seamProbeMatch = block.match(/\*\*Seam-probe:\*\*\s*(.+)/);

    if (!boundsMatch || !fileMatch) continue;

    sections.push({
      label: labelMatch?.[1]?.trim() ?? "Section",
      reason: reasonMatch?.[1]?.trim() ?? "",
      seamProbe: seamProbeMatch?.[1]?.trim() ?? "",
      x: parseInt(boundsMatch[1], 10),
      y: parseInt(boundsMatch[2], 10),
      width: parseInt(boundsMatch[3], 10) || imageWidth,
      height: parseInt(boundsMatch[4], 10),
      filename: fileMatch[1],
    });
  }

  return sections.sort((a, b) => a.y - b.y);
}

/**
 * Validate + repair section bounds before cropping. Catches the failure modes
 * that produced badly-cropped sections: a section that grabs the whole page,
 * overlaps, gaps, and bounds that run past the image. Bounds are sorted, clamped
 * to the image, de-overlapped, and gaps/uncropped regions are reported. Throws
 * only when the set is structurally hopeless (no valid section survives).
 */
export function validateSections(sections, imageHeight, imageWidth) {
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new Error("validateSections: empty section list");
  }
  // Seam-probe gate: every section MUST record the native-res strip it read
  // across its boundary (see visual-page-section-segmentation skill). A missing
  // or blank seamProbe means the boundary was committed without probing for
  // bleed — the exact failure this enforcement exists to catch. Hard-fail so the
  // crop never runs on un-probed bounds.
  const unprobed = sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => typeof s?.seamProbe !== "string" || s.seamProbe.trim() === "");
  if (unprobed.length) {
    const names = unprobed.map(({ s, i }) => `"${s?.label ?? `#${i + 1}`}"`).join(", ");
    throw new Error(
      `validateSections: missing seam-probe on ${unprobed.length} section(s): ${names}. ` +
        `Read a native-resolution strip across each boundary and record what it showed in seamProbe before cropping — see the visual-page-section-segmentation skill.`,
    );
  }
  const sorted = sections
    .map((s) => ({ ...s, y: Math.max(0, Math.round(Number(s.y))), height: Math.round(Number(s.height)) }))
    .filter((s) => Number.isFinite(s.y) && Number.isFinite(s.height) && s.height >= 1)
    .sort((a, b) => a.y - b.y);

  const warnings = [];
  const fixed = [];
  for (let i = 0; i < sorted.length; i++) {
    const s = { ...sorted[i] };
    if (s.y >= imageHeight) { warnings.push(`dropped "${s.label ?? i + 1}" — y(${s.y}) past page height(${imageHeight})`); continue; }
    // Remove overlap with the previous kept section.
    const prev = fixed[fixed.length - 1];
    if (prev && s.y < prev.y + prev.height) {
      const newTop = prev.y + prev.height;
      s.height -= newTop - s.y;
      s.y = newTop;
      if (s.height < 1) { warnings.push(`dropped "${s.label ?? i + 1}" — fully overlapped by previous`); continue; }
    }
    // Flag the "grabbed the whole page" bug BEFORE clamping — once we clamp the
    // height to the image, an over-large request looks normal. Compare the
    // REQUESTED span (and the requested bottom) against the page.
    const requestedHeight = s.height;
    if (sorted.length > 1 && (requestedHeight > imageHeight * 0.7 || s.y + requestedHeight > imageHeight * 1.2)) {
      warnings.push(`section "${s.label ?? i + 1}" requested ${requestedHeight}px (${Math.round((requestedHeight / imageHeight) * 100)}% of the page) — likely a wrong boundary that grabbed the whole page, not a real section`);
    }
    if (s.y + s.height > imageHeight) s.height = imageHeight - s.y;
    fixed.push(s);
  }
  if (fixed.length === 0) throw new Error("validateSections: no valid sections after repair — bounds are unusable");

  // Report vertical gaps + uncropped top/bottom (content the crops would miss).
  for (let i = 1; i < fixed.length; i++) {
    const gap = fixed[i].y - (fixed[i - 1].y + fixed[i - 1].height);
    if (gap > 20) warnings.push(`gap of ${gap}px between section ${i} and ${i + 1} — uncropped content`);
  }
  if (fixed[0].y > 20) warnings.push(`first section starts at y:${fixed[0].y} — top is uncropped`);
  const lastBottom = fixed[fixed.length - 1].y + fixed[fixed.length - 1].height;
  if (imageHeight - lastBottom > 20) warnings.push(`last section ends at y:${lastBottom} — bottom ${imageHeight - lastBottom}px (likely footer) is uncropped`);

  if (warnings.length) {
    console.warn("⚠ Section-bounds validation warnings:");
    for (const w of warnings) console.warn(`    - ${w}`);
  }
  return { sections: fixed, warnings };
}

export async function cropSections(screenshotPath, sections, outputDir, imageWidth) {
  ensureDir(outputDir);
  const sectionPaths = [];

  const meta = imageSize(screenshotPath);
  const imageHeight = meta.height;
  const { sections: validated } = validateSections(sections, imageHeight, imageWidth);

  for (let i = 0; i < validated.length; i++) {
    const s = validated[i];
    const label = String(i + 1).padStart(2, "0");
    const outPath = join(outputDir, `section-${label}.png`);

    const top = Math.max(0, s.y);
    const cropHeight = Math.min(s.height, imageHeight - top);
    if (cropHeight < 1) continue;

    cropPng(screenshotPath, { left: 0, top, width: imageWidth, height: cropHeight }, outPath);

    sectionPaths.push(outPath);
    console.log(`  Saved ${outPath} (${s.label ?? `Section ${i + 1}`}, y:${top}–${top + cropHeight})`);
  }

  return sectionPaths;
}

// Called by Claude after it has detected sections and written section markdown.
// sections: array parsed from Claude's visual-page-section-segmentation output.
export async function applySections(url, desktopSections, mobileSections) {
  const { screenshotPath, sectionsDir, metaPath } = sitePaths(url);
  const savedMeta = JSON.parse(readFileSync(metaPath, "utf8"));

  const imgMeta = imageSize(screenshotPath);
  const sectionPaths = await cropSections(screenshotPath, desktopSections, sectionsDir, imgMeta.width);
  savedMeta.sections = sectionPaths;

  if (mobileSections?.length && savedMeta.mobile?.screenshotPath) {
    const mobileSectionsDir = join(sitePaths(url).outputDir, "mobile-sections");
    const mobileImg = imageSize(savedMeta.mobile.screenshotPath);
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
