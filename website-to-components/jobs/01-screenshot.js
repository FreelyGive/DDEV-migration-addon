import { execSync, spawnSync } from "child_process";
import { writeFileSync } from "fs";
import { sitePaths, ensureDir } from "../lib/paths.js";
import { measureSections } from "./01c-measure-sections.js";

function browserEval(js) {
  const result = spawnSync("agent-browser", ["eval", "--stdin"], {
    input: js,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.stdout?.trim() ?? "";
}

export async function run(url) {
  const { outputDir, screenshotPath, metaPath } = sitePaths(url);
  ensureDir(outputDir);

  console.log(`Opening ${url}...`);
  execSync("agent-browser set viewport 1440 900", { stdio: "inherit" });
  execSync(`agent-browser open "${url}"`, { stdio: "inherit" });
  execSync("agent-browser wait --load networkidle", { stdio: "inherit" });

  // Dismiss cookie banner using AI vision on the accessibility tree.
  // agent-browser snapshot reads all interactive elements regardless of language,
  // so the agent can identify and click the accept button on any site.
  console.log("Checking for cookie banner...");
  try {
    const snapshot = spawnSync("agent-browser", ["snapshot", "-i", "--compact"], {
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    }).stdout ?? "";

    // Look for cookie/consent-related containers by common keywords in any language
    const cookieKeywords = /cookie|consent|gdpr|privacy|accepter|akzeptieren|aceptar|aceitar|accepteren|accetta|kabul|согласи|同意|クッキー/i;
    if (cookieKeywords.test(snapshot)) {
      // Ask the AI agent (via eval) to find the best button ref to click
      const refResult = spawnSync("agent-browser", ["eval", "--stdin"], {
        input: `
          const snapshot = ${JSON.stringify(snapshot)};
          // Find the @ref of the most likely "accept" button in the snapshot text
          const lines = snapshot.split('\\n');
          const cookieRe = /cookie|consent|gdpr|privacy|accepter|akzeptieren|aceptar|aceitar|accepteren|accetta|kabul|согласи|同意|クッキー/i;
          const acceptRe = /accept|agree|ok|allow|confirm|accep|zustimm|aceptar|aceitar|accetta|kabul|accepter|akkoord|согласен|同意する|すべて許可/i;
          // Find lines near cookie context that look like buttons with accept-like labels
          let bestRef = null;
          for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (acceptRe.test(line) && line.includes('@')) {
              const ref = line.match(/@e\\d+/)?.[0];
              if (ref) { bestRef = ref; break; }
            }
          }
          bestRef ?? '';
        `,
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      }).stdout?.trim() ?? "";

      if (refResult && refResult.startsWith("@")) {
        execSync(`agent-browser click ${refResult}`, { stdio: "pipe" });
        console.log(`Cookie banner dismissed via snapshot ref ${refResult}`);
        execSync("agent-browser wait 500", { stdio: "pipe" });
      } else {
        console.log("Cookie banner detected but no accept button ref found — continuing.");
      }
    } else {
      console.log("No cookie banner detected.");
    }
  } catch {
    console.log("Cookie banner check failed — continuing.");
  }

  // Get page height
  const pageHeightStr = browserEval("document.documentElement.scrollHeight", { quiet: true });
  const pageHeight = parseInt(pageHeightStr, 10) || 8000;
  console.log(`Page height: ${pageHeight}px. Scrolling to trigger animations...`);

  // Scroll slowly top-to-bottom so intersection observers fire for every section
  const step = 200;
  const steps = Math.ceil(pageHeight / step);
  for (let i = 0; i < steps; i++) {
    browserEval(`window.scrollTo(0, ${i * step})`);
    execSync("agent-browser wait 3000", { stdio: "inherit" });
  }

  // Lock animation end-states before scrolling back to top.
  //
  // IMPORTANT: do NOT apply a blanket `* { opacity: 1 !important }` /
  // `* { filter: none !important }`. That forces intentional overlay/scrim/tint
  // layers (hero darkening gradients, hover overlays, low-alpha image tints) to
  // full opacity, which renders as a grey box over the whole element — most
  // visible on rounded-corner image containers. Reset entrance-animation state
  // ONLY on elements that actually carry an animation/entrance class, leaving
  // designed overlays and image filters intact.
  console.log("Locking animation end-states (scoped to entrance animations)...");
  browserEval(`
    const ANIM_RE = /anima|animated|entrance|fade-?in|reveal|aos|wow|scroll-?trigger|inview|in-view/i;
    document.querySelectorAll('[class*="anima"], [class*="fade"], [class*="reveal"], [class*="aos"], [class*="inview"], [class*="in-view"], [data-aos]').forEach(el => {
      const cs = getComputedStyle(el);
      // Only neutralise opacity if it's hidden by a not-yet-fired entrance anim.
      if (parseFloat(cs.opacity) < 1) el.style.setProperty('opacity', '1', 'important');
      el.style.removeProperty('transform');
      el.style.removeProperty('filter');
      el.classList.forEach(c => { if (ANIM_RE.test(c)) el.classList.remove(c); });
      el.removeAttribute('data-aos');
    });
    // Stub IntersectionObserver so any further scroll-triggered reveals fire
    // immediately for the rest of the capture.
    window.IntersectionObserver = function(cb, opts) {
      return { observe: function(){}, unobserve: function(){}, disconnect: function(){}, takeRecords: function(){ return []; } };
    };
    'locked';
  `);
  execSync("agent-browser wait 1000", { stdio: "pipe" });

  // Scroll back to top so sticky nav is visible
  browserEval("window.scrollTo(0, 0)");

  // Force-load video posters and lazy media BEFORE the readiness gate.
  // Video players capture blank when their poster/thumbnail hasn't painted:
  //  - <video poster="..."> posters aren't <img>, so the img-only gate ignores them
  //  - facade players (lit-youtube, lite-vimeo, "click to play") render the
  //    thumbnail as a CSS background-image or a lazily-injected <img>
  //  - real <iframe> embeds (YouTube/Vimeo) paint asynchronously after load
  // Eagerly promote lazy attributes and decode posters so they're visible.
  console.log("Force-loading video posters and lazy media...");
  browserEval(`
    // Promote common lazy attributes to real src so the browser fetches them.
    document.querySelectorAll('img[loading="lazy"], img[data-src], video[data-src], source[data-src]').forEach(el => {
      el.loading = 'eager';
      if (el.dataset && el.dataset.src && !el.src) el.src = el.dataset.src;
      if (el.dataset && el.dataset.poster && el.poster === '') el.poster = el.dataset.poster;
    });
    // Kick <video> elements to load their poster/first frame.
    document.querySelectorAll('video').forEach(v => { try { v.preload = 'auto'; v.load(); } catch (e) {} });
    // Decode any <video poster> as an Image so it's in cache when we paint.
    [...document.querySelectorAll('video[poster]')].forEach(v => { const im = new Image(); im.src = v.poster; });
    'kicked';
  `);

  // Wait for all images AND video posters to be decoded and displayed.
  console.log("Waiting for all images and video posters to load...");
  execSync(
    "agent-browser wait --fn \"[...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)\"",
    { stdio: "inherit" },
  );
  // <video> readiness (HAVE_CURRENT_DATA+) and poster image decode — these are
  // not <img> nodes, so they need their own gate. Tolerant: posters that fail to
  // decode must not hang the run, so we bound the wait.
  try {
    execSync(
      "agent-browser wait --fn \"[...document.querySelectorAll('video')].every(v => v.readyState >= 2 || !v.poster || (() => { const i = new Image(); i.src = v.poster; return i.complete; })())\" --timeout 8000",
      { stdio: "inherit" },
    );
  } catch {
    console.log("Video readiness gate timed out — continuing (posters may be slow).");
  }
  // Give real <iframe> video embeds a fixed settle to paint their thumbnail.
  const hasIframeVideo = browserEval(
    "!!document.querySelector('iframe[src*=\"youtube\"], iframe[src*=\"vimeo\"], iframe[src*=\"player\"], iframe[src*=\"embed\"]')",
  );
  if (hasIframeVideo === "true") {
    console.log("Iframe video embed present — settling 3s for it to paint...");
    execSync("agent-browser wait 3000", { stdio: "inherit" });
  }

  console.log("Taking full-page screenshot...");
  execSync(`agent-browser screenshot "${screenshotPath}" --full`, { stdio: "inherit" });

  // Measure REAL section boundaries from the live DOM while it's still open and
  // fully rendered. These accurate, contiguous bounds are the starting point for
  // Step 3 (vision refines/labels them) instead of pixel-estimating off the
  // downscaled screenshot — which cut through components. → dom-sections.json
  console.log("Measuring section boundaries from the DOM...");
  try {
    measureSections(url);
  } catch (e) {
    console.log(`  DOM section measurement failed (${e.message}); vision will estimate.`);
  }

  console.log("Closing browser...");
  execSync("agent-browser close", { stdio: "inherit" });

  const meta = { url, timestamp: new Date().toISOString(), screenshotPath };
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`Screenshot saved to ${screenshotPath}`);
}

if (process.argv[1]?.endsWith("01-screenshot.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/01-screenshot.js <url>"); process.exit(1); }
  await run(url);
}
