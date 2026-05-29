#!/usr/bin/env node
/**
 * Per-component iteration budget tracker.
 *
 * Each fidelity-iteration agent must check the budget BEFORE editing a component
 * (or page story), increment after editing, and stop touching that file once
 * the cap (default 3) is hit.
 *
 * Usage:
 *   node edit-budget.js check <component-or-story-path>
 *     → prints current count + remaining budget; exit 0 if budget left, exit 1 if exhausted.
 *
 *   node edit-budget.js bump <component-or-story-path>
 *     → increments the counter after a successful edit.
 *
 *   node edit-budget.js report
 *     → prints the full ledger.
 *
 * Budget file: canvas/.edit-budget.json
 *   { "<repo-relative path>": { "count": N, "cap": 3, "lastBumped": "<iso>", "lastBumpedBy": "<actor>" } }
 *
 * Default cap is 3. Override per-file by setting the entry's `cap` field
 * manually, or via the EDIT_BUDGET_CAP env var when bumping.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname, relative, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "../..");
const BUDGET_FILE = resolve(ROOT, "canvas/.edit-budget.json");
const DEFAULT_CAP = Number(process.env.EDIT_BUDGET_CAP || 3);

function loadLedger() {
  if (!existsSync(BUDGET_FILE)) return {};
  try { return JSON.parse(readFileSync(BUDGET_FILE, "utf8")); }
  catch { return {}; }
}

function saveLedger(ledger) {
  mkdirSync(dirname(BUDGET_FILE), { recursive: true });
  writeFileSync(BUDGET_FILE, JSON.stringify(ledger, null, 2) + "\n");
}

function normalize(path) {
  const abs = resolve(path);
  return relative(ROOT, abs);
}

const [cmd, ...rest] = process.argv.slice(2);

if (cmd === "check") {
  const path = rest[0];
  if (!path) { console.error("Usage: edit-budget check <path>"); process.exit(2); }
  const key = normalize(path);
  const ledger = loadLedger();
  const entry = ledger[key] || { count: 0, cap: DEFAULT_CAP };
  const remaining = entry.cap - entry.count;
  console.log(JSON.stringify({ path: key, count: entry.count, cap: entry.cap, remaining, allowed: remaining > 0 }));
  process.exit(remaining > 0 ? 0 : 1);
}

if (cmd === "bump") {
  const path = rest[0];
  const actor = rest[1] || process.env.EDIT_BUDGET_ACTOR || "unknown";
  if (!path) { console.error("Usage: edit-budget bump <path> [actor]"); process.exit(2); }
  const key = normalize(path);
  const ledger = loadLedger();
  const cap = ledger[key]?.cap ?? DEFAULT_CAP;
  const count = (ledger[key]?.count ?? 0) + 1;
  ledger[key] = { count, cap, lastBumped: new Date().toISOString(), lastBumpedBy: actor };
  saveLedger(ledger);
  const remaining = cap - count;
  console.log(JSON.stringify({ path: key, count, cap, remaining, allowed: remaining > 0 }));
  if (remaining < 0) {
    console.error(`WARNING: budget exceeded for ${key} (count=${count}, cap=${cap})`);
  }
  process.exit(0);
}

if (cmd === "report") {
  const ledger = loadLedger();
  const rows = Object.entries(ledger).sort((a, b) => b[1].count - a[1].count);
  if (rows.length === 0) { console.log("(empty)"); process.exit(0); }
  const w = Math.max(...rows.map(([k]) => k.length));
  console.log("count/cap  remaining  path");
  for (const [path, e] of rows) {
    const rem = e.cap - e.count;
    const marker = rem <= 0 ? "X" : rem === 1 ? "!" : " ";
    console.log(`${marker} ${String(e.count).padStart(2)}/${String(e.cap).padStart(2)}    ${String(rem).padStart(2)}      ${path}`);
  }
  process.exit(0);
}

if (cmd === "reset") {
  const path = rest[0];
  const ledger = loadLedger();
  if (path) {
    const key = normalize(path);
    delete ledger[key];
  } else {
    Object.keys(ledger).forEach(k => delete ledger[k]);
  }
  saveLedger(ledger);
  console.log("OK");
  process.exit(0);
}

console.error("Usage:");
console.error("  edit-budget check <path>        # exit 1 if cap reached");
console.error("  edit-budget bump <path> [actor] # increment counter");
console.error("  edit-budget report              # show full ledger");
console.error("  edit-budget reset [path]        # reset one or all");
process.exit(2);
