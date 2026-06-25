function isJunk(href, label) {
  if (!href || !label) return true;
  if (/^(mailto:|tel:|javascript:)/i.test(href)) return true;
  if (/\.(pdf|zip|docx?|xlsx?|pptx?|jpe?g|png|gif|mp4|mov)(\?|$)/i.test(href)) return true;
  if (label.length < 1 || label.length > 80) return true;
  return false;
}

function toLinks(list, origin) {
  const seen = new Set();
  const out = [];
  for (const { label, url } of list || []) {
    if (isJunk(url, label)) continue;
    let u;
    try { u = new URL(url, origin); } catch { continue; }
    if (u.origin !== origin) continue;
    if (u.protocol !== "http:" && u.protocol !== "https:") continue;
    const path = u.pathname.replace(/\/+$/, "") || "/";
    if (seen.has(path)) continue;
    seen.add(path);
    out.push({ label: label.trim().replace(/\s+/g, " ").slice(0, 80), path, href: path });
  }
  return out;
}

export function normalizeMenus(raw, origin) {
  return {
    main: toLinks(raw.main, origin),
    footer: toLinks(raw.footer, origin),
    sidebar: toLinks(raw.sidebar, origin),
  };
}

export function withUnbuiltLinksDisabled(menus, builtPaths) {
  const fix = (links) => links.map(l => ({ ...l, href: builtPaths.has(l.path) ? l.path : "#" }));
  return { main: fix(menus.main), footer: fix(menus.footer), sidebar: fix(menus.sidebar) };
}
