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
import { imageSize } from "../lib/image.js";
import { sitePaths, ensureDir } from "../lib/paths.js";
import { paintVideoIframes } from "../lib/video-iframes.js";

const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;
const MOBILE_SCALE = 2; // deviceScaleFactor — retina/@2x render

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

  // Open FIRST, then set the viewport on the live page.
  //
  // `set viewport` must run AFTER `open`. The desktop job (01-screenshot.js)
  // ends with `agent-browser close`, so the daemon's browser is freshly
  // (re)created here; a `set viewport` issued before `open` is discarded when
  // the navigation rebuilds the page, leaving the capture at the daemon's
  // default (desktop) width — which is exactly how the mobile screenshot ended
  // up the same size as desktop. Resize the page that actually exists.
  // The sequence open → set viewport → reopen is deliberate and all three steps
  // are load-bearing (verified against agent-browser on host):
  //  - `set viewport` issued BEFORE any open is silently discarded — the first
  //    open resets the daemon to its default 1280x1, so a viewport set with no
  //    page context never sticks (this is the original desktop-width bug).
  //  - So we open ONCE to establish a page context, THEN set the mobile viewport
  //    (it now sticks on the daemon), THEN reopen so the page does a fresh load
  //    at 390px — responsive sites that branch on the initial width (JS, not just
  //    CSS media queries) need the reload, not just a post-load resize.
  console.log(`Opening ${url} to establish page context...`);
  execSync(`agent-browser open "${url}"`, { stdio: "inherit" });
  execSync("agent-browser wait --load networkidle", { stdio: "inherit" });

  console.log(`Setting mobile viewport ${MOBILE_WIDTH}x${MOBILE_HEIGHT} @${MOBILE_SCALE}x...`);
  // Third positional arg is the deviceScaleFactor (retina). `set viewport 390
  // 844 2` yields window.innerWidth=390 and devicePixelRatio=2 exactly. Do NOT
  // use `set device "iPhone 12"` — that profile reports innerWidth 980 / dpr 3,
  // not a 390 @2x render.
  execSync(`agent-browser set viewport ${MOBILE_WIDTH} ${MOBILE_HEIGHT} ${MOBILE_SCALE}`, { stdio: "inherit" });
  console.log("Reloading at mobile viewport...");
  execSync(`agent-browser open "${url}"`, { stdio: "inherit" });
  execSync("agent-browser wait --load networkidle", { stdio: "inherit" });
  execSync("agent-browser wait 500", { stdio: "pipe" });

  // Verification gate: confirm the live page is actually a 390px @2x mobile
  // render before we spend time scrolling/capturing. Fail loudly otherwise —
  // never emit a desktop-width screenshot labelled as mobile.
  const innerWidth = parseInt(browserEval("window.innerWidth"), 10);
  const measuredDpr = parseFloat(browserEval("window.devicePixelRatio"));
  if (innerWidth !== MOBILE_WIDTH) {
    throw new Error(
      `Mobile viewport did not apply: window.innerWidth=${innerWidth}px, expected exactly ${MOBILE_WIDTH}px. ` +
      `Aborting so we don't emit a desktop-width screenshot labelled as mobile.`,
    );
  }
  if (measuredDpr !== MOBILE_SCALE) {
    throw new Error(
      `Mobile devicePixelRatio is ${measuredDpr}, expected ${MOBILE_SCALE}. The capture would not be a ` +
      `true @${MOBILE_SCALE}x mobile render — aborting. Check that 'set viewport ${MOBILE_WIDTH} ${MOBILE_HEIGHT} ${MOBILE_SCALE}' is supported.`,
    );
  }
  console.log(`Confirmed mobile viewport: window.innerWidth=${innerWidth}px, dpr=${measuredDpr}`);

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

  // Lock animation end-states — scoped to entrance animations only.
  // Do NOT use a blanket `* { opacity:1 !important; filter:none !important }`:
  // it forces designed overlay/scrim/tint layers fully opaque (grey box over
  // rounded-corner images) and strips intended image filters. Reset only the
  // elements that carry an animation/entrance class.
  browserEval(`
    const ANIM_RE = /anima|animated|entrance|fade-?in|reveal|aos|wow|scroll-?trigger|inview|in-view/i;
    document.querySelectorAll('[class*="anima"], [class*="fade"], [class*="reveal"], [class*="aos"], [class*="inview"], [class*="in-view"], [data-aos]').forEach(el => {
      const cs = getComputedStyle(el);
      if (parseFloat(cs.opacity) < 1) el.style.setProperty('opacity', '1', 'important');
      el.style.removeProperty('transform');
      el.style.removeProperty('filter');
      el.classList.forEach(c => { if (ANIM_RE.test(c)) el.classList.remove(c); });
      el.removeAttribute('data-aos');
    });
    window.IntersectionObserver = function(cb) {
      return { observe: function(){}, unobserve: function(){}, disconnect: function(){}, takeRecords: function(){ return []; } };
    };
    'locked';
  `);
  execSync("agent-browser wait 500", { stdio: "pipe" });

  browserEval("window.scrollTo(0, 0)");
  execSync("agent-browser wait 1000", { stdio: "pipe" });

  // Force-load video posters / lazy media before waiting (posters aren't <img>).
  browserEval(`
    document.querySelectorAll('img[loading="lazy"], img[data-src], video[data-src], source[data-src]').forEach(el => {
      el.loading = 'eager';
      if (el.dataset && el.dataset.src && !el.src) el.src = el.dataset.src;
      if (el.dataset && el.dataset.poster && el.poster === '') el.poster = el.dataset.poster;
    });
    document.querySelectorAll('video').forEach(v => { try { v.preload = 'auto'; v.load(); } catch (e) {} });
    [...document.querySelectorAll('video[poster]')].forEach(v => { const im = new Image(); im.src = v.poster; });
    'kicked';
  `);

  // Wait for all images, video posters, and <video> readiness.
  console.log("Waiting for all images and video posters to load...");
  browserEval(`
    const posterReady = (v) => { if (!v.poster) return true; const i = new Image(); i.src = v.poster; return i.decode().then(() => true).catch(() => true); };
    await Promise.allSettled([
      ...[...document.querySelectorAll('img')].map(img =>
        img.complete ? Promise.resolve() : new Promise(resolve => {
          img.addEventListener('load', resolve, { once: true });
          img.addEventListener('error', resolve, { once: true });
          setTimeout(resolve, 8000);
        })
      ),
      ...[...document.querySelectorAll('video')].map(v =>
        v.readyState >= 2 ? posterReady(v) : new Promise(resolve => {
          v.addEventListener('loadeddata', resolve, { once: true });
          setTimeout(resolve, 8000);
        })
      ),
    ]);
    'media ready';
  `);
  // YouTube throttles poster rendering for off-screen/automated iframes, so the
  // embeds capture blank. Replace each youtube.com/embed/<id> iframe with its
  // real CDN poster (img.youtube.com/vi/<id>/...) + play overlay, then wait for
  // those poster <img> to load. (Also waits internally for the posters.)
  paintVideoIframes(browserEval);

  // Hard lazy-image gate: do NOT capture until every <img> has actually decoded
  // (complete && naturalWidth > 0). The scroll pass above pulls lazy images into
  // view; this gate guarantees they finished before we shoot. Bounded so a
  // single broken asset can't hang the run.
  console.log("Gating on all <img> loaded (complete && naturalWidth > 0)...");
  const imgGate = spawnSync(
    "agent-browser",
    [
      "wait",
      "--fn",
      "[...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)",
      "--timeout",
      "15000",
    ],
    { stdio: "pipe", encoding: "utf8" },
  );
  const imgStats = browserEval(
    "(() => { const a = [...document.querySelectorAll('img')]; return JSON.stringify({total: a.length, loaded: a.filter(i => i.complete && i.naturalWidth > 0).length}); })()",
  );
  if (imgGate.status !== 0) {
    console.log(`WARN: image gate timed out — ${imgStats} (capturing anyway).`);
  } else {
    console.log(`All images loaded: ${imgStats}`);
  }

  // Capture the device pixel ratio while the page is still live — the full-page
  // PNG is rendered at MOBILE_WIDTH × dpr, so we need it to validate the output.
  const dpr = parseFloat(browserEval("window.devicePixelRatio")) || 1;

  console.log("Taking mobile full-page screenshot...");
  execSync(`agent-browser screenshot "${mobileScreenshotPath}" --full`, { stdio: "inherit" });

  execSync("agent-browser close", { stdio: "inherit" });

  // Second verification gate: the produced PNG must actually be mobile-width.
  // Guards against a viewport that reverted between the innerWidth check and the
  // capture. Expected PNG width = MOBILE_WIDTH × devicePixelRatio.
  const expectedPngWidth = Math.round(MOBILE_WIDTH * dpr);
  const pngMeta = imageSize(mobileScreenshotPath);
  if (pngMeta.width > expectedPngWidth + 40) {
    throw new Error(
      `Mobile screenshot is ${pngMeta.width}px wide, expected ~${expectedPngWidth}px ` +
      `(${MOBILE_WIDTH}px × dpr ${dpr}). The capture is desktop-width — refusing to ` +
      `save it as the mobile screenshot.`,
    );
  }
  console.log(`Confirmed mobile screenshot width: ${pngMeta.width}px (dpr ${dpr})`);

  // Persist mobile screenshot path into meta.json
  let savedMeta = {};
  try { savedMeta = JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
  savedMeta.mobile = { screenshotPath: mobileScreenshotPath, width: pngMeta.width, height: pngMeta.height };
  writeFileSync(metaPath, JSON.stringify(savedMeta, null, 2));

  console.log(`Mobile screenshot saved to ${mobileScreenshotPath}`);
  return mobileScreenshotPath;
}

if (process.argv[1]?.endsWith("01b-screenshot-mobile.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/01b-screenshot-mobile.js <url>"); process.exit(1); }
  await run(url);
}
