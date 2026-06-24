// website-to-components/lib/discovery.js
//
// Routes a resolved scope to a concrete list of page URLs. Pure: all I/O is
// injected so it is unit-testable without network.

import { discoverSiteUrls } from "../jobs/00b-sitemap-xml.js";

export async function resolveDiscovery({ scope, origin, fetchXml, listMenuPages, homepageUrl, log }) {
  if (scope === "homepage") {
    return { pages: [homepageUrl], source: "homepage" };
  }
  if (scope === "menus") {
    return { pages: await listMenuPages(), source: "menus" };
  }
  // scope === "site"
  const result = await discoverSiteUrls({ origin, fetchXml, listMenuPages, log });
  return { pages: result.urls, source: result.source };
}
