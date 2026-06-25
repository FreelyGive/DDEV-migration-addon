---
name: acquia-source-create-pages
description: Use when creating or managing content programmatically in Acquia Source via JSON:API — POSTing nodes, taxonomy terms, or media; authenticating with OAuth; enabling write access; or automating content creation from scripts or migration workflows.
---

# Creating Content in Acquia Source via JSON:API

Acquia Source exposes a full JSON:API. Pages, taxonomy terms, media, and other content can be created programmatically via POST requests once write access is enabled.

## Step 1: Enable Write Access

By default the API is read-only. To enable writes:

1. Access your site
2. Navigate to **API > JSON:API** in the left sidebar
3. Set **Allowed operations** to **Read and write**
4. Click **Save configuration**

## Step 2: Authenticate (OAuth)

```javascript
const tokenResponse = await fetch('https://your-site.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: 'YOUR_CLIENT_ID',
    client_secret: 'YOUR_CLIENT_SECRET',
  }),
});
const { access_token } = await tokenResponse.json();
```

OAuth credentials come from `.env` (`CANVAS_CLIENT_ID` / `CANVAS_CLIENT_SECRET`). See `acquia-source-setup` skill for OAuth setup.

## Step 3: POST a New Page

```javascript
const response = await fetch('https://your-site.com/jsonapi/node/page', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${access_token}`,
    'Content-Type': 'application/vnd.api+json',
    Accept: 'application/vnd.api+json',
  },
  body: JSON.stringify({
    data: {
      type: 'node--page',
      attributes: {
        title: 'My New Page',
      },
    },
  }),
});
const page = await response.json();
```

The endpoint pattern is `/jsonapi/node/<bundle>` — replace `page` with the actual content type bundle name (e.g. `landing_page`, `article`).

## Available API Resources

| Resource type | JSON:API endpoint |
|---|---|
| Pages / content | `/jsonapi/node/<bundle>` |
| Media (images, docs) | `/jsonapi/media/<bundle>` |
| Taxonomy terms | `/jsonapi/taxonomy_term/<vocab>` |
| Menu links (content) | `/jsonapi/menu_link_content/menu_link_content` — writable with `administer menu` |
| Menu structure (config) | `/jsonapi/menu/<menu_id>` (e.g. `menu_items--main`) — **read-only** |
| Users | `/jsonapi/user/user` |

> **Menu writability depends on config vs content entity:**
> - **Menu *links* are content entities** (`menu_link_content`) and **ARE
>   writable** over JSON:API (POST/PATCH/DELETE) when the OAuth client/user has
>   the **`administer menu`** permission. Set the target menu via the
>   `menu_name` attribute (e.g. `"main"`, `"footer"`) and nesting via the `parent`
>   field. This is the correct way to populate a menu programmatically.
> - **The menu *container* and code/config-defined items are config entities**
>   (`menu_items--<menu>` resources return `Allow: GET, HEAD`); you cannot create
>   the menu itself or edit code-defined links via JSON:API, and some menus may
>   not be exposed at all.
>
> Two things still gate writes regardless: the `administer menu` permission must
> be granted to the token's user/client, AND JSON:API writes must be enabled
> server-side (a 405 "configured to accept only read operations" means writes are
> globally off — check API > JSON:API settings).
>
> If write access genuinely isn't available on a target site (permission not
> grantable, writes disabled), the fallback is to **deliver navigation as
> components that carry the links** (a richtext `<ul>` inside a card/text
> component, or a slot of small link components) rather than as menu entities.

## Exploring Available Types

Use the **JSON:API Query Builder** (left sidebar → **API > JSON:API Query Builder**) to:
- Discover available entity types and bundles
- Preview real responses before scripting
- Copy generated request URLs and code samples

## Creating Taxonomy Terms via API

Taxonomy vocabularies (e.g. `tags`, `categories`) contain terms. POST a term the same way as a node:

```javascript
await fetch('https://your-site.com/jsonapi/taxonomy_term/tags', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${access_token}`,
    'Content-Type': 'application/vnd.api+json',
    Accept: 'application/vnd.api+json',
  },
  body: JSON.stringify({
    data: {
      type: 'taxonomy_term--tags',
      attributes: {
        name: 'My Tag',
        description: { value: 'Optional description', format: 'plain_text' },
      },
      // Optional: set parent term for hierarchical vocabularies
      relationships: {
        parent: {
          data: [{ type: 'taxonomy_term--tags', id: 'PARENT_TERM_UUID' }],
        },
      },
    },
  }),
});
```

**Built-in vocabularies:**

| Vocabulary | Bundle | Notes |
|---|---|---|
| Tags | `tags` | Flat, keyword labeling |
| Categories | `categories` | Hierarchical, parent-child supported |

Custom vocabularies follow the same pattern — use the machine name as the bundle.

## Content Types & Fields

Content types are templates that define the fields available on a node. Each type has a bundle name used in API endpoints.

**Default content types:**

| Content type | Bundle | Typical fields |
|---|---|---|
| Page | `page` | title, body |
| Article | `article` | title, body, author, tags, publication date |
| Event (custom) | `event` | title, event_date, location, thumbnail, description |

**Field types available:**

| Type | Notes |
|---|---|
| Text (plain) | Single line, 255 char max |
| Text area | Multiline, formatted |
| Numeric | Numbers only |
| Date | Calendar picker |
| Select / Multiselect | Predefined values |
| Email | Validated email format |
| URL | Validated URL format |

### Creating a Content Type (admin UI only)

Content types cannot be created via JSON:API — use the admin UI:

1. **Structure > Content types > Overview > Add content type**
2. Fill in the form, configure menu/search/workflow/scheduling settings
3. Click **Save**
4. Add fields via **Structure > Content types > [type] > Manage fields**

### Creating a Vocabulary (admin UI only)

Vocabularies also require the admin UI:

1. **Structure > Taxonomy > Overview > Add vocabulary**
2. Fill in the form, click **Save**
3. Then add terms via the API or UI

## Canvas component-based pages (the flat component tree)

A Canvas page is **not** plain body HTML — its `attributes.components` is a FLAT
array of component instances:
`{ uuid, component_id: "js.<machine>", component_version, inputs, parent_uuid, slot }`.
Nesting is expressed via `parent_uuid` + `slot`. Rich-text inputs are
`{ value, format: "canvas_html_block" }`; image inputs are `{ target_id: "<media id>" }`.

### `component_version` must match the deployed component's hash

Each instance pins a `component_version`. If the page still references the OLD
hash after a component re-push, the deployed page renders the OLD component and
**new props are ignored** ("I fixed it in Storybook but the live page is
unchanged"). Fetch the active hashes from the **config/component** endpoint (the
`js_component` config endpoint does NOT expose them):

```
GET <CANVAS_SITE_URL>canvas/api/v0/config/component
→ { "js.<machine>": { "version": "dad0888024ff4095", ... }, ... }
```

Deploy sequence: push components to completion → fetch active versions → set every
instance's `component_version` to the active hash for its `component_id` → update
the page → verify on the **public** URL (not the CMS URL).

**Nuance:** a **JSX-only** change (Tailwind/layout, no `component.yml` prop
change) ships without changing the hash, so no page re-sync is needed for pure
style tweaks. Re-sync only when an **input value or prop schema** changed.

### Build a re-runnable page generator (don't hand-edit the JSON)

UUIDs, version hashes, and `target_id`s drift on every re-push. Hand-editing the
flat component-tree JSON each iteration is error-prone. Write a re-runnable
generator that reads current versions from `/config/component`, takes a
**declarative page spec** (component + inputs + children), resolves versions
automatically, and emits the page JSON. Write it **before the first page push**;
then a tweak round is "change one input → re-run → update". A feature flag to emit
the page WITH or WITHOUT a new prop is useful for the two-pass sequence around
prop registration (see the deadlock below).

### Replacing/removing a component referenced by a live page (the stub dance)

Deleting a component while a live page still references it aborts the push:
`This code component is in use in a default revision and cannot be deleted.` But
you often can't repoint the page first, because the replacement's new props
aren't registered until the push completes — and the push won't complete because
of the delete. **Deadlock.** Escape hatch:

1. Recreate the doomed component as a **thin stub** (valid `component.yml` +
   minimal `index.jsx`, `status: true`) so the push has nothing to delete.
2. `canvas push` → completes → registers the replacement components' new props.
3. Update the PAGE to use the replacements + their new props (now accepted).
4. Delete the stub → `canvas push` → the delete now succeeds.

### Raw `<img src>` props need an uploaded media URL, not `/images/...`

Storybook serves `/public/images/...`, but the deployed site 404s those paths.
Canvas `Image`-component images reference a media entity (`{ target_id }`) and
resolve under `/sites/default/files/...`. A component that takes a **plain string
`src`** rendered as a raw `<img>` must use the uploaded file's **public URL**
(`https://<public-host>/sites/default/files/<YYYY-MM>/<name>.png`). Upload first,
verify the URL returns 200 on the public host, then wire it into the page JSON.

## No MCP Available

There is no MCP server for Acquia Source. Use `npx canvas-jsonapi` (available in Canvas component projects) for content interactions, or script directly against the JSON:API as shown above.

## Common Mistakes

- **401 errors** — OAuth credentials wrong or expired; re-fetch the token
- **403 errors** — Write access not enabled; check API > JSON:API settings
- **422 errors** — Invalid payload; verify `type` matches the exact bundle name (`node--page` not `node--Page`)
- **Missing fields** — Required fields (e.g. `body`, custom fields) must be included in `attributes`; check the JSON:API Query Builder response for the schema
- **`the <prop> prop is not defined`** (component pages) — the prop schema isn't
  registered on the server. `canvas upload` does NOT register new props; only a
  `canvas push` that runs **to completion** does. Push to completion → confirm the
  prop → then update the page. See the deploy notes in the setup skill.
- **`unknown prop for js.<machine>`** — you're passing an input that isn't
  declared in the component's `component.yml` (e.g. a JS function-arg default).
  Either add it as a real `component.yml` prop (+ push), or derive that behaviour
  inside the component instead of passing it as an input.
- **`A component subtree must only exist for components with >=1 slot, but the
  component js.<machine> has no slots, yet a subtree exists…`** — a slot→prop
  migration left an orphaned child instance whose `parent_uuid` points at the
  now-slotless component. Remove the orphaned child (and its descendants) from the
  page's `data.attributes.components[]` array before pushing. Also: prop machine
  names must be the exact camelCase of their title (validator `component-prop-names`),
  e.g. title "Engagements Badge Src" → `engagementsBadgeSrc`.
- **Live page renders the OLD component** — the instance's `component_version`
  doesn't match the active hash. Re-sync from `/canvas/api/v0/config/component`
  (see the component-pages section above).
