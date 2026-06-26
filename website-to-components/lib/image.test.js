import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { PNG } from "pngjs";
import { imageSize, cropPng, resizePngFill, readPng, writePng } from "./image.js";

const tmp = mkdtempSync(join(tmpdir(), "imgtest-"));

// Build a deterministic test PNG: 40x30, left half red, right half blue.
function makeSrc() {
  const w = 40, h = 30;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (w * y + x) << 2;
      const left = x < w / 2;
      png.data[i] = left ? 255 : 0;       // R
      png.data[i + 1] = 0;                // G
      png.data[i + 2] = left ? 0 : 255;   // B
      png.data[i + 3] = 255;              // A
    }
  }
  const p = join(tmp, "src.png");
  writePng(p, png);
  return p;
}

test("imageSize reads PNG dimensions from header", () => {
  const p = makeSrc();
  assert.deepEqual(imageSize(p), { width: 40, height: 30 });
});

test("imageSize returns null for a missing/unreadable file", () => {
  assert.equal(imageSize(join(tmp, "nope.png")), null);
});

test("cropPng extracts the requested region", () => {
  const src = makeSrc();
  const out = join(tmp, "crop.png");
  const dims = cropPng(src, { left: 0, top: 0, width: 20, height: 30 }, out);
  assert.deepEqual(dims, { width: 20, height: 30 });
  const cropped = readPng(out);
  assert.equal(cropped.width, 20);
  // top-left pixel should be red (left half)
  assert.deepEqual([cropped.data[0], cropped.data[1], cropped.data[2]], [255, 0, 0]);
});

test("cropPng clamps an over-tall request to source bounds (no throw)", () => {
  const src = makeSrc();
  const out = join(tmp, "crop-clamp.png");
  const dims = cropPng(src, { left: 0, top: 10, width: 40, height: 9999 }, out);
  assert.deepEqual(dims, { width: 40, height: 20 }); // 30 - 10
});

test("resizePngFill produces exactly the target dimensions", () => {
  const src = makeSrc();
  const out = join(tmp, "resized.png");
  const dims = resizePngFill(src, 80, 15, out);
  assert.deepEqual(dims, { width: 80, height: 15 });
  const r = readPng(out);
  assert.equal(r.width, 80);
  assert.equal(r.height, 15);
});
