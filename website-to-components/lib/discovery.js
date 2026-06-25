// website-to-components/lib/discovery.js
//
// Routes a resolved scope to a concrete list of page URLs. Pure: all I/O is
// injected so it is unit-testable without network.

import { discoverSiteUrls } from "../jobs/00b-sitemap-xml.js";

export async function resolveDiscovery({ scope, origin, fetchXml, listMenuPages, homepageUrl, log, validateUrls }) {
  if (scope === "homepage") {
    return { pages: [homepageUrl], source: "homepage" };
  }
  if (scope === "menus") {
    return { pages: await listMenuPages(), source: "menus" };
  }
  // scope === "site": discover via sitemap.xml → robots → menu fallback (unchanged).
  const result = await discoverSiteUrls({ origin, fetchXml, listMenuPages, log });
  // If we got a sitemap (not menu fallback) and a validateUrls fn is provided,
  // post-filter the URL list over HTTP (drops redirected/noindex/non-canonical).
  // Wrapped in try/catch: a throwing validateUrls must NOT abort the run.
  if (validateUrls && result.source === "sitemap") {
    try {
      const validated = await validateUrls(result.urls);
      return { pages: validated, source: "sitemap-validated" };
    } catch (e) {
      log("validateUrls failed (" + e.message + "); using unvalidated sitemap URLs.");
    }
  }
  return { pages: result.urls, source: result.source };
}
