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
  // scope === "site": prefer seo-sitemap when available and returns urls.
  // Wrapped in try/catch so a throwing runner (e.g. the real claude-seo CLI
  // erroring) degrades to the fallback chain instead of aborting the whole run.
  if (seoSitemap) {
    try {
      const seo = await seoSitemap();
      if (seo && seo.source === "seo-sitemap" && seo.urls.length > 0) {
        return { pages: seo.urls, source: "seo-sitemap" };
      }
    } catch (e) {
      log("claude-seo discovery failed (" + e.message + "); falling back to sitemap.xml / menus.");
    }
  }
  // fall back to raw sitemap.xml parse → robots → menu-reachable
  const result = await discoverSiteUrls({ origin, fetchXml, listMenuPages, log });
  return { pages: result.urls, source: result.source };
}
