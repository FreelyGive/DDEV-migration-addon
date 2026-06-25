// website-to-components/test/push-pages.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushPages } from "../lib/push-pages.js";

function clientStub({ existing = {}, revisions = true }) {
  return {
    bundleHasRevisions: async () => revisions,
    findPageByPath: async (p) => existing[p] ? { id: existing[p], path: p } : null,
    createPage: async ({ path }) => ({ id: "new-" + path }),
    updatePage: async (id) => ({ id }),
  };
}

test("creates new pages, updates existing when revisions on", async () => {
  const log = [];
  const res = await pushPages({
    client: clientStub({ existing: { "/about": "id-about" }, revisions: true }),
    pages: [{ title: "Home", path: "/" }, { title: "About", path: "/about" }],
    log: (m) => log.push(m),
  });
  assert.deepEqual(res.created, ["/"]);
  assert.deepEqual(res.updated, ["/about"]);
  assert.deepEqual(res.skipped, []);
});

test("skips existing + warns when revisions off; still creates new", async () => {
  const log = [];
  const res = await pushPages({
    client: clientStub({ existing: { "/about": "id-about" }, revisions: false }),
    pages: [{ title: "Home", path: "/" }, { title: "About", path: "/about" }],
    log: (m) => log.push(m),
  });
  assert.deepEqual(res.created, ["/"]);
  assert.deepEqual(res.skipped, ["/about"]);
  assert.deepEqual(res.updated, []);
  assert.ok(log.some(m => /revisions disabled/i.test(m)));
});
