import { mkdirSync, rmSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const ROOT = join(__dirname, "..");

export function siteSlug(url) {
  return new URL(url).hostname.replace(/^www\./, "");
}

// pageSlug turns a full URL into a filesystem-safe directory name.
// Homepage → "home", /about → "about", /foo/bar → "foo__bar"
export function pageSlug(url) {
  const u = new URL(url);
  const path = u.pathname.replace(/^\/|\/$/g, ""); // strip leading/trailing slashes
  if (!path) return "home";
  return path.replace(/\//g, "__");
}

export function sitePaths(url) {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  const page = pageSlug(url);
  // Root site dir holds the sitemap meta; per-page dirs hold screenshots + reports
  const siteDir = join(ROOT, "output", host);
  const outputDir = page === "home" ? siteDir : join(siteDir, page);
  return {
    siteDir,          // always the hostname-level dir (for sitemap meta.json)
    outputDir,        // per-page dir
    sectionsDir: join(outputDir, "sections"),
    screenshotPath: join(outputDir, "screenshot.png"),
    metaPath: join(siteDir, "meta.json"),   // sitemap meta stays at site root
    componentsPath: join(outputDir, "components.json"),
    reportPath: join(outputDir, "report.md"),
  };
}

export function ensureDir(dir) {
  mkdirSync(dir, { recursive: true });
}

// Remove all generated output for a single page (sections, screenshot, components, report).
// Preserves the parent siteDir so sibling pages are unaffected.
export function cleanPage(url) {
  const { outputDir } = sitePaths(url);
  if (existsSync(outputDir)) {
    rmSync(outputDir, { recursive: true, force: true });
    console.log(`Cleaned: ${outputDir}`);
  }
}

// Remove the entire site output directory (all pages, meta.json, everything).
// Used before a full run-all re-scrape.
export function cleanSite(url) {
  const { siteDir } = sitePaths(url);
  if (existsSync(siteDir)) {
    rmSync(siteDir, { recursive: true, force: true });
    console.log(`Cleaned: ${siteDir}`);
  }
}
