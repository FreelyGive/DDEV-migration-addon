import { test } from "node:test";
import assert from "node:assert/strict";
import { checkLocalReady } from "../lib/bootstrap-check.js";

const full = {
  CANVAS_LOCAL_SITE_URL: "https://p.ddev.site",
  CANVAS_LOCAL_CLIENT_ID: "canvas-ai",
  CANVAS_LOCAL_CLIENT_SECRET: "s",
};

test("reports each missing env var", async () => {
  const res = await checkLocalReady({ env: {}, probeToken: async () => "t" });
  assert.equal(res.ok, false);
  assert.ok(res.problems.some(p => /CANVAS_LOCAL_SITE_URL/.test(p)));
  assert.ok(res.problems.some(p => /CANVAS_LOCAL_CLIENT_ID/.test(p)));
  assert.ok(res.problems.some(p => /CANVAS_LOCAL_CLIENT_SECRET/.test(p)));
});

test("fails with guidance when token probe fails", async () => {
  const res = await checkLocalReady({ env: full, probeToken: async () => null });
  assert.equal(res.ok, false);
  assert.ok(res.problems.some(p => /OAuth|401|client/i.test(p)));
});

test("ok when env present and token obtained", async () => {
  const res = await checkLocalReady({ env: full, probeToken: async () => "tok" });
  assert.equal(res.ok, true);
  assert.deepEqual(res.problems, []);
});
