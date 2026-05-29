#!/usr/bin/env node
// scripts/run-multipage.js
//
// Multi-page orchestrator. Given a single domain URL, this script:
//   1. Runs the sitemap detector (jobs/00-sitemap.js) to discover the main
//      menu pages.
//   2. For every discovered page, runs the per-page automated steps used by
//      scripts/run.js (desktop + mobile screenshots, asset extraction,
//      resource download).
//   3. Writes CLAUDE_HANDOFF.md describing all pages so the Claude Code agent
//      can pick up at Step 3 (vision analysis) and continue through component
//      builds, audits, and page-story assembly for every page in turn.
//
// Per-page output lives at website-to-components/output/<host>/<page-slug>/.
// The homepage slug is `home` and is placed directly under <host>/.
//
// Usage:
//   node website-to-components/scripts/run-multipage.js <url>
//   node website-to-components/scripts/run-multipage.js <url> --clean
//   node website-to-components/scripts/run-multipage.js <url> --no-mobile
//   node website-to-components/scripts/run-multipage.js <url> --limit 5
//   node website-to-components/scripts/run-multipage.js <url> --concurrency 6
//
// Concurrency default is 6 (raised from 4 → 6 after V7 measurement: c=4 ran a 16-page
// site in ~8.7m of screenshot wall; expected c=6 → ~6m, c=8 → diminishing returns on
// most hosts. Use --concurrency 1 to force serial when debugging a single page or when
// the host can't handle multiple browser sessions. Cap is 8 (max sessions agent-browser
// will multiplex cleanly on this host).

import { spawn } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { run as discoverSitemap } from "../jobs/00-sitemap.js";
import { siteSlug, sitePaths, cleanSite, pageSlug } from "../lib/paths.js";
import { timed } from "../lib/timings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, "../..");

try {
  const { default: dotenv } = await import("dotenv");
  dotenv.config();
} catch {}

const args = process.argv.slice(2);
const url = args.find(a => !a.startsWith("-")) || process.env.TARGET_URL;
if (!url) {
  console.error("Usage: node run-multipage.js <url> [--clean] [--no-mobile] [--limit N] [--concurrency N]");
  process.exit(1);
}

const doClean = args.includes("--clean") || process.env.CLEAN === "1";
const skipMobile = args.includes("--no-mobile") || process.env.NO_MOBILE === "1";
const limitArg = args[args.indexOf("--limit") + 1];
const limit = limitArg && !isNaN(Number(limitArg)) ? Number(limitArg) : Infinity;
const concurrencyArg = args[args.indexOf("--concurrency") + 1];
// Default raised: 1 → 4 (Step 4, 2026-05-23) → 6 (V7, 2026-05-23). At c=4 a 16-page
// run finished its screenshot phase in ~8.7m; at c=6 expected ~6m (diminishing returns
// because agent-browser session startup is amortised across workers). Cap 8 — beyond
// that the harness throttles new browser sessions and per-worker latency rises.
const concurrency = Math.max(1, Math.min(8, Number(concurrencyArg) || 6));

const host = siteSlug(url);

if (doClean) {
  console.log(`\n==> [0/N] Wiping previous output for ${host}`);
  cleanSite(url);
} else {
  console.log(`\n==> [0/N] Keeping existing output (pass --clean to wipe and start fresh)`);
}

console.log(`\n==> [sitemap] Detecting main navigation for ${url}`);
const sitemap = await timed(
  url,
  { stage: "step-0-sitemap", page: "site" },
  () => discoverSitemap(url),
);
const pages = (sitemap.pages || []).slice(0, limit);

if (pages.length === 0) {
  console.error("No pages discovered. Aborting.");
  process.exit(1);
}

console.log(`\n==> Processing ${pages.length} page(s) with concurrency=${concurrency}.`);

const __dirname2 = dirname(fileURLToPath(import.meta.url));
const workerScript = join(__dirname2, "run-page-worker.js");

function runWorker(workerId, page) {
  return new Promise(resolve => {
    const env = { ...process.env, AGENT_BROWSER_SESSION: `w${workerId}` };
    const workerArgs = [workerScript, page.url, "--site-url", url];
    if (skipMobile) workerArgs.push("--no-mobile");
    const child = spawn("node", workerArgs, { env, stdio: "inherit" });
    child.on("exit", (code) => {
      if (code === 0) {
        try {
          const meta = JSON.parse(readFileSync(sitePaths(page.url).metaPath, "utf8"));
          resolve({ ...page, ok: true, desktopScreenshot: meta.screenshotPath, mobileScreenshot: meta.mobile?.screenshotPath ?? null });
        } catch (e) {
          resolve({ ...page, ok: false, error: String(e?.message ?? e) });
        }
      } else {
        resolve({ ...page, ok: false, error: `worker exit ${code}` });
      }
    });
    child.on("error", (e) => resolve({ ...page, ok: false, error: String(e?.message ?? e) }));
  });
}

// Worker pool: each of `concurrency` lanes consumes pages off a shared queue.
const queue = [...pages];
const results = [];
const lanes = [];
for (let w = 0; w < concurrency; w++) {
  lanes.push((async () => {
    while (queue.length > 0) {
      const page = queue.shift();
      console.log(`\n[w${w}] start ${page.slug.padEnd(40)} ${page.url}`);
      const t0 = Date.now();
      const result = await runWorker(w, page);
      const dt = ((Date.now() - t0) / 1000).toFixed(1);
      console.log(`[w${w}] done  ${page.slug.padEnd(40)} ${result.ok ? "✓" : "✗"} ${dt}s`);
      results.push(result);
    }
  })());
}
await Promise.all(lanes);

// Preserve original page order for the handoff
results.sort((a, b) => a.order - b.order);

// Write a multi-page handoff
const handoff = `# Claude Handoff — ${host} (multi-page)

> The multi-page pipeline has finished sitemap detection, screenshots, and
> asset extraction for every page in the main menu. Your job — for **every
> page** — is to detect sections, build components, and assemble a Storybook
> page story. Reuse shared components (Navbar, Footer, repeated cards) across
> pages instead of rebuilding them.

## Site

- Host: ${host}
- Root: ${url}
- Sitemap: \`website-to-components/output/${host}/sitemap.json\`

## Pages

${results.map(r => `- **${r.slug}** — ${r.url}  ${r.ok ? "✓" : "✗ failed: " + (r.error ?? "")}`).join("\n")}

## For each page (in order)

1. **Detect sections** — use the \`webpage-sections-splitter\` skill on
   \`output/${host}/<page-slug>/screenshot.png\` (homepage is at
   \`output/${host}/screenshot.png\`). Crop into
   \`output/${host}/<page-slug>/sections/section-0N.png\`.
2. **Vision analysis** — spawn 3 parallel subagents, merge results, write
   \`output/${host}/<page-slug>/components.json\` (homepage:
   \`output/${host}/components.json\`).
3. **Build components** — spawn parallel subagents. Before creating a new
   component, check \`canvas/src/components/\` — if a matching component
   already exists from an earlier page, reuse it.
4. **Visual comparison** — start Storybook, open the page story, screenshot,
   compare against \`output/${host}/<page-slug>/sections/\`, fix gaps.
5. **Page story** — write
   \`canvas/src/stories/pages/<SiteName><PageName>.stories.jsx\` that
   assembles all sections in top-to-bottom order.

## Fonts (once)

Extract fonts only on the first page that has them — subsequent pages share
the same font system via \`canvas/src/global.css\` \`@theme\` tokens.

## Inter-page links

After all page stories are written, update every page's Navbar and Footer to
use Storybook's \`linkTo()\` for nav items that map to a built page story.
Story title format: \`Pages/<Site Name> — <Page Name>\`.

## Final audit

\`\`\`bash
node website-to-components/scripts/audit-content.js
\`\`\`

---
*Generated by \`run-multipage.js\` at ${new Date().toISOString()}*
`;

const handoffPath = join(PROJECT_ROOT, "CLAUDE_HANDOFF.md");
writeFileSync(handoffPath, handoff);

console.log(`\n\n==> Multi-page pipeline complete.`);
console.log(`==> Handoff written to ${handoffPath}`);
console.log(`==> Next: hand off to Claude Code (no API key needed in this terminal — just open Claude Code).`);
