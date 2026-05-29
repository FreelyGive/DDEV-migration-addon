#!/usr/bin/env node
// scripts/run-page-worker.js
//
// One-shot per-page worker. Runs the four automated per-page jobs
// (desktop screenshot, mobile screenshot, asset extract, resource download)
// for a single URL. The orchestrator (run-multipage.js) spawns N of these in
// parallel, each with its own AGENT_BROWSER_SESSION env var so they don't
// step on each other's browser state.
//
// Usage:
//   AGENT_BROWSER_SESSION=worker-0 node scripts/run-page-worker.js <page-url> [--no-mobile]
//
// Reads --site-url from args so timings are attributed to the host's log,
// not the per-page slug.

import { readFileSync } from "fs";
import { spawn } from "child_process";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { run as extractAssets } from "../jobs/03b-extract-assets.js";
import { run as downloadResources } from "../jobs/03c-download-resources.js";
import { sitePaths, pageSlug } from "../lib/paths.js";
import { timed } from "../lib/timings.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function spawnScreenshot(scriptName, sessionSuffix, pageUrl, siteUrl, slug, session) {
  // V8 — desktop and mobile each run in their own child Node process so the
  // event loop is free in both, AND each gets its own AGENT_BROWSER_SESSION
  // so the two browsers don't race over viewport state.
  const script = join(__dirname, "internal", scriptName);
  return new Promise((resolve, reject) => {
    const child = spawn("node", [script, pageUrl, siteUrl, slug], {
      env: { ...process.env, AGENT_BROWSER_SESSION: `${session}${sessionSuffix}` },
      stdio: "inherit",
    });
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`${scriptName} failed (exit ${code})`)),
    );
    child.on("error", reject);
  });
}

const args = process.argv.slice(2);
const pageUrl = args.find(a => !a.startsWith("--"));
if (!pageUrl) {
  console.error("Usage: run-page-worker.js <page-url> [--site-url <root-url>] [--no-mobile]");
  process.exit(1);
}

const skipMobile = args.includes("--no-mobile");
const siteUrlIdx = args.indexOf("--site-url");
const siteUrl = siteUrlIdx >= 0 ? args[siteUrlIdx + 1] : pageUrl;
const slug = pageSlug(pageUrl);
const session = process.env.AGENT_BROWSER_SESSION || "default";

console.log(`[worker:${session}] ${slug}  starting`);

try {
  // V8 (2026-05-23): run desktop + mobile screenshots IN PARALLEL.
  // BOTH run in child Node processes — the parent's event loop would otherwise
  // be blocked by execSync inside the screenshot jobs, defeating the goal.
  // Each child gets its own AGENT_BROWSER_SESSION so the browsers don't race.
  // Saves min(desktop, mobile) per page = ~30s typical → ~80s off c=6 wall clock.
  const desktopP = spawnScreenshot("run-desktop-screenshot.mjs", "-d", pageUrl, siteUrl, slug, session);
  const mobileP = skipMobile
    ? Promise.resolve()
    : spawnScreenshot("run-mobile-screenshot.mjs", "-m", pageUrl, siteUrl, slug, session);

  if (skipMobile) console.log(`[worker:${session}] ${slug}  mobile skipped`);

  await Promise.all([desktopP, mobileP]);

  // Extract + resource download still need the desktop's browser session and run after.
  await timed(siteUrl, { stage: "step-2b-extract-assets", page: slug, subagent: session },
    () => extractAssets(pageUrl));

  await timed(siteUrl, { stage: "step-2c-download-resources", page: slug, subagent: session },
    () => downloadResources(pageUrl));

  console.log(`[worker:${session}] ${slug}  ok`);
  // Brief summary so the orchestrator can collect them
  const meta = JSON.parse(readFileSync(sitePaths(pageUrl).metaPath, "utf8"));
  console.log(`[worker:${session}] DESKTOP_PATH=${meta.screenshotPath}`);
  if (meta.mobile?.screenshotPath) console.log(`[worker:${session}] MOBILE_PATH=${meta.mobile.screenshotPath}`);
} catch (e) {
  console.error(`[worker:${session}] ${slug}  FAIL: ${e?.message ?? e}`);
  process.exit(1);
}
