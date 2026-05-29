---
name: typography-audit
description: Audit and document a site's typography — font families, sizes, weights, styles, colors, letter-spacing, line-height — then compare rendered component screenshots against source section images to verify typographic accuracy.
---

# Typography Audit Skill

## Purpose

Extract every typographic detail from a live website and verify that built components reproduce those styles exactly. Typography is the most commonly wrong thing in cloned components — fonts render differently when family, weight, size, letter-spacing, or color are even slightly off.

## When This Skill Activates

- User says "check fonts", "check typography", "observe font styles", "fonts look wrong"
- During Step 3c of the website-to-components pipeline (font extraction)
- During Step 6 visual comparison when typography differences are suspected
- After building components, as a final typography check pass

---

## Part 1 — Extract Typography from Live Page

### 1a. Capture computed styles per element type

Run this via `agent-browser eval` against the live page:

```bash
agent-browser eval --stdin << 'EOF'
const sel = (q) => document.querySelector(q);
const all = (q) => [...document.querySelectorAll(q)];
const cs = (el) => el ? window.getComputedStyle(el) : null;

const pick = (el, label) => {
  const s = cs(el);
  if (!s) return null;
  return {
    label,
    selector: label,
    fontFamily: s.fontFamily,
    fontSize: s.fontSize,
    fontWeight: s.fontWeight,
    fontStyle: s.fontStyle,
    color: s.color,
    letterSpacing: s.letterSpacing,
    lineHeight: s.lineHeight,
    textTransform: s.textTransform,
    textDecoration: s.textDecoration,
  };
};

const targets = [
  [sel('body'),                          'body'],
  [sel('h1'),                            'h1'],
  [sel('h2'),                            'h2'],
  [sel('h3'),                            'h3'],
  [sel('h4'),                            'h4'],
  [sel('p'),                             'p'],
  [sel('nav a'),                         'nav-link'],
  [sel('nav a.active, nav a[aria-current]'), 'nav-link-active'],
  [sel('button, .btn, [class*="btn"]'),  'button'],
  [sel('[class*="badge"], [class*="tag"], [class*="pill"]'), 'badge'],
  [sel('[class*="card"] h2, [class*="card"] h3'), 'card-title'],
  [sel('[class*="card"] p'),             'card-body'],
  [sel('[class*="eyebrow"], [class*="label"], [class*="kicker"]'), 'eyebrow'],
  [sel('[class*="hero"] h1, [class*="hero"] h2'), 'hero-heading'],
  [sel('[class*="hero"] p'),             'hero-subtext'],
  [sel('footer'),                        'footer'],
  [sel('footer a'),                      'footer-link'],
  [sel('input, textarea'),               'form-input'],
];

const result = targets
  .map(([el, label]) => pick(el, label))
  .filter(Boolean);

JSON.stringify(result, null, 2);
EOF
```

Save the output to `output/<site>/typography.json`.

### 1b. Capture all @font-face declarations

```bash
agent-browser eval --stdin << 'EOF'
const fontFaces = [...document.styleSheets].flatMap(ss => {
  try {
    return [...ss.cssRules]
      .filter(r => r instanceof CSSFontFaceRule)
      .map(r => ({
        family: r.style.fontFamily,
        weight: r.style.fontWeight,
        style: r.style.fontStyle,
        display: r.style.fontDisplay,
        src: r.style.src,
      }));
  } catch(e) { return []; }
});
JSON.stringify(fontFaces, null, 2);
EOF
```

---

## Part 2 — Map to Design Tokens

After extracting, map the results to `global.css` tokens:

### Font families → `--font-*` tokens

| Source element | Token |
|---|---|
| `body`, `p`, form fields | `--font-sans` |
| `h1`, `h2`, `h3`, hero headings | `--font-heading` |
| Script/cursive headings, decorative | `--font-script` |

### Colors → `--color-*` tokens

For each unique `color` value found:
1. Convert `rgb(r, g, b)` to hex
2. Check if the hex already exists in `@theme`
3. If not, add it: `--color-<semantic-name>: #xxxxxx;`

**Semantic naming guide:**
- Heading text → `--color-charcoal` or `--color-navy`
- Body/paragraph text → `--color-body` or add opacity variant to existing token
- Muted/secondary text → `--color-muted`
- Link color → `--color-link`
- Badge/accent text → match to existing `--color-amber`, `--color-green-dark`, etc.

### Letter-spacing → Tailwind class mapping

| Computed value | Tailwind class |
|---|---|
| `normal` or `0px` | `tracking-normal` |
| `0.05em` / ~1px on 16px | `tracking-wide` |
| `0.1em` | `tracking-wider` |
| `0.15em`+ | `tracking-widest` |
| Non-standard values | `tracking-[Xem]` (arbitrary) |

### Font sizes → Tailwind class mapping

| Computed value | Tailwind class |
|---|---|
| 12px | `text-xs` |
| 14px | `text-sm` |
| 16px | `text-base` |
| 18px | `text-lg` |
| 20px | `text-xl` |
| 24px | `text-2xl` |
| 30px | `text-3xl` |
| 36px | `text-4xl` |
| 48px | `text-5xl` |
| 60px | `text-6xl` |
| Non-standard | `text-[Xpx]` (arbitrary) |

---

## CSS Class Rule — Always Read the Source Stylesheet

**Never assume what a CSS class does — always read its actual definition from the live page.**

When you see a named CSS class applied to a text element (e.g. `class="text-gradient"`, `class="hero-label"`, `class="eyebrow"`), you must:

**1. Find the rule in the inline stylesheets:**

```bash
agent-browser eval --stdin << 'EOF'
(function() {
  const className = 'text-gradient'; // change to target class
  const matches = [];
  for (const sheet of document.styleSheets) {
    try {
      for (const rule of sheet.cssRules) {
        if (rule.selectorText && rule.selectorText.includes(className)) {
          matches.push({ selector: rule.selectorText, css: rule.cssText });
        }
      }
    } catch(e) {}
  }
  // Also check inline <style> blocks (Elementor, etc.)
  const inlineMatches = [...document.querySelectorAll('style')].map(s => {
    const idx = s.textContent.indexOf(className);
    if (idx === -1) return null;
    return s.textContent.substring(Math.max(0, idx - 20), idx + 400);
  }).filter(Boolean);
  return JSON.stringify({ sheetRules: matches, inlineBlocks: inlineMatches }, null, 2);
})();
EOF
```

**2. Resolve any CSS custom properties** referenced in the rule:

```bash
agent-browser eval --stdin << 'EOF'
(function() {
  const s = window.getComputedStyle(document.documentElement);
  // List every --variable used in the CSS rule you found above
  return JSON.stringify({
    colorPrimary: s.getPropertyValue('--color-primary').trim(),
    colorAccent: s.getPropertyValue('--color-accent').trim(),
    // add others as needed
  }, null, 2);
})();
EOF
```

**3. Replicate exactly in the component.** Common CSS text effects and their JSX equivalents:

| CSS effect | JSX implementation |
|---|---|
| `background-clip: text` + `webkit-text-fill-color: transparent` + gradient | `style={{ background: 'linear-gradient(...)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}` |
| `text-shadow: 2px 2px 4px rgba(0,0,0,0.5)` | `style={{ textShadow: '2px 2px 4px rgba(0,0,0,0.5)' }}` |
| `letter-spacing: -0.6px` | `tracking-[-0.6px]` (Tailwind arbitrary) |
| `text-transform: uppercase` | `uppercase` |
| `-webkit-text-stroke: 1px #color` | `style={{ WebkitTextStroke: '1px #color' }}` |

**4. Add gradient colors as `@theme` tokens** — not inline hex if used in multiple places:

```css
@theme {
  --color-gradient-start: #2a5c3e;
  --color-gradient-end: #c1772e;
}
```

**Why this matters:** Computed styles report `background-image: none` on elements using `background-clip: text` because the background is inherited or set on the element itself but then clipped. The only reliable way to get the real gradient is to read the raw CSS rule from the stylesheet, not from `getComputedStyle`.

### Gradient text clipping check (mandatory)

After applying `background-clip: text` + `WebkitTextFillColor: transparent` to any text element, **always add `paddingRight: '10px'`** to the inline style. Without it, italic glyphs and letters with descenders/ascenders that overhang the bounding box will be visually clipped at the right edge — the gradient background stops at the box boundary but the rendered glyph extends beyond it.

```jsx
// ✅ Always include paddingRight on gradient text
style={{
  background: 'linear-gradient(135deg, #2a5c3e 0%, #c1772e 100%)',
  WebkitBackgroundClip: 'text',
  WebkitTextFillColor: 'transparent',
  backgroundClip: 'text',
  paddingRight: '0.2em',  // prevents right-edge clipping — em scales with font size
}}
```

**Visual check:** In the Storybook screenshot, look at the rightmost character of any gradient text span. If it appears cut off or the last letter looks narrower than expected, `paddingRight` is missing.

---

## Part 3 — Visual Typography Check (Component vs Source)

After building components, do a typography-specific visual comparison pass.

### For each section component:

1. **Read the source section image** with the `Read` tool.
2. **Open the component in Storybook** and take a screenshot via `agent-browser`.
3. **Read the Storybook screenshot** with the `Read` tool.
4. **Compare side-by-side in context.** Check specifically:

#### Heading checks
- [ ] Font family matches — display/decorative vs sans-serif
- [ ] Font weight — thin/light vs bold vs black
- [ ] Letter-spacing — tight vs loose (common source of "looks off" even when font is correct)
- [ ] Text transform — `uppercase` / `capitalize` / `none`
- [ ] Color — exact match, not approximation
- [ ] Font size — proportionally the same relative to container

#### Body text checks
- [ ] Font family — body font vs heading font (they are often different)
- [ ] Line-height — loose line spacing is often a brand characteristic
- [ ] Color opacity — body text is often `color/80` or similar opacity of the base color

#### Badge / eyebrow / label checks
- [ ] Font size — often smaller than body (xs or sm)
- [ ] Letter-spacing — eyebrow labels often use `tracking-widest` or `tracking-[0.15em]`
- [ ] Text transform — often `uppercase`
- [ ] Font weight — often `font-semibold` or `font-bold`

#### Navigation checks
- [ ] Font weight of active vs inactive links
- [ ] Letter-spacing on nav items
- [ ] Color of hover state

### Fix criteria

If any of the above differ between the rendered component and the source screenshot, update the component's Tailwind classes. Common fixes:

```jsx
// Wrong — generic sans, assumed charcoal, wrong weight
<h2 className="text-3xl font-bold text-charcoal">

// Correct — heading font, exact color token, exact size, exact tracking
<h2 className="font-heading text-[56px] font-normal text-heading uppercase tracking-normal">
```

**Do not accept "close enough."** Typography mismatches are visible at a glance and degrade the quality of the clone.

---

## The Perfection Rule

**Every computed color must be verified against the live page — never assumed.**

The most common failure mode: a heading looks "dark" in a screenshot so it gets `text-charcoal` or `text-black` without checking. But the real site often uses a specific brand color (e.g. `#514653` muted purple-brown for H2 section headings, `#2d5016` dark forest green for H3 card titles) that is invisible to the eye when compared to near-black but is clearly different when overlaid.

**Layout composition must be verified against the live site.**


### The verification process (mandatory, not optional)

For every heading and label in every component you build or audit:

1. **Query the live element's computed `color`** via `agent-browser eval`:
   ```bash
   agent-browser eval --stdin << 'EOF'
   const headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,p,[class*="label"],[class*="eyebrow"]')];
   JSON.stringify(headings.map(h => ({
     tag: h.tagName, text: h.textContent.trim().substring(0,60),
     color: window.getComputedStyle(h).color,
     fontFamily: window.getComputedStyle(h).fontFamily.substring(0,40),
     fontSize: window.getComputedStyle(h).fontSize,
     fontWeight: window.getComputedStyle(h).fontWeight,
     textTransform: window.getComputedStyle(h).textTransform,
     letterSpacing: window.getComputedStyle(h).letterSpacing,
   })).filter(h => h.text.length > 0), null, 2);
   EOF
   ```

2. **Convert `rgb(r, g, b)` to hex** and check if the value exists in `global.css @theme`. If not, add it with a semantic name.

3. **Never use `text-charcoal`, `text-black`, or `text-navy` for a heading without confirming the exact hex** from the live page matches those tokens.

4. **Add every unique color as a named `@theme` token** — never use `text-[#xxxxxx]` inline hex for a color that appears more than once.

---

## Part 4 — Update Skill After Findings

After completing a typography audit on a new site:
1. Note any unusual font pairings or non-standard letter-spacing values in the project's `components.json` descriptions
2. Ensure `global.css` has all needed tokens documented with a comment explaining their usage
3. Verify the heading global rule applies to all heading levels used on the site

---

## Output Files

| File | Description |
|---|---|
| `output/<site>/typography.json` | Computed styles per element type from live page |

## Tools Used

- `agent-browser eval` — extracts computed styles from live page
- `Read` — reads source section images and Storybook screenshots for visual comparison
- `Edit` — updates `global.css` with new tokens
