#!/usr/bin/env node
/**
 * Smoke-test that Tailwind utilities resolve in a running Storybook.
 *
 * Why: Tailwind v4 + @tailwindcss/vite + Storybook can silently fail to generate
 * utility classes if `@source` scanning misses the component tree. Symptom: components
 * render with className strings but ZERO applied styles. Run this AFTER the first
 * component is built to fail loudly before the rest of the build pipeline burns
 * time on a broken config.
 *
 * Algorithm:
 *  1. Hit the Storybook iframe URL for the first story it can find.
 *  2. Locate the Vite-injected style tag for global.css.
 *  3. Assert: total CSS length is meaningfully > the bare-Tailwind baseline (~8 KB).
 *  4. Assert: at least one of the brand-* utility classes (or a probe class
 *     specified on the CLI) has resolved CSS (i.e. has a `.bg-<probe>{` rule).
 *  5. Optionally: render a probe story and check `getComputedStyle` of a specific selector.
 *
 * Usage:
 *   node website-to-components/jobs/05-smoke-test-tailwind.js
 *     [--port 6007]
 *     [--story-id atoms-button--default]
 *     [--probe-utility bg-brand-red]      (default: bg-brand-red)
 *     [--probe-selector header]            (default: probe via CSS scan only)
 *     [--min-css-bytes 12000]              (default: 12000)
 *
 * Exit:
 *   0 — Tailwind utilities present and styled. Safe to continue build phase.
 *   1 — Utilities NOT present. Inspect global.css `@source` configuration.
 *
 * This script does NOT start Storybook — call `start-storybook.js` first.
 */

import http from "http";
import { spawnSync } from "child_process";

function parseArgs(argv) {
  const out = {
    port: 6007,
    storyId: null,
    probeUtility: "bg-brand-red",
    probeSelector: null,
    minCssBytes: 12000,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = parseInt(argv[++i], 10);
    else if (a === "--story-id") out.storyId = argv[++i];
    else if (a === "--probe-utility") out.probeUtility = argv[++i];
    else if (a === "--probe-selector") out.probeSelector = argv[++i];
    else if (a === "--min-css-bytes") out.minCssBytes = parseInt(argv[++i], 10);
  }
  return out;
}

// ---------- Find a probe story (first one in the index) --------------------
async function findFirstStory(port) {
  return new Promise((resolve) => {
    http
      .get(`http://localhost:${port}/index.json`, (res) => {
        let body = "";
        res.on("data", (d) => (body += d));
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            const entries = json?.entries ?? json?.stories ?? {};
            const id = Object.keys(entries)[0];
            resolve(id);
          } catch {
            resolve(null);
          }
        });
      })
      .on("error", () => resolve(null));
  });
}

// ---------- Run agent-browser to introspect computed styles ----------------
function runAgentBrowser(args) {
  const r = spawnSync("agent-browser", args, { encoding: "utf8" });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", status: r.status };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  let storyId = opts.storyId;
  if (!storyId) storyId = await findFirstStory(opts.port);
  if (!storyId) {
    console.error("Could not auto-detect a story id from Storybook's index.json.");
    console.error("Pass --story-id explicitly or ensure Storybook is running on the requested port.");
    process.exit(1);
  }
  const iframeUrl = `http://localhost:${opts.port}/iframe.html?id=${encodeURIComponent(storyId)}&viewMode=story`;
  console.log(`Probing: ${iframeUrl}`);
  console.log(`Probe utility: .${opts.probeUtility}`);

  // Open the page and wait a moment for Vite HMR / CSS injection.
  runAgentBrowser(["open", iframeUrl]);
  // Give the CSS a moment to inject.
  await new Promise((r) => setTimeout(r, 4000));

  const probeJs = `(() => {
  const styles = [...document.querySelectorAll('style')];
  const tw = styles.find(s => (s.getAttribute('data-vite-dev-id') || '').endsWith('global.css'));
  const t = tw ? tw.textContent : '';
  const matchUtility = t.indexOf('.${opts.probeUtility}');
  const findFonts = [...new Set((t.match(/\\-\\-color-brand-[a-z-]+/g) || []))];
  ${
    opts.probeSelector
      ? `const el = document.querySelector(${JSON.stringify(opts.probeSelector)});
         const cs = el && getComputedStyle(el);
         const elState = el ? { display: cs.display, bg: cs.backgroundColor, font: cs.fontFamily } : null;`
      : "const elState = null;"
  }
  return JSON.stringify({ cssBytes: t.length, hasUtility: matchUtility >= 0, brandColorTokens: findFonts.length, elState });
})()`;

  const r = runAgentBrowser(["eval", probeJs]);
  const lastLine = r.stdout.split("\n").reverse().find((l) => l.trim());
  let report;
  try {
    report = JSON.parse(JSON.parse(lastLine || "{}"));
  } catch {
    report = JSON.parse(lastLine || "{}");
  }

  console.log(`  CSS bytes injected:   ${report.cssBytes}`);
  console.log(`  Has .${opts.probeUtility}:    ${report.hasUtility ? "yes" : "no"}`);
  console.log(`  Brand color tokens:   ${report.brandColorTokens}`);
  if (report.elState) console.log(`  Element state:        ${JSON.stringify(report.elState)}`);

  const issues = [];
  if (report.cssBytes < opts.minCssBytes) {
    issues.push(`CSS is too small (${report.cssBytes} < ${opts.minCssBytes} bytes) — Tailwind isn't generating utilities.`);
  }
  if (!report.hasUtility) {
    issues.push(`Probe utility .${opts.probeUtility} is missing from generated CSS — @source isn't scanning component JSX.`);
  }
  if (report.brandColorTokens < 2) {
    issues.push(`Only ${report.brandColorTokens} --color-brand-* tokens reached the bundle — Tailwind tree-shaking is dropping them because no utility references them.`);
  }
  if (opts.probeSelector && report.elState && report.elState.bg === "rgba(0, 0, 0, 0)") {
    issues.push(`Probe selector "${opts.probeSelector}" has transparent background — its Tailwind classes did not apply.`);
  }

  if (issues.length) {
    console.error("");
    console.error("✗ Tailwind smoke test FAILED:");
    for (const i of issues) console.error(`  - ${i}`);
    console.error("");
    console.error("Likely fixes:");
    console.error("  1. Confirm canvas/src/global.css contains `@source inline(...)` listing brand utilities.");
    console.error("  2. Rerun `node website-to-components/scripts/init-global-css.js --force` to regenerate.");
    console.error("  3. Verify Storybook viteFinal adds the `tailwindcss()` plugin.");
    process.exit(1);
  }
  console.log("");
  console.log("✓ Tailwind utilities resolve. Safe to continue the component-build phase.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
