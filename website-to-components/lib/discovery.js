// website-to-components/lib/discovery.js
//
// Routes a resolved scope to a concrete list of page URLs. Pure: all I/O is
// injected so it is unit-testable without network.

import { discoverSiteUrls } from "../jobs/00b-sitemap-xml.js";

export async function resolveDiscovery({ scope, origin, fetchXml, listMenuPages, homepageUrl, log, seoSitemap }) {
  if (scope === "homepage") {
    return { pages: [homepageUrl], source: "homepage" };
  }
  if (scope === "menus") {
    return { pages: await listMenuPages(), source: "menus" };
  }
  // scope === "site": prefer seo-sitemap when available and returns urls
  if (seoSitemap) {
    const seo = await seoSitemap();
    if (seo.source === "seo-sitemap" && seo.urls.length > 0) {
      return { pages: seo.urls, source: "seo-sitemap" };
    }
  }
  // fall back to raw sitemap.xml parse → robots → menu-reachable
  const result = await discoverSiteUrls({ origin, fetchXml, listMenuPages, log });
  return { pages: result.urls, source: result.source };
}
