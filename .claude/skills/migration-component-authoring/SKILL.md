---
name: component-authoring
description:
  'How to write, modify, and style React components for Drupal Canvas and Acquia
  Source. Covers the technology stack (React 19, Tailwind CSS 4, CVA variants,
  cn utility), component.yml prop and slot definitions, enum naming, image and
  video prop types, formatted text fields, color scheme variants, theme tokens
  from global.css, required folder structure (index.jsx + component.yml), and
  matching source site visual styles including extracting design tokens, dark
  backgrounds, gradient text, glass/blur effects, and updating global.css theme.
  Use when building, editing, or fixing any component in src/components/.'
---

# Requirements for creating or modifying components

Components are the building blocks of someone's digital presence. Every prop,
slot, and style choice shapes how content reaches its audience. Build with care
and precision — understand what a component needs to represent before writing a
single line of code.

## Understanding What You're Building

Before building or modifying a component, understand the content it must
represent:

1. **Inspect the source section's DOM.** Don't just look at screenshots — read
   the HTML structure, CSS layout, and identify dynamic vs. static content. A
   footer isn't "some text at the bottom" — it may be a multi-column layout with
   menus, contact info, social links, and legal text.

2. **Document structural requirements.** Before coding, list:
   - Every content area (headings, text blocks, image slots, menu regions)
   - Column/grid layout and responsive behavior
   - Dynamic content sources (Drupal menus, media entities, computed values)
   - Interactive elements (dropdowns, accordions, mobile toggles)

3. **A component is not just a visual wrapper.** It maps CMS content to rendered
   output. If a section has 4 columns of content, the component needs props or
   slots for each. A `{text}` prop cannot represent a multi-column footer.

4. **Check existing components critically.** Read `index.jsx`, not just
   `component.yml`. The YAML tells you what props exist; the JSX tells you what
   they actually render. A component with a `text` prop that renders
   `<p>{text}</p>` cannot display a logo, menu columns, or social links —
   regardless of its name.

## Technology stack

- React 19;
- Tailwind CSS 4.1+;
- class-variance-authority (CVA) for component variants;
- `clsx` and `tailwind-merge` via the `cn()` utility;
- `FormattedText` component for rendering HTML content.

### Import paths cheat sheet (the project's lint rule enforces these — get them wrong and validate fails)

- `cn` and `FormattedText` are exported from **`drupal-canvas`**:
  ```js
  import { cn, FormattedText } from 'drupal-canvas';
  ```
  The aliases `@/lib/utils` and `@/lib/FormattedText` are NOT valid for new components — Canvas's
  `drupal-canvas/component-imports` ESLint rule rejects them.
- Sub-components are imported via the `@/components` alias — **no relative paths, no `/index.jsx`
  suffix**:
  ```js
  import RmhFooter from '@/components/rmh_footer';
  ```
  Relative imports like `../rmh_footer/index.jsx` are rejected by the same lint rule.
- `cva` from `class-variance-authority` is normal.
- **Data-only helper modules must be inlined, not relatively imported.** The
  `drupal-canvas/component-imports` rule rejects relative imports even for pure
  data (e.g. an icon-data `.js` file beside the component). Inline the data
  directly into the component's `index.jsx`, or move it under `@/components`.
- **Minimise `@/components` imports in section/page-level components.** A
  component placed directly on a deployed page can silently fail to hydrate when
  it imports certain `@/components/*` sub-components — it renders in Storybook but
  is **blank on the live site**, with a console error like
  `[astro-island] Error hydrating … Failed to resolve module specifier "@/components/…"`.
  For top-level section components, prefer `drupal-canvas` primitives
  (`FormattedText`, `cn`, `Image`) and plain HTML (`<h1>`/`<h2>`) over
  cross-component imports, and verify each on the **live deployed render**, not
  just Storybook.

## Component patterns

- Use CVA (`cva()`) to define variant styles for components.
- Use the `cn()` utility imported from `drupal-canvas` to merge class names.
- Always export components as default exports.
- Accept a `className` prop for style customization when necessary.
- Use the `@/components` import alias when importing other components.
- Only use dependencies listed in the technology stack; do not add third-party
  imports or create new library utilities.
- Place each component in its own folder under `src/components/` with an
  `index.jsx` and `component.yml` file. Do not create nested folder structures.

## Styling conventions

- Use Tailwind's theme colors (`primary-*`, `gray-*`) defined in `global.css`.
- Avoid hardcoded color values; use theme tokens instead.
- Follow the existing focus, hover, and active state patterns from examples.

### CRITICAL: Verify Tailwind is wired up before building components

If Tailwind classes appear to have no effect in Storybook, **do not fall back to
inline styles.** Inline styles are not a workaround — they just hide the problem
and produce components that can never use the design system. Fix the config first.

**Check this before building any components:**

1. `canvas/.storybook/main.ts` — `viteFinal` must include `tailwindcss()`:
   ```ts
   import tailwindcss from '@tailwindcss/vite';
   // ...
   return mergeConfig(config, {
     plugins: [tailwindcss(), componentCssPlugin()],
   });
   ```

2. `canvas/src/global.css` — must have an `@source` directive so Tailwind scans
   component files:
   ```css
   @import 'tailwindcss';
   @source './**/*.{jsx,tsx,js,ts}';
   ```
   Without `@source`, Tailwind 4 won't scan `src/components/` and no utility
   classes from components will be included in the build.

3. `canvas/.storybook/preview.*` — must import `global.css`:
   ```js
   import '../src/global.css';
   ```

If any of these are missing, add them and restart Storybook before building
components. This setup is required once per project and must stay committed.

### Never use inline styles for layout or visual styling

**Do not use `style={{}}` for layout, color, spacing, typography, or any visual
property.** If Tailwind classes aren't applying, fix the configuration above —
not the components.

```jsx
// ❌ WRONG — inline styles bypass Tailwind, and break if the config is later fixed
<section style={{ display: 'flex', backgroundColor: '#0f172a', padding: '4rem 2rem' }}>
  <h1 style={{ fontSize: '3rem', color: 'white', fontWeight: 700 }}>Heading</h1>
</section>

// ✅ CORRECT — Tailwind scans className strings at build time
<section className="flex bg-[#0f172a] px-8 py-16">
  <h1 className="text-5xl text-white font-bold">Heading</h1>
</section>
```

**The only permitted uses of `style={{}}`:**
- `backgroundImage: \`url(${src})\`` — Tailwind cannot generate dynamic URL values
- CSS custom property injection: `style={{ '--custom-prop': value }}`
- Truly dynamic numeric values with no Tailwind equivalent (e.g. `width: \`${percent}%\``)

For everything else — use Tailwind classes. If a value isn't in the theme, use
arbitrary value syntax: `bg-[#1a2b3c]`, `pt-[72px]`, `text-[13px]`.

### Section components must self-frame (there is no page wrapper on Source)

On the deployed page, components render as a **flat list** — there are no wrapper
divs around sections. Any layout that relied on a Storybook story wrapper (e.g. a
`<div className="max-w-screen-xl mx-auto">` in the story) renders **full-width /
unframed on the live site**. So every section-level component must own its own
frame: `mx-auto max-w-[…] px-4` plus its vertical padding. Never depend on a
story wrapper for centering, max-width, or spacing — express it as a prop or bake
it into the component.

### `max-w-screen-*` is a dead no-op in Tailwind v4 — it silently goes full-width

In Tailwind CSS v4 the `max-w-screen-{sm,md,lg,xl,2xl}` utilities are **removed**.
The class still emits `max-width: var(--breakpoint-xl)`, but `--breakpoint-*` are
build-time-only variables not exposed at runtime, so they resolve to nothing →
`max-width: none` → full width. Use **`max-w-7xl`** (= 1280px, compiles to a real
`--container-*` token) or an arbitrary value like `max-w-[1140px]`. Diagnose by
reading `getComputedStyle(el).maxWidth` on the live render — if it is `none`
despite a `max-w-*` class, it is a v4-removed token.

## Matching source site visual styles

### Measure the source's ACTUAL container width — don't assume a Tailwind token

Don't default the content container to `max-w-7xl` (1280px). Measure the source
site's content wrapper (`getComputedStyle(container).width` — a Bootstrap
`.container` is often **1140px**, not 1280) and bake that exact width into the
components with an arbitrary value (`max-w-[1140px]`) when no token fits.

### `currentColor` in inlined sprite icons resolves to the icon's OWN color

When you inline a sprite `<symbol>` that uses `fill="currentColor"`, do **not**
assume `currentColor` inherits body-text color. Measure the source icon's own
computed `color` (`getComputedStyle(svg).color`) and set that exact value on your
wrapper `<svg>` — on some sites it is a light grey that produces a deliberate
two-tone effect. Keep explicit stroke/fill hex values baked in; treat only
`currentColor` as variable.

## Matching source site visual styles — special effects

When building components to replicate a source site's design:

1. **Extract design tokens first.** Before building any component, inspect the
   source site's computed CSS to capture exact colors, gradients, shadows, and
   effects. Update `global.css` `@theme` block with any missing tokens.

2. **Replicate special effects.** Common effects that must not be approximated:
   - **Dark backgrounds** — use the correct dark color from the source (e.g.,
     navy `#0f172a`), not a generic gray.
   - **Gradient text** — use `bg-clip-text text-transparent bg-gradient-to-r`
     with the exact gradient colors from the source.
   - **Glass/blur effects** — use `backdrop-blur-*` and `bg-white/10` (or
     similar opacity) to match frosted glass panels.
   - **Box shadows** — match the source's shadow depth and spread.
   - **Overlays** — dark or colored overlays on hero images use `bg-black/50` or
     gradient overlays.

3. **Do not default to plain white.** If the source site has a dark section with
   styled text, the component must have a dark variant — not render as white
   cards on a white background.

4. **Add theme tokens for new colors.** If the source uses a color not in
   `global.css`, add it to `@theme` rather than hardcoding hex values in the
   component.

## Tailwind 4 theme variables

This project uses Tailwind CSS 4's `@theme` directive to define design tokens in
`global.css`. Variables defined inside `@theme { }` automatically become
available as Tailwind utility classes.

**Always check `global.css` for available design tokens.** The `@theme` block is
the source of truth for colors, fonts, breakpoints, and other design tokens in
this project.

### How theme variables map to utility classes

When you define a CSS variable in `@theme`, Tailwind 4 automatically generates
corresponding utility classes based on the variable's namespace prefix:

| CSS Variable in `@theme`    | Generated Utility Classes                                  |
| --------------------------- | ---------------------------------------------------------- |
| `--color-primary-600: #xxx` | `bg-primary-600`, `text-primary-600`, `border-primary-600` |
| `--color-gray-100: #xxx`    | `bg-gray-100`, `text-gray-100`, `border-gray-100`          |
| `--font-sans: ...`          | `font-sans`                                                |
| `--breakpoint-md: 48rem`    | `md:` responsive prefix                                    |

The pattern is: `--{namespace}-{name}` becomes `{utility}-{name}`.

### Examples

Given this definition in `global.css`:

```css
@theme {
  --color-primary-600: #1899cb;
  --color-primary-700: #1487b4;
}
```

You can use these colors with any color-accepting utility:

```jsx
// ✅ GOOD: Using theme tokens via utility classes
<button className="bg-primary-600 hover:bg-primary-700 text-white">
  Click me
</button>

<div className="border border-primary-600">
  Bordered content
</div>

<span className="text-primary-600">
  Colored text
</span>
```

```jsx
// ❌ AVOID: Hardcoding hex values when theme tokens exist
<button className="bg-[#1899cb] text-white hover:bg-[#1487b4]">Click me</button>
```

Arbitrary values (e.g., `bg-[#xxx]`) are acceptable for rare, one-off cases
where adding a theme variable would be overkill. However, if a color appears in
multiple places or represents a brand/design system value, add it to `@theme`
instead.

### Semantic aliases

Theme variables can reference other variables to create semantic aliases:

```css
@theme {
  --color-primary-700: #1487b4;
  --color-primary-dark: var(--color-primary-700);
}
```

Both `bg-primary-700` and `bg-primary-dark` will work. Use semantic aliases when
they better express intent (e.g., `primary-dark` for a darker brand variant).

### Adding or updating theme variables

When a design requires a color, font, or other value not yet defined in the
theme, add it to the `@theme` block in `global.css` rather than hardcoding the
value in a component.

**When to add new theme variables:**

- A design introduces a new brand color or shade
- You need a semantic alias for an existing value (e.g., `--color-accent`)
- The design uses a specific spacing, font, or breakpoint value repeatedly

**When to update existing theme variables:**

- The brand colors change (update the hex values)
- Design tokens need adjustment across the system

**Example - adding a new color:**

```css
@theme {
  /* Existing tokens */
  --color-primary-600: #1899cb;

  /* New token for a success state */
  --color-success: #22c55e;
  --color-success-dark: #16a34a;
}
```

After adding, you can immediately use `bg-success`, `text-success-dark`, etc.

**Keep the theme organized.** Group related tokens together with comments
explaining their purpose. Follow the existing naming conventions in `global.css`
(e.g., numbered shades like `primary-100` through `primary-900`, semantic names
like `primary-dark`).

## Color props must use variants, not color codes

**Never create props that allow users to pass color codes** (hex values, RGB,
HSL, or any raw color strings). Instead, define a small set of human-readable
variants using CVA that map to the design tokens in `global.css`.

**Always check `global.css` for available design tokens.** The tokens defined
there (such as `primary-*`, `gray-*`, etc.) are the source of truth for color
values in this project.

**Wrong - allowing raw color values:**

```yaml
# ❌ BAD: Allows arbitrary color codes as prop values
props:
  properties:
    backgroundColor:
      title: Background Color
      type: string
      examples:
        - '#3b82f6'
```

```jsx
// ❌ BAD: Uses inline style with raw color value
const Card = ({ backgroundColor }) => (
  <div style={{ backgroundColor }}>{/* ... */}</div>
);
```

**Correct - using CVA variants with design tokens:**

```yaml
# ✅ GOOD: Offers curated color scheme options
props:
  properties:
    colorScheme:
      title: Color Scheme
      type: string
      enum:
        - default
        - primary
        - muted
        - dark
      meta:enum:
        default: Default (White)
        primary: Primary (Blue)
        muted: Muted (Light Gray)
        dark: Dark
      examples:
        - default
```

```jsx
// ✅ GOOD: Uses CVA variants mapped to design tokens
import { cva } from 'class-variance-authority';

const cardVariants = cva('rounded-lg p-6', {
  variants: {
    colorScheme: {
      default: 'bg-white text-black',
      primary: 'bg-primary-600 text-white',
      muted: 'bg-gray-100 text-gray-700',
      dark: 'bg-gray-900 text-white',
    },
  },
  defaultVariants: {
    colorScheme: 'default',
  },
});

const Card = ({ colorScheme, children }) => (
  <div className={cardVariants({ colorScheme })}>{children}</div>
);
```

This approach ensures:

- Consistent colors across the design system
- Users select from curated, meaningful options (not arbitrary values)
- Easy theme updates by modifying `global.css` tokens
- Better accessibility through tested color combinations

## Component metadata

Every `component.yml` must include these top-level keys:

```yaml
name: Component Name # Human-readable display name
machineName: component_name # Machine name in snake_case
status: true # Whether the component is enabled
required: [] # Array of required prop names
props:
  properties:
    # ... prop definitions
slots: [] # Array of slot definitions or empty
```

**Props must have title and examples.**

`title` is REQUIRED on every prop — the Canvas editor uses it as the label.
Every prop definition must include a `title` for the UI label. The `examples`
array is required for required props and recommended for all others. Only the
first example value is used by Drupal Canvas.

**Never include `className` in component.yml metadata** — it's a composition
prop passed by parent components, not an editor-facing prop.

```yaml
props:
  properties:
    heading:
      title: Heading
      type: string
      examples:
        - Enter a heading...
```

**Prop IDs must be camelCase versions of their titles.**

The prop ID (the key under `properties`) must be the camelCase conversion of the
`title` value.

```yaml
# Correct - prop ID is camelCase of title
props:
  properties:
    buttonText:           # camelCase of "Button Text"
      title: Button Text
      type: string
    backgroundColor:      # camelCase of "Background Color"
      title: Background Color
      type: string
    isVisible:            # camelCase of "Is Visible"
      title: Is Visible
      type: boolean

# Wrong - prop IDs don't match titles
props:
  properties:
    btn_text:             # should be "buttonText" for title "Button Text"
      title: Button Text
    bgColor:              # should be "backgroundColor" for title "Background Color"
      title: Background Color
```

## Prop types

### Text

Basic text input. Stored as a string value.

```yaml
type: string
examples:
  - Hello, world!
```

### Formatted text

Rich text content with HTML formatting support, displayed in a block context.

```yaml
type: string
contentMediaType: text/html
x-formatting-context: block
examples:
  - <p>This is <strong>formatted</strong> text with HTML.</p>
```

### Link

URL or URI reference for links to internal or external resources.

```yaml
type: string
format: uri-reference
examples:
  - /about/contact
```

**Note:** The format can be either `uri` (accepts only absolute URLs) or
`uri-reference` (accepts both absolute and relative URLs).

**IMPORTANT: Use proper path examples for URL props.** Do not use `#` as an
example value for `uri-reference` props—it can cause validation failures during
upload. Always use realistic path-like examples:

```yaml
# ✅ Correct - proper path examples
examples:
  - /resources
  - /about/team
  - https://example.com/page

# ❌ Wrong - can cause upload failures
examples:
  - "#"
  - ""
```

### Image

Reference to an image object with metadata like alt text, dimensions, and file
URL. Only the file URL is required to exist, all other metadata is always
optional.

```yaml
type: object
$ref: json-schema-definitions://canvas.module/image
examples:
  - src: >-
      https://images.unsplash.com/photo-1484959014842-cd1d967a39cf?ixlib=rb-1.2.1&ixid=MnwxMjA3fDB8MHxwaG90by1wYWdlfHx8fGVufDB8fHx8&auto=format&fit=crop&w=1770&q=80
    alt: Woman playing the violin
    width: 1770
    height: 1180
```

### YouTube embeds

**Never guess YouTube video IDs from screenshots or descriptions — they will be wrong.** Always extract real IDs from the live page before building:

```bash
agent-browser open <url>
agent-browser eval --stdin << 'EOF'
JSON.stringify([...document.querySelectorAll('iframe')].map(f => ({
  src: f.src,
  id: (f.src.match(/embed\/([^?&]+)/) || [])[1] || null,
})), null, 2);
EOF
```

**In Storybook (local dev), `<iframe>` embeds show "Video unavailable"** because YouTube blocks playback from localhost. Render a thumbnail + play button link instead so Storybook is useful:

```jsx
<a href={`https://www.youtube.com/watch?v=${youtubeId}`} target="_blank" rel="noopener noreferrer"
   className="relative block w-full aspect-video group">
  <img src={`https://img.youtube.com/vi/${youtubeId}/maxresdefault.jpg`}
       alt={title} className="w-full h-full object-cover" />
  <span className="absolute inset-0 flex items-center justify-center">
    <span className="w-12 h-12 bg-red-600 rounded-sm flex items-center justify-center group-hover:bg-red-500 transition-colors">
      <svg className="w-5 h-5 text-white fill-current ml-1" viewBox="0 0 24 24">
        <path d="M8 5v14l11-7z"/>
      </svg>
    </span>
  </span>
</a>
```

Use `maxresdefault.jpg` — loads from YouTube's image CDN without hotlink protection. The thumbnail + link approach also works correctly when deployed to Canvas.

### Video

Reference to a video object with metadata like dimensions and file URL. Only the
file URL is required to exist, all other metadata is always optional.

```yaml
type: object
$ref: json-schema-definitions://canvas.module/video
examples:
  - src: https://media.istockphoto.com/id/1340051874/video/aerial-top-down-view-of-a-container-cargo-ship.mp4?s=mp4-640x640-is&k=20&c=5qPpYI7TOJiOYzKq9V2myBvUno6Fq2XM3ITPGFE8Cd8=
    poster: https://example.com/600x400.png
```

### Boolean

True or false value.

```yaml
type: boolean
examples:
  - false
```

### Integer

Whole number value without decimal places.

```yaml
type: integer
examples:
  - 42
```

### Number

Numeric value that can include decimal places.

```yaml
type: number
examples:
  - 3.14
```

### List: text

A predefined list of text options that the user can select from.

```yaml
type: string
enum:
  - option1
  - option2
  - option3
meta:enum:
  option1: Option 1
  option2: Option 2
  option3: Option 3
examples:
  - option1
```

### List: integer

A predefined list of integer options that the user can select from.

```yaml
type: integer
enum:
  - 1
  - 2
  - 3
meta:enum:
  1: Option 1
  2: Option 2
  3: Option 3
examples:
  - 1
```

## Enum value naming

Enum values must use lowercase, machine-friendly identifiers. Use `meta:enum` to
provide human-readable display labels for the UI.

**Note:** Enum values cannot contain dots.

**Match the starter's existing convention when it differs.** The lowercase rule
is a default, not absolute — the validator also accepts **Title-Case** enum
values (`Solid`, `Centered`, `Large`). Some starters use Title-Case throughout.
Before writing enums, read a couple of existing `component.yml` files in the
project and **match whichever convention they use** — consistency within the
starter wins over the blanket lowercase rule.

```yaml
# Correct
enum:
  - left_aligned
  - center_aligned
meta:enum:
  left_aligned: Left aligned
  center_aligned: Center aligned
examples:
  - left_aligned

# Wrong - using display labels as enum values
enum:
  - Left aligned
  - Center aligned
```

The `examples` value must be the enum value, not the display label.

### Enum values must match JSX component variants

When using class-variance-authority (CVA) or similar libraries in the JSX
component, the variant keys must exactly match the enum values defined in
`component.yml`.

```jsx
// component.yml defines: enum: [left_aligned, center_aligned]
// CVA variants must match:
const variants = cva('base-classes', {
  variants: {
    layout: {
      left_aligned: 'text-left', // matches enum value
      center_aligned: 'text-center', // matches enum value
    },
  },
});
```

## Slots

Slots allow other components to be embedded within a component. In React, slots
are received as props containing the rendered children.

Slots are defined as **object maps keyed by slot name** — NOT arrays. This is a
common mistake.

```yaml
# ✅ Correct — object map keyed by slot name
slots:
  content:
    title: Content
  buttons:
    title: Buttons

# ❌ Wrong — slots is not an array of objects
slots:
  - name: content
    title: Content
```

In the JSX component, slots are destructured as props and rendered directly:

```jsx
const Section = ({ width, content }) => {
  return <div className={sectionVariants({ width })}>{content}</div>;
};
```

Use an empty array when the component has no slots:

```yaml
slots: []
```

**Slot visibility in the page editor.** Slots in content-sized containers need
minimum sizing (`min-w-32 min-h-8`) to be selectable in the Canvas page editor.
Without this, editors can't click into the slot to add components.

## Defensive Prop Handling

Components run server-side in Canvas. An unguarded null access will crash the
page renderer and cause rendering errors. **Every optional prop must be
null-safe.**

### Image props

Image props (`$ref: .../image`) may be `null` or `undefined` if the media entity
fails to resolve (wrong `target_id`, deleted media, type mismatch). Never access
`.src` directly on an image prop.

```jsx
// ❌ DANGEROUS — crashes if backgroundImage is null/undefined
<div style={{ backgroundImage: `url(${backgroundImage.src})` }} />;

// ✅ SAFE — guard with optional chaining or destructuring
const { src, alt, width, height } = backgroundImage || {};
{
  src && <div style={{ backgroundImage: `url(${src})` }} />;
}

// ✅ SAFE — also fine with optional chaining
<Image src={image?.src} alt={image?.alt} />;
```

### Link props

Link props (`format: uri-reference`) should be plain strings but page data may
incorrectly contain Drupal link objects `{"uri": "/path", "options": []}`. Guard
against this:

```jsx
// ✅ SAFE — handle both string and object forms
const href = typeof link === 'string' ? link : link?.uri || '#';
```

### Formatted text props

Rich text props (`contentMediaType: text/html`) should be
`{"value": "<html>", "format": "canvas_html_block"}` but may arrive as plain
strings:

```jsx
// ✅ SAFE — handle both forms
const htmlContent = typeof text === 'object' ? text.value : text;
```

### General rules

- **Destructure with defaults:** `const { src } = image || {}`
- **Guard before rendering:** `{image?.src && <Image ... />}`
- **Test with missing props** in Storybook — create a story variant with
  minimal/empty props to verify the component doesn't crash.
- **Never access nested properties** on a prop without checking the parent
  exists first. (Also audit *existing* shared components you reuse — an unguarded
  `const { src } = image;` will crash at SSR/hydration the moment you reuse the
  component without that prop.)

### Prop vs. derive-in-component: not every behaviour needs a prop

A JS function-arg default that is **not declared in `component.yml`** cannot be
passed as a page input — `canvas-jsonapi update` rejects it as an unknown prop.
Two ways to control such behaviour on the deployed page:

- **(a) Add a real `component.yml` prop** (+ push) — when an author genuinely
  needs to choose per instance.
- **(b) Derive the behaviour INSIDE the component** from data it already has —
  when the rule is intrinsic to the content. Example: a card that auto-detects a
  link list (`/<ul[\s>]/i.test(textHtml)`) and disables its hover background for
  those cards only. No new prop, no per-instance input, works on Source
  immediately.

Prefer (b) for intrinsic rules; reach for (a) only when per-instance choice is
needed.

## JSX Syntax Rules

JSX has stricter parsing rules than HTML. Violating these causes Storybook to
fail to index the file entirely.

### HTML strings in props must use JS expression syntax

When a prop value contains HTML (tags, attributes, entities), wrap it in `{}`
rather than passing it as a plain JSX attribute string. JSX parses `<` inside
attribute strings as the start of a new element.

```jsx
// ❌ WRONG — JSX parser chokes on the `<p>` and `<a>` tags
<Component body="<p>Some <a href='/link'>text</a></p>" />

// ✅ CORRECT — JS string expression, parser ignores the HTML
<Component body={'<p>Some <a href="/link">text</a></p>'} />
```

This applies to any prop containing: HTML tags, `href` attributes inside HTML,
`&amp;` entities, or any `<` / `>` characters.

### After writing any JSX file, verify syntax is valid

Run this from `canvas/`:

```bash
node --input-type=module <<'EOF'
import { readFileSync } from 'fs';
// Quick parse check — Vite will also catch this on next HMR
EOF
```

Or simply check that Storybook's HMR output shows no parse errors after saving.
If Storybook logs `Unable to index <file>`, the file has a JSX syntax error —
fix it before moving on.

## Structural Verification

After building or modifying a component, verify it works structurally — not just
visually.

1. **All props render visible output.** If a prop exists, it should affect what
   the user sees. Unused props indicate a design mismatch between
   `component.yml` and `index.jsx`.
2. **Slots accept and display children.** Place actual child components in each
   slot and verify they render in the correct container element with appropriate
   layout.
3. **Test with realistic content.** Use multiple menu items (not just one), real
   paragraph text (not "Lorem ipsum"), actual image dimensions, and
   representative data. Placeholder content that's too simple hides structural
   problems — a footer story with `text: "Footer"` won't reveal that the
   component can't render 3 menu columns.
4. **Verify the deployed version.** After uploading, use the Canvas Code Editor
   at `<CMS_URL>/canvas/code-editor/component/<name>` to confirm the deployed
   component matches your local source.
5. **Check multiple viewport sizes.** View in Storybook at desktop, tablet, and
   mobile widths. Verify responsive behavior matches the source site's
   responsive design.

## Acquia Source Documentation

When building components for Acquia Source, consult the official documentation
to understand platform capabilities and constraints. Use the
`acquia-source-docs-explorer` skill to fetch relevant docs:

```
/acquia-source-docs-explorer components props slots known issues
```

Key platform constraints to be aware of:

- Tailwind directives work in `global.css` only — **not in component-specific
  CSS**.
- Tailwind square bracket notation does not work with `@apply`. Use `@theme`
  variables instead.
- Removing components via the Component Library UI triggers an error — use the
  Code component panel.

Always check the docs when encountering unexpected behavior. The platform has
documented workarounds for known issues.

## Data Fetching with SWR and JSON:API

Canvas components can fetch data from Drupal's JSON:API using SWR hooks. This
pattern is used for dynamic content like article listings, taxonomy terms, and
related content.

### Setup Gate

Before writing any data-fetching component:

1. Verify `.env` has `CANVAS_SITE_URL` set
2. Test JSON:API reachability: `curl -s "$CANVAS_SITE_URL/jsonapi" | head -5`
3. If unreachable, the component must work with static props only

### SWR Hook Pattern

```jsx
import { DrupalJsonApiParams, JsonApiClient } from 'drupal-canvas';
import useSWR from 'swr';

const fetcher = (url) => JsonApiClient.getCollection(url);

export default function ArticleList({ count = 3 }) {
  const params = new DrupalJsonApiParams();
  params
    .addSort('created', 'DESC')
    .addFields('node--article', ['title', 'field_image', 'created', 'path'])
    .addInclude(['field_image', 'field_image.field_media_image'])
    .addPageLimit(count);

  const { data, error, isLoading } = useSWR(
    `/jsonapi/node/article?${params.getQueryString()}`,
    fetcher,
  );

  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error loading articles</div>;
  return (
    <ul>
      {data?.data?.map((article) => (
        <li key={article.id}>{article.attributes.title}</li>
      ))}
    </ul>
  );
}
```

### DrupalJsonApiParams Methods

| Method                              | Purpose               | Example                                 |
| ----------------------------------- | --------------------- | --------------------------------------- |
| `addSort(field, direction)`         | Sort results          | `addSort('created', 'DESC')`            |
| `addInclude(fields)`                | Include relationships | `addInclude(['field_image'])`           |
| `addFields(type, fields)`           | Sparse fieldsets      | `addFields('node--article', ['title'])` |
| `addFilter(field, value, operator)` | Filter results        | `addFilter('status', '1')`              |
| `addPageLimit(limit)`               | Limit results         | `addPageLimit(5)`                       |

### Circular Reference Avoidance

**CRITICAL:** Never `addInclude` self-referential fields. For example, an
Article with `field_related_articles` that references other Articles creates
infinite recursion in SWR's deep equality check.

```jsx
// WRONG — infinite recursion
params.addInclude(['field_related_articles']);

// CORRECT — separate query
const { data: article } = useSWR(`/jsonapi/node/article/${id}`, fetcher);
const relatedIds =
  article?.data?.relationships?.field_related_articles?.data?.map((r) => r.id);
const { data: related } = useSWR(
  relatedIds
    ? `/jsonapi/node/article?filter[id][value]=${relatedIds.join(',')}`
    : null,
  fetcher,
);
```

### Filter Options

Fetch filter options dynamically via JSON:API. Never hardcode taxonomy terms or
categories:

```jsx
const { data: categories } = useSWR('/jsonapi/taxonomy_term/category', fetcher);
```

### Storybook Rule

Don't mock JSON:API in stories. Components should gracefully show loading or
empty states in Storybook since JSON:API won't be available.

### `getNodePath` Utility

Use `getNodePath` from `drupal-canvas` for generating node URLs:

```jsx
import { getNodePath } from 'drupal-canvas';

const url = getNodePath(node); // Returns the aliased path
```

## Component Composability

### When to decompose

Components with 6-8+ props or multiple distinct visual sections should be split
into smaller components connected via slots.

### Slots vs props

Use **slots** for variable/composite child content that content editors compose
in the page editor. Use **props** for single values and configuration (text,
colors, booleans, enums).

### Common decomposition patterns

- **Header/content/footer** — a section component with separate slots for each
  region
- **Card with media/body/actions** — media slot for images/video, body slot for
  text, actions slot for buttons
- **List containers with item slots** — a grid/list parent with a slot that
  accepts repeated child components

### When NOT to decompose

Don't split components that always appear together, share internal state, or
would create unnecessary indirection. A button with an icon doesn't need the
icon as a separate slotted component.

### Repeatable Content Pattern (Parent/Child Slots)

Canvas does NOT support `type: array` props with object items. When you need
repeatable structured content, use the parent/child slot pattern:

**Pattern:** Parent component (grid/list container) + child component
(card/item) connected via a named slot.

| Parent Component | Child Component     | Slot Name |
| ---------------- | ------------------- | --------- |
| `card_grid`      | `card`              | `cards`   |
| `footer`         | `footer_link_group` | `groups`  |
| `stats_hero`     | `stat_item`         | `stats`   |
| `carousel`       | `carousel_item`     | `slides`  |
| `icon_grid`      | `icon_card`         | `items`   |

**Child naming conventions:**

- `-card` suffix for visually distinct card-type items
- `-item` suffix for generic repeated elements
- `-link` suffix for link-type items
- `-group` suffix for grouped sub-containers

**Example — Card Grid parent:**

```yaml
# component.yml for card_grid
props:
  columns:
    type: string
    enum: ['2', '3', '4']
slots:
  cards:
    title: Cards
```

**Example — Card child:**

```yaml
# component.yml for card
props:
  title:
    type: string
  image:
    type: object
  link:
    type: object
```

### Slot Container Minimum Size Rule

When a slot wrapper is a flex item, grid item, or inline element, it can
collapse to zero height/width when empty. This hides Canvas editor drop zones,
making it impossible for content editors to add content.

**Fix:** Add minimum dimensions to slot containers:

```jsx
// WRONG — slot collapses to zero in flex container
<div className="flex gap-4">
  <div>{slots.sidebar}</div>  {/* Invisible when empty */}
</div>

// CORRECT — slot has minimum size
<div className="flex gap-4">
  <div className="min-w-32 min-h-8">{slots.sidebar}</div>
</div>
```

**When this is NOT needed:**

- Slot wrapper has fixed dimensions (e.g., `w-64`)
- Slot wrapper is block-level and full-width
- Slot wrapper has padding that provides inherent size

### Decomposition Signals (Strengthened)

A component SHOULD be decomposed when:

- **>6-8 distinct props** serving different visual/functional purposes — split
  into parent + slotted children
- **Props for elements that make sense standalone** (breadcrumbs, titles,
  navigation elements) — extract as separate components
- **Repeatable content modeled as array-of-objects** — MUST use parent/child
  slot pattern instead
- **Multiple layout variants** that change the component structure (not just
  styling) — consider separate components or slots

## Upload Behavior & Caveats

- `canvas upload` **overwrites published components without warning** — there is
  no confirmation prompt or version check.
- It does NOT discard unpublished changes in the browser Canvas editor — if
  someone has unsaved edits in the editor, they persist alongside the upload,
  causing confusion. Discard manually in the browser.
- HTTP 422 errors often indicate folder naming issues — folder names must be all
  lowercase (hyphens/underscores OK).
- **Dependency-related failures are expected** on first upload when components
  import other components. The imported component may not exist on the server
  yet. Re-run the upload — it will succeed once dependencies are present.
- Connection/setup failures (auth errors, unreachable server) should NOT be
  retried — fix the .env config first.

## Canvas Documentation

- Official docs: `https://project.pages.drupalcode.org/canvas/`
- Code Components:
  `https://project.pages.drupalcode.org/canvas/code-components/`
- Packages (FormattedText, cn, CVA, SWR):
  `https://project.pages.drupalcode.org/canvas/code-components/packages/`
- Data Fetching (getPageData, getSiteData, JsonApiClient):
  `https://project.pages.drupalcode.org/canvas/code-components/data-fetching/`

## Default Props Must Match Story Values

**Component JSX default prop values must use the same realistic content as the
Storybook story for that component.** This ensures:

- The component renders correctly in the Canvas Code Editor preview (which uses
  defaults when no page data overrides them)
- Storybook and the Canvas editor show the same output for unset props
- Content editors see a meaningful preview, not placeholder text like "Enter a
  heading..."

### Rule

**Wherever a story sets a prop value, the JSX default for that prop must match.**

```jsx
// ✅ GOOD — defaults match story content
export default function RmhPageHero({
  title = "Who We Are",
  imageSrc = "https://176202-....cms.acquia.site/sites/default/files/2026-05/Family_Hike_1450.jpg",
  imageAlt = "A family of four hikes a trail in a green landscape.",
}) { ... }
```

```jsx
// ❌ BAD — defaults are placeholders, story uses real content
export default function RmhPageHero({
  title = "Page Title",
  imageSrc = "",
  imageAlt = "",
}) { ... }
```

### Images

Default image props (`imageSrc`, `imageAlt`) must use the CDN URL of the actual
uploaded image for that component — not an empty string, not a placeholder.co
URL. The CDN URL format is:

```
https://<ID>.cms.acquia.site/sites/default/files/<year-month>/<filename>
```

Upload the image first (via `npm run canvas:upload-images`), then use the
returned CDN URL as the JSX default.

### Text

Default text props must use real, representative content from the source site —
not generic filler like "Lorem ipsum" or "Enter text here." Copy the actual
heading, body text, or label from the source page.

### The component.yml `examples` field

The `examples` value in `component.yml` must also match the story/default value.
Only the first example is shown in the Canvas editor UI — make it meaningful.

## Canvas-Starter Reference

For canonical Canvas component patterns, see the canvas-starter reference skills
at `.claude/reference/canvas-starter/`. Key references:
`canvas-component-metadata` for component.yml schema,
`canvas-component-composability` for decomposition patterns,
`canvas-component-upload` for upload error handling.
