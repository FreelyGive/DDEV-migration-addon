// website-to-components/lib/seo-sitemap.js
//
// Sitemap URL utilities: parse text output for same-origin URLs, and
// validate a list of sitemap URLs over HTTP (200/canonical/noindex checks).
// All I/O is injected so the module is unit-testable without network.

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

// Validate a list of sitemap URLs over HTTP. Pure: fetchImpl injected.
// fetchImpl(url, {redirect:"manual"}) must resolve to an object shaped like the
// global fetch Response: { status, url (final url), headers: {get(name)}, text() }.
// Keeps only URLs that: respond 200, did NOT redirect (final url === requested),
// are not noindex (X-Robots-Tag header or <meta name=robots ... noindex>),
// and whose <link rel=canonical> (if present) points to themselves.
// Returns the surviving URLs in input order. Network errors drop that URL.
export async function validateSitemapUrls(urls, { fetchImpl, log = () => {}, concurrency = 6 }) {
  const f = fetchImpl || globalThis.fetch;
  // simple bounded-concurrency map preserving input order
  let i = 0;
  const results = new Array(urls.length);
  async function worker() {
    while (i < urls.length) {
      const idx = i++; const url = urls[idx];
      results[idx] = await checkOne(f, url, log);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, urls.length) }, worker));
  const keep = [];
  for (let k = 0; k < urls.length; k++) if (results[k]) keep.push(urls[k]);
  return keep;
}

async function checkOne(f, url, log) {
  let res;
  try { res = await f(url, { redirect: "manual" }); }
  catch (e) { log(`drop ${url}: fetch error ${e.message}`); return false; }
  if (res.status !== 200) { log(`drop ${url}: status ${res.status}`); return false; }
  if (res.url && res.url !== url) { log(`drop ${url}: redirected to ${res.url}`); return false; }
  const xr = res.headers?.get?.("x-robots-tag") || "";
  if (/noindex/i.test(xr)) { log(`drop ${url}: X-Robots-Tag noindex`); return false; }
  let body = ""; try { body = await res.text(); } catch { body = ""; }
  if (/<meta[^>]+name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(body)) { log(`drop ${url}: meta noindex`); return false; }
  const canon = body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i);
  if (canon) {
    let c; try { c = new URL(canon[1], url).href; } catch { c = canon[1]; }
    if (c.replace(/#.*$/, "") !== url.replace(/#.*$/, "")) { log(`drop ${url}: canonical -> ${c}`); return false; }
  }
  return true;
}
