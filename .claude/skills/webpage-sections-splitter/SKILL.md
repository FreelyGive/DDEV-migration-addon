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
- **SPLIT** a single DOM block only when it visually contains two clearly distinct sections (different background AND different component role).
- **LABEL** each final section and give a one-line reason.
- **Keep `y`/`height` snapped to the DOM `top`/`bottom` values** unless you are deliberately splitting or merging. Do not nudge a boundary off a real DOM edge — that's how crops start cutting through components.

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

## Boundary precision: place cuts in the gap, then verify

Sections bleed into one another when a boundary is placed at a content edge instead of the blank band between sections, or when it is read off a downscaled preview. To keep boundaries precise:

1. **Cut in the gap, never at the content edge.** Each boundary `y` goes in the blank background band *below* all of section N's content (text descenders, rounded card bottoms, shadows, decorative shapes, low-alpha tints) and *above* section N+1's first pixel.
2. **Probe EVERY seam at full resolution before committing — no exceptions for "obvious" or fixed-offset cuts.** For each boundary, `Read` a narrow native-resolution strip across it directly from the screenshot (a ~90px-tall crop, `y-45` to `y+45`, full width) and look at what is actually there. The output of this read is what you write into that section's `Seam-probe:` field — you cannot fill the field without doing the read. A boundary you snapped to a DOM edge still gets probed: DOM edges are accurate but the screenshot may still show a shadow or descender crossing the line. Reading crops of the existing `screenshot.png` is allowed and expected: this does not violate the "no new screenshots" rule; do NOT take fresh captures with Playwright/ImageMagick.
3. **Bleed self-check is a GATE, not a closing remark (MANDATORY).** Before you emit ANY section block, that block's `Seam-probe:` field must already be filled from an actual strip read of its top and bottom edges. Treat an empty, missing, or hand-waved `Seam-probe:` field as a hard stop: the list is not ready to output. Walk every boundary; for any strip that shows clipped or bleeding content, move the boundary into the blank band and re-probe — do not emit it as-is and do not report done after one pass.

   **Self-audit before output — answer all three or you are not done:**
   - Did I `Read` a strip for *every* boundary, including the ones I left on their DOM edge? (If you cut N sections, you read ~N+1 strips.)
   - Does every section block carry a `Seam-probe:` field describing what its strips actually showed — not "looks fine"?
   - For each shared boundary, do the bottom-of-N and top-of-N+1 descriptions agree the band is clear?

   If the answer to any is no, the most likely reason is you skipped the probe on a boundary that "looked obvious" — that is exactly the boundary that bleeds. Go read it.

Example output:

### Section 1: Navbar + Hero

- **Reason:** Full-width dark background with logo, nav links, and a large headline + CTA over a photograph
- **Bounds:** x=0, y=0, width=1440, height=920
- **Seam-probe:** top y=0 — page edge, clear; bottom y=920 — strip shows the dark hero ending ~y=905, then blank band to y=920, no CTA shadow crossing the line
- **File:** section-01.png

### Section 2: Features Grid

- **Reason:** Background changes to white, layout shifts to a 3-column card grid
- **Bounds:** x=0, y=920, width=1440, height=640
- **Seam-probe:** top y=920 — DOM edge, strip confirms blank white band above the first card row (no hero bleed); bottom y=1560 — strip shows card shadows end ~y=1545, blank band to y=1560
- **File:** section-02.png