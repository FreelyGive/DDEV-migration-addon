#!/usr/bin/env node
/**
 * Per-page section cropper that does NOT touch meta.json (safe under parallel agents).
 *
 * Usage:
 *   node website-to-components/scripts/crop-sections.js <page-url> <sections-json-path>
 *
 * The JSON file should contain an array of:
 *   { label, y, height, width?, reason? }
 * Cropped PNGs are written into the per-page sectionsDir as section-01.png … section-NN.png.
 */
import { readFileSync } from "fs";
import { sitePaths } from "../lib/paths.js";
import { cropSections } from "../jobs/02-split-sections.js";
import sharp from "sharp";

const url = process.argv[2];
const jsonPath = process.argv[3];
if (!url || !jsonPath) {
  console.error("Usage: node crop-sections.js <page-url> <sections-json-path>");
  process.exit(1);
}

const sections = JSON.parse(readFileSync(jsonPath, "utf8"));
if (!Array.isArray(sections) || sections.length === 0) {
  console.error("sections JSON must be a non-empty array");
  process.exit(1);
}

const { screenshotPath, sectionsDir } = sitePaths(url);
const meta = await sharp(screenshotPath).metadata();

const normalized = sections.map((s, i) => ({
  label: s.label || `Section ${i + 1}`,
  reason: s.reason || "",
  x: s.x ?? 0,
  y: Number(s.y),
  width: s.width || meta.width,
  height: Number(s.height),
  filename: s.filename || `section-${String(i + 1).padStart(2, "0")}.png`,
}));

const paths = await cropSections(screenshotPath, normalized, sectionsDir, meta.width);
console.log(`Cropped ${paths.length} section(s) into ${sectionsDir}`);
