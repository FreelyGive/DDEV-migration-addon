#!/usr/bin/env node
// scripts/timings-infographic.js
//
// Reads output/<host>/timings.jsonl and writes a self-contained HTML
// infographic to output/<host>/timings-infographic.html. No external assets,
// no JS deps — pure HTML + inline SVG + CSS.
//
// Surfaces the metrics that matter when reviewing a pipeline run:
//   - Hero stats: wall clock, CPU sum, parallelism, total tokens, tool uses
//   - Pipeline timeline (Gantt-style) — when each stage started/ended
//   - Stage cost: duration vs token bar chart
//   - Per-subagent rollup
//   - Optimisation suggestions (>20% of wall, >2x median bottleneck)
//
// Usage:
//   node website-to-components/scripts/timings-infographic.js <site-url-or-host>

import { writeFileSync, existsSync } from "fs";
import { join } from "path";
import { sitePaths, siteSlug } from "../lib/paths.js";
import { readTimings, timingsPath } from "../lib/timings.js";

const arg = process.argv[2];
if (!arg) {
  console.error("Usage: timings-infographic.js <site-url-or-host>");
  process.exit(1);
}

const url = arg.includes("://") ? arg : `https://${arg.replace(/^https?:\/\//, "")}/`;
const host = siteSlug(url);
const { siteDir } = sitePaths(url);

if (!existsSync(timingsPath(url))) {
  console.error(`No timings log at ${timingsPath(url)}. Run the pipeline first.`);
  process.exit(1);
}

const entries = readTimings(url).filter(e => typeof e.durationMs === "number");
if (entries.length === 0) {
  console.error("Timings log has no measurable entries.");
  process.exit(1);
}

function ms(n) {
  if (n == null) return "—";
  if (n < 1000) return `${n}ms`;
  if (n < 60_000) return `${(n / 1000).toFixed(1)}s`;
  return `${(n / 60_000).toFixed(1)}m`;
}
function fmtTokens(n) {
  if (!n) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}k`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}
function pct(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];
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
    rows.push({
      key: k,
      count: items.length,
      total: durations.reduce((a, b) => a + b, 0),
      mean: durations.reduce((a, b) => a + b, 0) / durations.length,
      p95: pct(durations, 0.95),
      tokens: tokens.reduce((a, b) => a + b, 0),
      toolUses: toolUses.reduce((a, b) => a + b, 0),
      failures: items.filter(i => i.status === "fail").length,
    });
  }
  return rows.sort((a, b) => b.total - a.total);
}

const sumDurations = entries.reduce((a, b) => a + b.durationMs, 0);
const totalTokens = entries.reduce((a, b) => a + (b.tokens || 0), 0);
const totalToolUses = entries.reduce((a, b) => a + (b.toolUses || 0), 0);

const starts = entries.map(e => e.startedAt ? Date.parse(e.startedAt) : null).filter(Boolean);
const ends = entries.map(e => e.endedAt ? Date.parse(e.endedAt) : null).filter(Boolean);
const t0 = starts.length ? Math.min(...starts) : 0;
const t1 = ends.length ? Math.max(...ends) : t0 + sumDurations;
const actualWall = t1 - t0;
const parallelism = actualWall > 0 ? sumDurations / actualWall : 1;

const byStage = rollup(groupBy(entries, "stage"));
const bySubagent = rollup(groupBy(entries, "subagent"));
const failures = entries.filter(e => e.status === "fail");

// Suggestions
const suggestions = [];
for (const s of byStage) {
  if (s.total / sumDurations > 0.2) {
    suggestions.push(`<b>${s.key}</b> consumed ${(100 * s.total / sumDurations).toFixed(0)}% of total CPU (${ms(s.total)}). Look at parallelising further or caching across pages.`);
  }
}
for (const [stage, items] of groupBy(entries, "stage").entries()) {
  const subDur = items.filter(i => i.subagent).map(i => i.durationMs);
  if (subDur.length >= 2) {
    const median = pct(subDur, 0.5);
    const slowest = Math.max(...subDur);
    if (median > 0 && slowest > median * 2) {
      const slowItem = items.filter(i => i.subagent && i.durationMs === slowest)[0];
      suggestions.push(`Stage <b>${stage}</b> is bottlenecked by <b>${slowItem.subagent}</b> (${ms(slowest)} vs median ${ms(median)}). Rebalance the work.`);
    }
  }
}

// Timeline bars — only entries with startedAt/endedAt
const timelineEntries = entries
  .filter(e => e.startedAt && e.endedAt)
  .map(e => ({
    label: e.subagent ? `${e.stage} / ${e.subagent}` : (e.component ? `${e.stage} / ${e.component}` : e.stage),
    start: Date.parse(e.startedAt) - t0,
    end: Date.parse(e.endedAt) - t0,
    stage: e.stage,
    status: e.status,
  }))
  .sort((a, b) => a.start - b.start);

const stageColors = [
  "#DB0007", "#1B43B2", "#9CD83E", "#FFBC0D", "#F4B6CD",
  "#D0C9FF", "#FF6E0D", "#91187D", "#1A1A1A", "#0EA5E9",
  "#10B981", "#F59E0B", "#EF4444", "#6366F1", "#EC4899",
];
const uniqueStages = [...new Set(byStage.map(s => s.key))];
const stageColor = (s) => stageColors[uniqueStages.indexOf(s) % stageColors.length];

const maxStageTotal = byStage.length ? byStage[0].total : 1;
const maxStageTokens = Math.max(...byStage.map(s => s.tokens), 1);
const maxSubTokens = Math.max(...bySubagent.map(s => s.tokens), 1);
const maxSubTotal = bySubagent.length ? bySubagent[0].total : 1;

const stageBars = byStage.map(s => {
  const durW = (s.total / maxStageTotal) * 100;
  const tokW = (s.tokens / maxStageTokens) * 100;
  return `
    <div class="row">
      <div class="row-label">${s.key} <span class="muted">(${s.count})</span></div>
      <div class="row-bars">
        <div class="bar-track">
          <div class="bar bar-duration" style="width:${durW}%;background:${stageColor(s.key)}"></div>
          <div class="bar-value">${ms(s.total)}</div>
        </div>
        <div class="bar-track">
          <div class="bar bar-tokens" style="width:${tokW}%"></div>
          <div class="bar-value">${fmtTokens(s.tokens)}</div>
        </div>
      </div>
    </div>`;
}).join("\n");

const subBars = bySubagent.slice(0, 20).map(s => {
  const durW = (s.total / maxSubTotal) * 100;
  const tokW = (s.tokens / maxSubTokens) * 100;
  return `
    <div class="row">
      <div class="row-label">${s.key} <span class="muted">(${s.count})</span></div>
      <div class="row-bars">
        <div class="bar-track">
          <div class="bar bar-duration" style="width:${durW}%;background:#1B43B2"></div>
          <div class="bar-value">${ms(s.total)}</div>
        </div>
        <div class="bar-track">
          <div class="bar bar-tokens" style="width:${tokW}%"></div>
          <div class="bar-value">${fmtTokens(s.tokens)}</div>
        </div>
      </div>
    </div>`;
}).join("\n");

// Timeline SVG
const tlH = Math.max(120, timelineEntries.length * 18 + 60);
const tlW = 1200;
const tlPadL = 20, tlPadR = 20, tlPadT = 40, tlPadB = 30;
const tlInner = tlW - tlPadL - tlPadR;
const scaleX = (msVal) => tlPadL + (actualWall > 0 ? (msVal / actualWall) * tlInner : 0);

// Time-axis ticks
const tickCount = 8;
const tickStep = Math.ceil(actualWall / tickCount / 30000) * 30000 || actualWall / tickCount;
const ticks = [];
for (let v = 0; v <= actualWall; v += tickStep) ticks.push(v);

const tlBars = timelineEntries.map((e, i) => {
  const y = tlPadT + i * 16;
  const x1 = scaleX(e.start), x2 = scaleX(e.end);
  const w = Math.max(2, x2 - x1);
  const color = e.status === "fail" ? "#EF4444" : stageColor(e.stage);
  const labelMax = e.label.length > 70 ? e.label.slice(0, 67) + "…" : e.label;
  return `
    <g>
      <rect x="${x1}" y="${y}" width="${w}" height="11" rx="2" fill="${color}" opacity="0.85">
        <title>${e.label} — ${ms(e.end - e.start)}</title>
      </rect>
      <text x="${Math.min(x2 + 6, tlPadL + tlInner - 240)}" y="${y + 9}" font-size="10" fill="#0a0a0a" font-family="-apple-system,sans-serif">${labelMax}</text>
    </g>`;
}).join("");

const tickMarks = ticks.map(v => {
  const x = scaleX(v);
  return `
    <line x1="${x}" y1="${tlPadT - 8}" x2="${x}" y2="${tlH - tlPadB + 4}" stroke="#e5e5e5" stroke-width="1"></line>
    <text x="${x}" y="${tlPadT - 12}" font-size="10" fill="#737373" text-anchor="middle" font-family="-apple-system,sans-serif">${ms(v)}</text>`;
}).join("");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Pipeline timings — ${host}</title>
<style>
  :root {
    --brand-red: #DB0007;
    --brand-purple: #D0C9FF;
    --brand-cream: #FFFDE9;
    --brand-yellow: #FFBC0D;
    --brand-green: #9CD83E;
    --ink: #0a0a0a;
    --muted: #737373;
    --line: #e5e5e5;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 40px 24px; background: #fafafa; color: var(--ink); font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
  .wrap { max-width: 1240px; margin: 0 auto; }
  h1 { font-size: 28px; margin: 0 0 4px; }
  .sub { color: var(--muted); margin-bottom: 32px; }
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 40px; }
  .stat { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 16px 18px; }
  .stat .v { font-size: 28px; font-weight: 800; letter-spacing: -0.02em; }
  .stat .l { font-size: 12px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; margin-top: 6px; }
  .stat.accent { background: var(--brand-cream); border-color: var(--brand-yellow); }
  .stat.danger { background: #fef2f2; border-color: #fecaca; }
  h2 { font-size: 18px; margin: 32px 0 14px; padding-bottom: 8px; border-bottom: 1px solid var(--line); }
  .legend { display: inline-block; margin-left: 8px; font-size: 11px; color: var(--muted); font-weight: 400; }
  .legend .sw { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; margin-right: 4px; }
  .panel { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 18px; }
  .row { display: grid; grid-template-columns: 220px 1fr; gap: 14px; align-items: center; margin-bottom: 10px; }
  .row-label { font-size: 13px; }
  .row-label .muted { color: var(--muted); font-weight: 400; }
  .row-bars { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .bar-track { position: relative; height: 22px; background: #f5f5f5; border-radius: 4px; overflow: hidden; }
  .bar { position: absolute; left: 0; top: 0; bottom: 0; min-width: 2px; }
  .bar-tokens { background: linear-gradient(90deg, #FFBC0D, #FF6E0D); }
  .bar-value { position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 11px; color: var(--ink); font-variant-numeric: tabular-nums; }
  .timeline { background: #fff; border: 1px solid var(--line); border-radius: 12px; padding: 12px; overflow-x: auto; }
  .timeline svg { display: block; min-width: 1200px; }
  .suggestions { background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 16px 20px; }
  .suggestions ul { margin: 8px 0 0; padding-left: 20px; }
  .suggestions li { margin-bottom: 8px; font-size: 14px; }
  .footer { margin-top: 40px; font-size: 12px; color: var(--muted); text-align: center; }
</style>
</head>
<body>
<div class="wrap">
  <h1>Pipeline timings — ${host}</h1>
  <div class="sub">${entries.length} records · generated ${new Date().toISOString()}</div>

  <div class="stats">
    <div class="stat accent">
      <div class="v">${ms(actualWall)}</div>
      <div class="l">Wall clock</div>
    </div>
    <div class="stat">
      <div class="v">${ms(sumDurations)}</div>
      <div class="l">CPU sum</div>
    </div>
    <div class="stat">
      <div class="v">${parallelism.toFixed(2)}×</div>
      <div class="l">Parallelism</div>
    </div>
    <div class="stat">
      <div class="v">${fmtTokens(totalTokens)}</div>
      <div class="l">LLM tokens</div>
    </div>
    <div class="stat ${failures.length ? 'danger' : ''}">
      <div class="v">${totalToolUses.toLocaleString()}</div>
      <div class="l">Tool uses · ${failures.length} fail${failures.length === 1 ? '' : 's'}</div>
    </div>
  </div>

  <h2>Timeline (Gantt) <span class="legend">each bar = one timed call · colour = stage · width = duration</span></h2>
  <div class="timeline">
    <svg viewBox="0 0 ${tlW} ${tlH}" width="100%" height="${tlH}" xmlns="http://www.w3.org/2000/svg">
      ${tickMarks}
      ${tlBars}
    </svg>
  </div>

  <h2>Per-stage cost <span class="legend"><span class="sw" style="background:#1B43B2"></span> duration &nbsp; <span class="sw" style="background:linear-gradient(90deg,#FFBC0D,#FF6E0D)"></span> tokens</span></h2>
  <div class="panel">${stageBars}</div>

  <h2>Per-subagent cost <span class="legend">(top 20)</span></h2>
  <div class="panel">${subBars}</div>

  ${suggestions.length ? `
  <h2>Suggestions</h2>
  <div class="suggestions">
    <ul>
      ${suggestions.map(s => `<li>${s}</li>`).join("\n")}
    </ul>
  </div>` : ""}

  <div class="footer">
    Source log: ${timingsPath(url)} · ${entries.length} records
  </div>
</div>
</body>
</html>`;

const outPath = join(siteDir, "timings-infographic.html");
writeFileSync(outPath, html);
console.log(`Wrote ${outPath}`);
console.log(`  ${entries.length} records · ${ms(actualWall)} wall · ${fmtTokens(totalTokens)} tokens · ${failures.length} failures`);
