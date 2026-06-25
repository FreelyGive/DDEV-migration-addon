// website-to-components/test/push-local.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { pushToLocal } from "../lib/push-local.js";

const env = {
  CANVAS_LOCAL_SITE_URL: "https://p.ddev.site",
  CANVAS_LOCAL_CLIENT_ID: "canvas-ai",
  CANVAS_LOCAL_CLIENT_SECRET: "s",
};

function clientStub() {
  const calls = { menuLinks: [], pages: [] };
  return {
    calls,
    bundleHasRevisions: async () => true,
    findPageByPath: async () => null,
    createPage: async (p) => { calls.pages.push(p.path); return { id: "n-" + p.path }; },
    updatePage: async (id) => ({ id }),
    upsertMenuLink: async (l) => { calls.menuLinks.push(l.title); return { id: "m" }; },
    getToken: async () => "tok",
  };
}

test("pushes components, then menus, then pages; reports review URL", async () => {
  const order = [];
  const client = clientStub();
  const res = await pushToLocal({
    env,
    menus: { main: [{ label: "Home", path: "/", href: "/" }], footer: [], sidebar: [] },
    pages: [{ title: "Home", path: "/" }],
    runCanvasPush: async () => { order.push("components"); },
    client,
    log: () => {},
  });
  order.push("menus:" + client.calls.menuLinks.length, "pages:" + client.calls.pages.length);
  assert.equal(res.ok, true);
  assert.deepEqual(order, ["components", "menus:1", "pages:1"]);
  assert.match(res.report, /https:\/\/p\.ddev\.site/);
});

test("aborts when env not ready", async () => {
  const res = await pushToLocal({
    env: {},
    menus: { main: [], footer: [], sidebar: [] },
    pages: [],
    runCanvasPush: async () => { throw new Error("must not push"); },
    client: clientStub(),
    log: () => {},
  });
  assert.equal(res.ok, false);
  assert.match(res.report, /CANVAS_LOCAL_SITE_URL/);
});
