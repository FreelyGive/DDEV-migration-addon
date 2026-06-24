import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeMenus, withUnbuiltLinksDisabled } from "../lib/menu.js";

const origin = "https://x.com";

test("normalizeMenus keeps same-origin, dedups, drops junk", () => {
  const menus = normalizeMenus({
    main: [
      { label: "Home", url: "https://x.com/" },
      { label: "About", url: "https://x.com/about" },
      { label: "About", url: "https://x.com/about#team" }, // dup path
      { label: "Twitter", url: "https://twitter.com/x" },  // external
      { label: "Mail", url: "mailto:a@x.com" },            // junk
    ],
    footer: [{ label: "Privacy", url: "https://x.com/privacy" }],
  }, origin);

  assert.deepEqual(menus.main.map(l => l.path), ["/", "/about"]);
  assert.deepEqual(menus.footer.map(l => l.path), ["/privacy"]);
  assert.deepEqual(menus.sidebar, []);
  assert.equal(menus.main[1].href, "/about");
});

test("withUnbuiltLinksDisabled rewrites unbuilt links to #", () => {
  const menus = { main: [{ label: "Home", path: "/", href: "/" }, { label: "About", path: "/about", href: "/about" }], footer: [], sidebar: [] };
  const out = withUnbuiltLinksDisabled(menus, new Set(["/"]));
  assert.equal(out.main[0].href, "/");
  assert.equal(out.main[1].href, "#");
});
