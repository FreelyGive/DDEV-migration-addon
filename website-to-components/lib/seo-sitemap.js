import { spawn } from "node:child_process";

// website-to-components/lib/seo-sitemap.js
//
// Whole-site URL discovery via the claude-seo `seo-sitemap` skill (Mode 1:
// "Analyze Existing Sitemap"). The skill locates sitemap.xml (with robots.txt
// and sitemap-index fallbacks), 200-checks each URL, and drops noindex /
// redirected / non-canonical URLs. This module owns invocation + parsing; all
// I/O is injected so the parser is unit-testable without the skill installed.

export function parseSeoSitemapOutput(text, origin) {
  if (!text) return [];
  const originUrl = new URL(origin);
  const seen = new Set();
  const out = [];
  // Match absolute http(s) URLs anywhere in the skill's output.
  const re = /https?:\/\/[^\s)<>"']+/gi;
  let m;
  while ((m = re.exec(text))) {
    let u;
    try { u = new URL(m[0]); } catch { continue; }
    if (u.origin !== originUrl.origin) continue;     // same-origin only
    const norm = u.href.replace(/#.*$/, "");          // drop fragment
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export async function discoverWithSeoSitemap({ origin, runSkill, isInstalled, log }) {
  if (!(await isInstalled())) {
    log("claude-seo seo-sitemap skill not installed. Install: /plugin marketplace add AgricIDaniel/claude-seo. Falling back to menu-reachable discovery.");
    return { source: "unavailable", urls: [] };
  }
  const raw = await runSkill(origin);
  const urls = parseSeoSitemapOutput(raw, origin);
  return { source: "seo-sitemap", urls };
}

function nodeExec(cmd, args) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { encoding: "utf8" });
    let stdout = "", stderr = "";
    child.stdout?.on("data", (d) => { stdout += d; });
    child.stderr?.on("data", (d) => { stderr += d; });
    child.on("error", () => resolve({ code: 1, stdout, stderr: stderr || "spawn error" }));
    child.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

export function defaultSeoSitemapRunner({ execImpl } = {}) {
  const exec = execImpl || nodeExec;

  async function isInstalled() {
    // Probe for the seo-sitemap skill. The exact discovery command depends on
    // how claude-seo is installed in this environment; adjust the probe to your
    // setup (see NOTE in the plan). Treat exit 0 + mention of the skill as ready.
    const { code, stdout } = await exec("claude", ["skill", "list"]);
    return code === 0 && /seo-sitemap/i.test(stdout);
  }

  async function runSkill(origin) {
    // Invoke seo-sitemap Mode 1 for this origin and return its stdout. The exact
    // CLI form is environment-specific; the injected execImpl keeps it swappable.
    const { stdout } = await exec("claude", [
      "skill", "run", "seo-sitemap",
      "--mode", "analyze-existing-sitemap",
      "--site", origin,
    ]);
    return stdout;
  }

  return { isInstalled, runSkill };
}

// NOTE for the implementer: the `claude skill list` / `claude skill run` invocation above is a
// placeholder for *how* claude-seo exposes `seo-sitemap` in this DDEV environment. Before relying
// on it, confirm the real entry point: check the claude-seo plugin's `seo-sitemap` skill for its
// documented CLI (it may be a Python script under the plugin dir, e.g.
// `python3 .../seo-sitemap/scripts/analyze_sitemap.py <url>`, rather than a `claude skill run`
// subcommand). Update `isInstalled`/`runSkill` to match; the parser and pipeline do not change.
// This is the design's open question #3 ("whether claude-seo is added as a DDEV-Canvas addon
// dependency or installed by the migration addon's own installer") — resolve it here.
