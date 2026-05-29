#!/usr/bin/env node
/**
 * 03b-extract-assets.js
 *
 * Scans the live page for ALL image/video/font assets including:
 *   - <img src="..."> elements (URLs)
 *   - <img src="data:..."> base64-encoded images
 *   - Inline <svg> elements (serialized as data URIs)
 *   - CSS background-image URLs and base64 data URIs
 *   - <video> elements
 *   - <link rel="stylesheet">, <script src>, font links
 *
 * Saves results to output/<site>/site-resources.json.
 * Run this AFTER the agent writes components.json (Step 3b).
 *
 * Usage: node jobs/03b-extract-assets.js <url>
 */

import { execSync } from 'child_process';
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { sitePaths } from '../lib/paths.js';

export async function run(url) {
  const { outputDir: outDir } = sitePaths(url);
  mkdirSync(outDir, { recursive: true });

  const script = `
const r = {};

// --- <img> elements: URLs and base64 ---
const allImgs = [...document.querySelectorAll('img')].map(i => ({
  src: i.src,
  alt: i.alt || '',
  width: i.naturalWidth || null,
  height: i.naturalHeight || null,
  isBase64: i.src.startsWith('data:'),
})).filter(i => i.src);
r.images = allImgs;

// --- Inline <svg> elements ---
r.inlineSvgs = [...document.querySelectorAll('svg')].map((svg, idx) => {
  const serialized = new XMLSerializer().serializeToString(svg);
  const b64 = btoa(unescape(encodeURIComponent(serialized)));
  return {
    index: idx,
    viewBox: svg.getAttribute('viewBox') || '',
    dataUri: 'data:image/svg+xml;base64,' + b64,
    parentClass: svg.parentElement ? svg.parentElement.className.toString().substring(0, 80) : '',
    widthAttr: svg.getAttribute('width') || '',
    heightAttr: svg.getAttribute('height') || '',
  };
}).filter(s => s.dataUri.length < 100000); // skip huge SVGs

// --- CSS background-image: URLs and base64 ---
const bgImages = [];
document.querySelectorAll('*').forEach(el => {
  try {
    const bg = window.getComputedStyle(el).backgroundImage;
    if (bg && bg !== 'none') {
      const urlMatch = bg.match(/url\\(["']?([^"')]+)["']?\\)/);
      if (urlMatch) {
        bgImages.push({
          tagName: el.tagName,
          className: el.className.toString().substring(0, 60),
          backgroundImage: urlMatch[1],
          isBase64: urlMatch[1].startsWith('data:'),
        });
      }
    }
  } catch(e) {}
});
r.backgroundImages = bgImages;

// --- Videos: universal detection across many embed patterns ---
function cssPath(el) {
  if (!el) return '';
  const parts = [];
  while (el && el.nodeType === 1 && parts.length < 5) {
    let part = el.tagName.toLowerCase();
    if (el.id) { part += '#' + el.id; parts.unshift(part); break; }
    if (el.className && typeof el.className === 'string') {
      const cls = el.className.trim().split(/\\s+/).slice(0, 2).join('.');
      if (cls) part += '.' + cls;
    }
    parts.unshift(part);
    el = el.parentElement;
  }
  return parts.join(' > ');
}

const videos = [];

// 1. Native <video> and <source>
[...document.querySelectorAll('video, video source')].forEach(v => {
  const src = v.currentSrc || v.src || v.getAttribute('src') || '';
  if (!src) return;
  videos.push({
    kind: 'native',
    src,
    poster: v.poster || v.closest('video')?.poster || null,
    type: v.type || null,
    containerSelector: cssPath(v),
    extractedFrom: v.tagName.toLowerCase(),
    title: v.getAttribute('title') || v.getAttribute('aria-label') || null,
  });
});

// 2. <iframe> embeds — YouTube / Vimeo / Brightcove / Wistia / Loom / generic
[...document.querySelectorAll('iframe[src]')].forEach(f => {
  const src = f.src || '';
  if (!src) return;
  let kind = null, id = null, embedUrl = src;
  let m;
  if ((m = src.match(/(?:youtube\\.com|youtube-nocookie\\.com)\\/embed\\/([\\w-]+)/))) {
    kind = 'youtube'; id = m[1];
    embedUrl = 'https://www.youtube.com/embed/' + id;
  } else if ((m = src.match(/youtu\\.be\\/([\\w-]+)/))) {
    kind = 'youtube'; id = m[1];
    embedUrl = 'https://www.youtube.com/embed/' + id;
  } else if ((m = src.match(/(?:player\\.vimeo\\.com\\/video|vimeo\\.com)\\/(\\d+)/))) {
    kind = 'vimeo'; id = m[1];
    embedUrl = 'https://player.vimeo.com/video/' + id;
  } else if (/players\\.brightcove\\.net/.test(src)) {
    kind = 'brightcove';
  } else if (/wistia\\.(net|com)/.test(src)) {
    kind = 'wistia';
  } else if (/loom\\.com\\/embed/.test(src)) {
    kind = 'loom';
  } else if (/dailymotion\\.com\\/embed/.test(src)) {
    kind = 'dailymotion';
  } else {
    if (!/(video|embed|player|stream)/i.test(src)) return;
    kind = 'iframe-other';
  }
  videos.push({
    kind, src, id, embedUrl,
    title: f.title || f.getAttribute('aria-label') || null,
    width: f.width || null,
    height: f.height || null,
    containerSelector: cssPath(f),
    extractedFrom: 'iframe',
  });
});

// 3. data-* attributes — lightbox triggers, lazy players, custom widgets
const dataKeys = ['data-video-id', 'data-youtube-id', 'data-vimeo-id', 'data-video-url', 'data-video', 'data-yt-id', 'data-src'];
document.querySelectorAll('[data-video-id], [data-youtube-id], [data-vimeo-id], [data-video-url], [data-video], [data-yt-id]').forEach(el => {
  for (const k of dataKeys) {
    const v = el.getAttribute(k);
    if (!v) continue;
    let kind = 'data-attribute', id = null, embedUrl = null;
    if (k.includes('youtube') || k === 'data-yt-id') {
      kind = 'youtube'; id = v;
      embedUrl = 'https://www.youtube.com/embed/' + v;
    } else if (k.includes('vimeo')) {
      kind = 'vimeo'; id = v;
      embedUrl = 'https://player.vimeo.com/video/' + v;
    } else if (k === 'data-video-url' || (k === 'data-src' && /\\.(mp4|webm|m4v|mov)/i.test(v))) {
      kind = /\\.(mp4|webm|m4v|mov)/i.test(v) ? 'native' : 'data-url';
      embedUrl = v;
    } else if (k === 'data-video' && /youtube|youtu\\.be/.test(v)) {
      kind = 'youtube';
      const m = v.match(/(?:embed\\/|v=|youtu\\.be\\/)([\\w-]+)/);
      if (m) { id = m[1]; embedUrl = 'https://www.youtube.com/embed/' + id; }
    }
    videos.push({
      kind, src: v, id, embedUrl,
      poster: el.querySelector('img')?.src || null,
      title: el.getAttribute('title') || el.getAttribute('aria-label') || el.textContent?.trim()?.substring(0, 80) || null,
      containerSelector: cssPath(el),
      extractedFrom: k,
    });
    break;
  }
});

// 4. JSON-LD VideoObject entries
[...document.querySelectorAll('script[type="application/ld+json"]')].forEach(s => {
  let parsed;
  try { parsed = JSON.parse(s.textContent); } catch { return; }
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach(visit); return; }
    const t = node['@type'];
    if (t === 'VideoObject' || (Array.isArray(t) && t.includes('VideoObject'))) {
      const url = node.contentUrl || node.embedUrl || node.url || null;
      let kind = 'ld-json';
      let id = null, embedUrl = url;
      if (typeof url === 'string') {
        if (/youtube|youtu\\.be/.test(url)) {
          kind = 'youtube';
          const m = url.match(/(?:embed\\/|v=|youtu\\.be\\/)([\\w-]+)/);
          if (m) { id = m[1]; embedUrl = 'https://www.youtube.com/embed/' + id; }
        } else if (/vimeo/.test(url)) {
          kind = 'vimeo';
          const m = url.match(/(\\d+)$/);
          if (m) { id = m[1]; embedUrl = 'https://player.vimeo.com/video/' + id; }
        } else if (/\\.(mp4|webm|m4v|mov)/i.test(url)) {
          kind = 'native';
        }
      }
      videos.push({
        kind, src: url, id, embedUrl,
        poster: node.thumbnailUrl || null,
        title: node.name || (node.description ? String(node.description).substring(0, 80) : null),
        containerSelector: null,
        extractedFrom: 'ld-json-VideoObject',
      });
    }
    for (const v of Object.values(node)) visit(v);
  };
  visit(parsed);
});

// Dedupe by id|embedUrl|src
const seen = new Set();
r.videos = videos.filter(v => {
  const key = v.id || v.embedUrl || v.src;
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
});

// --- Stylesheets, scripts, fonts ---
r.stylesheets = [...document.querySelectorAll('link[rel="stylesheet"]')].map(l => l.href).filter(Boolean);
r.scripts = [...document.querySelectorAll('script[src]')].map(s => s.src).filter(Boolean);
r.fonts = [...document.querySelectorAll('link[href*="font"], link[href*="Font"]')].map(l => l.href).filter(Boolean);

JSON.stringify(r, null, 2);
`;

  // Ensure the page is open and lazy-loaded content is realised before
  // evaluating. Video iframes (YouTube IFrame Player API, Vimeo lazy
  // wrappers, Brightcove, etc.) are inserted into the DOM *after*
  // DOMContentLoaded — often after the user scrolls them into view. Without
  // this scroll-and-wait step, the extractor will report 0 videos on any
  // page that lazy-loads its players.
  try {
    execSync(`agent-browser open ${url}`, { encoding: 'utf8', timeout: 30000 });
  } catch (err) {
    // Ignore — page may already be open
  }
  try { execSync(`agent-browser wait --load networkidle`, { encoding: 'utf8', timeout: 30000 }); } catch {}
  // Scroll through the page to trigger IntersectionObserver-based lazy
  // loading (videos, deferred images, etc.). Three passes is plenty for
  // most pages.
  for (let i = 0; i < 3; i++) {
    try { execSync(`agent-browser scroll down 4000`, { encoding: 'utf8', timeout: 10000 }); } catch {}
  }
  try { execSync(`agent-browser scroll up 99999`, { encoding: 'utf8', timeout: 10000 }); } catch {}
  // Final pause for any iframe `load` events to flush
  try { execSync(`agent-browser wait 1500`, { encoding: 'utf8', timeout: 10000 }); } catch {}

  let result;
  try {
    result = execSync(`agent-browser eval --stdin`, {
      input: script,
      encoding: 'utf8',
      timeout: 30000,
    });
  } catch (err) {
    console.error('  agent-browser eval failed:', err.message);
    return;
  }

  // Strip surrounding quotes if agent-browser wraps output in a JSON string
  let parsed;
  try {
    const raw = result.trim();
    // agent-browser returns the JS result as a JSON-stringified string
    const unwrapped = JSON.parse(raw);
    parsed = typeof unwrapped === 'string' ? JSON.parse(unwrapped) : unwrapped;
  } catch (e) {
    console.error('  Failed to parse agent-browser output:', e.message);
    return;
  }

  // Annotate images with usage hints based on alt text / src patterns
  if (parsed.images) {
    parsed.images = parsed.images.map(img => ({
      ...img,
      usage: guessUsage(img.src, img.alt),
    }));
  }
  if (parsed.backgroundImages) {
    parsed.backgroundImages = parsed.backgroundImages.map(bg => ({
      ...bg,
      usage: guessUsage(bg.backgroundImage, ''),
    }));
  }

  const outPath = join(outDir, 'site-resources.json');
  writeFileSync(outPath, JSON.stringify(parsed, null, 2));

  const imgCount = parsed.images?.length ?? 0;
  const svgCount = parsed.inlineSvgs?.length ?? 0;
  const bgCount = parsed.backgroundImages?.length ?? 0;
  const b64Count = [
    ...(parsed.images ?? []),
    ...(parsed.backgroundImages ?? []),
  ].filter(x => x.isBase64).length;

  const videoCount = parsed.videos?.length ?? 0;
  const videoKinds = (parsed.videos ?? []).reduce((a, v) => { a[v.kind] = (a[v.kind] || 0) + 1; return a; }, {});
  const videoKindsStr = Object.entries(videoKinds).map(([k, n]) => `${n} ${k}`).join(', ');

  console.log(`  Saved ${outPath}`);
  console.log(`  ${imgCount} <img> elements, ${svgCount} inline SVGs, ${bgCount} CSS background images, ${b64Count} base64-encoded assets`);
  console.log(`  ${videoCount} video(s)${videoCount ? ': ' + videoKindsStr : ''}`);
}

function guessUsage(src, alt) {
  const s = (src + ' ' + alt).toLowerCase();
  if (s.includes('logo')) return 'logo';
  if (s.includes('hero') || s.includes('banner') || s.includes('home-page')) return 'hero';
  if (s.includes('show') || s.includes('bird') || s.includes('echoes') || s.includes('prey')) return 'show-card';
  if (s.includes('zone') || s.includes('safari') || s.includes('park-zone') || s.includes('ticket')) return 'zone-card';
  if (s.includes('workshop') || s.includes('enrichment') || s.includes('recycling') || s.includes('conservation')) return 'event-card';
  if (s.includes('offer') || s.includes('gemini') || s.includes('bundle')) return 'offer-card';
  if (s.includes('vet') || s.includes('nutrition') || s.includes('explorer-safari')) return 'care-card';
  if (s.includes('eaza') || s.includes('waza') || s.includes('seaza') || s.includes('rta')) return 'partner-logo';
  if (s.includes('group-11') || s.includes('group-10')) return 'illustration';
  if (s.includes('giraffe') || s.includes('rhino') || s.includes('addax') || s.includes('zuri') || s.includes('salam')) return 'wildlife-photo';
  if (s.includes('submit-spin') || s.includes('loading')) return 'ui-icon';
  return 'unknown';
}

// Run directly if called as script
if (process.argv[1] && process.argv[1].endsWith('03b-extract-assets.js')) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) {
    console.error('Usage: node jobs/03b-extract-assets.js <url>');
    process.exit(1);
  }
  await run(url);
}
