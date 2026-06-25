// website-to-components/jobs/00b-sitemap-xml.js
//
// Whole-site discovery. Sitemap parsing and menu-reachable fallback.
// HTTP-200/canonical/noindex validation is handled by validateSitemapUrls
// (lib/seo-sitemap.js) at the call site, keeping this module unit-testable
// without network access.

export function parseSitemapXml(xml) {
  if (!xml) return [];
  const out = [];
  const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1]);
  return out;
}

function parseRobotsSitemap(txt) {
  if (!txt) return null;
  const m = txt.match(/^\s*Sitemap:\s*(\S+)/im);
  return m ? m[1] : null;
}

export function isSitemapIndex(xml) {
  return /<sitemapindex[\s>]/i.test(xml || "");
}

export async function discoverSiteUrls({ origin, fetchXml, listMenuPages, log }) {
  for (const path of ["/sitemap.xml", "/sitemap_index.xml"]) {
    const xml = await fetchXml(path);
    if (!xml) continue;
    if (isSitemapIndex(xml)) {
      const childLocs = parseSitemapXml(xml); // <loc> entries are child sitemaps
      const all = [];
      for (const child of childLocs) {
        const childPath = child.startsWith("http") ? new URL(child).pathname : child;
        const childXml = await fetchXml(childPath);
        all.push(...parseSitemapXml(childXml));
      }
      if (all.length) return { source: "sitemap", urls: all };
      continue;
    }
    const urls = parseSitemapXml(xml);
    if (urls.length) return { source: "sitemap", urls };
  }
  const robots = await fetchXml("/robots.txt");
  const ref = parseRobotsSitemap(robots);
  if (ref) {
    const refPath = ref.startsWith("http") ? new URL(ref).pathname : ref;
    const xml = await fetchXml(refPath);
    const urls = parseSitemapXml(xml);
    if (urls.length) return { source: "sitemap", urls };
  }
  const menuUrls = await listMenuPages();
  log("No sitemap.xml found. Migrating " + menuUrls.length + " pages reachable from menus instead.");
  return { source: "menus", urls: menuUrls };
}
