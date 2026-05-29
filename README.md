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
