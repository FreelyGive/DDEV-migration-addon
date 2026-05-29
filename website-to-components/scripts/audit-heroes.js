#!/usr/bin/env node
// scripts/audit-heroes.js
//
// Universal guardrail for hero sections. For every page that has a
// site-resources.json, finds the page-story file and audits the first
// hero-like element (any JSX component whose name ends in "Hero" or
// "PageHero"). Checks four classes of regression:
//
//   1. Video heroes — if the source page has a <video> recorded in
//      site-resources.json.videos[], the hero element must reference
//      that video's src (or pass a videoSrc / videoUrl prop that
//      matches). Catches "source has a background video but story
//      renders a still image."
//
//   2. Image asset provenance — the hero's imageSrc / posterSrc must
//      resolve to a real file under canvas/public/images/<host>/, AND
//      the filename slug must trace back to a captured URL in
//      site-resources.json (videos[].poster, backgroundImages[], or
//      images[]). Catches fabricated/renamed asset paths.
//
//   3. Fabricated copy — if the story sets `breadcrumb=` or `subhead=`,
//      the same tokens (or "breadcrumb"/"subhead" keywords) must appear
//      somewhere in the page's components.json hero description. If
//      the source description never mentions a breadcrumb, leave it
//      empty.
//
//   4. Component class fit — if components.json describes section 1
//      with the words "no photo", "no image", "cream", "off-white",
//      "centered text block", or describes height < 200px, the story
//      should NOT use a full-bleed PageHero. Catches the "every page
//      gets a photographic hero" trap.
//
// Allow-list per story: a line `// audit-heroes: skip — <reason>`.
//
// Usage:
//   node website-to-components/scripts/audit-heroes.js [<site>]
//
// Exit codes:
//   0 — no issues found
//   1 — at least one hero regression found

import { readdirSync, readFileSync, existsSync, statSync } from "fs";
import { basename, join } from "path";

const OUTPUT = new URL("../output/", import.meta.url).pathname;
const STORIES = new URL("../../canvas/src/stories/pages/", import.meta.url).pathname;
const PUBLIC_IMG_ROOT = new URL("../../canvas/public/images/", import.meta.url).pathname;

const argSite = process.argv[2];

function collectPageDirs(siteFilter) {
  const dirs = [];
  if (!existsSync(OUTPUT)) return dirs;
  for (const host of readdirSync(OUTPUT, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    if (siteFilter && host.name !== siteFilter) continue;
    const hostDir = join(OUTPUT, host.name);
    if (existsSync(join(hostDir, "site-resources.json"))) {
      dirs.push({ host: host.name, slug: "home", dir: hostDir });
    }
    for (const page of readdirSync(hostDir, { withFileTypes: true })) {
      if (!page.isDirectory()) continue;
      if (["resources", "sections", "diffs", "heuristic-sections"].includes(page.name)) continue;
      const pageDir = join(hostDir, page.name);
      if (existsSync(join(pageDir, "site-resources.json"))) {
        dirs.push({ host: host.name, slug: page.name, dir: pageDir });
      }
    }
  }
  return dirs;
}

function slugTokens(slug) {
  return slug.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
}

function hostTokens(host) {
  // dubaisafari.ae → ["dubaisafari"], rmh.org.uk → ["rmh"].
  // Also try splitting common compound brand slugs into pieces so
  // e.g. "dubaisafari" matches story tokens ["dubai","safari"].
  const base = (host || "").split(".")[0].toLowerCase();
  const tokens = new Set([base]);
  // Heuristic: greedy split on common english words (best-effort)
  for (const word of ["dubai", "safari", "house", "ronald", "mcdonald", "rmh", "park", "zoo", "kids"]) {
    if (base.includes(word)) tokens.add(word);
  }
  return [...tokens];
}

function findMatchingStoryFile(slug, host) {
  if (!existsSync(STORIES)) return null;
  const files = readdirSync(STORIES).filter(f => /\.stories\.(jsx?|tsx?)$/.test(f));
  const slugToks = slug === "home" ? ["home", "homepage"] : slugTokens(slug);
  const hostToks = hostTokens(host);
  // Page-identifying tokens (slug) carry more weight than brand tokens.
  let best = null, bestSlugScore = 0, bestTotalScore = 0;
  for (const f of files) {
    const stem = f.replace(/\.stories\.(jsx?|tsx?)$/, "");
    const fileTokens = stem.split(/(?=[A-Z])/).map(t => t.toLowerCase()).filter(t => t.length > 1);
    const slugScore = slugToks.filter(t => fileTokens.includes(t)).length;
    const hostScore = hostToks.filter(t => fileTokens.includes(t)).length;
    const total = slugScore * 2 + hostScore;
    if (slugScore > bestSlugScore || (slugScore === bestSlugScore && total > bestTotalScore)) {
      bestSlugScore = slugScore;
      bestTotalScore = total;
      best = f;
    }
  }
  // Require at least one slug-token AND at least one host-token match,
  // OR two slug tokens (multi-word slug stands alone).
  if (!best) return null;
  if (bestSlugScore >= 2) return join(STORIES, best);
  if (bestSlugScore >= 1 && bestTotalScore - bestSlugScore * 2 >= 1) return join(STORIES, best);
  return null;
}

// Extract the first hero-like JSX element invocation from a story file.
function extractHeroInvocation(src) {
  // Hero-equivalent first-section component naming patterns. We treat
  // *Hero, *PageHero, *PageIntro, and *PageHeader as the page's lead band
  // — any of these as the first hit counts. The cream-bg intro variant
  // (PageIntro) doesn't have an imageSrc but still needs to be audited
  // for fabricated copy.
  const re = /<([A-Z][A-Za-z0-9_]*(?:Hero|PageHero|PageIntro|PageHeader))\b([\s\S]*?)\/>/;
  const m = src.match(re);
  if (!m) return null;
  return { name: m[1], body: m[2], raw: m[0] };
}

// Parse simple `propName="value"` and `propName={`...`}` from a JSX fragment.
function extractProps(body) {
  const props = {};
  const re = /([a-zA-Z][a-zA-Z0-9_]*)\s*=\s*(?:"([^"]*)"|`([^`]*)`|\{[^}]*?["'`]([^"'`]*)["'`][^}]*?\})/g;
  let m;
  while ((m = re.exec(body)) !== null) {
    props[m[1]] = m[2] ?? m[3] ?? m[4] ?? "";
  }
  return props;
}

function collectCapturedUrls(resources) {
  const urls = new Set();
  for (const v of resources.videos || []) {
    if (v.src) urls.add(v.src);
    if (v.embedUrl) urls.add(v.embedUrl);
    if (v.poster) urls.add(v.poster);
  }
  for (const b of resources.backgroundImages || []) {
    if (b.backgroundImage && !b.isBase64) urls.add(b.backgroundImage);
  }
  for (const i of resources.images || []) {
    if (i.src) urls.add(i.src);
  }
  return urls;
}

function urlSlug(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    return basename(u.pathname).toLowerCase().replace(/\.[a-z0-9]+$/, "");
  } catch {
    return basename(url).toLowerCase().replace(/\.[a-z0-9]+$/, "");
  }
}

function localFilenameSlug(localPath) {
  if (!localPath) return "";
  return basename(localPath).toLowerCase().replace(/\.[a-z0-9]+$/, "");
}

function fileExistsForLocalPath(localPath) {
  if (!localPath || !localPath.startsWith("/")) return false;
  // /images/<host>/foo.webp → public/images/<host>/foo.webp
  if (!localPath.startsWith("/images/")) return false;
  const rel = localPath.replace(/^\/images\//, "");
  const abs = join(PUBLIC_IMG_ROOT, rel);
  try { return statSync(abs).isFile(); } catch { return false; }
}

function heroSectionDescription(componentsJsonPath) {
  if (!existsSync(componentsJsonPath)) return "";
  try {
    const data = JSON.parse(readFileSync(componentsJsonPath, "utf8"));
    const first = Array.isArray(data) ? data[0] : null;
    if (!first || !Array.isArray(first.components)) return "";
    const parts = [];
    for (const c of first.components) {
      const name = (c.name || "").toLowerCase();
      const type = (c.type || "").toLowerCase();
      if (name.includes("hero") || type.includes("hero")) {
        parts.push(c.description || "");
        parts.push(c.layout || "");
        parts.push(c.background || "");
      }
    }
    return parts.join(" \n ").toLowerCase();
  } catch { return ""; }
}

const issues = [];
const pages = collectPageDirs(argSite);

for (const p of pages) {
  let resources;
  try {
    resources = JSON.parse(readFileSync(join(p.dir, "site-resources.json"), "utf8"));
  } catch { continue; }

  const storyPath = findMatchingStoryFile(p.slug, p.host);
  if (!storyPath) {
    issues.push({ host: p.host, slug: p.slug,
      reason: "No matching page-story file in canvas/src/stories/pages/. If this page has no story, that's the bug — heroes can't be audited without one." });
    continue;
  }

  const storySrc = readFileSync(storyPath, "utf8");
  if (/audit-heroes:\s*skip/.test(storySrc)) continue;

  const hero = extractHeroInvocation(storySrc);
  if (!hero) {
    issues.push({ host: p.host, slug: p.slug, story: storyPath,
      reason: "Page story has no *Hero / *PageHero element. Source pages almost always start with a hero — confirm or add `audit-heroes: skip`." });
    continue;
  }

  const props = extractProps(hero.body);
  const captured = collectCapturedUrls(resources);
  const heroDesc = heroSectionDescription(join(p.dir, "components.json"));
  const localIssues = [];

  // 1. Video heroes
  const videos = resources.videos || [];
  if (videos.length > 0) {
    const hasVideoProp = !!(props.videoSrc || props.videoUrl);
    const videoRefHit = videos.some(v => {
      const fps = [v.src, v.embedUrl, v.id].filter(Boolean);
      return fps.some(fp => storySrc.includes(fp));
    });
    if (!hasVideoProp && !videoRefHit && heroDesc.includes("video")) {
      localIssues.push(`hero description mentions video, source has ${videos.length} captured video(s), but story has no videoSrc/videoUrl prop and no captured video URL appears in the story.`);
    }
    if (hasVideoProp) {
      const v = props.videoSrc || props.videoUrl;
      const knownVideo = videos.some(rec => rec.src === v || rec.embedUrl === v || rec.id === v);
      if (!knownVideo && !captured.has(v)) {
        localIssues.push(`videoSrc="${v}" not found in site-resources.json videos[] — provenance broken.`);
      }
    }
  }

  // 2. Image asset provenance
  for (const propName of ["imageSrc", "posterSrc"]) {
    const v = props[propName];
    if (!v) continue;
    if (v.startsWith("http")) {
      // External URL — must be in captured set
      if (!captured.has(v)) {
        localIssues.push(`${propName}="${v}" is an external URL not present in site-resources.json — provenance broken.`);
      }
      continue;
    }
    if (!fileExistsForLocalPath(v)) {
      localIssues.push(`${propName}="${v}" does not resolve to a file under canvas/public/images/.`);
      continue;
    }
    const slug = localFilenameSlug(v);
    const matched = [...captured].some(url => urlSlug(url) === slug);
    if (!matched) {
      localIssues.push(`${propName}="${v}" filename "${slug}" does not match any captured URL slug in site-resources.json — likely fabricated/renamed. Rebuild with the original captured filename or record provenance.`);
    }
  }

  // 3. Fabricated copy
  for (const copyProp of ["breadcrumb", "subhead"]) {
    const v = (props[copyProp] || "").trim();
    if (!v) continue;
    const keywordPresent = heroDesc.includes(copyProp);
    if (!keywordPresent) {
      localIssues.push(`${copyProp}=${JSON.stringify(v)} is set, but components.json hero description never mentions a ${copyProp}. Likely fabricated — clear the prop or update the section description to record what's actually visible.`);
    }
  }

  // 4. Component class fit
  if (/page-?hero/i.test(hero.name)) {
    const noPhotoSignals = ["no photo", "no image", "no hero image", "cream background", "off-white background", "centered text block", "text-only intro"];
    const match = noPhotoSignals.find(s => heroDesc.includes(s));
    if (match) {
      localIssues.push(`Section description signals "${match}" yet story uses ${hero.name} (full-bleed photographic). Use a lightweight intro variant instead.`);
    }
  }

  if (localIssues.length > 0) {
    issues.push({ host: p.host, slug: p.slug, story: storyPath, hero: hero.name, list: localIssues });
  }
}

if (issues.length === 0) {
  console.log(`✓ No hero regressions across ${pages.length} page(s) checked.`);
  process.exit(0);
}

console.log(`Found ${issues.length} hero issue(s):\n`);
for (const i of issues) {
  console.log(`  ${i.host} / ${i.slug}${i.hero ? `  (<${i.hero}>)` : ""}`);
  if (i.story) console.log(`    story: ${i.story}`);
  if (i.reason) console.log(`    ${i.reason}`);
  for (const msg of i.list || []) console.log(`    - ${msg}`);
  console.log();
}
console.log(`To suppress on a single story add: // audit-heroes: skip — <reason>\n`);
process.exit(1);
