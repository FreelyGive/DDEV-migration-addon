#!/usr/bin/env node
/**
 * Report which components a single page references and which are already on disk.
 *
 * Used by the orchestrator when deciding whether to spawn a Step 9 (page-story)
 * subagent for a given page while Step 5 (composite builds) are still in flight.
 *
 * A page is "ready for atoms-only Step 9 fan-out" when every *atom* it needs
 * exists in canvas/src/components/. Composites can still be pending; the page
 * story will write fine and only Storybook smoke-test cares whether composites
 * land before the test runs.
 *
 * Usage:
 *   node website-to-components/scripts/page-readiness.js <page-url>
 *   node website-to-components/scripts/page-readiness.js <page-url> --json
 *
 * Exit code:
 *   0 — every atom the page needs is present (safe to spawn Step 9 subagent)
 *   1 — at least one atom is missing (wait for Step 5 atom subagents to finish)
 *   2 — bad invocation or missing components.json
 *
 * Inputs:
 *   - output/<host>/[<page-slug>/]components.json  (vision output)
 *   - canvas/src/components/<machine_name>/        (build output to check against)
 *
 * Classification (atom vs composite) is heuristic: read the component's
 * index.jsx if present and look for `from '@/components/...'` imports. If the
 * file isn't built yet, fall back to a name-based heuristic (cards/grids/forms
 * are usually composites; logos/buttons/links are usually atoms).
 */

import { readFileSync, existsSync, readdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { sitePaths, siteSlug, pageSlug } from "../lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const COMPONENTS_DIR = join(ROOT, "canvas/src/components");

function pascalToSnake(s) {
  return s.replace(/([A-Z])/g, (m, c, i) => (i === 0 ? "" : "_") + c.toLowerCase());
}

// Name heuristic for unbuilt components.
const COMPOSITE_HINTS = /(Cards?|Grid|List|Accordion|Form|Header|Banner|Footer|Navbar)$/;

function isComposite(machineName) {
  // Built? Read its JSX for @/components/ imports.
  const jsxPath = join(COMPONENTS_DIR, machineName, "index.jsx");
  if (existsSync(jsxPath)) {
    const src = readFileSync(jsxPath, "utf8");
    return /from\s+['"]@\/components\//.test(src);
  }
  // Unbuilt: guess from PascalCase suffix.
  const pascal = machineName
    .split("_")
    .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
    .join("");
  return COMPOSITE_HINTS.test(pascal);
}

function collectComponentNames(componentsJsonPath) {
  const data = JSON.parse(readFileSync(componentsJsonPath, "utf8"));
  const out = new Set();
  for (const sec of data) {
    for (const c of sec.components || []) {
      if (c.name) out.add(c.name);
      for (const ch of c.children || []) out.add(ch);
    }
  }
  return [...out];
}

function classify(name) {
  const machine = pascalToSnake(name);
  const present = existsSync(join(COMPONENTS_DIR, machine));
  const composite = isComposite(machine);
  return { name, machineName: machine, present, composite };
}

function main() {
  const argv = process.argv.slice(2);
  const url = argv.find((a) => !a.startsWith("--"));
  const json = argv.includes("--json");
  if (!url) {
    console.error("Usage: page-readiness.js <page-url> [--json]");
    process.exit(2);
  }
  const { componentsPath } = sitePaths(url);
  if (!existsSync(componentsPath)) {
    console.error(`No components.json at ${componentsPath}`);
    process.exit(2);
  }

  const refs = collectComponentNames(componentsPath).map(classify);
  const atoms = refs.filter((r) => !r.composite);
  const composites = refs.filter((r) => r.composite);
  const missingAtoms = atoms.filter((a) => !a.present);
  const missingComposites = composites.filter((c) => !c.present);

  const ready = missingAtoms.length === 0;

  if (json) {
    console.log(
      JSON.stringify(
        {
          page: pageSlug(url),
          ready,
          totalReferenced: refs.length,
          atoms: { needed: atoms.length, missing: missingAtoms.map((a) => a.machineName) },
          composites: { needed: composites.length, missing: missingComposites.map((c) => c.machineName) },
        },
        null,
        2,
      ),
    );
  } else {
    console.log(`Page:           ${pageSlug(url)}`);
    console.log(`Components ref: ${refs.length}`);
    console.log(`  Atoms:        ${atoms.length - missingAtoms.length}/${atoms.length} present`);
    console.log(`  Composites:   ${composites.length - missingComposites.length}/${composites.length} present`);
    if (missingAtoms.length) {
      console.log(`  Missing atoms:      ${missingAtoms.map((a) => a.machineName).join(", ")}`);
    }
    if (missingComposites.length) {
      console.log(`  Missing composites: ${missingComposites.map((c) => c.machineName).join(", ")}`);
    }
    console.log("");
    console.log(ready ? "✓ All atoms present — safe to spawn Step 9 subagent for this page." : "✗ Atoms still missing — wait for Step 5 atom subagents to finish.");
  }

  process.exit(ready ? 0 : 1);
}

main();
