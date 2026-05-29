#!/usr/bin/env node
/**
 * 03d-generate-brand-kit.js
 *
 * Generates canvas/canvas.brand-kit.json and resets canvas/src/components/global.css
 * based on fonts downloaded for the cloned site.
 *
 * - Copies fonts from output/<site>/resources/fonts/ → canvas/public/fonts/
 * - Parses @font-face rules from downloaded CSS to extract family/weight/style
 * - Falls back to filename inference if no CSS @font-face rules found
 * - Writes canvas/canvas.brand-kit.json with local file entries
 * - Rewrites canvas/src/components/global.css with @font-face blocks
 *
 * Usage: node jobs/03d-generate-brand-kit.js <url>
 */

import { readFileSync, writeFileSync, copyFileSync, mkdirSync, existsSync, readdirSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath } from "url";
import { sitePaths } from "../lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CANVAS_ROOT = join(__dirname, "../../canvas");
const PUBLIC_FONTS_DIR = join(CANVAS_ROOT, "public/fonts");
const BRAND_KIT_PATH = join(CANVAS_ROOT, "canvas.brand-kit.json");
const GLOBAL_CSS_PATH = join(CANVAS_ROOT, "src/components/global.css");

const FONT_EXTS = new Set([".woff2", ".woff", ".ttf", ".otf"]);

// Infer weight from filename patterns
function inferWeight(filename) {
  const f = filename.toLowerCase();
  if (f.includes("thin") || f.includes("-100")) return "100";
  if (f.includes("extralight") || f.includes("ultralight") || f.includes("-200")) return "200";
  if (f.includes("light") || f.includes("-300")) return "300";
  if (f.includes("medium") || f.includes("-500")) return "500";
  if (f.includes("semibold") || f.includes("demibold") || f.includes("-600")) return "600";
  if (f.includes("extrabold") || f.includes("ultrabold") || f.includes("-800")) return "800";
  if (f.includes("black") || f.includes("heavy") || f.includes("-900")) return "900";
  if (f.includes("bold") || f.includes("-700")) return "700";
  if (f.includes("book") || f.includes("regular") || f.includes("-400")) return "400";
  return "400";
}

// Infer style from filename patterns
function inferStyle(filename) {
  const f = filename.toLowerCase();
  if (f.includes("italic") || f.includes("oblique")) return "italic";
  return "normal";
}

// Parse @font-face rules from CSS text, return array of { family, weight, style, src (relative filename) }
function parseFontFaces(cssText, downloadedFontFiles) {
  const faces = [];
  const fontFaceRe = /@font-face\s*\{([^}]+)\}/gi;
  let match;
  while ((match = fontFaceRe.exec(cssText)) !== null) {
    const block = match[1];
    const familyMatch = block.match(/font-family\s*:\s*['"]?([^'";,]+)['"]?/i);
    const weightMatch = block.match(/font-weight\s*:\s*([^;]+)/i);
    const styleMatch = block.match(/font-style\s*:\s*([^;]+)/i);
    const srcMatches = [...block.matchAll(/url\(['"]?([^'")\s]+\.(?:woff2|woff|ttf|otf))['"]?\)/gi)];

    if (!familyMatch) continue;

    const family = familyMatch[1].trim();
    const weight = weightMatch ? weightMatch[1].trim().split(/\s+/)[0] : "400";
    const style = styleMatch ? styleMatch[1].trim() : "normal";

    for (const srcMatch of srcMatches) {
      const srcUrl = srcMatch[1];
      const filename = basename(srcUrl.split("?")[0]);
      // Only include if we actually downloaded this font
      const downloaded = downloadedFontFiles.find(f => basename(f) === filename || f.endsWith(filename));
      if (downloaded) {
        faces.push({ family, weight, style, filename: basename(downloaded) });
      }
    }
  }
  return faces;
}

export async function run(url) {
  const { outputDir } = sitePaths(url);
  const manifestPath = join(outputDir, "resources-manifest.json");

  if (!existsSync(manifestPath)) {
    console.warn("  resources-manifest.json not found — skipping brand kit generation");
    return;
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const fontFiles = (manifest.fonts ?? []).map(f => f.local).filter(Boolean);

  if (fontFiles.length === 0) {
    console.log("  No fonts downloaded — skipping brand kit generation");
    return;
  }

  // Copy fonts to canvas/public/fonts/
  mkdirSync(PUBLIC_FONTS_DIR, { recursive: true });
  const copiedFonts = [];
  for (const src of fontFiles) {
    if (!existsSync(src)) continue;
    const dest = join(PUBLIC_FONTS_DIR, basename(src));
    copyFileSync(src, dest);
    copiedFonts.push(basename(src));
  }
  console.log(`  Copied ${copiedFonts.length} font(s) to canvas/public/fonts/`);

  // Try to extract @font-face rules from downloaded CSS
  let fontFaces = [];
  for (const cssEntry of manifest.css ?? []) {
    if (!cssEntry.local || !existsSync(cssEntry.local)) continue;
    try {
      const css = readFileSync(cssEntry.local, "utf8");
      const parsed = parseFontFaces(css, copiedFonts.map(f => join(PUBLIC_FONTS_DIR, f)));
      fontFaces.push(...parsed);
    } catch {}
  }

  // Deduplicate by family+weight+style+filename
  const seen = new Set();
  fontFaces = fontFaces.filter(f => {
    const key = `${f.family}|${f.weight}|${f.style}|${f.filename}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Fall back to filename inference if no CSS @font-face rules matched
  if (fontFaces.length === 0) {
    console.log("  No @font-face rules found in CSS — inferring from filenames");
    for (const filename of copiedFonts) {
      const ext = "." + filename.split(".").pop();
      if (!FONT_EXTS.has(ext)) continue;
      // Guess family name: strip weight/style suffixes and extension
      const base = filename.replace(/\.[^.]+$/, "");
      const family = base
        .replace(/[-_](thin|extralight|ultralight|light|book|regular|medium|semibold|demibold|bold|extrabold|ultrabold|black|heavy|italic|oblique|100|200|300|400|500|600|700|800|900|web|wf|woff2?)/gi, "")
        .replace(/[-_]+$/, "")
        .replace(/[-_]/g, " ")
        .trim();
      fontFaces.push({
        family: family || base,
        weight: inferWeight(filename),
        style: inferStyle(filename),
        filename,
      });
    }
  }

  // Write canvas.brand-kit.json
  const brandKit = {
    fonts: {
      families: fontFaces.map(f => ({
        name: f.family,
        src: `public/fonts/${f.filename}`,
        weights: [f.weight],
        styles: [f.style],
      })),
    },
  };
  writeFileSync(BRAND_KIT_PATH, JSON.stringify(brandKit, null, 2));
  console.log(`  Wrote canvas.brand-kit.json (${fontFaces.length} font variant(s))`);

  // Rewrite canvas/src/components/global.css
  mkdirSync(dirname(GLOBAL_CSS_PATH), { recursive: true });
  const fontFaceBlocks = fontFaces.map(f => `@font-face {
  font-family: "${f.family}";
  font-weight: ${f.weight};
  font-style: ${f.style};
  font-display: swap;
  src: url("/fonts/${f.filename}") format("${f.filename.endsWith(".woff2") ? "woff2" : f.filename.endsWith(".woff") ? "woff" : "truetype"}");
}`);

  const globalCss = ["@import \"tailwindcss\";", "", ...fontFaceBlocks, ""].join("\n");
  writeFileSync(GLOBAL_CSS_PATH, globalCss);
  console.log("  Rewrote canvas/src/components/global.css");
}

if (process.argv[1]?.endsWith("03d-generate-brand-kit.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/03d-generate-brand-kit.js <url>"); process.exit(1); }
  await run(url);
}
