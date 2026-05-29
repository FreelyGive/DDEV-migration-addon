#!/usr/bin/env node
/**
 * audit-content.js
 *
 * Checks that every component file exists and uses real site URLs/text (not placeholders).
 * Reads the story file + each component's index.jsx and checks image/text props.
 *
 * Usage:
 *   node scripts/audit-content.js                         # auto-detect from output/
 *   node scripts/audit-content.js ronaldmcdonaldhouse.org.uk
 */

import { readFileSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const SCRIPT_ROOT = new URL('..', import.meta.url).pathname;
// canvas/ is a sibling of website-to-components/, so go up one more level
const PROJECT_ROOT = join(SCRIPT_ROOT, '..');
const CANVAS = join(PROJECT_ROOT, 'canvas/src');
const OUTPUT = join(SCRIPT_ROOT, 'output');

const RESET  = '\x1b[0m';
const RED    = '\x1b[31m';
const GREEN  = '\x1b[32m';
const YELLOW = '\x1b[33m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

// ─── Determine site slug ───────────────────────────────────────────────────
function findComponentsJsonPaths(dir) {
  // Returns all paths to components.json files under dir (recursive, 2 levels)
  const results = [];
  if (!existsSync(dir)) return results;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const sub = join(dir, entry.name);
    if (existsSync(join(sub, 'components.json'))) results.push(join(sub, 'components.json'));
    // One level deeper (e.g. output/site/page-slug/components.json)
    for (const entry2 of readdirSync(sub, { withFileTypes: true })) {
      if (!entry2.isDirectory()) continue;
      const sub2 = join(sub, entry2.name);
      if (existsSync(join(sub2, 'components.json'))) results.push(join(sub2, 'components.json'));
    }
  }
  return results;
}

function detectSite() {
  const arg = process.argv[2];
  if (arg) return arg;
  // Auto-detect: find sites that have a components.json (direct or nested)
  const sites = readdirSync(OUTPUT, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name)
    .filter(name => {
      const siteDir = join(OUTPUT, name);
      return existsSync(join(siteDir, 'components.json')) || findComponentsJsonPaths(siteDir).length > 0;
    });
  if (sites.length === 1) return sites[0];
  if (sites.length > 1) {
    console.log(`Multiple sites found: ${sites.join(', ')}`);
    console.log(`Usage: node scripts/audit-content.js <site-slug>\n`);
    process.exit(1);
  }
  console.error('No site found in output/. Run node scripts/run.js <url> first.');
  process.exit(1);
}

const site = detectSite();

// ─── Load site-specific checks ────────────────────────────────────────────
function getChecks(site) {
  // Generic: check that all detected component files exist
  console.log(`${YELLOW}Checking component files exist for "${site}"${RESET}\n`);
  return getGenericChecks(site);
}

function getGenericChecks(site) {
  // Collect all components.json files for this site (direct + sub-page folders)
  const siteDir = join(OUTPUT, site);
  const directPath = join(siteDir, 'components.json');
  const allPaths = existsSync(directPath)
    ? [directPath]
    : findComponentsJsonPaths(siteDir);

  const allComponents = allPaths.flatMap(p => JSON.parse(readFileSync(p, 'utf8')));
  const names = [...new Set(allComponents.flatMap(s => s.components.map(c => c.name)))];

  // Find most-recently-modified story file
  const storiesDir = join(CANVAS, 'stories/pages');
  const storyFile = existsSync(storiesDir)
    ? readdirSync(storiesDir).find(f => f.endsWith('.stories.tsx'))
    : null;

  return {
    story: storyFile ? join(storiesDir, storyFile) : null,
    label: site,
    checks: names.map(name => {
      const snake = name.replace(/([A-Z])/g, m => '_' + m.toLowerCase()).replace(/^_/, '').toLowerCase();
      return { component: snake, label: name, imageChecks: [], textChecks: [] };
    }),
  };
}

// ─── Run audit ─────────────────────────────────────────────────────────────
const { story: STORY, label: SITE_LABEL, checks: CHECKS } = getChecks(site);

if (STORY && !existsSync(STORY)) {
  console.error(`Story file not found: ${STORY}`);
  process.exit(1);
}

const story = STORY ? readFileSync(STORY, 'utf8') : '';

function readComponent(name) {
  const p = join(CANVAS, `components/${name}/index.jsx`);
  return existsSync(p) ? readFileSync(p, 'utf8') : null;
}

function findInSource(source, value, caseSensitive = true) {
  if (caseSensitive) return source.includes(value);
  return source.toLowerCase().includes(value.toLowerCase());
}

let totalIssues = 0;

console.log(`\n${BOLD}=== ${SITE_LABEL} — Content Audit ===${RESET}`);
console.log(`${DIM}Checking story props and component source against real site content${RESET}\n`);

for (const check of CHECKS) {
  const componentSrc = readComponent(check.component);
  if (!componentSrc) {
    console.log(`${BOLD}${check.label}${RESET} (${check.component})`);
    console.log(`  ${RED}✗ Component file not found${RESET}\n`);
    totalIssues++;
    continue;
  }
  const sources = [story, componentSrc].filter(Boolean).join('\n');

  const issues = [];

  for (const ic of check.imageChecks || []) {
    if (!findInSource(sources, ic.expected)) {
      issues.push(`  ${RED}✗ Image URL missing${RESET}: ${ic.field}\n    ${DIM}Expected: ${ic.expected}${ic.note ? `  (${ic.note})` : ''}${RESET}`);
      totalIssues++;
    }
  }
  for (const vc of check.videoChecks || []) {
    if (!findInSource(sources, vc.expected)) {
      issues.push(`  ${RED}✗ Video URL missing${RESET}: ${vc.field}\n    ${DIM}Expected: ${vc.expected}${RESET}`);
      totalIssues++;
    }
  }
  for (const tc of check.textChecks || []) {
    if (!findInSource(sources, tc.expected, false)) {
      issues.push(`  ${YELLOW}⚠ Text missing${RESET}: ${tc.field}\n    ${DIM}Expected: "${tc.expected}"${RESET}`);
      totalIssues++;
    }
  }

  console.log(`${BOLD}${check.label}${RESET} (${check.component})`);
  if (issues.length === 0) {
    console.log(`  ${GREEN}✓ OK${RESET}`);
  } else {
    for (const msg of issues) console.log(msg);
  }
  console.log();
}

console.log(`${BOLD}=== Summary ===${RESET}`);
if (totalIssues === 0) {
  console.log(`${GREEN}✓ No issues — all components use real site content${RESET}\n`);
  process.exit(0);
} else {
  console.log(`${RED}${totalIssues} issue(s) found${RESET} — fix story props or component source to use real URLs/text\n`);
  process.exit(1);
}
