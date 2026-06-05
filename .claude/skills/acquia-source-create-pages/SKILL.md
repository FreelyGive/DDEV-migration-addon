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
| Menus | `/jsonapi/menu/<menu_id>` |
| Users | `/jsonapi/user/user` |

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

## No MCP Available

There is no MCP server for Acquia Source. Use `npx canvas-jsonapi` (available in Canvas component projects) for content interactions, or script directly against the JSON:API as shown above.

## Common Mistakes

- **401 errors** — OAuth credentials wrong or expired; re-fetch the token
- **403 errors** — Write access not enabled; check API > JSON:API settings
- **422 errors** — Invalid payload; verify `type` matches the exact bundle name (`node--page` not `node--Page`)
- **Missing fields** — Required fields (e.g. `body`, custom fields) must be included in `attributes`; check the JSON:API Query Builder response for the schema
