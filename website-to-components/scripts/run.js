#!/usr/bin/env node
import { writeFileSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { createInterface } from "node:readline/promises";
import { run as screenshot } from "../jobs/01-screenshot.js";
import { run as screenshotMobile } from "../jobs/01b-screenshot-mobile.js";
import { run as extractAssets } from "../jobs/03b-extract-assets.js";
import { run as downloadResources } from "../jobs/03c-download-resources.js";
import { run as generateBrandKit } from "../jobs/03d-generate-brand-kit.js";
import { siteSlug, sitePaths, cleanPage } from "../lib/paths.js";
import { resolveScope } from "../lib/scope.js";
import { resolveDiscovery } from "../lib/discovery.js";
import { validateSitemapUrls } from "../lib/seo-sitemap.js";
import { run as discoverSitemapMenus } from "../jobs/00-sitemap.js";
import { normalizeMenus } from "../lib/menu.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");

try {
  const { default: dotenv } = await import("dotenv");
  dotenv.config();
} catch {}

const url = process.argv[2] || process.env.TARGET_URL;
if (!url) {
  console.error("Usage: node run.js <url>");
  console.error("  e.g. node run.js https://vercel.com");
  process.exit(1);
}

async function promptUser(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return await rl.question(question); } finally { rl.close(); }
}

const scope = await resolveScope({
  argv: process.argv,
  isTTY: process.stdin.isTTY === true,
  prompt: promptUser,
});
console.log(`\n==> Migration scope: ${scope}`);

const doClean = process.argv.includes('--clean') || process.env.CLEAN === '1';

if (doClean) {
  console.log(`\n==> [0/5] Clean previous output for: ${url}`);
  cleanPage(url);
} else {
  console.log(`\n==> [0/5] Keeping existing output (pass --clean to wipe and start fresh)`);
}

const skipMobile = process.argv.includes('--no-mobile') || process.env.NO_MOBILE === '1';

console.log(`\n==> [1/6] Desktop screenshot: ${url}`);
await screenshot(url);

console.log(`\n==> [1b/6] Mobile screenshot (390px): ${url}`);
if (skipMobile) {
  console.log("  Skipped (--no-mobile)");
} else {
  await screenshotMobile(url);
}

console.log("\n==> [2/6] Extract site assets (images, SVGs, backgrounds)");
await extractAssets(url);

console.log("\n==> [3/6] Download resources (images, CSS, SVGs, fonts)");
await downloadResources(url);

console.log("\n==> [3d/6] Generate brand kit + global.css");
await generateBrandKit(url);

// Read meta to get screenshot paths for the handoff
const meta = JSON.parse(readFileSync(sitePaths(url).metaPath, "utf8"));
meta.scope = scope;
const origin = new URL(url).origin;

// discoverSitemapMenus shells out to agent-browser (a full open/snapshot/eval
// pass). It is needed both for menu-reachable discovery and for menu extraction
// below, so memoize the promise and reuse it rather than running the browser twice.
let sitemapMenusPromise = null;
const getSitemapMenus = () => (sitemapMenusPromise ??= discoverSitemapMenus(url));

const discovery = await resolveDiscovery({
  scope,
  origin,
  homepageUrl: origin + "/",
  fetchXml: async (p) => {
    try {
      const r = await fetch(origin + p);
      return r.ok ? await r.text() : null;
    } catch { return null; }
  },
  listMenuPages: async () => {
    const sm = await getSitemapMenus();
    return (sm.pages || []).map(pg => pg.url);
  },
  log: (m) => console.log(m),
  validateUrls: scope === "site"
    ? (urls) => validateSitemapUrls(urls, { fetchImpl: fetch, log: (m) => console.log(m) })
    : undefined,
});
meta.discovery = { source: discovery.source, pages: discovery.pages };
console.log(`\n==> Discovery (${discovery.source}): ${discovery.pages.length} page(s)`);

// Menus come from nav extraction (not the sitemap, which has no hierarchy).
try {
  const sm = await getSitemapMenus();
  const rawMenus = sm.menusRaw || { main: (sm.pages || []).map(p => ({ label: p.label, url: p.url })), footer: [], sidebar: [] };
  meta.menus = normalizeMenus(rawMenus, origin);
} catch (e) {
  console.log(`  Menu extraction skipped: ${e.message}`);
  meta.menus = { main: [], footer: [], sidebar: [] };
}

writeFileSync(sitePaths(url).metaPath, JSON.stringify(meta, null, 2));
const desktopScreenshot = meta.screenshotPath;
const mobileScreenshot = meta.mobile?.screenshotPath ?? null;

const handoff = `# Claude Handoff — ${siteSlug(url)}

> **Read this file at session start.** The \`ddev clone\` pipeline has finished
> screenshots and asset extraction. Your job is to detect sections, build
> components, and verify them in Storybook.

## Site

URL: ${url}
Output dir: website-to-components/output/${siteSlug(url)}/

## Step 1 — Detect sections and crop (FIRST)

**START FROM THE DOM-MEASURED BOUNDS — do NOT pixel-estimate off the screenshot.**
The screenshot job already measured the page's REAL section boundaries from the
live DOM (via getBoundingClientRect) and wrote them to:

\`website-to-components/output/${siteSlug(url)}/dom-sections.json\`

These bounds are accurate and contiguous — they never cut through a component,
because they ARE the component containers. Read this file FIRST. Your job is to
**REFINE** these bounds with the \`visual-page-section-segmentation\` skill, not
to re-estimate them:
- **Merge** when the DOM split something that's visually one section (e.g. a bare
  navbar block above a hero → one hero section).
- **Split** only when one DOM block visually contains two distinct sections.
- **Label** each section and give a short reason.
- Keep \`y\`/\`height\` snapped to the DOM bounds unless you are splitting/merging.

If \`dom-sections.json\` has \`{ "error": ... }\` (no reliable DOM structure — rare),
THEN fall back to visual estimation from the screenshot, being careful never to
cut through text or a component.

**Desktop screenshot:** ${desktopScreenshot}
${mobileScreenshot ? `**Mobile screenshot:** ${mobileScreenshot}` : "*(mobile skipped)*"}

Then crop. \`applySections()\` validates the bounds before cropping (rejects
overlaps, clamps to page height, warns on gaps and on any section spanning >70%
of the page — the "grabbed the whole page" bug). Heed its warnings.

\`\`\`js
import { applySections } from "./website-to-components/jobs/02-split-sections.js";
// After refining the DOM bounds with the skill, call:
await applySections("${url}", desktopSections, mobileSections);
\`\`\`

Where \`desktopSections\` and \`mobileSections\` are arrays of:
\`{ label, y, height, width, reason }\` — refined from \`dom-sections.json\`.

## Step 2 — Detect components

Read all section images in \`website-to-components/output/${siteSlug(url)}/sections/\`
in parallel. Write \`website-to-components/output/${siteSlug(url)}/components.json\`.

## Step 3 — Generate report

\`\`\`bash
node website-to-components/scripts/finish.js ${url}
\`\`\`

## Step 4 — Build components

Build all detected components into \`storybook/src/components/\` (one folder per
component: \`index.jsx\` + \`component.yml\`). Follow the \`component-authoring\`
skill — use Tailwind classes, never inline styles.

## Step 5 — Visual comparison

Screenshot each Storybook story at \`http://localhost:6007\` and compare against
the source section images. Fix any gaps.

## Step 6 — Mobile check

\`\`\`bash
node website-to-components/jobs/06-mobile-check.js ${url}
\`\`\`

## Step 7 — Audit content

\`\`\`bash
node website-to-components/scripts/audit-content.js
\`\`\`

## Step 8 — Page story

Create a Storybook page story at \`canvas/src/stories/pages/\` that assembles all
components in order.

---
*Generated by \`ddev clone\` at ${new Date().toISOString()}*
`;

const handoffPath = join(PROJECT_ROOT, "CLAUDE_HANDOFF.md");
writeFileSync(handoffPath, handoff);

console.log(`\n==> [4/6] Handoff file written to CLAUDE_HANDOFF.md`);
console.log(`\nPipeline complete. Run from your host terminal:`);
console.log(`  ddev claude`);
