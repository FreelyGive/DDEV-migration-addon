---
name: stories
description:
  'Creating and modifying Storybook 10 stories using atomic design hierarchy.
  Covers atom stories (src/stories/atoms/), molecule stories
  (src/stories/molecules/), organism stories (src/stories/organisms/), template
  stories (src/stories/templates/), page stories (src/stories/pages/), and test
  stories (src/stories/tests/). Includes naming conventions (kebab-case
  .stories.tsx), autodocs setup, controls matching component.yml props and
  slots, placeholder images via placehold.co, real asset handling with index.ts
  exports, PageLayout usage for fullscreen page stories, and rules against
  direct HTML markup in story arguments. Use when creating, updating, or fixing
  any Storybook story file.'
---

# Creating and modifying stories

Stories prove your components work. They are living documentation, visual
regression references, and the first place structural problems become visible. A
story that renders correctly with realistic content gives confidence; a story
that only works with placeholder text hides structural gaps.

Stories fall into a few categories:

## Component stories (Atomic Design Hierarchy)

Stories are organized by atomic design level:

| Level     | Location                 | Components                                                                                                                                     |
| --------- | ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Atoms     | `src/stories/atoms/`     | button, heading, text, image, spacer, logo, video                                                                                              |
| Molecules | `src/stories/molecules/` | card, blockquote, logo_card, search_form, search_button, breadcrumb                                                                            |
| Organisms | `src/stories/organisms/` | hero, card_container, two_column_text, grid_container, stats_banner, contact_section, header, footer, main_navigation, search_results, section |

- Naming convention: `<component-name>.stories.tsx` using `kebab-case`
- Story titles use the level as prefix: `Atoms/Button`, `Molecules/Card`,
  `Organisms/Hero`

Auto documentation should be used, and all parameter types must be explicitly
defined with appropriate controls. Always cross-reference the story parameters
with the `component.yml` `props` and `slots`.

Non-interactive tests (e.g. expects) can be added to component stories, but
interactive tests that simulate user input MUST NOT be included in stories.

Both props and slots arguments MUST be either scalar values, an image object
type, or a React fragment of public components. You must never use direct
markup.

## Test stories

- Location: `src/stories/tests/`
- Naming convention: `<component-name>.stories.tsx` using `kebab-case`, although
  if a component has a large number of tests, they can be grouped using
  `<component-name>-<group>.stories.tsx`.

These are intended to provide automated tests for components and other UI
elements.

Auto documentation MUST be disabled.

If a component makes use of the canvas parsing to directly inspect or manipulate
components in props, a test should be added to ensure that the component
correctly parses the canvas island.

## Templates

- Location: `src/stories/templates/`
- Contains the PageLayout component that wraps pages with header and footer.
- Story title prefix: `Templates/`

## Page stories

- Location: `src/stories/pages/`
- Naming convention: `<page-name>.stories.tsx` using `kebab-case`.
- Story title prefix: `Pages/`

These provide an example of how a page could be built using components.

Autodocs must be disabled and the fullscreen layout must be used. There must
only be one story per page.

The PageLayout component from the templates story
(`src/stories/templates/PageLayout.stories.tsx`) should be used to ensure
consistent wrapping of the page.

Both props and slots arguments MUST be either scalar values, an image object
type, or a React fragment of public components. You must never use direct
markup.

## Assets

### Placeholder images

Placeholder.io can be used to generate placeholder images for components:

```
{
   src: "https://placehold.co/800x600",
   alt: "Example image placeholder",
   width: 800,
   height: 600,
}
```

## Page Story Composition Rules

Page stories MUST only import and compose existing components.

### Allowed

- Import from `@/components/<name>`
- Pass props and compose together
- Define sample data objects (strings, image objects, arrays of scalars)

### NOT Allowed

- Define React components inline in the story file
- Use raw HTML elements (`<div>`, `<span>`, `<section>`) for layout
- Duplicate existing component code
- Pass `className` prop (not available in Canvas editor)

If you need a wrapper `<div>`, find the existing component that provides that
layout (e.g., `section` for width constraints, `grid_container` for columns). If
none exists, create a component first.

### Spacing Between Components

Control spacing between components using the `spacer` component, NOT margins,
padding, or wrapper divs.

```jsx
// Correct
<Hero title="About Us" />
<Spacer height="large" />
<Section width="normal" content={<Text text="<p>Our story...</p>" />} />

// Wrong — raw HTML and className for spacing
<Hero title="About Us" />
<div className="mt-16">
  <Section width="normal" content={<Text text="<p>Our story...</p>" />} />
</div>
```

### Single-Story Hoisting

Page stories should export only ONE story (typically `Default`) with a `name`
property matching the page title. This creates flat sidebar navigation instead
of nested folders.

```tsx
export const Default: Story = {
  name: 'Home Page',
  render: () => (
    <PageLayout>
      <Hero ... />
      <Spacer height="large" />
      <Section ... />
    </PageLayout>
  ),
};
```

## Page Stories for Migration

When migrating a site, every migrated page should have a corresponding page
story that serves as a visual regression reference.

- **Compose all components in the same order as the migrated page** — hero, then
  content sections, then CTA, then footer. The story should mirror the page
  structure.
- **Use realistic content that matches the source.** Real headings, real body
  text, real image dimensions. Placeholder content hides structural problems —
  if the footer story only shows `text: "Footer"` instead of 3 menu columns with
  social links, it won't catch a structurally inadequate footer component.
- **Page stories are regression tests.** If a component changes break a page
  story, that's a signal — not noise.

## Structural Testing via Stories

Stories are the first line of defense — if a component crashes in Storybook, it
will crash on the live site.

- **Create a story variant with NO props passed** (bare minimum render) — this
  simulates SSR with empty data. If it crashes, the component will crash the
  live site when rendered server-side without data.
- **Create a story variant with FULL realistic content** — this verifies all
  structural elements render. If the source footer has logo, 3 menu columns,
  social links, and copyright, create a story variant with all of those
  populated.
- **Verify all structural elements render.** Columns should appear, menu items
  should list, slot children should display in their containers.
- **If only partial content renders in a story, it will be partial on the live
  site too.** A story is a truthful preview of component capability.
- If `npm run build` (Storybook static build) fails, fix before uploading.

### Real assets

Assets should be stored in the `src/stories/assets` directory, in suitable
subdirectories depending on the scope of the asset. An `index.ts` file must be
created to export the assets with the correct image type. Real assets must never
be directly imported in stories without their image type. The image type must
include the correct dimensions and provide alt text.

## Acquia Source Documentation

When building stories for components deployed to Acquia Source, consult the
official documentation to understand how props, slots, and component patterns
work on the platform. Use the `acquia-source-docs-explorer` skill:

```
/acquia-source-docs-explorer components props slots patterns
```

This helps ensure your stories test against realistic platform constraints, not
just local rendering.

## Canvas-Starter Reference

The canvas-starter's `get-examples.js` utility pattern parses `component.yml` to
extract example prop values automatically for stories. See
`.claude/reference/canvas-starter/` for this pattern. Consider adopting if you
want auto-generated story variants from component.yml examples.
