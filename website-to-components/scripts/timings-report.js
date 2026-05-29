#!/usr/bin/env node
// scripts/timings-report.js
//
// Reads output/<host>/timings.jsonl for a site and writes a markdown report
// to output/<host>/timings-report.md with:
//   - Total wall-clock time
//   - Per-stage rollup (count, sum, mean, p95)
//   - Per-component table (which components took longest to build)
//   - Per-subagent table (which subagents were the slowest)
//   - Failures list
//   - Suggestions for steps that look worth optimising
//
// Usage:
//   node website-to-components/scripts/timings-report.js <site-url>
//   node website-to-components/scripts/timings-report.js ronaldmcdonaldhouse.org.uk

import { writeFileSync, existsSync, readdirSync, readFileSync } from "fs";
import { join } from "path";
import { sitePaths, siteSlug } from "../lib/paths.js";
import { readTimings, timingsPath } from "../lib/timings.js";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: timings-report.js <site-url-or-host>");
  process.exit(1);
}

// Allow either a full URL or just a hostname
const url = arg.includes("://") ? arg : `https://${arg.replace(/^https?:\/\//, "")}/`;
const host = siteSlug(url);
const { siteDir } = sitePaths(url);

if (!existsSync(timingsPath(url))) {
  console.error(`No timings log at ${timingsPath(url)}. Run the pipeline first.`);
  process.exit(1);
}

const entries = readTimings(url).filter(e => typeof e.durationMs === "number");

function ms(n) {
  if (n == null) return "—";
  if (n < 1000) return `${n}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${(n / 60_000).toFixed(1)}m`;
}

function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(sorted.length * p));
  return sorted[idx];
}

function groupBy(arr, key) {
  const out = new Map();
  for (const e of arr) {
    const k = e[key];
    if (!k) continue;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(e);
  }
  return out;
}

function rollup(group) {
  const rows = [];
  for (const [k, items] of group.entries()) {
    const durations = items.map(i => i.durationMs);
    const tokens = items.map(i => i.tokens || 0);
    const toolUses = items.map(i => i.toolUses || 0);
    const failures = items.filter(i => i.status === "fail").length;
    rows.push({
      key: k,
      count: items.length,
      total: durations.reduce((a, b) => a + b, 0),
      mean: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95: pct(durations, 0.95),
      tokens: tokens.reduce((a, b) => a + b, 0),
      toolUses: toolUses.reduce((a, b) => a + b, 0),
      failures,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

function fmtTokens(n) {
  if (!n) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

const byStage = rollup(groupBy(entries, "stage"));
const byComponent = rollup(groupBy(entries, "component"));
const bySubagent = rollup(groupBy(entries, "subagent"));
const failures = entries.filter(e => e.status === "fail");
const sumDurations = entries.reduce((a, b) => a + b.durationMs, 0);

// Actual wall clock: from earliest startedAt to latest endedAt
const starts = entries.map(e => e.startedAt ? Date.parse(e.startedAt) : null).filter(Boolean);
const ends = entries.map(e => e.endedAt ? Date.parse(e.endedAt) : null).filter(Boolean);
const actualWall = (starts.length && ends.length)
  ? Math.max(...ends) - Math.min(...starts)
  : sumDurations;
const wallTotal = sumDurations;
const parallelism = actualWall > 0 ? sumDurations / actualWall : 1;

// Heuristic: highlight stages where total > 20% of wall OR a single subagent
// in that stage took >2x the median subagent time in that stage. These are
// the "worth improving" candidates.
const suggestions = [];
for (const s of byStage) {
  if (s.total / wallTotal > 0.2) {
    suggestions.push(`**${s.key}** consumed ${(100 * s.total / wallTotal).toFixed(0)}% of total wall time (${ms(s.total)}). Look at whether its subagents could be split further, or whether the work could be cached across pages.`);
  }
}
for (const [stage, items] of groupBy(entries, "stage").entries()) {
  const subDur = items.filter(i => i.subagent).map(i => i.durationMs);
  if (subDur.length >= 2) {
    const median = pct(subDur, 0.5);
    const slowest = Math.max(...subDur);
    if (median > 0 && slowest > median * 2) {
      const slowItem = items.filter(i => i.subagent && i.durationMs === slowest)[0];
      suggestions.push(`Stage **${stage}** is bottlenecked by **${slowItem.subagent}** (${ms(slowest)} vs median ${ms(median)}). Rebalance the work — give this subagent fewer items, or split its task.`);
    }
  }
}

const lines = [];
lines.push(`# Pipeline timing report — ${host}`);
lines.push("");
const totalTokens = entries.reduce((a, b) => a + (b.tokens || 0), 0);
const totalToolUses = entries.reduce((a, b) => a + (b.toolUses || 0), 0);

lines.push(`- Source log: \`${timingsPath(url)}\``);
lines.push(`- Records: ${entries.length}`);
lines.push(`- **Actual wall clock** (earliest start → latest end): **${ms(actualWall)}**`);
lines.push(`- Sum of all stage durations (CPU-time equivalent): ${ms(sumDurations)}`);
lines.push(`- Achieved parallelism: **${parallelism.toFixed(2)}×** (sum ÷ wall clock)`);
lines.push(`- **Total LLM tokens**: **${fmtTokens(totalTokens)}** across ${totalToolUses.toLocaleString()} tool uses`);
lines.push(`- Failures recorded: ${failures.length}`);
lines.push("");

lines.push(`## Per-stage rollup`);
lines.push("");
lines.push(`| Stage | Count | Total | Mean | p95 | Tokens | Tool uses | Failures |`);
lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
for (const r of byStage) {
  lines.push(`| ${r.key} | ${r.count} | ${ms(r.total)} | ${ms(r.mean)} | ${ms(r.p95)} | ${fmtTokens(r.tokens)} | ${r.toolUses || "—"} | ${r.failures} |`);
}
lines.push("");

if (byComponent.length > 0) {
  lines.push(`## Per-component build time (top 30)`);
  lines.push("");
  lines.push(`| Component | Builds | Total | Mean | p95 | Tokens |`);
  lines.push(`|---|---:|---:|---:|---:|---:|`);
  for (const r of byComponent.slice(0, 30)) {
    lines.push(`| ${r.key} | ${r.count} | ${ms(r.total)} | ${ms(r.mean)} | ${ms(r.p95)} | ${fmtTokens(r.tokens)} |`);
  }
  lines.push("");
}

if (bySubagent.length > 0) {
  lines.push(`## Per-subagent time + tokens (top 20)`);
  lines.push("");
  lines.push(`| Subagent | Runs | Total | Mean | p95 | Tokens | Tool uses | Failures |`);
  lines.push(`|---|---:|---:|---:|---:|---:|---:|---:|`);
  for (const r of bySubagent.slice(0, 20)) {
    lines.push(`| ${r.key} | ${r.count} | ${ms(r.total)} | ${ms(r.mean)} | ${ms(r.p95)} | ${fmtTokens(r.tokens)} | ${r.toolUses || "—"} | ${r.failures} |`);
  }
  lines.push("");
}

if (failures.length > 0) {
  lines.push(`## Failures`);
  lines.push("");
  lines.push(`| Stage | Component / Subagent | Duration | Error |`);
  lines.push(`|---|---|---:|---|`);
  for (const f of failures) {
    const who = f.component ?? f.subagent ?? "—";
    const err = f.meta?.error?.replace(/\|/g, "\\|").slice(0, 120) ?? "—";
    lines.push(`| ${f.stage} | ${who} | ${ms(f.durationMs)} | ${err} |`);
  }
  lines.push("");
}

lines.push(`## Suggestions for improvement`);
lines.push("");
if (suggestions.length === 0) {
  lines.push(`No clear bottlenecks detected. Stages are reasonably balanced.`);
} else {
  for (const s of suggestions) lines.push(`- ${s}`);
}
lines.push("");

const outPath = join(siteDir, "timings-report.md");
writeFileSync(outPath, lines.join("\n"));
console.log(`Wrote ${outPath}`);
