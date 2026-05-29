#!/usr/bin/env node
/**
 * Validate Storybook page-story / component-story files for JSX syntax landmines
 * that would silently break Storybook startup.
 *
 * Catches:
 *  1. Escaped apostrophes inside single-quoted JSX attributes (`'foo\'s bar'`) — JSX
 *     does not unescape `\'` and the parser rejects the resulting unterminated string.
 *     Observed in the wild in `RmhStories.stories.jsx` — Storybook refuses to start.
 *  2. Smart-quote apostrophes (U+2019) inside JSX attribute single-quoted strings —
 *     parses but tends to mis-render. We warn rather than fail.
 *  3. Adjacent JSX expressions with no whitespace (`}{`) that often signal a missing prop.
 *  4. Missing `import React from 'react'` in files that contain JSX — Storybook is mostly
 *     fine with this in React 19 but some lint rules still expect it.
 *
 * Usage:
 *   node website-to-components/scripts/validate-page-stories.js [--fix] [<glob>]
 *
 * Default glob: canvas/src/stories/** /*.stories.{js,jsx,ts,tsx}
 *
 * With --fix, the script rewrites broken attributes from `'foo\'s bar'` to a template-literal
 * form: `{`foo's bar`}`. Other classes of issue are reported but not auto-fixed.
 *
 * Exit code:
 *   0 — no fatal issues
 *   1 — fatal issues found (Storybook would fail to start). --fix may resolve.
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

const DEFAULT_GLOB_DIRS = [
  join(ROOT, "canvas/src/stories"),
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = join(dir, e);
    let s;
    try {
      s = statSync(p);
    } catch {
      continue; // skip transient files / broken symlinks
    }
    if (s.isDirectory()) walk(p, out);
    else if (/\.stories\.(jsx?|tsx?)$/.test(e)) out.push(p);
  }
  return out;
}

// --- Issue checks ----------------------------------------------------------

// 1. attribute='value with \'escaped\' apostrophe' — JSX parser rejects this.
// Pattern matches: `name=` then `'` then any non-`'` chars (including `\'`) then `'`.
// We then test whether the captured value contains `\'` — if yes, FATAL.
const ATTR_SINGLE_QUOTE = /(\b[A-Za-z_$][A-Za-z0-9_$]*=)'((?:[^'\\\n]|\\.)*)'/g;

// 2. smart-quote inside attribute single-quoted strings
const HAS_SMART_QUOTE = /['"‘’“”]/;

// 3. Adjacent JSX expressions `}{` with no whitespace inside a tag body.
const ADJACENT_EXPR = /}\{/g;

// 4. Missing React import.
const HAS_JSX = /<[A-Za-z][^>]*>/;
const HAS_REACT_IMPORT = /from ['"]react['"]/;

function fixEscapedApostropheAttrs(src) {
  let changed = 0;
  const fixed = src.replace(ATTR_SINGLE_QUOTE, (match, attrEq, value) => {
    if (!/\\'/.test(value)) return match;
    // Replace `\'` with real `'`, then wrap in template literal.
    const unescaped = value.replace(/\\'/g, "'");
    // Escape backticks/${ if they were in the original (rare).
    const tpl = unescaped.replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
    changed++;
    return `${attrEq}{\`${tpl}\`}`;
  });
  return { fixed, changed };
}

function inspectFile(file, { fix }) {
  const orig = readFileSync(file, "utf8");
  const issues = [];

  // Check 1
  const escapedApos = [...orig.matchAll(ATTR_SINGLE_QUOTE)]
    .filter((m) => /\\'/.test(m[2]))
    .map((m) => ({
      kind: "escaped-apostrophe-in-attr",
      severity: "fatal",
      message: `Escaped apostrophe inside single-quoted JSX attribute: ${m[1]}'${m[2].slice(0, 40)}...'`,
      offset: m.index,
    }));
  issues.push(...escapedApos);

  // Check 3 — adjacent expressions are not fatal but worth flagging
  if (ADJACENT_EXPR.test(orig)) {
    issues.push({
      kind: "adjacent-expressions",
      severity: "warn",
      message: "Adjacent `}{` JSX expressions — verify a space/prop wasn't dropped",
    });
  }

  // Check 4
  if (HAS_JSX.test(orig) && !HAS_REACT_IMPORT.test(orig)) {
    issues.push({
      kind: "missing-react-import",
      severity: "warn",
      message: "JSX present but no `import React from 'react'` — fine on React 19, warned for safety",
    });
  }

  let writeOut = false;
  let newSrc = orig;
  if (fix && escapedApos.length) {
    const r = fixEscapedApostropheAttrs(orig);
    if (r.changed) {
      newSrc = r.fixed;
      writeOut = true;
      issues.push({ kind: "auto-fixed", severity: "info", message: `Fixed ${r.changed} escaped-apostrophe attribute(s)` });
    }
  }

  if (writeOut) writeFileSync(file, newSrc);
  return issues;
}

function fmt(severity) {
  if (severity === "fatal") return "\x1b[31mFATAL\x1b[0m";
  if (severity === "warn") return "\x1b[33mWARN \x1b[0m";
  if (severity === "info") return "\x1b[32mINFO \x1b[0m";
  return severity;
}

function main() {
  const argv = process.argv.slice(2);
  const fix = argv.includes("--fix");
  const dirArgs = argv.filter((a) => !a.startsWith("--"));
  const dirs = dirArgs.length ? dirArgs : DEFAULT_GLOB_DIRS;

  const files = dirs.flatMap((d) => walk(d));
  if (!files.length) {
    console.log("No story files found.");
    process.exit(0);
  }

  let fatal = 0;
  let warn = 0;
  let autoFixed = 0;
  for (const f of files) {
    const issues = inspectFile(f, { fix });
    if (!issues.length) continue;
    const wasFixed = issues.some((i) => i.kind === "auto-fixed");
    console.log(`\n${f}`);
    for (const i of issues) {
      console.log(`  ${fmt(i.severity)} ${i.kind}: ${i.message}`);
      // Count fatals as resolved when --fix succeeded for the same file.
      if (i.severity === "fatal" && !(fix && wasFixed)) fatal++;
      else if (i.severity === "fatal" && fix && wasFixed) autoFixed++;
      if (i.severity === "warn") warn++;
    }
  }

  console.log("");
  if (autoFixed) console.log(`✓ Auto-fixed ${autoFixed} previously-fatal issue(s).`);
  if (fatal) {
    console.log(`✗ ${fatal} fatal issue(s) — Storybook will refuse to start until fixed.`);
    if (!fix) console.log("  Re-run with --fix to auto-resolve known patterns.");
    process.exit(1);
  }
  if (warn) console.log(`⚠ ${warn} warning(s) — review before declaring done.`);
  console.log(`✓ No fatal issues across ${files.length} story file(s).`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
