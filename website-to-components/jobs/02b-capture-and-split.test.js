import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PNG } from "pngjs";
import { writeFileSync } from "fs";
import { mergeNavIntoHero, mergeTailFragments, verifyCrop } from "./02b-capture-and-split.js";

// ---- mergeNavIntoHero: the one universal structural merge (navbar + hero) ----

test("mergeNavIntoHero folds a top nav block into the hero below it", () => {
  const secs = [
    { y: 0, bottom: 132, height: 132, tag: "nav", hasHeading: false },
    { y: 132, bottom: 537, height: 405, tag: "section", hasHeading: true },
    { y: 537, bottom: 900, height: 363, tag: "section", hasHeading: true },
  ];
  const out = mergeNavIntoHero(secs);
  assert.equal(out.length, 2);
  assert.equal(out[0].y, 0);
  assert.equal(out[0].bottom, 537);
  assert.equal(out[0].tag, "header");
});

test("mergeNavIntoHero leaves sections alone when the first block is not a top nav", () => {
  const secs = [
    { y: 0, bottom: 600, height: 600, tag: "section", hasHeading: true },
    { y: 600, bottom: 900, height: 300, tag: "section", hasHeading: true },
  ];
  assert.deepEqual(mergeNavIntoHero(secs), secs);
});

// ---- mergeTailFragments: headingless short tails fold into the section above ----

test("a short headingless block (lone CTA button) merges into the previous section", () => {
  const secs = [
    { y: 0, bottom: 500, height: 500, tag: "section", hasHeading: true },     // Nos actualités
    { y: 500, bottom: 600, height: 100, tag: "div", hasHeading: false },      // "Découvrir" button tail
    { y: 600, bottom: 1000, height: 400, tag: "section", hasHeading: true },
  ];
  const out = mergeTailFragments(secs);
  assert.equal(out.length, 2);
  assert.equal(out[0].bottom, 600, "tail folded into the actualités section");
  assert.equal(out[0]._merged, "tail");
});

test("a short block WITH its own heading is a real compact section — not merged", () => {
  const secs = [
    { y: 0, bottom: 500, height: 500, tag: "section", hasHeading: true },
    { y: 500, bottom: 620, height: 120, tag: "section", hasHeading: true },   // compact CTA band w/ heading
  ];
  const out = mergeTailFragments(secs);
  assert.equal(out.length, 2, "compact-but-headed section is preserved");
});

test("a tall headingless block is NOT a fragment — left alone", () => {
  const secs = [
    { y: 0, bottom: 500, height: 500, tag: "section", hasHeading: true },
    { y: 500, bottom: 900, height: 400, tag: "div", hasHeading: false },      // tall, no heading (image band)
  ];
  assert.equal(mergeTailFragments(secs).length, 2);
});

test("a footer is never merged away, even if short and headingless", () => {
  const secs = [
    { y: 0, bottom: 500, height: 500, tag: "section", hasHeading: true },
    { y: 500, bottom: 600, height: 100, tag: "footer", hasHeading: false },
  ];
  assert.equal(mergeTailFragments(secs).length, 2);
});

// ---- verifyCrop: blank detection + sliced-vs-clean-band edge discrimination ----

function makePng(rows) {
  // rows: function(x,y)->[r,g,b]; size from caller
  return rows;
}
function writeTestPng(path, w, h, paint) {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      const [r, g, b] = paint(x, y);
      png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
    }
  }
  writeFileSync(path, PNG.sync.write(png));
}

const TMP = mkdtempSync(join(tmpdir(), "verifycrop-"));

test("verifyCrop flags an essentially blank section", () => {
  const p = join(TMP, "blank.png");
  writeTestPng(p, 200, 120, () => [255, 255, 255]); // all white
  const v = verifyCrop(p);
  assert.equal(v.ok, false);
  assert.match(v.reason, /blank/);
});

test("verifyCrop passes a clean cut into a SOLID colour band (busy but not choppy)", () => {
  const p = join(TMP, "band.png");
  // White bg corners; top rows a solid dark band (high ink, ~0 horizontal flips).
  writeTestPng(p, 300, 200, (x, y) => (y < 40 ? [40, 30, 30] : [255, 255, 255]));
  const v = verifyCrop(p);
  assert.equal(v.ok, true, `solid band should pass; got ${v.reason}`);
});

test("verifyCrop flags a top edge that slices TEXT (busy AND choppy)", () => {
  const p = join(TMP, "text.png");
  // Top ~20 rows alternate ink/background every few px → high chop (like cut
  // text at the boundary). Body has normal mid-section content so it isn't blank.
  writeTestPng(p, 300, 200, (x, y) => {
    if (y < 20) return (Math.floor(x / 4) % 2 === 0) ? [10, 10, 10] : [255, 255, 255];
    if (y > 90 && y < 110 && Math.floor(x / 6) % 2 === 0) return [0, 0, 0];
    return [255, 255, 255];
  });
  const v = verifyCrop(p);
  assert.equal(v.ok, false);
  assert.match(v.reason, /top edge slices/);
});

test("verifyCrop passes a normal section (calm edges, content in the middle)", () => {
  const p = join(TMP, "normal.png");
  writeTestPng(p, 300, 200, (x, y) => {
    // calm white near both edges; some text-like content only in the middle band
    if (y > 80 && y < 120 && Math.floor(x / 5) % 2 === 0) return [0, 0, 0];
    return [255, 255, 255];
  });
  const v = verifyCrop(p);
  assert.equal(v.ok, true, `normal section should pass; got ${v.reason}`);
});
