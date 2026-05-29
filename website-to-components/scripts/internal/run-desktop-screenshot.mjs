// Internal helper — runs the desktop screenshot in a child Node process so it
// can run in parallel with the mobile screenshot. Called by run-page-worker.js
// as part of V8 (2026-05-23). Do not invoke directly.
//
// Args: <page-url> <site-url> <page-slug>
// Env:  AGENT_BROWSER_SESSION — separate session id, set by run-page-worker.js

import { run as screenshot } from "../../jobs/01-screenshot.js";
import { timed } from "../../lib/timings.js";

const [pageUrl, siteUrl, slug] = process.argv.slice(2);
if (!pageUrl || !siteUrl || !slug) {
  console.error("Usage: run-desktop-screenshot.mjs <page-url> <site-url> <page-slug>");
  process.exit(1);
}
const session = process.env.AGENT_BROWSER_SESSION || "default";

await timed(siteUrl, { stage: "step-1-screenshot-desktop", page: slug, subagent: session },
  () => screenshot(pageUrl));
console.log(`[worker:${session}] desktop ${slug} ok`);
