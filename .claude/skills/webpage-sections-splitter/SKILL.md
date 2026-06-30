---
name: visual-page-section-segmentation
description: Segments a full-page website screenshot into logical sections. Starts from DOM-measured boundaries (dom-sections.json, real getBoundingClientRect geometry) and REFINES them semantically with AI vision — merging, splitting, and labelling. Falls back to pure visual estimation only when no DOM bounds exist. Never take new screenshots or probe pixel colors with bash.
---

**HARD RULES — read before doing anything:**

1. **START FROM THE DOM-MEASURED BOUNDS.** Read `website-to-components/output/<host>/<page-slug>/dom-sections.json` FIRST. The screenshot job measured the page's REAL section containers via `getBoundingClientRect` — these bounds are accurate, contiguous, and never cut through a component (they ARE the component containers). They are your starting point, NOT a visual pixel-estimate.
2. **Do NOT take new screenshots** and do NOT probe pixel colors with bash/ImageMagick/Playwright. (Measuring DOM geometry is done for you — that's what `dom-sections.json` is. You don't run it; you read its output.)
3. **Read the existing screenshot** with the `Read` tool (`.../screenshot.png`) and use AI vision to REFINE the DOM bounds — not to replace them.

## How to detect sections — refine the DOM bounds

`dom-sections.json` looks like:
```json
{ "pageWidth": 1440, "pageHeight": 3346, "container": "ARTICLE.sections", "coverage": 0.9,
  "sections": [ { "y": 0, "height": 455, "top": 0, "bottom": 455, "tag": "section", "cls": "page-section ..." }, ... ] }
```
Each entry is a real, full-width layout block. Look at the screenshot alongside these bounds and adjust ONLY where vision disagrees with the DOM grouping:

- **MERGE** adjacent DOM blocks that are visually one section — most commonly a bare navbar block sitting above a hero (→ one hero section), or a decorative divider block that belongs to the section above/below.
- **SPLIT** a single DOM block when it visually contains two distinct sections — i.e. a clear change in **component role** (e.g. a photo/link-card grid followed by a "Our Clients" logo cloud, or a feature grid followed by a CTA band), **a different background, OR its own heading introducing a new block.** A background change is sufficient but NOT required: many sites stack several roles on one shared background inside a single `<section>`. When a block carries two clearly separate roles — especially when the lower one has its own centered heading — split at the blank band between them even though the background is unchanged. Place the split `y` in that blank band (probe it like any other seam, with breathing room on both sides). The two halves keep the block's DOM-located outer edges — but those outer edges follow the same framing rule as any boundary: if the DOM edge sits flush against content, nudge it into the gap.
- **LABEL** each final section and give a one-line reason.
- **Use the DOM `top`/`bottom` values to LOCATE each boundary, then place the cut for framing.** Start from the DOM edge — it accurately marks where one block's content ends and the next begins. But a DOM edge is often *flush* against content (markup divides at the content, not in the whitespace), so it is the floor, not the final cut. Where the DOM edge sits in a clear blank band, keep it. Where it sits flush against content (a card top, heading, image edge — content within ~15px), nudge it a small amount into the blank band so the crop has breathing room on both sides (see "Boundary precision" below; always re-probe the moved cut). This small, probe-verified nudge is the ONLY licensed move off a DOM edge — do NOT free-hand a boundary far from the DOM edge or into a region you have not probed, because *that* is how crops start cutting through components.

The DOM bounds already cover the full page top-to-bottom (including the footer). Preserve that full coverage: no gaps, no overlaps.

### Fallback — no DOM bounds available

If `dom-sections.json` is missing or contains `{ "error": ... }` (rare — a page with no usable layout container), THEN fall back to pure visual estimation from the screenshot. In that mode, look at the screenshot and identify visually distinct horizontal content blocks using your understanding of web layout — and be especially careful never to cut through text, a card grid, or a device mockup mid-component. Ask yourself:

- Does the background color or image change here?
- Does the layout structure shift (e.g. full-width hero → card grid)?
- Is there a clear whitespace band separating content?
- Does a new component role begin (navbar, hero, features, testimonials, CTA band, footer)?
- Does typography hierarchy change dramatically?

Start a new section at each such boundary.

## Section Continuity Rules

Keep content within the SAME section when:

- Cards belong to the same grid system
- Text and media are visually grouped
- Repeated content patterns are part of the same module
- Minor spacing occurs without a layout/background change
- Elements share the same background/container

## Ignore These Elements

Do NOT treat these as standalone sections:

- Sticky headers repeated during scroll
- Floating chat widgets
- Cookie banners
- Scrollbars
- Floating CTA buttons
- Popups/modals unless dominant

## Hero special-case (always)

- **One hero, one crop.** A tall photographic or video band is one section even if it has a stats bar or text overlay. Do not split it until the background photo/video ends and a new band begins.
- **Navbar + hero share the top.** The hero starts at y=0 and extends past the navbar overlay — do not create a separate section for the navbar alone unless it sits on a distinctly different background.
- **Cream/text-only page intros** are one section with the label "cream background, no photo" — do not treat as a photographic hero.

## Output Requirements

After reading the screenshot and identifying sections visually, output a markdown block for each:

```
### Section [index]: [Label]

- **Reason:** [what you see that marks this boundary — describe visually]
- **Bounds:** x=0, y=[y], width=[full page width], height=[height]
- **Seam-probe:** top y=[y] — [what the native-res strip showed: "blank band, no descenders/shadows"]; bottom y=[y+height] — [same]. [For a DOM-snapped boundary you did not move, write "DOM edge, strip confirms blank band".]
- **File:** [section-NN.png]
```

Bounds must cover the full page width (x=0, width = page width). The y and height values come from `dom-sections.json` (snapped to real DOM edges), adjusted only where you deliberately merged or split — NOT free-hand visual estimates. Only in the no-DOM fallback do they come from visual estimation, in which case be precise enough to avoid cutting through text, cards, or images mid-component.

**The `Seam-probe:` field is not optional and is not free-form reassurance.** You may only write it AFTER you have actually `Read` the native-resolution strip across that boundary (step 2 below). A block whose `Seam-probe:` describes a strip you did not read is a fabricated field — worse than omitting it. This is enforced downstream: it maps to the `seamProbe` property on each section object you pass to `applySections()`, which **hard-fails the crop job** if any section's `seamProbe` is missing or blank. A skipped probe no longer silently passes — it stops the pipeline. Every boundary between two sections appears as the *bottom* of one block and the *top* of the next; both descriptions must agree that the band is clear. If you cannot describe what the strip actually showed, you have not probed it, and the section list is not done.

After producing the final list, the cropper (`applySections`) validates it: it rejects overlaps, clamps to page height, and warns on gaps or any section spanning >70% of the page. If you see those warnings, your merge/split was wrong — revisit it.

## Boundary precision: place cuts in the gap WITH breathing room, then verify

Sections bleed into one another when a boundary is placed at a content edge instead of the blank band between sections, or when it is read off a downscaled preview. A boundary can avoid bleed and *still be wrong*: a cut placed flush against the content (right at a card top, a heading's cap-line, an image edge) clips nothing yet produces a crop that looks cramped — content jammed against the frame with no margin. **"Doesn't clip" is not the bar. "Looks like a properly-framed component" is the bar.** A good crop has visible breathing room above its first content and below its last. To keep boundaries precise:

1. **Cut in the gap WITH breathing room — never flush against the content edge.** Each boundary `y` goes in the blank background band *below* all of section N's content (text descenders, rounded card bottoms, shadows, decorative shapes, low-alpha tints) and *above* section N+1's first pixel — and it leaves margin on **both** sides, not just barely-clearing one. Concretely: when content starts or ends within **~15px** of a candidate boundary (especially a DOM-snapped edge, which markup tends to place flush against content), pull the cut deeper into the blank band so each side gets roughly balanced padding. **The DOM edge is the floor that locates the content, not the final cut** — snap to it to find where content is, then move into the gap to frame it. Only cut flush when there is genuinely no blank band (two sections abut with zero gap); that is rare and you should suspect a missed merge.
2. **Probe EVERY seam at full resolution before committing — no exceptions for "obvious" or fixed-offset cuts.** For each boundary, `Read` a narrow native-resolution strip across it directly from the screenshot (a ~90px-tall crop, `y-45` to `y+45`, full width) and look at what is actually there. **Measure, don't just glance:** note where the nearest content actually ends above the cut and begins below it, and state the resulting gap in pixels — e.g. "text ends ~y=2168, cards start ~y=2240, cut at 2200 leaves ~32px above / ~40px below." A `Seam-probe:` that says only "blank band, clear" passed the no-bleed test but skipped the breathing-room test — it is not done. The output of this read is what you write into that section's `Seam-probe:` field — you cannot fill the field without doing the read. A boundary you snapped to a DOM edge still gets probed: DOM edges are accurate but the screenshot may still show a shadow or descender crossing the line, OR sit flush against content with no margin. Reading crops of the existing `screenshot.png` is allowed and expected: this does not violate the "no new screenshots" rule; do NOT take fresh captures with Playwright/ImageMagick.
3. **Bleed AND breathing-room self-check is a GATE, not a closing remark (MANDATORY).** Before you emit ANY section block, that block's `Seam-probe:` field must already be filled from an actual strip read of its top and bottom edges, AND must record the measured gap on each side. Treat an empty, missing, hand-waved, or gap-less `Seam-probe:` field as a hard stop: the list is not ready to output. Walk every boundary; for any strip that shows clipped/bleeding content **OR content sitting flush (<~15px) against the cut**, move the boundary into the blank band for balanced padding and re-probe — do not emit it as-is and do not report done after one pass.

   **Self-audit before output — answer all four or you are not done:**
   - Did I `Read` a strip for *every* boundary, including the ones I left on their DOM edge? (If you cut N sections, you read ~N+1 strips.)
   - Does every section block carry a `Seam-probe:` field that states, in pixels, where the nearest content ends/starts and how much gap the cut leaves on each side — not just "blank band, clear"?
   - For each shared boundary, do the bottom-of-N and top-of-N+1 descriptions agree the band is clear AND that neither side is jammed flush against the cut?
   - **Did I actually look at the resulting crops?** After cropping, `Read` each output `section-NN.png` and ask of each one: *"would I ship this as a framed component?"* — does its first content have visible top margin and its last content visible bottom margin? A crop that is technically bleed-free but visually cramped fails this check. If any crop looks jammed, fix that boundary and re-crop. Do not report done on bounds alone; verify against the images.

   If the answer to any is no, the most likely reason is you verified against the no-bleed checklist instead of against the goal — a crop that *looks right*. A boundary that "looked obvious" or that you snapped flush to a DOM edge is exactly the one that ends up cramped. Go read it.

Example output:

### Section 1: Navbar + Hero

- **Reason:** Full-width dark background with logo, nav links, and a large headline + CTA over a photograph
- **Bounds:** x=0, y=0, width=1440, height=930
- **Seam-probe:** top y=0 — page edge, clear; bottom y=930 — DOM section edge was ~y=910 flush against the CTA shadow, so pulled the cut down to 930: strip shows the CTA shadow ending ~y=912, blank band through 930, first card row not until ~y=948 — ~18px margin below the hero / ~18px above the cards, nothing clipped
- **File:** section-01.png

### Section 2: Features Grid

- **Reason:** Background changes to white, layout shifts to a 3-column card grid
- **Bounds:** x=0, y=930, width=1440, height=640
- **Seam-probe:** top y=930 — strip confirms ~18px blank white band above the first card row (cards start ~y=948, no hero bleed, not flush); bottom y=1570 — card shadows end ~y=1548, cut at 1570 leaves ~22px margin below the cards before the next section's heading ~y=1592
- **File:** section-02.png
## Capture & DOM-measurement prerequisites (how the inputs are produced)

You consume `screenshot.png` + `dom-sections.json`; this is how they are made
robustly. Relevant when a page has no usable inputs, or a previous capture looks
wrong (whited-out bands, doubled header, footer missing, wrong scale).

- **Do not trust the browser's native `screenshot --full`.** On real pages it
  breaks: a `position:fixed`/`sticky` header repeats in every stitched slice, a
  fixed cookie/chat button floats over content, lazy content below the fold is
  unpainted when capture fires, and the engine may render `--full` at a different
  devicePixelRatio than the viewport (so the image scale no longer matches DOM
  coordinates). Capture by **scroll-and-stitch** instead: settle the page height
  (poll until `scrollHeight` is stable), hide fixed/sticky chrome (showing the
  header only on the first slice), screenshot one viewport at a time, and
  composite into one full-height PNG whose pixel rows map `pageY × scale`. The
  pipeline's `lib/capture-fullpage.js` does this; the invariant `imageY = pageY ×
  scale` is what makes DOM-edge cropping deterministic instead of eyeballed.
- **Crop to the document width, not the image width** — otherwise the scrollbar
  gutter leaves a dark strip down the right edge of every section.
- **Derive scale empirically** (`imageWidth / window.innerWidth`); a connected
  Chrome can render at 2× while reporting `devicePixelRatio: 1`, so never trust
  the reported DPR.
- **Drive scroll from the controller in small steps**, not via one long in-page
  `setTimeout` Promise — a multi-second eval trips the CDP command timeout.

### Bot-walled sites (Cloudflare "Just a moment…", 403 to curl)

If the target shows a "checking your browser" interstitial and the automated
browser can't clear it, the headless/spawned browser cannot proceed. The
reliable, generic path:

1. The user opens the URL in a **real, visible Chrome launched with
   `--remote-debugging-port=9222`** and clears the challenge so the real page is
   loaded.
2. Connect the automation to that tab over CDP (e.g. `agent-browser connect
   http://localhost:9222`). **Use `localhost`, not `127.0.0.1`** — the
   IPv4/IPv6 split can make `/json/list` return 0 targets on one but the tab on
   the other.
3. **Do not re-navigate** the connected tab (that re-triggers the wall). Drive
   capture + DOM measurement against the already-loaded tab in place.

Recognise this state by `document.title` / body text containing "just a moment" /
"checking your browser"; a normal page has full content and a real `<h1>`/title.
