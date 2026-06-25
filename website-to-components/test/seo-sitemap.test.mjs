import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeoSitemapOutput, discoverWithSeoSitemap, defaultSeoSitemapRunner } from "../lib/seo-sitemap.js";

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

test("defaultSeoSitemapRunner.runSkill passes the origin to the skill and returns stdout", async () => {
  const calls = [];
  const execImpl = async (cmd, args) => {
    calls.push({ cmd, args });
    return { code: 0, stdout: "- https://example.com/\n", stderr: "" };
  };
  const runner = defaultSeoSitemapRunner({ execImpl });
  const out = await runner.runSkill("https://example.com");
  assert.equal(out, "- https://example.com/\n");
  assert.ok(calls.length === 1);
  // The origin must reach the underlying command somewhere in its argv/stdin.
  const joined = JSON.stringify(calls[0]);
  assert.ok(joined.includes("https://example.com"));
});

test("defaultSeoSitemapRunner.isInstalled reflects exec success", async () => {
  const ok = defaultSeoSitemapRunner({ execImpl: async () => ({ code: 0, stdout: "seo-sitemap", stderr: "" }) });
  assert.equal(await ok.isInstalled(), true);
  const no = defaultSeoSitemapRunner({ execImpl: async () => ({ code: 1, stdout: "", stderr: "not found" }) });
  assert.equal(await no.isInstalled(), false);
});
