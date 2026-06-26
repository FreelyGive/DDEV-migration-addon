#!/usr/bin/env node
/**
 * Tag downloaded images by tokenising their filenames against a universal subject taxonomy.
 * Output is intended to be consumed by Step 9 (page-story assembly) so subagents can pick
 * an image whose filename matches the section's described subject without re-running vision.
 *
 * Universal — no site-specific keywords baked in. Customise via --extra-tags if a clone
 * has a niche vocabulary.
 *
 * Usage:
 *   node website-to-components/jobs/03d-tag-images.js <site-url>
 *   node website-to-components/jobs/03d-tag-images.js <site-url> --extra-tags '{"locations":["alder-hey","gosh","cardiff"]}'
 *
 * Output:
 *   website-to-components/output/<host>/image-tags.json
 *   {
 *     "<filename>": {
 *        "tokens": ["smiling","mom","child"],
 *        "subjects": ["person","child","family"],
 *        "size": { "w":1920, "h":1280 },
 *        "ext": "webp",
 *        "isLogo": false
 *     },
 *     ...
 *   }
 *
 * The subjects come from a fixed taxonomy of category keywords; tokens are the raw
 * filename tokens (split on - _ and digit boundaries). A page-story subagent can:
 *   - filter images by required subject ("person" / "building" / "event")
 *   - prefer images whose tokens overlap a section's description keywords
 */

import { readdirSync, writeFileSync, existsSync, statSync, readFileSync } from "fs";
import { dirname, join, resolve, extname, basename } from "path";
import { fileURLToPath } from "url";
import { imageSize as readImageSize } from "../lib/image.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// Universal subject taxonomy
// ---------------------------------------------------------------------------
const TAXONOMY = {
  // people / families
  person: ["person", "people", "portrait", "headshot", "bio", "staff", "team", "trustee", "founder", "ceo", "director", "doctor", "dr", "nurse", "professor"],
  child: ["child", "children", "kid", "kids", "baby", "babies", "toddler", "infant", "boy", "girl", "teen", "youth"],
  family: ["family", "families", "mom", "mum", "mother", "dad", "father", "parent", "parents", "carer", "carers", "sibling", "smiling", "hugging", "playing", "together"],
  volunteer: ["volunteer", "volunteers", "volunteering"],
  group: ["group", "team", "staff", "crowd", "audience"],
  // events
  event: ["event", "events", "marathon", "walk", "trek", "skydive", "run", "cycle", "gala", "ball", "ceremony", "challenge", "race", "tournament", "golf", "auction"],
  // location / buildings
  building: ["building", "house", "houses", "exterior", "interior", "hospital", "facade", "entrance", "lobby", "kitchen", "lounge", "bedroom"],
  location: ["city", "uk", "london", "paris", "york", "berlin", "manchester", "edinburgh", "cardiff", "dublin", "park", "garden"],
  // products / objects
  product: ["product", "item", "merchandise", "shop", "store", "logo", "icon"],
  food: ["food", "meal", "dinner", "breakfast", "lunch", "kitchen", "cooking", "chef"],
  vehicle: ["car", "van", "bus", "bike", "bicycle"],
  // logos
  logo: ["logo", "brand", "branding", "mark", "wordmark", "icon"],
  // generic
  hero: ["hero", "banner", "background", "header", "cover"],
  illustration: ["illustration", "graphic", "icon", "art"],
};

const TAGS_THAT_FORBID_PORTRAIT = new Set(["event", "building", "location", "vehicle", "logo", "food"]);

function siteHostFromUrl(u) {
  return new URL(u).hostname.replace(/^www\./, "");
}

// Split filename into atomic tokens
function tokenize(filename) {
  const stem = basename(filename, extname(filename))
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/([a-z])([0-9])/g, "$1-$2")
    .replace(/([0-9])([a-z])/g, "$1-$2")
    .replace(/\d+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return stem.split("-").filter(Boolean);
}

function classify(tokens) {
  const subjects = new Set();
  for (const [subject, keywords] of Object.entries(TAXONOMY)) {
    for (const t of tokens) if (keywords.includes(t)) subjects.add(subject);
  }
  return [...subjects];
}

async function imageSize(filePath) {
  // Pure-JS, multi-format header read (png/jpg/webp/gif/svg/avif). Returns the
  // legacy { w, h } shape consumed by image-tags.json; null on unreadable input.
  const dims = readImageSize(filePath);
  return dims ? { w: dims.width, h: dims.height } : null;
}

function findImageDirs(host) {
  const base = join(ROOT, "website-to-components/output", host);
  if (!existsSync(base)) return [];
  // Site-root resources + per-page resources.
  const dirs = [];
  const rootImages = join(base, "resources/images");
  if (existsSync(rootImages)) dirs.push(rootImages);
  for (const entry of readdirSync(base)) {
    const p = join(base, entry);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue;
    }
    if (!s.isDirectory()) continue;
    const pageImages = join(p, "resources/images");
    if (existsSync(pageImages)) dirs.push(pageImages);
  }
  return dirs;
}

async function main() {
  const argv = process.argv.slice(2);
  const url = argv[0];
  if (!url) {
    console.error("Usage: 03d-tag-images.js <site-url>");
    process.exit(1);
  }
  let extraTags = {};
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--extra-tags") {
      try {
        extraTags = JSON.parse(argv[++i]);
      } catch (e) {
        console.error("Invalid --extra-tags JSON:", e.message);
        process.exit(1);
      }
    }
  }
  // Merge extra tags into TAXONOMY
  for (const [k, v] of Object.entries(extraTags)) {
    TAXONOMY[k] = [...(TAXONOMY[k] || []), ...v];
  }

  const host = siteHostFromUrl(url);
  const dirs = findImageDirs(host);
  if (!dirs.length) {
    console.error(`No image directories found under output/${host}/`);
    process.exit(1);
  }

  // Dedup by filename across directories.
  const seen = new Map();
  for (const dir of dirs) {
    for (const f of readdirSync(dir)) {
      if (!/\.(webp|jpe?g|png|gif|svg)$/i.test(f)) continue;
      if (!seen.has(f)) seen.set(f, join(dir, f));
    }
  }

  const tags = {};
  for (const [name, path] of seen.entries()) {
    const tokens = tokenize(name);
    const subjects = classify(tokens);
    if (/logo|brand|icon/i.test(name)) subjects.push("logo");
    const size = await imageSize(path);
    const ext = extname(name).slice(1).toLowerCase();
    tags[name] = {
      tokens,
      subjects: [...new Set(subjects)],
      size,
      ext,
      isLogo: subjects.includes("logo"),
      forbiddenAsPortrait: subjects.some((s) => TAGS_THAT_FORBID_PORTRAIT.has(s)),
    };
  }

  const out = join(ROOT, "website-to-components/output", host, "image-tags.json");
  writeFileSync(out, JSON.stringify(tags, null, 2));

  // Print a quick rollup
  const counts = {};
  for (const v of Object.values(tags)) {
    for (const s of v.subjects) counts[s] = (counts[s] || 0) + 1;
  }
  const totalCount = Object.keys(tags).length;
  console.log(`Tagged ${totalCount} image(s) → ${out}`);
  const rolled = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of rolled) console.log(`  ${k.padEnd(15)} ${n}`);
  const untagged = Object.values(tags).filter((v) => !v.subjects.length).length;
  if (untagged) console.log(`  (untagged ${untagged}) — pure-token only, manual review recommended`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
