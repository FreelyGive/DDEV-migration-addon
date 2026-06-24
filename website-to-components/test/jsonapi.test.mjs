// website-to-components/test/jsonapi.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeClient } from "../lib/jsonapi.js";

function fakeFetch(routes) {
  return async (url, opts = {}) => {
    const key = `${opts.method || "GET"} ${new URL(url).pathname}`;
    const handler = routes[key];
    if (!handler) throw new Error(`no fake route for ${key}`);
    let body = null;
    if (opts.body) {
      const ct = (opts.headers && (opts.headers["Content-Type"] || opts.headers["content-type"])) || "";
      if (ct.includes("application/json")) {
        body = JSON.parse(opts.body);
      } else {
        try { body = JSON.parse(opts.body); } catch { body = opts.body; }
      }
    }
    const res = handler(body);
    return { ok: true, status: res.status || 200, json: async () => res.json };
  };
}

const base = { siteUrl: "https://p.ddev.site/", prefix: "jsonapi", clientId: "canvas-ai", clientSecret: "s" };

test("getToken posts client_credentials and returns access_token", async () => {
  const client = makeClient({ ...base, fetchImpl: fakeFetch({
    "POST /oauth/token": () => ({ json: { access_token: "tok123" } }),
  })});
  assert.equal(await client.getToken("member"), "tok123");
});

test("findPageByPath returns null when none match", async () => {
  const client = makeClient({ ...base, fetchImpl: fakeFetch({
    "POST /oauth/token": () => ({ json: { access_token: "t" } }),
    "GET /jsonapi/node/page": () => ({ json: { data: [] } }),
  })});
  assert.equal(await client.findPageByPath("/about"), null);
});

test("bundleHasRevisions reads new_revision flag", async () => {
  const client = makeClient({ ...base, fetchImpl: fakeFetch({
    "POST /oauth/token": () => ({ json: { access_token: "t" } }),
    "GET /jsonapi/node_type/node_type": () => ({ json: { data: [{ attributes: { drupal_internal__type: "page", new_revision: true } }] } }),
  })});
  assert.equal(await client.bundleHasRevisions("page"), true);
});
