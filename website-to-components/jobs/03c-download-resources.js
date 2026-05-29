#!/usr/bin/env node
/**
 * 03c-download-resources.js
 *
 * Downloads all site assets from site-resources.json into:
 *   output/<site>/resources/
 *     images/   — <img> src URLs (non-base64)
 *     css/      — stylesheets
 *     svg/      — inline SVGs saved as .svg files
 *     fonts/    — woff2/woff/ttf/otf font files
 *
 * Base64-encoded assets are written as-is (decoded to binary).
 * All downloaded filenames are recorded in resources-manifest.json.
 *
 * Usage: node jobs/03c-download-resources.js <url>
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, basename, extname } from 'path';
import { sitePaths } from '../lib/paths.js';

const FONT_EXTS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.eot']);
const IMG_EXTS  = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.avif']);

export async function run(url) {
  const { outputDir } = sitePaths(url);
  const resourcesJson = join(outputDir, 'site-resources.json');

  if (!existsSync(resourcesJson)) {
    console.warn('  site-resources.json not found — run 03b first');
    return;
  }

  const assets = JSON.parse(readFileSync(resourcesJson, 'utf8'));

  const dirs = {
    images: join(outputDir, 'resources', 'images'),
    css:    join(outputDir, 'resources', 'css'),
    svg:    join(outputDir, 'resources', 'svg'),
    fonts:  join(outputDir, 'resources', 'fonts'),
  };
  for (const d of Object.values(dirs)) mkdirSync(d, { recursive: true });

  const manifest = { images: [], css: [], svg: [], fonts: [], skipped: [] };

  // Download a URL to a local path via curl
  function download(srcUrl, destPath) {
    try {
      execSync(`curl -sL --max-time 15 -o "${destPath}" "${srcUrl}"`, { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  // Save base64 data URI to file
  function saveBase64(dataUri, destPath) {
    const match = dataUri.match(/^data:[^;]+;base64,(.+)$/);
    if (!match) return false;
    writeFileSync(destPath, Buffer.from(match[1], 'base64'));
    return true;
  }

  // Derive a unique safe filename from a URL or index
  function safeName(srcUrl, idx, defaultExt) {
    try {
      const u = new URL(srcUrl);
      let name = basename(u.pathname) || `asset-${idx}`;
      if (!extname(name) && defaultExt) name += defaultExt;
      return name;
    } catch {
      return `asset-${idx}${defaultExt || ''}`;
    }
  }

  // ── Images ──────────────────────────────────────────────────────────────────
  for (const [i, img] of (assets.images ?? []).entries()) {
    const src = img.src;
    if (!src) continue;
    if (img.isBase64) {
      const name = `base64-img-${i}.png`;
      const dest = join(dirs.images, name);
      if (saveBase64(src, dest)) manifest.images.push({ src, local: dest, base64: true });
    } else {
      const name = safeName(src, i, '.png');
      const dest = join(dirs.images, name);
      if (download(src, dest)) manifest.images.push({ src, local: dest });
      else manifest.skipped.push({ src, reason: 'download failed' });
    }
  }

  // ── CSS background images (non-base64 URLs only) ─────────────────────────
  for (const [i, bg] of (assets.backgroundImages ?? []).entries()) {
    const src = bg.backgroundImage;
    if (!src || bg.isBase64) continue;
    const name = safeName(src, i, '.png');
    const dest = join(dirs.images, name);
    if (!existsSync(dest)) {
      if (!download(src, dest)) manifest.skipped.push({ src, reason: 'download failed' });
      else manifest.images.push({ src, local: dest, via: 'css-background' });
    }
  }

  // ── Stylesheets ──────────────────────────────────────────────────────────
  for (const [i, href] of (assets.stylesheets ?? []).entries()) {
    if (!href) continue;
    const name = safeName(href, i, '.css');
    const dest = join(dirs.css, name);
    if (download(href, dest)) manifest.css.push({ src: href, local: dest });
    else manifest.skipped.push({ src: href, reason: 'download failed' });
  }

  // ── Inline SVGs ──────────────────────────────────────────────────────────
  for (const svgItem of (assets.inlineSvgs ?? [])) {
    const name = `inline-svg-${svgItem.index}.svg`;
    const dest = join(dirs.svg, name);
    if (saveBase64(svgItem.dataUri, dest)) {
      manifest.svg.push({ index: svgItem.index, viewBox: svgItem.viewBox, local: dest });
    }
  }

  // ── Fonts — from @font-face src URLs in stylesheets and font links ───────
  // Collect font URLs: from assets.fonts (link[href*=font]) + parse downloaded CSS
  const fontUrls = new Set();

  for (const href of (assets.fonts ?? [])) {
    if (href) fontUrls.add(href);
  }

  // Parse downloaded CSS files for @font-face src URLs
  for (const { local } of manifest.css) {
    try {
      const css = readFileSync(local, 'utf8');
      const matches = css.matchAll(/url\(['"]?([^'")\s]+\.(?:woff2|woff|ttf|otf|eot)[^'")\s]*)['"]?\)/gi);
      for (const m of matches) {
        try {
          // Resolve relative URLs against the stylesheet href
          const sheet = manifest.css.find(c => c.local === local);
          const base = sheet?.src;
          const resolved = base ? new URL(m[1], base).href : m[1];
          fontUrls.add(resolved);
        } catch { fontUrls.add(m[1]); }
      }
    } catch {}
  }

  for (const [i, fontUrl] of [...fontUrls].entries()) {
    const name = safeName(fontUrl, i, '.woff2');
    const dest = join(dirs.fonts, name);
    if (download(fontUrl, dest)) manifest.fonts.push({ src: fontUrl, local: dest });
    else manifest.skipped.push({ src: fontUrl, reason: 'download failed' });
  }

  // ── Write manifest ────────────────────────────────────────────────────────
  const manifestPath = join(outputDir, 'resources-manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`  resources/images/ — ${manifest.images.length} files`);
  console.log(`  resources/css/    — ${manifest.css.length} files`);
  console.log(`  resources/svg/    — ${manifest.svg.length} files`);
  console.log(`  resources/fonts/  — ${manifest.fonts.length} files`);
  if (manifest.skipped.length) console.log(`  skipped           — ${manifest.skipped.length} (see resources-manifest.json)`);
  console.log(`  Manifest: ${manifestPath}`);
}

// Run directly if called as script
if (process.argv[1] && process.argv[1].endsWith('03c-download-resources.js')) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) {
    console.error('Usage: node jobs/03c-download-resources.js <url>');
    process.exit(1);
  }
  await run(url);
}
