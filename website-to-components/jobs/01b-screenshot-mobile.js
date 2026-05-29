/**
 * Job 01b — Mobile screenshot
 *
 * Takes a full-page screenshot at 390×844 (iPhone 14 viewport).
 * Section splitting is handled by 02-split-sections.js using AI vision.
 *
 * Output: output/<site>/<page>/mobile-screenshot.png
 *
 * Usage: node jobs/01b-screenshot-mobile.js <url>
 */

import { execSync, spawnSync } from "child_process";
import { writeFileSync, readFileSync } from "fs";
import { sitePaths, ensureDir } from "../lib/paths.js";

const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;

function browserEval(js) {
  const result = spawnSync("agent-browser", ["eval", "--stdin"], {
    input: js,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.stdout?.trim() ?? "";
}

export async function run(url) {
  const paths = sitePaths(url);
  const mobileScreenshotPath = `${paths.outputDir}/mobile-screenshot.png`;
  const metaPath = paths.metaPath;

  ensureDir(paths.outputDir);

  console.log(`Setting mobile viewport ${MOBILE_WIDTH}x${MOBILE_HEIGHT}...`);
  execSync(`agent-browser set viewport ${MOBILE_WIDTH} ${MOBILE_HEIGHT}`, { stdio: "inherit" });
  execSync(`agent-browser open "${url}"`, { stdio: "inherit" });
  execSync("agent-browser wait --load networkidle", { stdio: "inherit" });

  // Dismiss cookie banner
  const cookieSelectors = [
    'find role button click --name "Accept all"',
    'find role button click --name "Accept cookies"',
    "find role button click --name Accept",
    "find role button click --name OK",
    'find role button click --name "I agree"',
    "find role button click --name Close",
  ];
  for (const sel of cookieSelectors) {
    try {
      execSync(`agent-browser ${sel}`, { stdio: "pipe" });
      execSync("agent-browser wait 500", { stdio: "pipe" });
      break;
    } catch { /* not found */ }
  }

  // Scroll to trigger lazy-load and animations
  const pageHeightStr = browserEval("document.documentElement.scrollHeight");
  const pageHeight = parseInt(pageHeightStr, 10) || 6000;
  console.log(`Mobile page height: ${pageHeight}px`);

  const step = 300;
  const steps = Math.ceil(pageHeight / step);
  for (let i = 0; i < steps; i++) {
    browserEval(`window.scrollTo(0, ${i * step})`);
    execSync("agent-browser wait 800", { stdio: "pipe" });
  }

  // Lock animation end-states
  browserEval(`
    const style = document.createElement('style');
    style.innerHTML = '* { opacity: 1 !important; filter: none !important; }';
    document.head.appendChild(style);
    window.IntersectionObserver = function(cb) {
      return { observe: function(){}, unobserve: function(){}, disconnect: function(){} };
    };
    'locked';
  `);
  execSync("agent-browser wait 500", { stdio: "pipe" });

  browserEval("window.scrollTo(0, 0)");
  execSync("agent-browser wait 1000", { stdio: "pipe" });

  // Wait for all images (including lazy-loaded thumbnails) to finish loading
  console.log("Waiting for all images to load...");
  browserEval(`
    await Promise.allSettled(
      [...document.querySelectorAll('img')].map(img =>
        img.complete ? Promise.resolve() : new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 8000);
        })
      )
    );
    'images ready';
  `);
  execSync("agent-browser wait 1000", { stdio: "pipe" });

  console.log("Taking mobile full-page screenshot...");
  execSync(`agent-browser screenshot "${mobileScreenshotPath}" --full`, { stdio: "inherit" });

  execSync("agent-browser close", { stdio: "inherit" });

  // Persist mobile screenshot path into meta.json
  let savedMeta = {};
  try { savedMeta = JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
  savedMeta.mobile = { screenshotPath: mobileScreenshotPath };
  writeFileSync(metaPath, JSON.stringify(savedMeta, null, 2));

  console.log(`Mobile screenshot saved to ${mobileScreenshotPath}`);
  return mobileScreenshotPath;
}

if (process.argv[1]?.endsWith("01b-screenshot-mobile.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/01b-screenshot-mobile.js <url>"); process.exit(1); }
  await run(url);
}
