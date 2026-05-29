#!/usr/bin/env node
/**
 * Normalize per-page components.json into the canonical array shape:
 *
 *   [ { section, sectionBounds: { y, height }, components: [ { name, type, description, layout, background, children } ] } ]
 *
 * Tolerates these alternate shapes that Sonnet/Haiku agents produced:
 *   { page, url, sections: [ { sectionImage, component: {...} } ] }
 *   { page, url, sections: [ { sectionImage, components: [...] } ] }
 *   { page, url, components: [ { sectionFile, component: "Name", description, props } ] }
 *   plain array of section objects (already canonical)
 *
 * Run for one file or for every components.json under output/<host>:
 *   node normalize-components-json.js <path-to-components.json>
 *   node normalize-components-json.js --all <output-host-dir>
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname, basename } from "path";

function repair(jsonText) {
  // Sonnet sometimes emits literal `\'` in JSON strings — invalid JSON, but easy to scrub.
  return jsonText
    .replace(/\\'/g, "'")
    .replace(/\\n/g, " ");
}

function normalize(raw, filePath) {
  const sectionsDir = join(dirname(filePath), "sections");
  let sectionEntries = [];

  if (Array.isArray(raw)) {
    sectionEntries = raw;
  } else if (raw && Array.isArray(raw.sections)) {
    sectionEntries = raw.sections;
  } else if (raw && Array.isArray(raw.components)) {
    sectionEntries = raw.components.map((c, i) => ({
      section: c.sectionFile || c.sectionImage || `section-${String(i + 1).padStart(2, "0")}.png`,
      sectionBounds: c.sectionBounds || { y: 0, height: 0 },
      components: [c],
    }));
  } else {
    return [];
  }

  return sectionEntries.map((sec, i) => {
    const rawName = sec.sectionImage || sec.sectionFile || sec.section || `section-${String(i + 1).padStart(2, "0")}.png`;
    const fileName = typeof rawName === "string" ? rawName : `section-${String(i + 1).padStart(2, "0")}.png`;
    const sectionPath = fileName.startsWith("/")
      ? fileName
      : join(sectionsDir, basename(fileName));

    let components = [];
    if (Array.isArray(sec.components)) {
      components = sec.components;
    } else if (sec.component) {
      components = [sec.component];
    }

    return {
      section: sectionPath,
      sectionBounds: sec.sectionBounds || { y: sec.y || 0, height: sec.height || 0 },
      components: components.map((c) => {
        if (typeof c === "string") return { name: c, type: "component", description: "", layout: "", background: "", children: [] };
        // Flatten nested `component` field if present
        if (typeof c.component === "string") {
          return {
            name: c.component,
            type: c.type || "component",
            description: c.description || "",
            layout: c.layout || c.props?.layout || "",
            background: c.background || c.props?.background || "",
            children: (c.children || c.props?.children || []).map((ch) =>
              typeof ch === "string" ? ch : ch?.name || ""
            ).filter(Boolean),
            props: c.props,
          };
        }
        return {
          name: c.name || c.component || "",
          type: c.type || "component",
          description: c.description || "",
          layout: c.layout || "",
          background: c.background || "",
          children: (c.children || []).map((ch) =>
            typeof ch === "string" ? ch : ch?.name || ""
          ).filter(Boolean),
          props: c.props,
        };
      }),
    };
  });
}

function processFile(filePath) {
  let text = readFileSync(filePath, "utf8");
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    try {
      raw = JSON.parse(repair(text));
      console.log(`[repaired] ${filePath}`);
    } catch (e2) {
      console.error(`[skip] ${filePath} — unparseable JSON: ${e2.message}`);
      return false;
    }
  }
  const normalized = normalize(raw, filePath);
  writeFileSync(filePath, JSON.stringify(normalized, null, 2) + "\n");
  console.log(`[ok] ${filePath} — ${normalized.length} section(s)`);
  return true;
}

const args = process.argv.slice(2);
if (args[0] === "--all") {
  const root = args[1];
  if (!root) { console.error("Usage: normalize-components-json.js --all <output-host-dir>"); process.exit(2); }
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name === "components.json") processFile(p);
    }
  };
  walk(root);
} else {
  if (!args[0]) { console.error("Usage: normalize-components-json.js <components.json> | --all <output-host-dir>"); process.exit(2); }
  processFile(args[0]);
}
