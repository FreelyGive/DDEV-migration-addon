#!/usr/bin/env node
// scripts/audit-section-descriptions.js
//
// Universal cross-reference audit. For every page that has a components.json,
// scan each section's description for media keywords ("video", "watch", "play
// button", "youtube", "vimeo", "embed", "iframe"). If a description mentions
// a video, verify two things:
//
//   1. The component named in that section has a `videoUrl` (or
//      videoEmbedUrl / videoSrc / videoYoutubeId / videoId) prop wired up in
//      its index.jsx, OR it composes a child component that does.
//   2. The matching page story actually passes a real video URL/ID to that
//      component (we just check that "videoUrl" appears in the rendered JSX
//      for the page story).
//
// This is the third leg of the video-handling tripod:
//   - jobs/03b extracts videos from the live page → site-resources.json
//   - audit-videos.js checks the page story references those video ids
//   - this audit checks the section descriptions and component code are
//     in sync with reality
//
// Universal — no hard-coded component names. Works for any clone.
//
// Exit codes:
//   0 — no mismatches
//   1 — at least one section description claims a video the component
//       cannot render, or the page story isn't passing one

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";

const OUTPUT = new URL("../output/", import.meta.url).pathname;
const COMPONENTS = new URL("../../canvas/src/components/", import.meta.url).pathname;
const STORIES = new URL("../../canvas/src/stories/pages/", import.meta.url).pathname;

const VIDEO_KEYWORDS = /\b(video|watch|play\s*button|youtube|vimeo|embed(?:ded)?|iframe|reel|footage|playback)\b/i;
const VIDEO_PROP_RE = /\b(videoUrl|videoEmbedUrl|videoSrc|videoYoutubeId|videoId|videoUri|video_url|video_id)\b/;

function pascalToSnake(name) {
  return name.replace(/([A-Z])/g, m => "_" + m.toLowerCase()).replace(/^_/, "");
}

function collectPageDirs() {
  const dirs = [];
  if (!existsSync(OUTPUT)) return dirs;
  for (const host of readdirSync(OUTPUT, { withFileTypes: true })) {
    if (!host.isDirectory()) continue;
    const hostDir = join(OUTPUT, host.name);
    if (existsSync(join(hostDir, "components.json"))) {
      dirs.push({ host: host.name, slug: "home", dir: hostDir });
    }
    for (const page of readdirSync(hostDir, { withFileTypes: true })) {
      if (!page.isDirectory()) continue;
      if (["resources", "sections", "diffs"].includes(page.name)) continue;
      const pageDir = join(hostDir, page.name);
      if (existsSync(join(pageDir, "components.json"))) {
        dirs.push({ host: host.name, slug: page.name, dir: pageDir });
      }
    }
  }
  return dirs;
}

function findMatchingStoryFile(slugTokens) {
  if (!existsSync(STORIES)) return null;
  const files = readdirSync(STORIES).filter(f => /\.stories\.(jsx?|tsx?)$/.test(f));
  let best = null, bestScore = 0;
  for (const f of files) {
    const stem = f.replace(/\.stories\.(jsx?|tsx?)$/, "");
    const fileTokens = stem.split(/(?=[A-Z])/).map(t => t.toLowerCase()).filter(t => t.length > 1);
    const score = slugTokens.filter(t => fileTokens.includes(t)).length;
    if (score > bestScore) { bestScore = score; best = f; }
  }
  return best && bestScore >= 2 ? join(STORIES, best) : null;
}

function readComponentSource(name) {
  const snake = pascalToSnake(name);
  const p = join(COMPONENTS, snake, "index.jsx");
  if (!existsSync(p)) return null;
  return { path: p, source: readFileSync(p, "utf8") };
}

function checkComponentAcceptsVideo(name, visited = new Set()) {
  if (visited.has(name)) return false;
  visited.add(name);
  const comp = readComponentSource(name);
  if (!comp) return false;
  if (VIDEO_PROP_RE.test(comp.source)) return true;
  // Follow @/components/... imports — if a child component supports video,
  // this one does transitively (it can wire the prop through).
  const importRe = /from\s+['"`]@\/components\/(\w+)['"`]/g;
  let m;
  while ((m = importRe.exec(comp.source)) !== null) {
    const childSnake = m[1];
    // Convert snake back to PascalCase for recursion
    const childPascal = childSnake.split("_").map(p => p[0].toUpperCase() + p.slice(1)).join("");
    if (checkComponentAcceptsVideo(childPascal, visited)) return true;
  }
  return false;
}

const issues = [];
const pages = collectPageDirs();

for (const p of pages) {
  let components;
  try { components = JSON.parse(readFileSync(join(p.dir, "components.json"), "utf8")); }
  catch { continue; }

  const slugTokens = p.slug.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length > 1);
  const storyPath = findMatchingStoryFile(slugTokens);
  const storySrc = storyPath ? readFileSync(storyPath, "utf8") : "";

  for (const section of components) {
    for (const comp of section.components || []) {
      const desc = `${comp.description || ""} ${comp.layout || ""}`;
      if (!VIDEO_KEYWORDS.test(desc)) continue;

      const matchedKeyword = (desc.match(VIDEO_KEYWORDS) || [])[0];
      const acceptsVideo = checkComponentAcceptsVideo(comp.name);
      const storyPasses = storyPath && new RegExp(`<${comp.name}\\b[^>]*\\bvideoUrl=`, "s").test(storySrc);

      if (!acceptsVideo || !storyPasses) {
        issues.push({
          host: p.host, slug: p.slug,
          section: section.section ? basename(section.section) : "?",
          componentName: comp.name,
          matchedKeyword,
          description: comp.description?.substring(0, 160) ?? "",
          acceptsVideo,
          storyPasses,
          storyPath,
        });
      }
    }
  }
}

if (issues.length === 0) {
  console.log(`✓ All sections whose description mentions a video have a video-capable component AND a page story that passes videoUrl.`);
  process.exit(0);
}

console.log(`Found ${issues.length} section/description/video mismatch(es):\n`);
for (const i of issues) {
  console.log(`  ${i.host} / ${i.slug}`);
  console.log(`    section: ${i.section}`);
  console.log(`    component: ${i.componentName}`);
  console.log(`    description (excerpt): "${i.description}…"`);
  console.log(`    triggering keyword: ${i.matchedKeyword}`);
  console.log(`    component accepts videoUrl/videoEmbedUrl/etc.? ${i.acceptsVideo ? "YES" : "NO"}`);
  console.log(`    page story passes videoUrl prop?               ${i.storyPasses ? "YES" : "NO"}`);
  if (!i.acceptsVideo) {
    console.log(`    Fix the component: add a videoUrl prop (or compose RmhVideoEmbed). The user must be able to change the video source by editing this one prop.`);
  } else if (!i.storyPasses) {
    console.log(`    Fix the page story: read site-resources.json videos for this page, find the matching entry, and pass its embedUrl/src as videoUrl on this component.`);
  }
  console.log("");
}
process.exit(1);
