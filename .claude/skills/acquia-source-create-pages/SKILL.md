---
name: acquia-source-create-pages
description: Use when creating pages programmatically in Acquia Source via JSON:API — POSTing new nodes, authenticating with OAuth, enabling write access, or automating content creation from scripts or migration workflows.
---

# Creating Pages in Acquia Source via JSON:API

Acquia Source exposes a full JSON:API. Pages (and other content types) can be created programmatically via POST requests once write access is enabled.

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

## No MCP Available

There is no MCP server for Acquia Source. Use `npx canvas-jsonapi` (available in Canvas component projects) for content interactions, or script directly against the JSON:API as shown above.

## Common Mistakes

- **401 errors** — OAuth credentials wrong or expired; re-fetch the token
- **403 errors** — Write access not enabled; check API > JSON:API settings
- **422 errors** — Invalid payload; verify `type` matches the exact bundle name (`node--page` not `node--Page`)
- **Missing fields** — Required fields (e.g. `body`, custom fields) must be included in `attributes`; check the JSON:API Query Builder response for the schema
