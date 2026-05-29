// Internal helper — runs the mobile screenshot in a child Node process so it
// gets its own AGENT_BROWSER_SESSION (and therefore its own browser instance)
// while the desktop screenshot runs in the parent process. Called by
// run-page-worker.js as part of V8 (2026-05-23). Do not invoke directly.
//
// Args: <page-url> <site-url> <page-slug>
// Env:  AGENT_BROWSER_SESSION — separate session id, set by run-page-worker.js

import { run as screenshotMobile } from "../../jobs/01b-screenshot-mobile.js";
import { timed } from "../../lib/timings.js";

const [pageUrl, siteUrl, slug] = process.argv.slice(2);
if (!pageUrl || !siteUrl || !slug) {
  console.error("Usage: run-mobile-screenshot.mjs <page-url> <site-url> <page-slug>");
  process.exit(1);
}
const session = process.env.AGENT_BROWSER_SESSION || "default-m";

await timed(siteUrl, { stage: "step-1-screenshot-mobile", page: slug, subagent: session },
  () => screenshotMobile(pageUrl));
console.log(`[worker:${session}] mobile ${slug} ok`);
