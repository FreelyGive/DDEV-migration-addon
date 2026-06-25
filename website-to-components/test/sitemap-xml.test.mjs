// website-to-components/test/sitemap-xml.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSitemapXml, discoverSiteUrls } from "../jobs/00b-sitemap-xml.js";

test("parseSitemapXml extracts loc URLs", () => {
  const xml = `<?xml version="1.0"?><urlset><url><loc>https://x.com/</loc></url><url><loc>https://x.com/about</loc></url></urlset>`;
  assert.deepEqual(parseSitemapXml(xml), ["https://x.com/", "https://x.com/about"]);
});

test("discoverSiteUrls uses sitemap.xml when present", async () => {
  const res = await discoverSiteUrls({
    origin: "https://x.com",
    fetchXml: async (p) => p === "/sitemap.xml"
      ? `<urlset><url><loc>https://x.com/a</loc></url></urlset>` : null,
    listMenuPages: async () => { throw new Error("should not fall back"); },
    log: () => {},
  });
  assert.equal(res.source, "sitemap");
  assert.deepEqual(res.urls, ["https://x.com/a"]);
});

test("discoverSiteUrls falls back to menus + warns when no sitemap", async () => {
  let warned = "";
  const res = await discoverSiteUrls({
    origin: "https://x.com",
    fetchXml: async () => null,
    listMenuPages: async () => ["https://x.com/", "https://x.com/about"],
    log: (m) => { warned = m; },
  });
  assert.equal(res.source, "menus");
  assert.equal(res.urls.length, 2);
  assert.match(warned, /No sitemap\.xml found/i);
});
