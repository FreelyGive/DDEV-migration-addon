#!/usr/bin/env node
// scripts/audit-videos.js
//
// Universal guardrail. For every page that has videos recorded in its
// site-resources.json, verify the corresponding page story references each
// video's embedUrl, src, or id. If a video exists in the source page but
// the page story doesn't mention it, flag — the subagent likely substituted
// a still image.
//
// Detection is intentionally loose: we check whether any of the video's
// identifying strings (id, embedUrl, raw src host+path) appears anywhere in
// the page story file. That catches both direct iframe embeds and the
// thumbnail-and-link YouTube pattern.
//
// Allow-list:
//   - A page story may opt out by adding a comment line:
//       // audit-videos: skip — <reason>
//
// Usage:
//   node website-to-components/scripts/audit-videos.js
//
// Exit codes:
//   0 — no mismatches
//   1 — at least one page has a source video the story doesn't reference

import { readdirSync, readFileSync, existsSync } from "fs";
import { join } from "path";

const OUTPUT = new URL("../output/", import.meta.url).pathname;
const STORIES = new URL("../../canvas/src/stories/pages/", import.meta.url).pathname;

function pageSlugToStoryHints(slug) {
  // RmhAboutUsOurStory.stories.jsx maps to about-us__our-story
  // We can't perfectly invert the mapping (it depends on how the subagent
  // named the file), so we compare loosely by tokenising the slug.
  return slug.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
}

function findMatchingStoryFile(slugTokens) {
  if (!existsSync(STORIES)) return null;
  const files = readdirSync(STORIES).filter(f => /\.stories\.(jsx?|tsx?)$/.test(f));
  // Score each story file by token overlap with the slug
  let best = null, bestScore = 0;
  for (const f of files) {
    const stem = f.replace(/\.stories\.(jsx?|tsx?)$/, "");
    // Split on uppercase boundaries first (PascalCase → words), then lowercase
    const fileTokens = stem.split(/(?=[A-Z])/).map(t => t.toLowerCase()).filter(t => t.length > 1);
    const score = slugTokens.filter(t => fileTokens.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best && bestScore >= 2 ? join(STORIES, best) : null;
}

function collectPageDirs() {
  const dirs = [];
  if (!existsSync(OUTPUT)) return dirs;
  for (const host of readdirSync(OUTPUT, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    const hostDir = join(OUTPUT, host.name);
    // Root counts as the "home" page
    if (existsSync(join(hostDir, "site-resources.json"))) {
      dirs.push({ host: host.name, slug: "home", dir: hostDir });
    }
    for (const page of readdirSync(hostDir, { withFileTypes: true })) {
      if (!page.isDirectory()) continue;
      if (page.name === "resources" || page.name === "sections" || page.name === "diffs") continue;
      const pageDir = join(hostDir, page.name);
      if (existsSync(join(pageDir, "site-resources.json"))) {
        dirs.push({ host: host.name, slug: page.name, dir: pageDir });
      }
    }
  }
  return dirs;
}

function videoFingerprints(video) {
  const fps = new Set();
  if (video.id) fps.add(video.id);
  if (video.embedUrl) fps.add(video.embedUrl);
  if (video.src) fps.add(video.src);
  // For YouTube also add the raw 11-char id pattern in any URL
  return [...fps].filter(Boolean);
}

const issues = [];
const pages = collectPageDirs();

for (const p of pages) {
  let resources;
  try {
    resources = JSON.parse(readFileSync(join(p.dir, "site-resources.json"), "utf8"));
  } catch { continue; }
  const videos = resources.videos || [];
  if (videos.length === 0) continue;

  const slugTokens = pageSlugToStoryHints(p.slug);
  const storyPath = findMatchingStoryFile(slugTokens);
  if (!storyPath) {
    issues.push({
      host: p.host, slug: p.slug,
      reason: `Source has ${videos.length} video(s) but no matching page story found in stories/pages/.`,
      missing: videos.map(v => v.id || v.embedUrl || v.src),
    });
    continue;
  }

  const storySrc = readFileSync(storyPath, "utf8");
  if (/audit-videos:\s*skip/.test(storySrc)) continue;

  const missing = [];
  for (const v of videos) {
    const fps = videoFingerprints(v);
    const hit = fps.some(fp => storySrc.includes(fp));
    if (!hit) missing.push({ video: v, fps });
  }
  if (missing.length > 0) {
    issues.push({
      host: p.host, slug: p.slug, story: storyPath,
      reason: `Page story does not reference ${missing.length} video(s) recorded in site-resources.json.`,
      missing,
    });
  }
}

if (issues.length === 0) {
  console.log(`✓ No video/page-story mismatches across ${pages.length} page(s) checked.`);
  process.exit(0);
}

console.log(`Found ${issues.length} video/page-story mismatch(es):\n`);
for (const i of issues) {
  console.log(`  ${i.host} / ${i.slug}`);
  if (i.story) console.log(`    story: ${i.story}`);
  console.log(`    ${i.reason}`);
  for (const m of i.missing) {
    if (m.video) {
      console.log(`      - kind=${m.video.kind} id=${m.video.id || '—'} embedUrl=${m.video.embedUrl || '—'}`);
      if (m.video.title) console.log(`        title: ${m.video.title}`);
      if (m.video.containerSelector) console.log(`        location: ${m.video.containerSelector}`);
    } else {
      console.log(`      - ${m}`);
    }
  }
  console.log(`    Fix: include the video's embedUrl, id, or src somewhere in the page story (eg. via a video component, YouTube thumbnail-plus-link, or RmhVideoEmbed prop). To intentionally suppress this check, add a comment "// audit-videos: skip — <reason>" to the story file.\n`);
}
process.exit(1);
