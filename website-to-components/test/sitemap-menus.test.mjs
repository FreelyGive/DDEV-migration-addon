// website-to-components/test/sitemap-menus.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { extractMenusFromSnapshot } from "../jobs/00-sitemap.js";

test("partitions links into main/footer/sidebar by region", () => {
  const links = [
    { region: "main", label: "Home", url: "https://x.com/" },
    { region: "main", label: "About", url: "https://x.com/about" },
    { region: "footer", label: "Privacy", url: "https://x.com/privacy" },
    { region: "sidebar", label: "Docs", url: "https://x.com/docs" },
  ];
  const menus = extractMenusFromSnapshot(links, "https://x.com");
  assert.deepEqual(menus.main.map(l => l.url), ["https://x.com/", "https://x.com/about"]);
  assert.deepEqual(menus.footer.map(l => l.url), ["https://x.com/privacy"]);
  assert.deepEqual(menus.sidebar.map(l => l.url), ["https://x.com/docs"]);
});

test("unknown region defaults to main", () => {
  const menus = extractMenusFromSnapshot([{ region: "header", label: "X", url: "https://x.com/x" }], "https://x.com");
  assert.equal(menus.main.length, 1);
  assert.equal(menus.footer.length, 0);
});
