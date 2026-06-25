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
