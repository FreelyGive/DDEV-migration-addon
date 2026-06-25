import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeoSitemapOutput, discoverWithSeoSitemap } from "../lib/seo-sitemap.js";

test("parseSeoSitemapOutput extracts same-origin URLs and dedupes", () => {
  const text = [
    "Validated URLs (HTTP 200, indexable):",
    "- https://example.com/",
    "- https://example.com/about",
    "- https://example.com/about",          // duplicate
    "- https://other.com/x",                // different origin — dropped
    "noise line without a url",
  ].join("\n");
  const urls = parseSeoSitemapOutput(text, "https://example.com");
  assert.deepEqual(urls, ["https://example.com/", "https://example.com/about"]);
});

test("discoverWithSeoSitemap returns unavailable when skill not installed", async () => {
  const logs = [];
  const res = await discoverWithSeoSitemap({
    origin: "https://example.com",
    isInstalled: async () => false,
    runSkill: async () => { throw new Error("should not run"); },
    log: (m) => logs.push(m),
  });
  assert.equal(res.source, "unavailable");
  assert.deepEqual(res.urls, []);
  assert.ok(logs.some((m) => /claude-seo/i.test(m)));
});

test("discoverWithSeoSitemap returns parsed urls when installed", async () => {
  const res = await discoverWithSeoSitemap({
    origin: "https://example.com",
    isInstalled: async () => true,
    runSkill: async () => "- https://example.com/\n- https://example.com/pricing",
    log: () => {},
  });
  assert.equal(res.source, "seo-sitemap");
  assert.deepEqual(res.urls, ["https://example.com/", "https://example.com/pricing"]);
});
