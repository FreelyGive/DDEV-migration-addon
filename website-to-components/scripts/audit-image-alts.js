#!/usr/bin/env node
// scripts/audit-image-alts.js
//
// Universal guardrail check. Scans every page story under
// canvas/src/stories/pages/ for <img> src + alt pairs (or { src, alt } object
// literals) and flags any case where the alt names a SPECIFIC entity (person,
// place, event) that the filename cannot plausibly represent.
//
// Designed to catch the "golf photo captioned 'portrait of Dr Audrey Evans'"
// class of bug without firing on every generic family/house/kitchen photo
// that has an unhelpful filename.
//
// What it flags:
//   1. Alt contains an explicit person-marker ("Dr X", "Mr X", "Mrs X",
//      "Professor X", "portrait of X", "photograph of X", "headshot of X")
//      AND none of the words from <X> appear in the filename, AND the file
//      isn't a placehold.co URL.
//   2. Alt mentions a known activity/event keyword (marathon, golf, walk,
//      swim, race, gala, cycle, hike, run, climb) and the filename clearly
//      references a different one (eg "marathon" alt vs "golf" filename).
//
// Allow-list:
//   - alts that include "(placeholder" are ignored — intentional gaps.
//   - Filenames that are placehold.co URLs are ignored.
//   - Filenames that are pure IDs (no descriptive tokens at all) emit a
//     softer "review" warning rather than a hard fail, on the assumption the
//     person who wrote the alt knew what they were doing.
//
// Usage:
//   node website-to-components/scripts/audit-image-alts.js
//   node website-to-components/scripts/audit-image-alts.js path/to/single-story.jsx
//
// Exit codes:
//   0 — no hard failures
//   1 — at least one hard failure (alt names a specific entity the file
//        cannot represent)

import { readdirSync, readFileSync, existsSync } from "fs";
import { join, basename } from "path";

const STOPWORDS = new Set([
  "a", "an", "of", "with", "the", "and", "for", "in", "on", "to", "at", "by",
  "from", "is", "are", "was", "were", "or", "image", "images", "photo",
  "photograph", "picture", "img", "icon", "logo", "scaled",
]);

const TITLES = /\b(dr|mr|mrs|ms|professor|prof|sir|dame|lord|lady|hrh|rev)\.?\s+/i;

const ACTIVITY_KEYWORDS = [
  "marathon", "golf", "walk", "swim", "race", "gala", "cycle", "hike",
  "run", "climb", "ride", "skydive", "abseil", "trek", "fundraiser",
  "tournament", "auction", "ball", "concert",
];

function splitCamel(s) {
  return s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2");
}

function tokenize(text) {
  if (!text) return [];
  return splitCamel(text)
    .toLowerCase()
    .replace(/\.(webp|jpe?g|png|gif|svg)$/i, "")
    .split(/[^a-z]+/)
    .filter(t => t.length > 2 && !STOPWORDS.has(t));
}

function extractNamedEntities(alt) {
  // Pull out capitalized name sequences after titles or after
  // "portrait of"/"photograph of"/"headshot of"/"picture of"
  const names = [];

  const titleMatch = alt.match(new RegExp(TITLES.source + "([A-Z][a-z]+(?:\\s+[A-Z][a-z]+){0,3})", "g"));
  if (titleMatch) {
    for (const m of titleMatch) {
      const cleaned = m.replace(TITLES, "").trim();
      names.push({ kind: "title", value: cleaned });
    }
  }

  const ofRe = /\b(?:portrait|photograph|headshot|picture|bust)\s+of\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g;
  let m;
  while ((m = ofRe.exec(alt)) !== null) {
    names.push({ kind: "portrait-of", value: m[1] });
  }

  return names;
}

function findPairs(source) {
  const pairs = [];

  const objRe = /src\s*:\s*['"`]([^'"`]+)['"`]\s*,\s*alt\s*:\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = objRe.exec(source)) !== null) pairs.push({ src: m[1], alt: m[2] });

  const altFirstRe = /alt\s*:\s*['"`]([^'"`]+)['"`]\s*,\s*src\s*:\s*['"`]([^'"`]+)['"`]/g;
  while ((m = altFirstRe.exec(source)) !== null) pairs.push({ src: m[2], alt: m[1] });

  const jsxRe = /<img[^>]*\bsrc\s*=\s*['"`]([^'"`]+)['"`][^>]*\balt\s*=\s*['"`]([^'"`]+)['"`]/g;
  while ((m = jsxRe.exec(source)) !== null) pairs.push({ src: m[1], alt: m[2] });

  const jsxAltFirstRe = /<img[^>]*\balt\s*=\s*['"`]([^'"`]+)['"`][^>]*\bsrc\s*=\s*['"`]([^'"`]+)['"`]/g;
  while ((m = jsxAltFirstRe.exec(source)) !== null) pairs.push({ src: m[2], alt: m[1] });

  return pairs;
}

function checkPair(src, alt) {
  if (/\(placeholder\b/i.test(alt)) return null;
  if (/placehold\.co/i.test(src)) return null;

  const cleanSrc = src.split("?")[0].split("#")[0];
  const stem = basename(cleanSrc);
  const fileTokens = tokenize(stem);
  const altTokens = tokenize(alt);

  // Hard fail 1: alt names a specific entity the filename can't represent.
  const named = extractNamedEntities(alt);
  for (const n of named) {
    const nameTokens = tokenize(n.value);
    const overlap = nameTokens.filter(t => fileTokens.includes(t));
    if (overlap.length === 0) {
      return {
        severity: "fail",
        reason: `Alt names "${n.value}" (${n.kind}) but the filename has no matching token. Either pick a file whose name matches the subject, use a placehold.co URL, or rewrite the alt to describe what is actually in the image.`,
        fileTokens,
        altTokens,
      };
    }
  }

  // Hard fail 2: activity keyword in alt vs different activity in filename.
  const altActivities = ACTIVITY_KEYWORDS.filter(k => altTokens.includes(k));
  const fileActivities = ACTIVITY_KEYWORDS.filter(k => fileTokens.includes(k));
  if (altActivities.length > 0 && fileActivities.length > 0) {
    const intersect = altActivities.filter(k => fileActivities.includes(k));
    if (intersect.length === 0) {
      return {
        severity: "fail",
        reason: `Alt references activity "${altActivities.join(", ")}" but filename references "${fileActivities.join(", ")}". Different events. Either pick a matching image or rewrite the alt.`,
        fileTokens,
        altTokens,
      };
    }
  }

  return null;
}

function scanFile(path) {
  const src = readFileSync(path, "utf8");
  const pairs = findPairs(src);
  const issues = [];
  for (const p of pairs) {
    const issue = checkPair(p.src, p.alt);
    if (issue) issues.push({ file: path, src: p.src, alt: p.alt, ...issue });
  }
  return issues;
}

function main() {
  const targetArg = process.argv[2];
  let files = [];
  if (targetArg) {
    if (!existsSync(targetArg)) {
      console.error(`Not found: ${targetArg}`);
      process.exit(1);
    }
    files = [targetArg];
  } else {
    const root = new URL("../../canvas/src/stories", import.meta.url).pathname;
    if (!existsSync(root)) {
      console.error(`No stories dir at ${root}`);
      process.exit(1);
    }
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      for (const ent of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, ent.name);
        if (ent.isDirectory()) stack.push(p);
        else if (/\.stories\.(jsx?|tsx?)$/.test(ent.name)) files.push(p);
      }
    }
  }

  let all = [];
  for (const f of files) all = all.concat(scanFile(f));

  if (all.length === 0) {
    console.log(`✓ No image/alt entity mismatches across ${files.length} story files.`);
    process.exit(0);
  }

  console.log(`Found ${all.length} image/alt entity mismatch(es) across ${files.length} file(s):\n`);
  for (const issue of all) {
    console.log(`  ${issue.file}`);
    console.log(`    src: ${issue.src}`);
    console.log(`    alt: ${issue.alt}`);
    console.log(`    file tokens: [${issue.fileTokens.join(", ")}]`);
    console.log(`    → ${issue.reason}\n`);
  }
  const hard = all.filter(a => a.severity === "fail");
  process.exit(hard.length > 0 ? 1 : 0);
}

main();
