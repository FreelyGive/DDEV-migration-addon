---
name: website-to-components-multipage
description: Use when cloning multiple pages of a website — pulling main nav pages, building components per page, and linking pages together in Storybook. Activates when user says "main menu pages", "all pages", "multi-page", "link pages together", or references nav links alongside a site URL.
---

# Multi-Page Website Clone

Extends `website-to-components` to cover an entire site's main navigation: scrape nav links, run the pipeline on each new page, build components, assemble page stories, and wire inter-page links.

**REQUIRED:** Read the `website-to-components` skill first — this skill only covers the differences.

## Decisions (no need to ask the user)

| Question | Answer |
|----------|--------|
| How to find pages | Scrape main nav links live |
| Existing homepage output | Keep it — only process new pages |
| Storybook structure | One page story per page + shared components |
| Inter-page links | Wire navbar/footer links via Storybook `linkTo()` |

## Pipeline

```
Step 0 — Scrape nav links    →  list of page URLs
Step 1–8 per new page        →  follow website-to-components skill exactly
Step 9 — Wire page links     →  update all page stories with linkTo()
```

### Step 0 — Scrape nav links

```bash
agent-browser open <site-url>
agent-browser eval --stdin << 'EOF'
JSON.stringify(
  [...document.querySelectorAll('nav a, header a')]
    .map(a => ({ text: a.textContent.trim(), href: a.href }))
    .filter(l => l.href.startsWith(location.origin) && l.href !== location.href)
    .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i),
  null, 2
);
EOF
```

Deduplicate and exclude the current page URL. The result is your page list.

**Skip pages already processed** — check `output/<site>/` for existing subdirectories (one per page slug). Only run Steps 1–8 on pages that don't already have a `components.json`.

### Steps 1–8 per new page

For each new page URL, run the full `website-to-components` pipeline:
- `node scripts/run.js <page-url>` — screenshot + split
- Vision analysis → write `output/<site>/<page-slug>/components.json`
- `node scripts/finish.js <page-url>` — assets + report
- Build components (reuse shared ones, build new ones)
- Visual comparison + content audit
- Assemble page story

**Output path:** `output/<site>/<page-slug>/` — one subdirectory per page.

**Shared components:** The Navbar, Footer, and any component that appears on multiple pages must be built once. Before building a component, check `storybook/src/components/` — if it exists, reuse it.

### Step 9 — Wire inter-page links

After all page stories are written, update every page story to use `linkTo()` for nav and footer links:

```tsx
import { linkTo } from '@storybook/addon-links';

// In the page component JSX:
<SiteNavbar
  onPageOneClick={linkTo('Pages/<Site Name> — Page One')}
  onPageTwoClick={linkTo('Pages/<Site Name> — Page Two')}
  // ...other nav links
/>
```

The story title format is `Pages/<Site Name> — <Page Name>` (matches what `website-to-components` produces).

**Update all page stories** — every page's Navbar and Footer must have `linkTo()` wired for all nav items that have a corresponding page story. Links to external pages or pages not yet cloned can be `href="#"`.

## Storybook story structure

```
stories/pages/
  <SiteName>Homepage.stories.tsx
  <SiteName>PageTwo.stories.tsx
  <SiteName>PageThree.stories.tsx
  ...one file per nav page
```

Each story:
- `title: 'Pages/<Site Name> — <Page Name>'`
- `layout: 'fullscreen'`
- Imports and renders all section components top-to-bottom
- Shared components (Navbar, Footer) appear in every story
- Props use real site content

## Done when

- All nav pages have a page story in Storybook
- Clicking any nav link in a page story navigates to another page story
- `node scripts/audit-content.js` passes for all pages
- Visual comparison passes for all pages
