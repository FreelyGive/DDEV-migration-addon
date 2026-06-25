import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveScope } from "../lib/scope.js";

test("explicit --scope flag wins, no prompt", async () => {
  let prompted = false;
  const scope = await resolveScope({
    argv: ["node", "clone", "https://x.com", "--scope", "site"],
    isTTY: true,
    prompt: async () => { prompted = true; return "homepage"; },
  });
  assert.equal(scope, "site");
  assert.equal(prompted, false);
});

test("no flag + TTY prompts and maps numeric choice", async () => {
  const scope = await resolveScope({
    argv: ["node", "clone", "https://x.com"],
    isTTY: true,
    prompt: async () => "2",
  });
  assert.equal(scope, "menus");
});

test("no flag + non-TTY defaults to homepage", async () => {
  const scope = await resolveScope({
    argv: ["node", "clone", "https://x.com"],
    isTTY: false,
    prompt: async () => { throw new Error("must not prompt"); },
  });
  assert.equal(scope, "homepage");
});

test("invalid explicit scope throws", async () => {
  await assert.rejects(
    () => resolveScope({ argv: ["x", "y", "z", "--scope", "bogus"], isTTY: false, prompt: async () => "" }),
    /invalid scope/i,
  );
});
