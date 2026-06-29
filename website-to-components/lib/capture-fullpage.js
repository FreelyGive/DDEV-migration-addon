// Robust full-page screenshot via deterministic scroll-and-stitch.
//
// WHY THIS EXISTS: `agent-browser screenshot --full` (and most engines' native
// full-page capture) breaks on common real-world pages:
//   - a position:fixed/sticky header repeats in every stitched slice,
//   - a fixed cookie/chat button floats over content at every scroll position,
//   - lazy-loaded content below the fold isn't painted when the capture fires,
//   - the engine may render --full at a different devicePixelRatio than the
//     viewport, so the image scale doesn't match DOM coordinates.
// The result is whited-out bands, doubled headers, and a scale mismatch that
// makes DOM-measured section bounds impossible to map onto the image.
//
// This module instead drives the page itself: it stabilises the layout, hides
// the offending fixed/sticky chrome, then screenshots one viewport slice at a
// time and composites them into a single full-height PNG whose pixel rows map
// 1:1 (times an integer `scale`) onto page Y coordinates. That invariant —
// imageY = pageY * scale — is what lets section cropping be deterministic
// instead of hand-tuned. It depends on nothing site-specific, so it works on
// any page.
//
// Usage (an agent-browser session must already be open on the target page):
//   import { captureFullPage } from "./lib/capture-fullpage.js";
//   const { path, width, height, scale } = await captureFullPage({ outPath, ab });
// where `ab(args, stdin?)` runs the agent-browser CLI and returns stdout.

import { PNG } from "pngjs";
import { readFileSync, writeFileSync, rmSync } from "fs";

function readPng(p) { return PNG.sync.read(readFileSync(p)); }
function writePng(p, png) { writeFileSync(p, PNG.sync.write(png)); }

// Unwrap agent-browser eval output (it JSON-encodes return values, sometimes
// twice). Returns the parsed value, or the raw string if it isn't JSON.
function unwrap(out) {
  const s = String(out).trim();
  try { let v = JSON.parse(s); if (typeof v === "string") { try { v = JSON.parse(v); } catch {} } return v; }
  catch { return s.replace(/^"|"$/g, ""); }
}

/**
 * Wait until the page's scrollHeight is stable across consecutive reads — the
 * signal that lazy content has finished loading and layout has settled. Without
 * this, the page height (and thus every section boundary) shifts mid-capture.
 */
async function settleHeight(evalJs, { tries = 25, intervalMs = 300, needStable = 4 } = {}) {
  let prev = -1, stable = 0, h = 0;
  for (let i = 0; i < tries; i++) {
    h = Number(unwrap(evalJs(`(function(){return document.documentElement.scrollHeight;})()`)));
    if (h === prev) stable++; else { stable = 0; prev = h; }
    if (stable >= needStable) break;
    await sleep(intervalMs);
  }
  return h;
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * Capture a full-page PNG by scroll-and-stitch.
 *
 * @param {object} o
 * @param {string} o.outPath              where to write the stitched PNG
 * @param {(args:string[], stdin?:string)=>string} o.ab  runs agent-browser, returns stdout
 * @param {number} [o.settleScrolls=3]    full scroll passes to trigger lazy-load
 * @param {string[]} [o.hideSelectors]    extra selectors to hide during capture
 * @returns {Promise<{path,width,height,scale,pageWidth,pageHeight}>}
 */
export async function captureFullPage({ outPath, ab, settleScrolls = 3, hideSelectors = [] }) {
  const evalJs = (js) => ab(["eval", "--stdin"], js).trim();

  // 1. Trigger lazy-load: scroll top→bottom in steps, driven from Node (one
  //    short eval per step). Doing the stepping here rather than inside a single
  //    long Promise eval keeps each CDP Runtime.evaluate call well under the
  //    debugger's command timeout — a long in-page Promise loop trips it.
  for (let pass = 0; pass < settleScrolls; pass++) {
    const H = Number(unwrap(evalJs(`(function(){return document.documentElement.scrollHeight;})()`)));
    const viewH = Number(unwrap(evalJs(`(function(){return innerHeight;})()`)));
    const step = Math.max(100, Math.round(viewH * 0.8));
    for (let y = 0; y < H; y += step) {
      evalJs(`(function(){scrollTo(0,${y});return 0;})()`);
      await sleep(90);
    }
    evalJs(`(function(){scrollTo(0,0);return 0;})()`);
    await sleep(150);
  }
  const pageHeight = await settleHeight(evalJs);

  // 2. Hide fixed/sticky chrome + caller-supplied overlays so they don't repeat
  //    in every slice or float over content. Record what we hid so we can show
  //    the header back for the first (top) slice, where it belongs.
  const hideList = [
    'nav.navbar-fixed-top', '.navbar-fixed-top', '[class*="cookie"]',
    '[class*="ot-floating"]', '[class*="onetrust"]', '#onetrust-banner-sdk',
    ...hideSelectors,
  ];
  evalJs(`(function(){
    var sels=${JSON.stringify(hideList)};
    window.__capHidden=[];      // [el, prevVisibility] for everything we hide
    window.__capHeader=null;    // the top navbar/header — shown ONLY on slice 0
    function autoFixed(){
      return [...document.querySelectorAll('*')].filter(function(e){
        var cs=getComputedStyle(e); var b=e.getBoundingClientRect();
        return (cs.position==='fixed'||cs.position==='sticky') && b.height>8 && b.width>40;
      });
    }
    var set=new Set();
    sels.forEach(function(s){ try{ document.querySelectorAll(s).forEach(function(e){set.add(e);}); }catch(e){} });
    autoFixed().forEach(function(e){ set.add(e); });
    // Identify the header: a hidden fixed/sticky nav/header anchored at the very
    // top of the page. It belongs to the first section, so we keep a handle to
    // re-show it for slice 0 only (so it isn't lost, and doesn't repeat below).
    var header=null;
    set.forEach(function(e){
      var b=e.getBoundingClientRect();
      var atTop=(b.top+scrollY)<=4;
      var navish=/nav|header/i.test(e.tagName)|| /nav|header/i.test(e.className||'');
      if(atTop && navish && (!header || b.width>header.getBoundingClientRect().width)) header=e;
    });
    window.__capHeader=header;
    set.forEach(function(e){ window.__capHidden.push([e, e.style.visibility]); e.style.visibility='hidden'; });
    document.documentElement.style.scrollBehavior='auto';
    return 'hid '+set.size+(header?' (header tracked)':'');
  })()`);

  // 3. Probe scale (image px per CSS px) + viewport metrics from one slice.
  const metrics = unwrap(evalJs(`(function(){return JSON.stringify({innerW:innerWidth,innerH:innerHeight,docW:document.documentElement.scrollWidth});})()`));
  const probePath = outPath + ".probe.png";
  evalJs(`(function(){scrollTo(0,0);return 'top';})()`);
  await sleep(120);
  ab(["screenshot", probePath]);
  const probe = readPng(probePath);
  const scale = Math.round((probe.width / metrics.innerW) * 1000) / 1000;
  const tileW = probe.width;                       // image px width per slice
  const viewH = metrics.innerH;                    // CSS px per slice
  const imgW = tileW;
  const imgH = Math.round(pageHeight * scale);

  // 4. Allocate the full canvas and bitblt each viewport slice into place.
  const canvas = new PNG({ width: imgW, height: imgH });
  const sliceTops = [];
  for (let y = 0; y < pageHeight; y += viewH) sliceTops.push(y);

  for (let i = 0; i < sliceTops.length; i++) {
    const yCss = sliceTops[i];
    // Show the header ONLY on the first slice (it belongs to the top section);
    // it stays hidden for every other slice so a sticky nav can't overlay
    // scrolled content or repeat down the page.
    evalJs(`(function(){ var hd=window.__capHeader; if(hd){ hd.style.visibility=${i === 0 ? "''" : "'hidden'"}; } return 'hdr'; })()`);
    evalJs(`(function(){scrollTo(0,${yCss});return 'y';})()`);
    await sleep(180);
    const tilePath = outPath + `.tile${i}.png`;
    ab(["screenshot", tilePath]);
    const tile = readPng(tilePath);
    // Where this slice lands in the canvas, and how tall (last slice is partial).
    const dstY = Math.round(yCss * scale);
    let copyH = tile.height;
    if (dstY + copyH > imgH) copyH = imgH - dstY;
    // The browser can't scroll past (pageHeight - viewH); for the final slice the
    // viewport top is clamped, so the tile shows content from a higher Y than
    // requested. Detect that clamp and copy only the not-yet-captured tail.
    const maxScrollTopCss = Math.max(0, pageHeight - viewH);
    const actualTopCss = Math.min(yCss, maxScrollTopCss);
    const overlapCss = yCss - actualTopCss;            // how much the browser clamped
    const srcY = Math.round(overlapCss * scale);
    copyH = Math.min(tile.height - srcY, imgH - dstY);
    if (copyH > 0) PNG.bitblt(tile, canvas, 0, srcY, tile.width, copyH, 0, dstY);
  }

  // 5. Restore hidden chrome and reset scroll.
  evalJs(`(function(){ (window.__capHidden||[]).forEach(function(p){ try{ p[0].style.visibility=p[1]||''; }catch(e){} }); scrollTo(0,0); return 'restored'; })()`);

  writePng(outPath, canvas);

  // Tidy up the per-slice tiles and the scale probe — they're scratch, not output.
  try {
    rmSync(probePath, { force: true });
    for (let i = 0; i < sliceTops.length; i++) rmSync(outPath + `.tile${i}.png`, { force: true });
  } catch {}

  return { path: outPath, width: imgW, height: imgH, scale, pageWidth: metrics.docW, pageHeight };
}
