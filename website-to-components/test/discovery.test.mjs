// website-to-components/test/discovery.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveDiscovery } from "../lib/discovery.js";

const common = {
  origin: "https://x.com",
  homepageUrl: "https://x.com/",
  fetchXml: async () => null,
  listMenuPages: async () => ["https://x.com/", "https://x.com/about"],
  log: () => {},
};

test("homepage scope returns only the homepage, no network", async () => {
  let fetched = false;
  const res = await resolveDiscovery({ ...common, scope: "homepage", fetchXml: async () => { fetched = true; return null; } });
  assert.deepEqual(res.pages, ["https://x.com/"]);
  assert.equal(res.source, "homepage");
  assert.equal(fetched, false);
});

test("menus scope returns the menu-reachable list", async () => {
  const res = await resolveDiscovery({ ...common, scope: "menus" });
  assert.deepEqual(res.pages, ["https://x.com/", "https://x.com/about"]);
  assert.equal(res.source, "menus");
});

test("site scope uses sitemap when present", async () => {
  const res = await resolveDiscovery({
    ...common, scope: "site",
    fetchXml: async (p) => p === "/sitemap.xml" ? `<urlset><url><loc>https://x.com/a</loc></url></urlset>` : null,
  });
  assert.equal(res.source, "sitemap");
  assert.deepEqual(res.pages, ["https://x.com/a"]);
});

test("site scope with no sitemap falls back to menus", async () => {
  const res = await resolveDiscovery({ ...common, scope: "site" });
  assert.equal(res.source, "menus");
  assert.equal(res.pages.length, 2);
});

test("site scope prefers seo-sitemap when it returns urls", async () => {
  const seoSitemap = async () => ({ source: "seo-sitemap", urls: ["https://x.com/", "https://x.com/blog"] });
  const res = await resolveDiscovery({ ...common, scope: "site", seoSitemap });
  assert.equal(res.source, "seo-sitemap");
  assert.deepEqual(res.pages, ["https://x.com/", "https://x.com/blog"]);
});

test("site scope falls back to discoverSiteUrls when seoSitemap returns unavailable", async () => {
  const seoSitemap = async () => ({ source: "unavailable", urls: [] });
  const res = await resolveDiscovery({ ...common, scope: "site", seoSitemap });
  // fetchXml returns null so discoverSiteUrls falls back to menus
  assert.equal(res.source, "menus");
  assert.equal(res.pages.length, 2);
});
