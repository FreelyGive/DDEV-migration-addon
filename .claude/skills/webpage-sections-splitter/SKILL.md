---
name: visual-page-section-segmentation
description: Detects and segments logical sections within a full-page website screenshot using AI vision. Read the existing screenshot.png with the Read tool and use semantic visual understanding — content structure, background changes, layout rhythm, component roles — to identify section boundaries precisely. Never use pixel sampling, ImageMagick, bash color probing, or Playwright to take new screenshots.
---

**HARD RULES — read before doing anything:**

1. **Do NOT take new screenshots.** Do NOT use Playwright, playwright-cli, ImageMagick, `convert`, `identify`, or any bash pixel-sampling technique. Do NOT probe pixel colors with shell commands.
2. **Read the existing screenshot** with the `Read` tool: `website-to-components/output/<host>/<page-slug>/screenshot.png`
3. **Use AI vision** — look at the image and identify section boundaries semantically, the same way a designer would by eye.

## How to detect sections

Look at the screenshot and identify visually distinct horizontal content blocks. Use your understanding of web layout — not pixel math. Ask yourself:

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
- **File:** [section-NN.png]
```

Bounds must cover the full page width (x=0, width = page width). The y and height values come from your visual estimate of where each section starts and ends in the image — be precise enough to avoid cutting through text or images mid-way.

Example output:

### Section 1: Navbar + Hero

- **Reason:** Full-width dark background with logo, nav links, and a large headline + CTA over a photograph
- **Bounds:** x=0, y=0, width=1440, height=920
- **File:** section-01.png

### Section 2: Features Grid

- **Reason:** Background changes to white, layout shifts to a 3-column card grid
- **Bounds:** x=0, y=920, width=1440, height=640
- **File:** section-02.png