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

test("site scope prefers validateUrls result when sitemap is present", async () => {
  const validateUrls = async (urls) => urls.filter(u => u.includes("/a"));
  const res = await resolveDiscovery({
    ...common,
    scope: "site",
    fetchXml: async (p) => p === "/sitemap.xml" ? `<urlset><url><loc>https://x.com/a</loc></url><url><loc>https://x.com/b</loc></url></urlset>` : null,
    validateUrls,
  });
  assert.equal(res.source, "sitemap-validated");
  assert.deepEqual(res.pages, ["https://x.com/a"]);
});

test("site scope skips validateUrls when source is menus (no sitemap found)", async () => {
  // fetchXml returns null → source will be "menus"; validateUrls must NOT be called
  let called = false;
  const validateUrls = async (urls) => { called = true; return urls; };
  const res = await resolveDiscovery({ ...common, scope: "site", validateUrls });
  // fetchXml returns null so discoverSiteUrls falls back to menus
  assert.equal(res.source, "menus");
  assert.equal(res.pages.length, 2);
  assert.equal(called, false);
});

test("site scope falls back gracefully when validateUrls throws (does not abort the run)", async () => {
  const validateUrls = async () => { throw new Error("network boom"); };
  const res = await resolveDiscovery({
    ...common,
    scope: "site",
    fetchXml: async (p) => p === "/sitemap.xml" ? `<urlset><url><loc>https://x.com/a</loc></url></urlset>` : null,
    validateUrls,
  });
  // The throw must be caught and discovery must still resolve via unvalidated sitemap URLs.
  assert.equal(res.source, "sitemap");
  assert.deepEqual(res.pages, ["https://x.com/a"]);
});
