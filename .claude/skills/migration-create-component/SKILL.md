---
name: create-component
description:
  'Step-by-step guide for scaffolding a new React component from scratch. Covers
  copying an existing component as a base, creating the required index.jsx and
  component.yml files, naming conventions (snake_case machineName, no project
  prefixes), creating the matching Storybook story file, reusing existing
  components via imports, composability patterns, and internal component setup
  (status false). Use when a needed component does not yet exist in
  src/components/ and must be created.'
---

# Creating new components

Creating a component is an act of design. Before scaffolding files, understand
what the component needs to represent — its content areas, layout structure, and
the CMS data it will render. The template you start from is a starting point,
not a constraint.

## Step 0: Deep Understanding Before Scaffolding

Before creating any component:

1. **Inspect the source section's DOM structure.** What HTML elements, CSS
   layout, and content areas does this section use? How many columns? What's
   dynamic vs. static?
2. **Draft the component interface first.** List every prop (with type), every
   slot, and every variant the component needs. Write this down before touching
   code.
3. **Choose a template based on interface needs**, not just visual similarity.
   If you need a multi-column footer with menus and social links, don't start
   from a component that only has a `{text}` prop — even if it's called
   "footer."
4. **Don't let the template constrain you.** A copied component is scaffolding.
   Replace its props, slots, and JSX entirely if the target section demands a
   different structure.

After creation, verify: **can this component represent the full structure of its
target section?** Every content area in the source should map to a prop or slot.
If it can't, the component is incomplete.

## Scaffolding Steps

When asked to create a new component:

1. Browse `src/components/` to find a similar component that can serve as a
   starting point (e.g., use `blockquote` as a base for an "alert" component, or
   `button` for any interactive element)
2. Copy the component folder to `src/components/<new_name>/`
3. Copy the corresponding story from `src/stories/`
4. Modify the copied files to implement the new component

**CRITICAL: Every component MUST have its own individual story file.** When
copying from existing components, always copy both the component folder AND its
corresponding story file. The story file naming convention is
`<component-name>.stories.jsx` (using kebab-case with hyphens).

This approach ensures consistent patterns for `component.yml` structure, JSX
conventions, and Storybook story format across all components.

**Example:** To create a new "Alert" component based on the Blockquote example:

```bash
cp -r src/components/blockquote src/components/alert
cp src/stories/components/blockquote.stories.tsx src/stories/components/alert.stories.tsx
```

Then modify the copied files to implement the Alert component.

Components use the `@/components` import alias, which points to
`src/components`. When you copy and modify exisiting components, the imports
will work automatically.

## Dependency Resolution When Copying Components

When copying a component as a template, you must also copy its dependencies:

1. Read the component's `index.jsx`
2. Find all `@/components/<name>` imports
3. For each imported component, check if it already exists in `src/components/`
4. If missing: recursively copy it from the source (existing components or
   examples)
5. Recurse: each copied dependency may have its own `@/components/<name>`
   imports

**Example:** Copying `hero` which imports `heading` and `button`:

- Check `src/components/heading/` — exists? Skip. Missing? Copy.
- Check `src/components/button/` — exists? Skip. Missing? Copy.
- Check `heading`'s imports — imports `@/components/text`? Copy if missing.

**Never overwrite existing components** during dependency copying. Only copy
what's missing.

## Component naming conventions

**Use simple, generic names.** Never prefix component names with the project or
site name. Components should be reusable and their names should describe their
purpose, not their origin.

```
# Correct - simple, descriptive names
footer
hero
navigation
contact_form

# Wrong - prefixed with project/site name
nebula_footer
acme_hero
mysite_navigation
projectx_contact_form
```

This ensures components remain portable and their names clearly communicate
their function rather than their project context.

## Reuse existing components

**Always check `src/components/` before creating new UI elements.** When
building a component that needs common UI elements (buttons, headings, images,
etc.), import and use existing components rather than duplicating their
functionality.

```jsx
// ✅ GOOD: Import and use the existing button component
import Button from '@/components/button';

const NewsletterSignup = ({ onSubmit }) => (
  <form onSubmit={onSubmit}>
    <input type="email" placeholder="Enter your email" />
    <Button variant="primary">Subscribe</Button>
  </form>
);
```

```jsx
// ❌ BAD: Duplicating button styles instead of reusing the component
const NewsletterSignup = ({ onSubmit }) => (
  <form onSubmit={onSubmit}>
    <input type="email" placeholder="Enter your email" />
    <button className="rounded bg-primary-600 px-4 py-2 text-white">
      Subscribe
    </button>
  </form>
);
```

This ensures visual consistency, reduces duplication, and makes updates easier
since changes to a shared component automatically apply everywhere it's used.

**Design components for composability.** By default, avoid building layout
constraints (like `max-width` or centering) into individual components. Layout
components such as `section` handle width constraints when composing pages, so
most components should remain flexible and adapt to their container.

Include built-in layout constraints when the component doesn't make sense in any
other layout context (such as `header` or `footer`), or when the design
specifically requires it.

```jsx
// ✅ GOOD: Component adapts to its container width
const Card = ({ title, children }) => (
  <div className="rounded-lg border p-4">
    <h3>{title}</h3>
    {children}
  </div>
);
```

```jsx
// ❌ BAD: Component has built-in width constraints (limits composability)
const Card = ({ title, children }) => (
  <div className="mx-auto max-w-md rounded-lg border p-4">
    <h3>{title}</h3>
    {children}
  </div>
);
```

## Required component contract

Every component must satisfy the **4-part contract**:

1. `index.jsx` — React component implementation (default export)
2. `component.yml` — Canvas metadata defining props, slots, and enums
3. Folder name matching `machineName` — lowercase `snake_case` (preferred) or
   `kebab-case`
4. A Storybook story file — in `src/stories/components/`

If any part is missing, the component is incomplete and will fail upload or
editor rendering.

### Recommended build order

1. **Metadata first** — define component.yml with props, slots, enums
2. **Composability** — decide what should be slots vs props
3. **Styling** — define design tokens in global.css, create CVA variants
4. **Utilities** — use FormattedText for HTML props, Image for image props
5. **Data fetching** — add SWR/JsonApiClient if the component fetches data
6. **Story** — create Storybook story with realistic content
7. **Validate** — run `npm run code:fix` (Prettier + ESLint + Canvas
   requirements), then `npm run canvas:validate`, then `npm run canvas:ssr-test`
8. **Upload** — run `npm run canvas:upload -- -- -c <name>` only after
   validation passes

## Required component folder structure

**CRITICAL:** Every component folder in `src/components/` MUST contain two
files:

```
src/components/<component_name>/
├── index.jsx      # React component source code (REQUIRED)
└── component.yml  # Component metadata and props (REQUIRED)
```

**Never create a component folder without both files.** The `index.jsx` contains
the actual React component implementation. The `component.yml` defines the
component's metadata, props, and slots for Drupal Canvas.

The directory name must match machineName. The component folder name must
exactly match the `machineName` value defined in `component.yml`. Use
`snake_case` as the preferred format, though `kebab-case` is also supported.

After creating components, verify the folder structure:

```bash
# List all component folders and their contents
ls -la src/components/*/

# Verify each new component has both required files
ls src/components/<component_name>/index.jsx
ls src/components/<component_name>/component.yml
```

If a component folder is missing either file, the component is incomplete and
will not work. Both `index.jsx` and `component.yml` are required.

## Internal components

For internal re-use that should not be exposed to content editors via the
library of components, ensure you set `status: false` in the `component.yml`
file.

## Common utilities

Utility/helper function can be placed in a `utils_<name>` component with an
React component as a default export. These should always be internal components,
so `status: false` MUST be set in the `component.yml` file.

## Stories

Every non-internal component should have a corresponding story file in
`src/stories/components/`. Where appropriate, internal components should also
have a story file.

Use the stories skill when creating or modifying stories.

## Acquia Source Documentation

When creating components for Acquia Source, consult the official platform
documentation to ensure your component follows platform conventions and avoids
known pitfalls. Use the `acquia-source-docs-explorer` skill:

```
/acquia-source-docs-explorer creating custom components
```

Important: never remove components via the Component Library UI (known bug that
can break the site). Use the Code component panel instead.

## Canvas-Starter Reference

For the canonical component contract and naming conventions, see
`.claude/reference/canvas-starter/canvas-component-definition/SKILL.md`.
