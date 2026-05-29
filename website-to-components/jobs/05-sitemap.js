import { spawnSync, execSync } from "child_process";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { sitePaths, siteSlug, ensureDir } from "../lib/paths.js";

function browserEval(js) {
  const result = spawnSync("agent-browser", ["eval", "--stdin"], {
    input: js,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.stdout?.trim() ?? "";
}

export async function run(url) {
  const { outputDir, metaPath } = sitePaths(url);
  ensureDir(outputDir);

  const origin = new URL(url).origin;
  const slug = siteSlug(url);

  console.log(`Discovering sitemap for ${slug} (same-domain only)...`);

  execSync("agent-browser set viewport 1440 900", { stdio: "inherit" });
  execSync(`agent-browser open "${url}"`, { stdio: "inherit" });
  execSync("agent-browser wait --load networkidle", { stdio: "inherit" });

  // Extract all anchor hrefs from the page, keep only same-domain links
  const raw = browserEval(`
    (function() {
      const origin = ${JSON.stringify(origin)};
      const seen = new Set();
      const links = [];
      document.querySelectorAll('a[href]').forEach(function(a) {
        try {
          const u = new URL(a.href, location.href);
          if (
            u.origin === origin &&
            (u.protocol === 'http:' || u.protocol === 'https:') &&
            u.pathname !== '#' &&
            !seen.has(u.pathname)
          ) {
            seen.add(u.pathname);
            links.push({ href: u.origin + u.pathname, text: a.textContent.trim().substring(0, 60) });
          }
        } catch(e) {}
      });
      return JSON.stringify(links);
    })()
  `);

  execSync("agent-browser close", { stdio: "inherit" });

  let links = [];
  try {
    // agent-browser wraps string return values in quotes, so double-parse if needed
    let parsed = JSON.parse(raw);
    if (typeof parsed === "string") parsed = JSON.parse(parsed);
    links = Array.isArray(parsed) ? parsed : [];
  } catch {
    console.error("Failed to parse links, raw value:", raw.substring(0, 200));
  }

  // Always include the root URL
  const rootEntry = { href: origin + "/", text: "Home" };
  const all = [rootEntry, ...links.filter(l => l.href !== origin + "/")];

  // Persist into meta.json alongside existing fields
  let meta = {};
  if (existsSync(metaPath)) {
    try { meta = JSON.parse(readFileSync(metaPath, "utf8")); } catch {}
  }
  meta.sitemap = all;
  writeFileSync(metaPath, JSON.stringify(meta, null, 2));

  console.log(`Found ${all.length} pages:`);
  all.forEach(l => console.log(`  ${l.href}  (${l.text || "—"})`));

  return all;
}

if (process.argv[1]?.endsWith("05-sitemap.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/05-sitemap.js <url>"); process.exit(1); }
  await run(url);
}
