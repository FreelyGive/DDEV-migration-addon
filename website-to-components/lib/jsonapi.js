// website-to-components/lib/jsonapi.js
//
// Thin local JSON:API + OAuth client. Injectable fetchImpl for testing.

export function makeClient({ siteUrl, prefix = "jsonapi", clientId, clientSecret, fetchImpl }) {
  const f = fetchImpl || globalThis.fetch;
  const base = siteUrl.endsWith("/") ? siteUrl : siteUrl + "/";
  const api = (p) => `${base}${prefix}${p}`;
  let cachedToken = null;

  async function getToken(scope) {
    const res = await f(`${base}oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret, scope }).toString(),
    });
    const data = await res.json();
    cachedToken = data.access_token;
    return cachedToken;
  }

  async function authedFetch(url, method, body, scope = "member") {
    const token = cachedToken || (await getToken(scope));
    return f(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  }

  async function findPageByPath(path) {
    const url = api(`/node/page?filter[path][value]=${encodeURIComponent(path)}`);
    const res = await authedFetch(url, "GET");
    const data = (await res.json()).data || [];
    return data.length ? { id: data[0].id, path } : null;
  }

  function pageBody({ title, path, layout, published }) {
    return { data: { type: "node--page", attributes: {
      title,
      path: path ? { alias: path } : undefined,
      status: !!published,
      ...(layout ? { layout } : {}),
    } } };
  }

  async function createPage(attrs) {
    const res = await authedFetch(api("/node/page"), "POST", pageBody(attrs));
    return { id: (await res.json()).data.id };
  }

  async function updatePage(id, attrs) {
    const body = pageBody(attrs);
    body.data.id = id;
    const res = await authedFetch(api(`/node/page/${id}`), "PATCH", body);
    return { id: (await res.json()).data.id };
  }

  async function bundleHasRevisions(bundle) {
    const res = await authedFetch(api("/node_type/node_type"), "GET");
    const data = (await res.json()).data || [];
    const t = data.find(d => d.attributes?.drupal_internal__type === bundle);
    return !!t?.attributes?.new_revision;
  }

  async function upsertMenuLink({ menu, title, url, weight = 0 }) {
    const body = { data: { type: "menu_link_content--menu_link_content", attributes: {
      title, link: { uri: url.startsWith("/") ? `internal:${url}` : url }, menu_name: menu, weight, enabled: true,
    } } };
    const res = await authedFetch(api("/menu_link_content/menu_link_content"), "POST", body);
    return { id: (await res.json()).data.id };
  }

  return { getToken, findPageByPath, createPage, updatePage, bundleHasRevisions, upsertMenuLink };
}
