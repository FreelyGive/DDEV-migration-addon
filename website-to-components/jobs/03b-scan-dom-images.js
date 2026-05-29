#!/usr/bin/env node
/**
 * 03b-scan-dom-images.js
 *
 * Deep-scans the FULLY RENDERED DOM of any URL for all <img> elements,
 * including those injected by JavaScript and third-party widgets (e.g.
 * Fundraise Up, Typeform, Intercom). Waits for network idle before scanning.
 *
 * Use this when a page has popups, modals, or widgets that load images
 * dynamically AFTER the initial HTML is parsed — these are missed by
 * 03b-extract-assets.js which captures only the static page load.
 *
 * Results are merged into site-resources.json and any new images are
 * downloaded into resources/images/ and copied to canvas/public/images/<site>/.
 *
 * Usage:
 *   node website-to-components/scripts/scan-dom-images.js <url>
 *
 * Examples:
 *   # Scan homepage
 *   node website-to-components/scripts/scan-dom-images.js https://example.com
 *
 *   # Scan page with modal open (query param triggers it)
 *   node website-to-components/scripts/scan-dom-images.js "https://example.com/?form=FUNJHNAUEXC"
 */

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, createWriteStream } from 'fs';
import { join, basename, extname } from 'path';
import { sitePaths, siteSlug, ROOT } from '../lib/paths.js';

// How long to wait (ms) after page load for JS widgets to inject their DOM
const SETTLE_MS = 4000;

export async function run(url) {
  const { outputDir, siteDir } = sitePaths(url);
  const slug = siteSlug(url);
  mkdirSync(outputDir, { recursive: true });

  console.log(`  Opening: ${url}`);
  try {
    execSync(`agent-browser open ${JSON.stringify(url)}`, { encoding: 'utf8', timeout: 30000 });
  } catch (err) {
    // Page may already be open — continue
  }

  // Wait for JS widgets to finish injecting DOM
  console.log(`  Waiting ${SETTLE_MS}ms for dynamic content to settle...`);
  await new Promise(r => setTimeout(r, SETTLE_MS));

  // Scan ALL <img> elements in the fully-rendered DOM, including shadow DOM where accessible
  const script = `
(function() {
  function scanImgs(root) {
    return [...root.querySelectorAll('img')].map(img => ({
      src: img.currentSrc || img.src || '',
      alt: img.alt || '',
      width: img.naturalWidth || img.getAttribute('width') || null,
      height: img.naturalHeight || img.getAttribute('height') || null,
      dataAttrs: Object.fromEntries(
        [...img.attributes]
          .filter(a => a.name.startsWith('data-'))
          .map(a => [a.name, a.value])
      ),
      className: img.className || '',
      isBase64: (img.currentSrc || img.src || '').startsWith('data:'),
      parentTag: img.parentElement ? img.parentElement.tagName : '',
      parentClass: img.parentElement ? (img.parentElement.className || '').toString().substring(0, 100) : '',
    })).filter(i => i.src && i.src !== window.location.href);
  }

  const imgs = scanImgs(document);

  // Also scan iframes with same-origin content
  const iframeImgs = [...document.querySelectorAll('iframe')].flatMap(f => {
    try {
      return scanImgs(f.contentDocument || f.contentWindow.document);
    } catch(e) { return []; }
  });

  return JSON.stringify([...imgs, ...iframeImgs], null, 2);
})();
`;

  let raw;
  try {
    raw = execSync(`agent-browser eval --stdin`, {
      input: script,
      encoding: 'utf8',
      timeout: 30000,
    });
  } catch (err) {
    console.error('  agent-browser eval failed:', err.message);
    return;
  }

  let scanned;
  try {
    const unwrapped = JSON.parse(raw.trim());
    scanned = typeof unwrapped === 'string' ? JSON.parse(unwrapped) : unwrapped;
    if (!Array.isArray(scanned)) throw new Error('Expected array');
  } catch (e) {
    console.error('  Failed to parse scan output:', e.message);
    return;
  }

  console.log(`  Found ${scanned.length} <img> elements in rendered DOM`);

  // Load existing site-resources.json to merge into it
  const resourcesPath = join(siteDir, 'site-resources.json');
  let existing = { images: [], backgroundImages: [], inlineSvgs: [], videos: [], stylesheets: [], scripts: [], fonts: [] };
  if (existsSync(resourcesPath)) {
    try {
      existing = JSON.parse(readFileSync(resourcesPath, 'utf8'));
    } catch (e) { /* start fresh */ }
  }

  const existingSrcs = new Set((existing.images || []).map(i => i.src));
  const newImgs = scanned.filter(i => !existingSrcs.has(i.src) && !i.isBase64);

  if (newImgs.length === 0) {
    console.log('  No new images found beyond what site-resources.json already has.');
  } else {
    console.log(`  ${newImgs.length} new images not previously captured:`);
    newImgs.forEach(i => console.log(`    ${i.src.substring(0, 100)}  alt="${i.alt}"`));
  }

  // Merge all scanned images (update existing + add new)
  const merged = [...(existing.images || [])];
  for (const img of scanned) {
    const idx = merged.findIndex(e => e.src === img.src);
    if (idx >= 0) {
      // Update with richer data from live DOM
      merged[idx] = { ...merged[idx], ...img };
    } else {
      merged.push({ ...img, usage: guessUsage(img.src, img.alt) });
    }
  }
  existing.images = merged;
  writeFileSync(resourcesPath, JSON.stringify(existing, null, 2));
  console.log(`  Updated ${resourcesPath}`);

  // Download new images
  const imagesDir = join(siteDir, 'resources', 'images');
  const publicDir = join(ROOT, '..', 'canvas', 'public', 'images', slug);
  mkdirSync(imagesDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });

  let downloaded = 0;
  for (const img of newImgs) {
    if (!img.src || img.src.startsWith('data:')) continue;

    let filename;
    try {
      const u = new URL(img.src);
      // Use last path segment; fall back to a hash of the URL
      filename = basename(u.pathname) || `img-${Buffer.from(img.src).toString('base64').substring(0, 12)}`;
      // Strip query params from filename
      filename = filename.split('?')[0];
      // Ensure it has an extension — try to guess from URL or default to .webp
      if (!extname(filename)) {
        const fmt = u.searchParams.get('format') || u.searchParams.get('fm') || 'webp';
        filename += '.' + fmt;
      }
    } catch {
      continue;
    }

    const destResources = join(imagesDir, filename);
    const destPublic = join(publicDir, filename);

    if (existsSync(destResources)) {
      console.log(`    skip (exists): ${filename}`);
      // Still ensure public copy exists
      if (!existsSync(destPublic)) {
        execSync(`cp ${JSON.stringify(destResources)} ${JSON.stringify(destPublic)}`);
      }
      continue;
    }

    try {
      execSync(
        `curl -sL --max-time 20 -o ${JSON.stringify(destResources)} ${JSON.stringify(img.src)}`,
        { timeout: 25000 }
      );
      execSync(`cp ${JSON.stringify(destResources)} ${JSON.stringify(destPublic)}`);
      console.log(`    downloaded: ${filename}  (${img.alt})`);
      downloaded++;
    } catch (err) {
      console.warn(`    failed to download: ${img.src.substring(0, 80)}`);
    }
  }

  if (downloaded > 0) {
    console.log(`  Downloaded ${downloaded} new images to resources/images/ and canvas/public/images/${slug}/`);
    console.log(`  Use /images/${slug}/<filename> paths in components.`);
  }
}

function guessUsage(src, alt) {
  const s = (src + ' ' + alt).toLowerCase();
  if (s.includes('logo')) return 'logo';
  if (s.includes('hero') || s.includes('banner')) return 'hero';
  if (s.includes('campaign') || s.includes('donate') || s.includes('modal') || s.includes('form')) return 'campaign';
  return 'unknown';
}

// Run directly if called as script
if (process.argv[1] && process.argv[1].endsWith('03b-scan-dom-images.js')) {
  const url = process.argv[2];
  if (!url) {
    console.error('Usage: node jobs/03b-scan-dom-images.js <url>');
    console.error('Example: node jobs/03b-scan-dom-images.js "https://example.com/?form=FUNJHNAUEXC"');
    process.exit(1);
  }
  await run(url);
}
