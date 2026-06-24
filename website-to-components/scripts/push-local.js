#!/usr/bin/env node
import { readFileSync, existsSync } from "fs";
import { sitePaths } from "../lib/paths.js";
import { makeClient } from "../lib/jsonapi.js";
import { normalizeMenus, withUnbuiltLinksDisabled } from "../lib/menu.js";
import { pushToLocal } from "../lib/push-local.js";

try { (await import("dotenv")).default.config({ path: "../.env" }); } catch {}

const url = process.argv[2] || process.env.TARGET_URL;
if (!url) { console.error("Usage: node scripts/push-local.js <url>"); process.exit(1); }

const { metaPath, siteDir } = sitePaths(url);
const meta = JSON.parse(readFileSync(metaPath, "utf8"));
const origin = new URL(url).origin;
const scope = meta.scope || "homepage";

const rawMenus = meta.menus || { main: meta.sitemap?.map(s => ({ label: s.text, url: s.href })) || [], footer: [], sidebar: [] };
let menus = normalizeMenus(rawMenus, origin);

const pagesPath = `${siteDir}/pages.json`;
const pages = existsSync(pagesPath) ? JSON.parse(readFileSync(pagesPath, "utf8")) : [{ title: "Home", path: "/", published: true }];

if (scope === "homepage") {
  const builtPaths = new Set(pages.map(p => p.path));
  menus = withUnbuiltLinksDisabled(menus, builtPaths);
}

const env = process.env;
const client = makeClient({
  siteUrl: env.CANVAS_LOCAL_SITE_URL,
  prefix: env.CANVAS_LOCAL_JSONAPI_PREFIX || "jsonapi",
  clientId: env.CANVAS_LOCAL_CLIENT_ID,
  clientSecret: env.CANVAS_LOCAL_CLIENT_SECRET,
});

const { execSync } = await import("node:child_process");
const result = await pushToLocal({
  env, menus, pages, client,
  runCanvasPush: async () => execSync("cd ../storybook && npm run canvas:push:local", { stdio: "inherit" }),
  log: (m) => console.log(m),
});

if (!result.ok) { console.error("\nPush aborted:\n" + result.report); process.exit(1); }
