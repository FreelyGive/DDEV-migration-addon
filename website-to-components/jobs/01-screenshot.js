import { execSync, spawnSync } from "child_process";
import { writeFileSync } from "fs";
import { sitePaths, ensureDir } from "../lib/paths.js";

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

  // Lock animation end-states before scrolling back to top
  console.log("Locking animation end-states...");
  browserEval(`
    const style = document.createElement('style');
    style.id = '__anim_lock_style';
    style.innerHTML = [
      '*:not(.grayscale-item) { filter: none !important; }',
      '* { opacity: 1 !important; }'
    ].join(' ');
    document.head.appendChild(style);
    document.querySelectorAll('[class*="anima"]').forEach(el => {
      el.style.removeProperty('opacity');
      el.style.removeProperty('filter');
      el.style.removeProperty('transform');
      el.classList.forEach(c => {
        if (c.includes('anima') || c.includes('animated') || c.includes('entrance')) el.classList.remove(c);
      });
    });
    window.IntersectionObserver = function(cb, opts) {
      return { observe: function(){}, unobserve: function(){}, disconnect: function(){} };
    };
    'locked';
  `);
  execSync("agent-browser wait 1000", { stdio: "pipe" });

  // Scroll back to top so sticky nav is visible
  browserEval("window.scrollTo(0, 0)");

  // Wait for all images (including lazy-loaded) to be fully decoded and displayed.
  console.log("Waiting for all images to load...");
  execSync(
    "agent-browser wait --fn \"[...document.querySelectorAll('img')].every(img => img.complete && img.naturalWidth > 0)\"",
    { stdio: "inherit" },
  );

  console.log("Taking full-page screenshot...");
  execSync(`agent-browser screenshot "${screenshotPath}" --full`, { stdio: "inherit" });

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
