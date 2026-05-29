---
name: acquia-source-docs-explorer
description:
  'Search and fetch Acquia Source documentation pages. Takes a query describing
  what you need to know about Acquia Source (e.g., "menu management", "component
  props and slots", "known issues", "site settings configuration") and returns
  the full content of matching documentation pages from docs.acquia.com. Invoke
  with /acquia-source-docs-explorer <query>. Use this whenever you need to
  understand how Acquia Source works, verify platform behavior, check for
  limitations, or find the correct admin paths and configuration options.'
compatibility:
  Requires internet access to fetch documentation from docs.acquia.com
---

# Acquia Source Documentation Explorer

Fetch and return official Acquia Source documentation relevant to a query. This
skill searches a local sitemap of all Acquia Source doc pages, identifies the
most relevant ones, fetches their full content, and returns it for the calling
agent to use.

## Arguments

- `$1` — **Query** (required). A natural language description of what you need
  to know. Examples:
  - `"known issues and limitations"`
  - `"how to manage menus"`
  - `"creating custom components props slots"`
  - `"site settings configuration"`
  - `"content workflows publishing"`
  - `"JSON API integration"`

## Execution

You are a fast research agent. Your job is to find and fetch documentation, not
to analyze or act on it. Return the raw content so the calling agent can use it.

### Step 1: Load the sitemap

Read the sitemap file at `acquia-source-sitemap.xml` (in this skill's
directory). This contains all known Acquia Source documentation page URLs with
their paths.

### Step 2: Match URLs to the query

From the sitemap URLs, identify **all pages relevant** to the query. Match by:

- URL path segments (e.g., query "menus" matches `/acquia-source/menus`,
  `/acquia-source/adding-links-menu`, `/acquia-source/displaying-menus`,
  `/acquia-source/creating-menu`,
  `/acquia-source/enabling-content-be-added-menu`,
  `/acquia-source/using-advanced-menu-features`)
- Semantic relevance (e.g., query "component creation" matches
  `/acquia-source/creating-custom-components`, `/acquia-source/components`,
  `/acquia-source/props`, `/acquia-source/slots`,
  `/acquia-source/sharing-custom-components-across-sites`)
- Always include `/acquia-source/known-issues-and-limitations` if the query
  relates to components, Tailwind, Canvas, or troubleshooting

Be generous with matching — it's better to fetch an extra page than to miss a
relevant one. But stay focused: don't fetch release notes unless the query is
specifically about releases or changelog.

### Step 3: Fetch matched pages

For each matched URL, use `WebFetch` to retrieve the page content. Fetch pages
in parallel where possible for speed.

Use this prompt for each fetch:

> "Extract the COMPLETE content of this page. Return all text, code examples,
> tables, steps, warnings, and notes. Do not summarize — return everything."

### Step 4: Return results

Return all fetched content organized by page, with clear headers:

```
## <Page Title> — <URL>

<full page content>

---

## <Next Page Title> — <URL>

<full page content>
```

If a page fails to load (404, 503, timeout), note the failure and continue with
remaining pages.

## Sitemap maintenance

The sitemap can be refreshed by running:

```bash
.claude/skills/acquia-source-docs-explorer/scripts/sitemap_update.sh
```

This pulls the latest sitemap from docs.acquia.com and filters to Acquia Source
pages only.
