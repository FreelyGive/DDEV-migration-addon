import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveSitemapPages } from "./00-sitemap.js";

const ORIGIN = "https://example.com";

// resolveSitemapPages must NEVER throw and NEVER exit — menu detection is
// best-effort discovery. Every failure mode degrades to a root-only sitemap
// (just the homepage) so the pipeline keeps going. This replaces the old
// process.exit(1) on an unparseable browser-eval result, which killed the run.

test("unparseable raw → root-only sitemap, flagged as fallback (no throw)", () => {
  // Empty string was the exact value that used to trigger process.exit(1).
  const r = resolveSitemapPages("", ORIGIN);
  assert.equal(r.pages.length, 1, "should still produce the homepage");
  assert.equal(r.pages[0].url, ORIGIN + "/");
  assert.equal(r.pages[0].label, "Home");
  assert.equal(r.fallback, true);
  assert.equal(r.reason, "menu-parse-failed");
  assert.equal(r.rootKind, null);
});

test("garbage / browser eval error text → root-only, no throw", () => {
  const r = resolveSitemapPages("✗ Evaluation error: SyntaxError: Unexpected token 'const'", ORIGIN);
  assert.equal(r.pages.length, 1);
  assert.equal(r.reason, "menu-parse-failed");
});

test("clean {error} payload → root-only with that reason", () => {
  const raw = JSON.stringify({ error: "no-main-nav-detected", candidates: 0 });
  const r = resolveSitemapPages(raw, ORIGIN);
  assert.equal(r.pages.length, 1);
  assert.equal(r.fallback, true);
  assert.equal(r.reason, "no-main-nav-detected");
});

test("double-encoded JSON string (agent-browser quoting) is still parsed", () => {
  const inner = JSON.stringify({ rootKind: "nav", pages: [
    { label: "About", url: ORIGIN + "/about", path: "/about" },
  ] });
  const r = resolveSitemapPages(JSON.stringify(inner), ORIGIN);
  assert.equal(r.fallback, false);
  assert.equal(r.reason, null);
  assert.equal(r.rootKind, "nav");
  assert.deepEqual(r.pages.map((p) => p.slug), ["home", "about"]);
});

test("successful detection → homepage + discovered pages, ordered, deduped of root", () => {
  const raw = JSON.stringify({
    rootKind: "nav",
    pages: [
      { label: "Home", url: ORIGIN + "/", path: "/" }, // root dupe — must be dropped
      { label: "About", url: ORIGIN + "/about", path: "/about" },
      { label: "Blog", url: ORIGIN + "/blog", path: "/blog" },
    ],
  });
  const r = resolveSitemapPages(raw, ORIGIN);
  assert.equal(r.fallback, false);
  assert.deepEqual(r.pages.map((p) => p.label), ["Home", "About", "Blog"]);
  assert.deepEqual(r.pages.map((p) => p.order), [0, 1, 2]);
  // The duplicate root from the nav must not appear twice.
  assert.equal(r.pages.filter((p) => p.url === ORIGIN + "/").length, 1);
});

test("parsed object with no pages array → root-only, no throw", () => {
  const r = resolveSitemapPages(JSON.stringify({ rootKind: "nav" }), ORIGIN);
  assert.equal(r.pages.length, 1);
  assert.equal(r.fallback, true);
});
