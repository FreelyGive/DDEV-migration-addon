// Pure-JS image helpers — no native binaries, identical on every OS.
//
// Replaces the `sharp` (libvips) dependency, whose native module must be
// compiled/installed per-platform and routinely fails on the host outside the
// ddev container. Every image this pipeline manipulates is a PNG screenshot, so
// pngjs covers the crop/resize/read-write ops. Dimension probing also runs over
// arbitrary downloaded assets (jpg/webp/gif/svg/avif), so that one path uses
// `image-size`, which reads dimensions from file headers without decoding.
//
// Supported ops (the entire sharp surface this repo used): imageSize, cropPng,
// resizePngFill, readPng, writePng.

import { readFileSync, writeFileSync } from "fs";
import { PNG } from "pngjs";
import { imageSize as headerImageSize } from "image-size";

/**
 * Width/height of any common raster/vector image, read from its header.
 * Works for PNG/JPEG/WebP/GIF/SVG/AVIF. Returns null on unreadable/unknown
 * input (callers already treat missing dimensions as "skip"), matching the
 * old `sharp(...).metadata()` + try/catch behaviour.
 */
export function imageSize(filePath) {
  try {
    const { width, height } = headerImageSize(readFileSync(filePath));
    if (!width || !height) return null;
    return { width, height };
  } catch {
    return null;
  }
}

/** Decode a PNG file into a pngjs object ({ width, height, data }). */
export function readPng(filePath) {
  return PNG.sync.read(readFileSync(filePath));
}

/** Encode a pngjs object and write it to disk. */
export function writePng(filePath, png) {
  writeFileSync(filePath, PNG.sync.write(png));
}

/**
 * Crop a rectangular region out of a PNG and write it to `outPath`.
 * Equivalent to sharp(src).extract({ left, top, width, height }).toFile(out).
 * The region is clamped to the source bounds so an over-tall request can't throw.
 */
export function cropPng(srcPath, { left, top, width, height }, outPath) {
  const src = readPng(srcPath);
  const x = clampInt(left, 0, src.width);
  const y = clampInt(top, 0, src.height);
  const w = clampInt(width, 0, src.width - x);
  const h = clampInt(height, 0, src.height - y);
  const out = new PNG({ width: w, height: h });
  // PNG.bitblt(src, dst, srcX, srcY, w, h, dstX, dstY)
  PNG.bitblt(src, out, x, y, w, h, 0, 0);
  writePng(outPath, out);
  return { width: w, height: h };
}

/**
 * Resize a PNG to exactly (targetW × targetH), stretching to fill — the
 * equivalent of sharp(src).resize(w, h, { fit: "fill" }).toFile(out).
 * Uses nearest-neighbour sampling; this output is only ever fed to pixelmatch
 * for section diffing, where exact dimension match matters and interpolation
 * quality does not.
 */
export function resizePngFill(srcPath, targetW, targetH, outPath) {
  const src = readPng(srcPath);
  const tw = Math.max(1, Math.round(targetW));
  const th = Math.max(1, Math.round(targetH));
  const out = new PNG({ width: tw, height: th });
  const xRatio = src.width / tw;
  const yRatio = src.height / th;
  for (let dy = 0; dy < th; dy++) {
    const sy = Math.min(src.height - 1, Math.floor(dy * yRatio));
    for (let dx = 0; dx < tw; dx++) {
      const sx = Math.min(src.width - 1, Math.floor(dx * xRatio));
      const sIdx = (src.width * sy + sx) << 2;
      const dIdx = (tw * dy + dx) << 2;
      out.data[dIdx] = src.data[sIdx];
      out.data[dIdx + 1] = src.data[sIdx + 1];
      out.data[dIdx + 2] = src.data[sIdx + 2];
      out.data[dIdx + 3] = src.data[sIdx + 3];
    }
  }
  writePng(outPath, out);
  return { width: tw, height: th };
}

function clampInt(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Math.round(Number(n))));
}
