---
name: acquia-source-setup
description:
  Connecting a Canvas component project to Acquia Source, configuring OAuth API
  clients, uploading components, troubleshooting authentication errors (401,
  client auth failed, no components found), and managing .env configuration
---

# Acquia Source Setup & Connection

This skill covers connecting a Canvas Storybook AI project to an Acquia Source
instance for component uploads and content management. Use this when setting up
a new project, debugging upload/auth failures, or onboarding a new site.

## Architecture Overview

The system uses two separate APIs, each requiring different OAuth configuration:

| API             | Base Path                  | Purpose                    | CLI Command     |
| --------------- | -------------------------- | -------------------------- | --------------- |
| Canvas REST API | `/canvas/api/v0/`          | Upload/manage components   | `canvas:upload` |
| JSON:API        | `/<prefix>` (e.g., `/api`) | Content management (pages) | `content`       |

Both APIs authenticate via OAuth 2.0 Client Credentials flow through the
`/oauth/token` endpoint on the CMS URL.

### Canvas REST API Endpoints

| Endpoint                                     | Method     | Purpose                  |
| -------------------------------------------- | ---------- | ------------------------ |
| `/canvas/api/v0/config/js_component`         | GET / POST | List / create components |
| `/canvas/api/v0/config/js_component/<name>`  | GET / PUT  | Get / update a component |
| `/canvas/api/v0/config/asset_library/global` | GET / PUT  | Get / update global CSS  |

### JSON:API Endpoints

| Endpoint                  | Method     | Purpose             |
| ------------------------- | ---------- | ------------------- |
| `/<prefix>/page`          | GET / POST | List / create pages |
| `/<prefix>/node--article` | GET / POST | Articles            |
| `/<prefix>/media--image`  | GET / POST | Media images        |

## Site URLs

Each Acquia Source site has two URLs:

- **CMS URL**: `https://<ID>.cms.acquia.site` — Used for API access, admin
  panel, and all `.env` configuration
- **Public URL**: `https://<name>.acquia.site` — The live public-facing site

Always use the **CMS URL** for `CANVAS_SITE_URL` in `.env`.

## Step 1: Configure OAuth API Client in Acquia Source

Navigate to the admin panel:

```
https://<ID>.cms.acquia.site/admin/config/services/api-clients
```

Create or edit an API client with these **required** settings:

### Basic Settings

| Field        | Value                         | Notes                          |
| ------------ | ----------------------------- | ------------------------------ |
| Label        | Any name (e.g., "Canvas CLI") | Display name only              |
| Machine name | e.g., `default_client`        | Becomes `CANVAS_CLIENT_ID`     |
| Secret       | e.g., `secret`                | Becomes `CANVAS_CLIENT_SECRET` |

### Grant Types

Enable **Client Credentials** grant type. This is essential — without it, the
CLI cannot authenticate.

### Scopes

Add **all three** scopes:

| Scope                  | Required For             |
| ---------------------- | ------------------------ |
| `canvas:asset_library` | Uploading global CSS     |
| `canvas:js_component`  | Uploading components     |
| `member`               | Authenticated API access |

### Client Credentials Settings (CRITICAL)

Under the **"Client Credentials settings"** section of the API client form:

- **User**: Assign an existing Drupal user (e.g., your admin account)

This is the user context under which API operations execute. The User field is
an autocomplete — start typing the username and select from the dropdown.

**This is the most commonly missed step.** Without a user assigned, the Canvas
REST API returns 401 even though the OAuth token itself is valid. See
Troubleshooting below.

## Step 2: Check JSON:API Prefix

Check your JSON:API configuration at:

```
https://<ID>.cms.acquia.site/admin/config/services/jsonapi
```

Note the **URL prefix**. Acquia Source sites often use `api` instead of the
Drupal default `jsonapi`.

## Step 3: Create the `.env` File

Copy `.env.example` to `.env` and fill in the values:

```env
# Base URL — must be the CMS URL, not the public URL.
# NOTE: some starters' deploy scripts concatenate this value directly to build
# OAuth/API paths. If yours does (e.g. a bash push.sh), CANVAS_SITE_URL MUST end
# with a trailing slash, or you get malformed URLs like
# "https://<ID>.cms.acquia.siteoauth/token". Starter .env.example files often
# ship without it — add it as the first deploy step and pre-flight-check for it.
CANVAS_SITE_URL=https://<ID>.cms.acquia.site

# JSON:API prefix — check admin/config/services/jsonapi
CANVAS_JSONAPI_PREFIX=api

# OAuth credentials from Step 1
CANVAS_CLIENT_ID=default_client
CANVAS_CLIENT_SECRET=secret

# Component source directory
CANVAS_COMPONENT_DIR=./src/components

# Debug logging
CANVAS_VERBOSE=false
```

### Full Environment Variable Reference

| Variable                | Required | Default                                    | Description                        |
| ----------------------- | -------- | ------------------------------------------ | ---------------------------------- |
| `CANVAS_SITE_URL`       | Yes      | —                                          | CMS base URL                       |
| `CANVAS_JSONAPI_PREFIX` | No       | `jsonapi`                                  | JSON:API URL prefix                |
| `CANVAS_CLIENT_ID`      | Yes      | —                                          | OAuth client machine name          |
| `CANVAS_CLIENT_SECRET`  | Yes      | —                                          | OAuth client secret                |
| `CANVAS_COMPONENT_DIR`  | No       | `./components`                             | Path to component source directory |
| `CANVAS_VERBOSE`        | No       | `false`                                    | Enable verbose CLI logging         |
| `CANVAS_SCOPE`          | No       | `canvas:js_component canvas:asset_library` | Custom OAuth scopes                |
| `CONTENT_NO_AUTH`       | No       | `false`                                    | Disable auth for content scripts   |
| `CONTENT_OAUTH_SCOPE`   | No       | —                                          | Custom scope for content API       |

## Step 4: Validate and Upload

This project has scripts in `canvas/scripts/` for all common operations. Always
prefer these over raw CLI commands.

### Component upload

```bash
# Push all components with automatic retry (PREFERRED — handles slot dependencies)
node scripts/push-retry.cjs

# Validate component structure before uploading
npm run canvas:validate

# Upload all components (deprecated, use push-retry instead)
npm run canvas:upload

# Upload a specific component
npm run canvas:upload -- -c component_name
```

**Always use `push-retry.cjs` for uploads.** It uses `canvas push` (not the
deprecated `canvas upload`) and retries until all slot dependencies are resolved.

> **`canvas upload` does NOT register new props — only a completed `canvas push` does.**
> After adding/removing a `component.yml` prop, `canvas upload` reports "Updated"
> but the prop schema on the server is **unchanged**, and any page update using
> the new prop fails with `the <prop> prop is not defined`. The schema only
> updates when a `canvas push` runs **to completion** — an aborted push (e.g. on
> a blocked delete) does not register props either, even at ~97% uploaded.
> Sequence: push to completion → confirm the prop is registered → then update the
> page. This is exactly why `push-retry.cjs` is preferred.

### Deploy gotchas (when a starter uses a `bash scripts/push.sh` deploy path)

Some starters deploy via a shell script rather than `push-retry.cjs`. If yours
does, these bite repeatedly:

- **Run it with `bash`, not `sh`, inside DDEV, with `node_modules/.bin` on PATH.**
  The script is bash (`[[`, `${BASH_SOURCE[0]}`); `npm run …:deploy` may invoke it
  via `dash` → `Bad substitution`. It also calls bare `canvas`, so the bin dir
  must be on PATH. And `node_modules` is linux-built in the container — running on
  the macOS host fails with `Cannot find module @rollup/rollup-darwin-arm64`:
  ```bash
  ddev exec 'cd <project> && export PATH="./node_modules/.bin:$PATH" && bash scripts/push.sh'
  ```
- **Compiled CSS is silently dropped on a bare `canvas push` → unstyled site.**
  The deploy script re-uploads `dist/index.css` via the asset-library API, so
  `canvas build` (which produces `dist/index.css`) is REQUIRED for a styled
  deploy. Use the full deploy script, not a bare push.
- **A relative `@import` breaks the browser Tailwind build.** `canvas build` uses
  the browser Tailwind build, which cannot follow a relative `@import` (e.g. an
  entry `global.css` importing `./components/global.css`) — it aborts with
  `The browser build does not support @import`. **Inline the `@theme` tokens +
  base rules directly into the entry CSS** and drop the relative `@import`. Load
  web fonts via a `<link>` (e.g. `.storybook/preview-head.html`), not
  `@import url(...)`, which also breaks the build. Fix this **before the first
  `canvas build`**, not at deploy time.

### Image upload

Acquia Source does not serve local `public/images/` files — images must be
uploaded as Drupal media entities. The file upload endpoint is
`POST /api/media/image/media_image` (not `/api/file/file`). Only `png`, `gif`,
`jpg`, `jpeg` are accepted — `.webp` files are auto-converted to jpg via `sips` (macOS) or `ffmpeg` (Linux).

> The media library rejects `.webp` outright (`Only png gif jpg jpeg`). If your
> starter has no auto-conversion step, convert webp → png/jpg before upload. Don't
> assume a converter is installed — the standard DDEV web image ships PHP **GD**
> (always available) but **not** the ImageMagick CLI (`convert`/`magick`) or
> `cwebp`. Check first (`ddev exec command -v convert cwebp`); if absent, convert
> via PHP/GD (`imagecreatefromwebp` → `imagepng`), or add `imagemagick` through a
> `.ddev/web-build/Dockerfile.*` and `ddev restart`. **Convert logos and any image
> with a transparent background to PNG, not JPG** — JPG flattens transparency onto
> a solid (usually black/white) box, and GD's webp→png preserves alpha (enable
> `imagealphablending(false)` + `imagesavealpha(true)`).

```bash
# Upload all images in a directory
npm run canvas:upload-images -- --dir ./public/images/mysite

# Example output — save these CDN URLs for use in pages.json and component defaults
#   RMHC-Logo-UK.webp → https://<ID>.cms.acquia.site/sites/default/files/2026-05/RMHC-Logo-UK.jpg
```

After uploading images, update all component default props and `pages.json` to
use the returned CDN URLs (format: `https://<ID>.cms.acquia.site/sites/default/files/<year-month>/<filename>`).

### Page management

Pages are defined in `website-to-components/output/<site-slug>/pages.json`.
Component `inputs` in pages.json **must match the component's current prop names
exactly** — mismatches cause HTTP 422 errors when recreating pages.

```bash
# Delete and recreate all pages from pages.json
node scripts/recreate-pages.cjs <site-slug>

# Recreate a single page
node scripts/recreate-pages.cjs <site-slug> --path /some-path

# Create pages from scratch (first time)
node scripts/create-pages.cjs <site-slug>

# Delete all pages
node scripts/delete-pages.cjs <site-slug>
```

#### Protected paths

Each site can define paths that must never be deleted (e.g., system pages the
CMS creates automatically). Create a `protected-paths.json` file in the site's
output directory:

```
website-to-components/output/<site-slug>/protected-paths.json
```

```json
[
  "/access-denied",
  "/not-found",
  "/homepage"
]
```

The delete and recreate scripts read this file automatically. If the file is
absent, no paths are protected. Do **not** hardcode paths in the scripts — they
are generic tools that must work across projects.

**Important**: Pages that return 403 on delete (CMS-protected) are automatically
PATCHed instead of deleted and recreated — no manual config needed for those.

**Navigation link rule**: In the navbar `navigationLinksJson`, only use local clone paths (e.g. `/rmh-who-we-are`) for pages that have been built and exist in the clone. For all other nav items that don't have a corresponding local page, use `"href": "#"` — never link to the original source site. Linking to the original site creates a false impression that the migration is complete when the user clicks through and lands on the real site instead of the clone.

Successful upload output:

```
All components pushed successfully.
```

## Step 5: Update vite.config.js

Update the `siteUrl` in `vite.config.js` to match your CMS URL:

```js
drupalCanvas({
  componentDir: './src/components',
  siteUrl: 'https://<ID>.cms.acquia.site',
  jsonapiPrefix: 'api',
}),
```

## Step 6: Verify Components

Verify each component in the Canvas Code Editor:

```
<CMS_URL>/canvas/code-editor/component/<component_name>
```

Check that props, source code, and preview render correctly. Components should
also be available in the Canvas page builder in the admin panel under the
component library.

## Troubleshooting

### Error: "No local components found in ./components"

**Cause**: `CANVAS_COMPONENT_DIR` is not set or points to the wrong directory.

**Fix**: Add to `.env`:

```env
CANVAS_COMPONENT_DIR=./src/components
```

The default is `./components`, but this project uses `./src/components`.

### Error: "Client authentication failed"

**Cause**: Wrong `CANVAS_CLIENT_ID` or `CANVAS_CLIENT_SECRET`.

**Fix**: Check the API client's **machine name** (not the label) in the admin
panel at `/admin/config/services/api-clients`. The machine name is the value you
need for `CANVAS_CLIENT_ID`.

Common mistake: using the label (e.g., "Test Client") instead of the machine
name (e.g., `default_client`), or using `cli` when the actual machine name is
different.

### Error: "You must be logged in to access this resource" (401)

This is the most common and confusing error. The OAuth token is valid, but the
Canvas REST API still rejects it. This happens when the API client is missing
one or more of three required settings.

**Diagnosis**: You can confirm the token itself works by testing against
JSON:API:

```bash
# Get a token
TOKEN=$(curl -s -X POST https://<ID>.cms.acquia.site/oauth/token \
  -d "grant_type=client_credentials&client_id=default_client&client_secret=secret" \
  | python3 -c "import sys,json;print(json.loads(sys.stdin.read())['access_token'])")

# This works — JSON:API accepts the token
curl -s -H "Authorization: Bearer $TOKEN" \
  https://<ID>.cms.acquia.site/api | head

# This fails — Canvas API rejects it
curl -s -H "Authorization: Bearer $TOKEN" \
  https://<ID>.cms.acquia.site/canvas/api/v0/config/js_component
```

**Fix — check all three requirements on the API client:**

1. **Grant type**: "Client Credentials" must be enabled
2. **Scopes**: All three must be present: `canvas:asset_library`,
   `canvas:js_component`, `member`
3. **User in Client Credentials settings**: A Drupal user must be assigned in
   the "Client Credentials settings" section. This is at the bottom of the API
   client edit form and is easy to miss.

The third item (assigning a user) is almost always the missing piece. Without
it, the token has no user context and the Canvas API treats the request as
anonymous.

### Error: Upload succeeds but components don't appear on site

**Possible causes**:

- Components uploaded to wrong site (check `CANVAS_SITE_URL`)
- Component `status: false` in `component.yml` — change to `status: true`
- Check the Code Editor at `<CMS_URL>/canvas/code-editor/component/<name>` for
  errors

### Error: OAuth token request returns HTML instead of JSON

**Cause**: `CANVAS_SITE_URL` is wrong or points to the public URL instead of the
CMS URL.

**Fix**: Use the CMS URL (`https://<ID>.cms.acquia.site`), not the public URL
(`https://<name>.acquia.site`).

### Investigating a working reference site

If another Acquia Source site is already working with Canvas uploads (e.g., a
teammate's site), you can inspect its API client configuration for reference:

```
https://<their-ID>.cms.acquia.site/admin/config/services/api-clients
```

Look at the API client's grant types, scopes, and Client Credentials settings to
compare with your own configuration.

## Quick Setup Checklist

Use this checklist when setting up a new project:

- [ ] Identify the CMS URL (`<ID>.cms.acquia.site`)
- [ ] Create/configure API client with Client Credentials grant type
- [ ] Add scopes: `canvas:asset_library`, `canvas:js_component`, `member`
- [ ] Assign a User in Client Credentials settings
- [ ] Note the JSON:API prefix (`api` vs `jsonapi`)
- [ ] Create `.env` with `CANVAS_SITE_URL`, `CANVAS_CLIENT_ID`,
      `CANVAS_CLIENT_SECRET`, `CANVAS_JSONAPI_PREFIX`, `CANVAS_COMPONENT_DIR`
- [ ] Update `siteUrl` in `vite.config.js`
- [ ] Run `npm run canvas:validate` to verify component detection
- [ ] Run `npm run canvas:upload` to push components
- [ ] Verify components in Canvas Code Editor
      (`<CMS_URL>/canvas/code-editor/component/<name>`)
