#!/usr/bin/env node
// scripts/log-timing.js
//
// CLI for the Claude Code agent to append timing entries to the pipeline log.
// Use either to record a single completed event (with --duration) or a
// start/end pair (call once with --start, once with --end). For one-shot
// recording — the most common case — pass --duration in ms.
//
// Examples:
//
//   # A subagent finished building a component in 47.5s
//   node website-to-components/scripts/log-timing.js \
//     --url https://example.com/ \
//     --stage step-5-build \
//     --component RmhFooter \
//     --subagent build-bottom \
//     --duration 47500 \
//     --status ok
//
//   # The vision-analysis subagent for sections 1-3 took 42s and burned 18000 tokens
//   node website-to-components/scripts/log-timing.js \
//     --url https://example.com/ \
//     --stage step-3-vision \
//     --subagent vision-1-3 \
//     --duration 42000 \
//     --tokens 18000 \
//     --tool-uses 12 \
//     --status ok \
//     --meta '{"sections":[1,2,3]}'
//
//   # A whole stage starts (no end time yet)
//   node website-to-components/scripts/log-timing.js \
//     --url https://example.com/ \
//     --stage step-6-storybook \
//     --event start
//
//   # That stage ends
//   node website-to-components/scripts/log-timing.js \
//     --url https://example.com/ \
//     --stage step-6-storybook \
//     --event end \
//     --status ok

import { logTiming } from "../lib/timings.js";

function getArg(name, def = undefined) {
  const i = process.argv.indexOf("--" + name);
  return i > 0 ? process.argv[i + 1] : def;
}

function help() {
  console.error(`Usage: log-timing.js --url <site-url> --stage <name> [--component <name>] [--page <slug>] [--subagent <name>] [--duration <ms>] [--tokens <n>] [--tool-uses <n>] [--status ok|fail|skip] [--event start|end] [--meta <json>]`);
  process.exit(1);
}

const url = getArg("url");
const stage = getArg("stage");
if (!url || !stage) help();

const event = getArg("event");
const durationMs = getArg("duration");
const tokens = getArg("tokens");
const toolUses = getArg("tool-uses");
const status = getArg("status", "ok");
const component = getArg("component");
const page = getArg("page");
const subagent = getArg("subagent");
const metaRaw = getArg("meta");

let meta = {};
if (metaRaw) {
  try { meta = JSON.parse(metaRaw); }
  catch { console.error("--meta must be valid JSON"); process.exit(1); }
}

const entry = {
  stage,
  page: page ?? null,
  component: component ?? null,
  subagent: subagent ?? null,
  status,
  event: event ?? null,
  startedAt: event === "start" ? new Date().toISOString() : null,
  endedAt: event === "end" ? new Date().toISOString() : null,
  durationMs: durationMs ? Number(durationMs) : null,
  tokens: tokens ? Number(tokens) : null,
  toolUses: toolUses ? Number(toolUses) : null,
  meta,
};

const record = logTiming(url, entry);
const tag = component
  ? `${stage}/${component}`
  : subagent
    ? `${stage}/${subagent}`
    : stage;
const human = durationMs
  ? `${(Number(durationMs) / 1000).toFixed(1)}s`
  : event
    ? event
    : "logged";
const tokensStr = tokens ? ` ${Number(tokens).toLocaleString()}t` : "";
console.log(`[timing] ${tag.padEnd(40)} ${human.padStart(8)}${tokensStr}  ${status}`);
