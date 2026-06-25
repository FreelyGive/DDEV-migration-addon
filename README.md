# DDEV Canvas Migration Addon

Adds the [Canvas Storybook AI](https://canvas.drupalstarforge.ai) website-to-components migration pipeline to a DDEV project.

## What this installs

- **`website-to-components/`** — pipeline scripts that screenshot a live site, detect visual sections, and generate React components ready for Storybook and Drupal Canvas
- **`ddev clone`** — command to kick off the migration pipeline against a URL
- **agent-browser** — Chromium-based browser automation (installed standalone; safe to use alongside [FreelyGive/DDEV-Canvas](https://github.com/FreelyGive/DDEV-Canvas))
- **Claude skills** — migration-specific skills added to `.claude/skills/`:
  - `website-to-components`, `website-to-components-multipage`
  - `migration-component-authoring`, `migration-create-component`, `migration-stories`
  - `acquia-source-setup`, `acquia-source-docs-explorer`
  - `typography-audit`, `webpage-sections-splitter`

## Requirements

- [DDEV](https://ddev.readthedocs.io/) v1.23+
- Docker
- Claude Code authenticated (`ddev claude` once, or `claude` on host)

### Optional: whole-site scope

`ddev clone <url> --scope site` discovers pages from the live site's `sitemap.xml`
using the [claude-seo](https://github.com/AgricIDaniel/claude-seo) plugin's
`seo-sitemap` skill (Mode 1). Install claude-seo (Python 3.10+, optional Playwright)
to enable it. If claude-seo is not installed, or the site has no `sitemap.xml`,
the run falls back to menu-reachable discovery and prints a warning.

## Installation

```bash
ddev add-on get FreelyGive/DDEV-migration-addon
ddev restart
```

Can be used standalone or alongside the base Canvas addon:

```bash
ddev add-on get FreelyGive/DDEV-Canvas
ddev add-on get FreelyGive/DDEV-migration-addon
ddev restart
```

## Usage

```bash
# Screenshot a site and generate components
ddev clone https://your-site.com

# Multi-page migration
ddev exec node website-to-components/scripts/run-multipage.js https://your-site.com

# Then launch Claude to build the components
ddev claude
```

The migration pipeline runs inside the DDEV web container. Results are written to `website-to-components/output/`.

## Permission bootstrap

`ddev clone` runs `ddev canvas-bootstrap` automatically before discovery. It is
idempotent and:

- enables JSON:API read/write,
- creates the `Canvas Migration` OAuth consumer (Client Credentials, scopes
  `canvas:asset_library canvas:js_component member`),
- assigns the `canvas_migration` service user to that consumer (without this the
  Canvas REST API returns 401),
- enables revisions on the `page` content type (so re-runs upsert safely),
- writes `CANVAS_LOCAL_SITE_URL` / `CANVAS_LOCAL_CLIENT_ID` /
  `CANVAS_LOCAL_CLIENT_SECRET` into `storybook/.env`.

Run it on its own at any time with `ddev canvas-bootstrap`.
