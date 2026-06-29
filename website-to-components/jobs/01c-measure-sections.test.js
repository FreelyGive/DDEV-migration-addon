import { test } from "node:test";
import assert from "node:assert/strict";
import { parseMeasureResult, MEASURE_JS } from "./01c-measure-sections.js";

// Regression guard for the two bugs that made DOM section measurement silently
// fail on every run — which forced the vision step to estimate section bounds
// off the downscaled screenshot, producing merged/bleeding section crops.

// Bug #1: MEASURE_JS used an arrow-function IIFE `(() => {…}())`. `agent-browser
// eval` cannot parse that form — it throws `SyntaxError: Unexpected token '('`.
// Only the `function`-keyword IIFE `(function(){…}())` parses. If someone
// "modernizes" this back to an arrow IIFE, measurement breaks again silently.
test("MEASURE_JS uses a function-keyword IIFE (agent-browser eval can't parse an arrow IIFE)", () => {
  assert.ok(
    MEASURE_JS.trimStart().startsWith("(function"),
    "MEASURE_JS must be a `(function () { … }())` IIFE — agent-browser eval throws SyntaxError on `(() => {…}())`",
  );
  assert.ok(
    !/^\(\s*\(\s*\)\s*=>/.test(MEASURE_JS.trimStart()),
    "MEASURE_JS must NOT be an arrow-function IIFE",
  );
});

// Bug #2: the page script returns a JSON string and agent-browser JSON-encodes
// the return value, so stdout is DOUBLE-encoded. A single JSON.parse left a
// string whose `.sections` was undefined → "No reliable DOM sections" on a
// successful measurement. parseMeasureResult must unwrap both layers.
test("parseMeasureResult unwraps a double-JSON-encoded result", () => {
  const obj = { pageWidth: 1440, pageHeight: 3346, sections: [{ y: 0, height: 455 }] };
  const doubleEncoded = JSON.stringify(JSON.stringify(obj)); // what stdout actually contains
  const parsed = parseMeasureResult(doubleEncoded);
  assert.equal(typeof parsed, "object");
  assert.equal(parsed.pageWidth, 1440);
  assert.equal(parsed.sections.length, 1);
});

test("parseMeasureResult also accepts a single-encoded object (forward-compatible)", () => {
  const obj = { pageWidth: 1440, sections: [] };
  const parsed = parseMeasureResult(JSON.stringify(obj));
  assert.equal(parsed.pageWidth, 1440);
  assert.ok(Array.isArray(parsed.sections));
});

test("parseMeasureResult returns measure-failed on unparseable / empty input", () => {
  assert.equal(parseMeasureResult("").error, "measure-failed");
  assert.equal(parseMeasureResult("✗ Evaluation error: SyntaxError").error, "measure-failed");
  // A bare JSON string that is not an object must also be treated as a failure,
  // not silently accepted as a "result".
  assert.equal(parseMeasureResult(JSON.stringify("just a string")).error, "measure-failed");
});
