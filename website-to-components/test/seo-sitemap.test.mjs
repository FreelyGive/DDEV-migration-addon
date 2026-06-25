import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSeoSitemapOutput, validateSitemapUrls } from "../lib/seo-sitemap.js";

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

// Helper: build a fake Response-like object
const resp = ({ status = 200, finalUrl, headers = {}, body = "" }) => ({
  status,
  url: finalUrl,
  headers: { get: (k) => headers[k.toLowerCase()] ?? null },
  text: async () => body,
});

test("validateSitemapUrls keeps a 200, same-final-url, no-noindex, self-canonical URL", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: url, body: `<link rel="canonical" href="${url}">` });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, ["https://example.com/page"]);
});

test("validateSitemapUrls drops a 404", async () => {
  const fetchImpl = async (url) => resp({ status: 404, finalUrl: url });
  const result = await validateSitemapUrls(["https://example.com/missing"], { fetchImpl });
  assert.deepEqual(result, []);
});

test("validateSitemapUrls drops a redirected URL (final url differs)", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: "https://example.com/other" });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, []);
});

test("validateSitemapUrls drops a X-Robots-Tag: noindex URL", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: url, headers: { "x-robots-tag": "noindex" } });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, []);
});

test("validateSitemapUrls drops a URL whose <meta name=robots content=noindex> is in the body", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: url, body: '<meta name="robots" content="noindex, nofollow">' });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, []);
});

test("validateSitemapUrls drops a URL whose <link rel=canonical> points elsewhere", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: url, body: '<link rel="canonical" href="https://example.com/other">' });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, []);
});

test("validateSitemapUrls drops a URL whose fetch throws", async () => {
  const fetchImpl = async () => { throw new Error("network error"); };
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, []);
});

test("validateSitemapUrls requests with redirect:manual", async () => {
  let seenOpts = null;
  const fetchImpl = async (url, opts) => { seenOpts = opts; return resp({ status: 200, finalUrl: url }); };
  await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.equal(seenOpts?.redirect, "manual");
});

test("validateSitemapUrls keeps a URL with no canonical tag", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: url, body: "<html><body>no canonical here</body></html>" });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, ["https://example.com/page"]);
});

test("validateSitemapUrls keeps a URL whose relative canonical resolves to itself", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: url, body: '<link rel="canonical" href="/page">' });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, ["https://example.com/page"]);
});

test("validateSitemapUrls drops a URL whose relative canonical points elsewhere", async () => {
  const fetchImpl = async (url) => resp({ status: 200, finalUrl: url, body: '<link rel="canonical" href="/other">' });
  const result = await validateSitemapUrls(["https://example.com/page"], { fetchImpl });
  assert.deepEqual(result, []);
});
