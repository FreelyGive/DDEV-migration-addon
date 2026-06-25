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

### Whole-site scope

`ddev clone <url> --scope site` discovers pages automatically — no external
dependency required:

1. Reads `sitemap.xml` (with `sitemap_index.xml` and `robots.txt` fallbacks).
2. Validates each URL over HTTP: keeps only URLs that return HTTP 200, did not
   redirect, are not marked `noindex` (via `X-Robots-Tag` header or
   `<meta name="robots">` tag), and whose `<link rel="canonical">` (if present)
   points to themselves.
3. Falls back to menu-reachable discovery if no sitemap is found.

Menus are always derived from on-page navigation, never from the sitemap.
No claude-seo plugin or Python runtime required.

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

Run `ddev canvas-bootstrap` once (from the host) before your first
`ddev clone`. It is a host command (it uses `drush` in the web container and
writes the host `storybook/.env`), idempotent, and safe to re-run. It:

- enables JSON:API read/write,
- ensures a usable OAuth consumer exists — reusing any consumer that already has
  the Client-Credentials grant and an assigned user, or creating one otherwise
  (without an assigned user the Canvas REST API returns 401),
- enables revisions on the `page` content type (so re-runs upsert safely),
- writes `CANVAS_LOCAL_SITE_URL` (the public `.ddev.site` URL),
  `CANVAS_LOCAL_CLIENT_ID`, `CANVAS_LOCAL_CLIENT_SECRET`, and
  `CANVAS_LOCAL_JSONAPI_PREFIX` into `storybook/.env`. On the reuse path the
  existing secret is preserved (a hashed consumer secret cannot be recovered).

The local OAuth scope is `canvas:asset_library canvas:js_component` (the `member`
scope is remote/Acquia-only and is invalid locally).

`ddev clone` reminds you to run it; because it cannot call a host command from
inside the nodejs container, it does not run bootstrap inline.
