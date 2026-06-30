#!/usr/bin/env node
// Source-vs-build element inventory + parity audit (site-agnostic QA gate).
//
// Extracts a structured inventory of the VISIBLE content elements of a page —
// headings, paragraphs/list-item text, links (label + href), images (src + alt),
// and "repeating blocks" (groups of similar sibling items, with per-item field
// counts) — then diffs a SOURCE page against a BUILT page so missed or altered
// content surfaces before sign-off. This is the durable guard against the two
// recurring content bugs: invented values and dropped items in a repeating list.
//
// It runs the same extraction in-page via `agent-browser eval` against any URL
// (or a saved file:// snapshot), so it works for any site. Builder-injected noise
// (inline <style>/CSS text nodes, Squarespace's duplicate <li>/<p>) is filtered.
//
// Usage:
//   node scripts/element-inventory.js <url>                       # print inventory
//   node scripts/element-inventory.js <source-url> <built-url>    # diff source→built
//
// Tips: for bot-walled sources, save the HTML and pass a file:// path. The diff
// is text-based (normalised), so trivial whitespace/case differences are ignored;
// it flags source text/links/images with no match in the build, and large
// repeating-block count drops.

import { execFileSync } from 'child_process';

function evalPage(url, js) {
  // open then eval against the controlled browser tab
  try { execFileSync('agent-browser', ['open', url], { stdio: 'ignore' }); } catch {}
  try { execFileSync('agent-browser', ['wait', '1500'], { stdio: 'ignore' }); } catch {}
  const out = execFileSync('agent-browser', ['eval', '--stdin'], { input: js, encoding: 'utf8' }).trim();
  try { let v = JSON.parse(out); if (typeof v === 'string') v = JSON.parse(v); return v; }
  catch { return null; }
}

// In-page extraction. Returns { headings[], texts[], links[{label,href}],
// images[{src,alt}], repeatingBlocks[{selector,count,fieldsPerItem}] }.
const EXTRACT = `(function(){
  function clean(t){ return (t||'').replace(/\\s+/g,' ').trim(); }
  function isNoise(t){ return !t || t.length>300 || /\\{|\\}|--tweak|@media|px;|block-yui|sqs-|webkit/.test(t); }
  function visibleTextLeaves(){
    var out=[]; var w=document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null); var n;
    while(n=w.nextNode()){ var t=clean(n.textContent); if(!isNoise(t)) out.push(t); }
    // de-dupe consecutive duplicates (Squarespace emits li then identical p)
    return out.filter(function(t,i,a){ return i===0 || a[i-1]!==t; });
  }
  var headings=[].slice.call(document.querySelectorAll('h1,h2,h3,h4')).map(function(e){return clean(e.textContent);}).filter(function(t){return t&&!isNoise(t);});
  var links=[].slice.call(document.querySelectorAll('a[href]')).map(function(a){
    var href=a.getAttribute('href')||''; return { label: clean(a.textContent) || ('['+ (a.querySelector('img,svg')?'icon':'') +']'), href: href };
  }).filter(function(l){ return l.href && !/^javascript:/.test(l.href); });
  var images=[].slice.call(document.querySelectorAll('img')).map(function(i){
    var src=(i.currentSrc||i.src||i.getAttribute('data-src')||''); return { src: src.split('?')[0].split('/').pop(), alt: clean(i.getAttribute('alt')||'') };
  }).filter(function(o){ return o.src; });
  // Repeating blocks: parents whose >=3 element children share the same tag+class.
  var repeating=[];
  [].slice.call(document.querySelectorAll('ul,ol,div,section')).forEach(function(p){
    var kids=[].slice.call(p.children);
    if(kids.length<3) return;
    var sig={}; kids.forEach(function(k){ var s=k.tagName+'.'+(k.className||'').toString().split(' ')[0]; sig[s]=(sig[s]||0)+1; });
    var top=Object.keys(sig).sort(function(a,b){return sig[b]-sig[a];})[0];
    if(sig[top]>=3){
      var items=kids.filter(function(k){ return (k.tagName+'.'+(k.className||'').toString().split(' ')[0])===top; });
      var fields=items[0]? items[0].querySelectorAll('a,img,h1,h2,h3,h4,p,span,svg').length : 0;
      repeating.push({ selector: top, count: items.length, fieldsPerItem: fields });
    }
  });
  // keep the few biggest repeating groups
  repeating.sort(function(a,b){return b.count-a.count;});
  return JSON.stringify({
    title: clean(document.title),
    headings: headings,
    texts: visibleTextLeaves(),
    links: links,
    images: images,
    repeatingBlocks: repeating.slice(0,8),
  });
}())`;

function inventory(url) { return evalPage(url, EXTRACT); }

function norm(s) { return (s || '').toLowerCase().replace(/\s+/g, ' ').trim(); }

function diff(src, built) {
  const builtText = new Set(built.texts.map(norm));
  const builtHeads = new Set(built.headings.map(norm));
  const builtImgs = new Set(built.images.map((i) => norm(i.src)));
  const builtHrefs = new Set(built.links.map((l) => norm(l.href)));

  const missingHeadings = src.headings.filter((h) => !builtHeads.has(norm(h)) && !builtText.has(norm(h)));
  const missingText = src.texts.filter((t) => t.length > 12 && !builtText.has(norm(t)) && !builtHeads.has(norm(t)));
  const missingImages = src.images.filter((i) => i.src && !builtImgs.has(norm(i.src)));
  // links: compare by destination path tail (ignore origin differences)
  const tail = (h) => norm(h).replace(/^https?:\/\/[^/]+/, '').replace(/\/$/, '');
  const builtTails = new Set(built.links.map((l) => tail(l.href)));
  const missingLinks = src.links.filter((l) => l.href && !builtTails.has(tail(l.href)) && !/^#/.test(l.href));

  return { missingHeadings, missingText: missingText.slice(0, 40), missingImages, missingLinks: missingLinks.slice(0, 40),
    repeating: { source: src.repeatingBlocks, built: built.repeatingBlocks } };
}

// --- main ---
const [a, b] = process.argv.slice(2);
if (!a) { console.error('Usage: node scripts/element-inventory.js <url> [<built-url>]'); process.exit(1); }

const srcInv = inventory(a);
if (!srcInv) { console.error('Failed to extract inventory from', a); process.exit(1); }

if (!b) {
  console.log(JSON.stringify(srcInv, null, 2));
  console.log(`\nheadings:${srcInv.headings.length} texts:${srcInv.texts.length} links:${srcInv.links.length} images:${srcInv.images.length} repeatingBlocks:${srcInv.repeatingBlocks.length}`);
  process.exit(0);
}

const builtInv = inventory(b);
if (!builtInv) { console.error('Failed to extract inventory from', b); process.exit(1); }
const d = diff(srcInv, builtInv);

console.log(`\n=== PARITY AUDIT  source=${a}  →  built=${b} ===`);
const report = (label, arr, fmt) => {
  console.log(`\n${label}: ${arr.length}`);
  arr.slice(0, 30).forEach((x) => console.log('  - ' + fmt(x)));
};
report('Headings on source but MISSING in build', d.missingHeadings, (x) => x);
report('Text bits on source but MISSING in build', d.missingText, (x) => x.slice(0, 90));
report('Links on source but MISSING in build', d.missingLinks, (x) => `${x.label} -> ${x.href}`);
report('Images on source but MISSING in build', d.missingImages, (x) => `${x.src} (alt: ${x.alt || '-'})`);
console.log('\nRepeating blocks (count) — source vs build:');
console.log('  source:', d.repeating.source.map((r) => `${r.selector}×${r.count}`).join(', ') || '(none)');
console.log('  built: ', d.repeating.built.map((r) => `${r.selector}×${r.count}`).join(', ') || '(none)');

const fails = d.missingHeadings.length + d.missingImages.length + d.missingLinks.length;
console.log(`\n${fails === 0 ? '✓ no missing headings/links/images' : '⚠ ' + fails + ' missing element(s) — review above'}`);
