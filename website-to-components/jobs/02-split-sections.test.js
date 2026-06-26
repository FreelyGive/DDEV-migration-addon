import { test } from "node:test";
import assert from "node:assert/strict";
import { validateSections } from "./02-split-sections.js";

const W = 1440;
const H = 2000;

// A well-formed section now MUST carry a non-empty seamProbe describing the
// native-res strip that was read across its boundary. This is the parser-side
// enforcement of the skill's seam-probe gate: skip the probe → crop job fails.

test("rejects a section with no seamProbe", () => {
  const sections = [
    { label: "Hero", y: 0, height: 900, width: W, reason: "r", seamProbe: "top y=0 page edge; bottom y=900 blank band" },
    { label: "Features", y: 900, height: 700, width: W, reason: "r" }, // missing seamProbe
  ];
  assert.throws(
    () => validateSections(sections, H, W),
    /seam-probe/i,
    "expected validateSections to throw when a section lacks seamProbe",
  );
});

test("rejects a section with an empty/whitespace seamProbe", () => {
  const sections = [
    { label: "Hero", y: 0, height: 900, width: W, reason: "r", seamProbe: "   " },
  ];
  assert.throws(() => validateSections(sections, H, W), /seam-probe/i);
});

test("accepts sections that all carry a non-empty seamProbe", () => {
  const sections = [
    { label: "Hero", y: 0, height: 900, width: W, reason: "r", seamProbe: "top y=0 page edge; bottom y=900 blank band" },
    { label: "Features", y: 900, height: 700, width: W, reason: "r", seamProbe: "top y=900 DOM edge, blank; bottom y=1600 shadows end y=1585" },
  ];
  assert.doesNotThrow(() => validateSections(sections, H, W));
  const { sections: out } = validateSections(sections, H, W);
  assert.equal(out.length, 2);
});
