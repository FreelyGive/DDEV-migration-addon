#!/usr/bin/env node
/**
 * Start Storybook in the background reliably.
 *
 * Why: `npx storybook dev -p 6007 --no-open` prompts INTERACTIVELY if the port is busy,
 * and silently fails to start if the previous instance is still bound. The `--ci`
 * flag exits cleanly on conflict but is easy to forget. This script bakes the safe
 * defaults in one place so every step in the pipeline starts Storybook the same way.
 *
 * Behavior:
 *  1. Kill any process bound to the requested port.
 *  2. Launch `npx storybook dev -p <port> --no-open --ci` detached, redirecting
 *     stdout+stderr to <canvas>/storybook.log.
 *  3. Poll http://localhost:<port>/ every 1s for up to <timeout> seconds.
 *  4. On success: print PID and URL. Exit 0.
 *  5. On failure: print the last 30 lines of storybook.log and exit 1.
 *
 * Usage:
 *   node website-to-components/scripts/start-storybook.js
 *   node website-to-components/scripts/start-storybook.js --port 6008 --timeout 60
 *   node website-to-components/scripts/start-storybook.js --canvas-dir /custom/canvas
 *
 * Defaults: port 6007, timeout 60, canvas dir <project-root>/canvas.
 */

import { spawn, spawnSync } from "child_process";
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";
import http from "http";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

function parseArgs(argv) {
  const out = { port: 6007, timeout: 60, canvasDir: join(ROOT, "canvas") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--port") out.port = parseInt(argv[++i], 10);
    else if (a === "--timeout") out.timeout = parseInt(argv[++i], 10);
    else if (a === "--canvas-dir") out.canvasDir = resolve(argv[++i]);
    else if (a === "--help" || a === "-h") {
      console.log("Usage: start-storybook.js [--port N] [--timeout N] [--canvas-dir PATH]");
      process.exit(0);
    }
  }
  return out;
}

function killPort(port) {
  // Use lsof to find anything bound to the port; ignore failures (nothing was bound).
  const r = spawnSync("sh", ["-c", `lsof -ti :${port} | xargs -r kill -9 2>/dev/null; true`]);
  return r.status === 0;
}

function ping(port) {
  return new Promise((resolve) => {
    const req = http
      .get({ host: "127.0.0.1", port, path: "/", timeout: 2000 }, (res) => {
        resolve(res.statusCode === 200 || res.statusCode === 301 || res.statusCode === 302);
        res.resume();
      })
      .on("error", () => resolve(false))
      .on("timeout", () => {
        req.destroy();
        resolve(false);
      });
  });
}

async function poll(port, timeoutSec) {
  const deadline = Date.now() + timeoutSec * 1000;
  while (Date.now() < deadline) {
    if (await ping(port)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!existsSync(opts.canvasDir)) {
    console.error(`No canvas dir at ${opts.canvasDir}`);
    process.exit(1);
  }
  console.log(`Killing anything bound to :${opts.port}…`);
  killPort(opts.port);

  const logPath = join(opts.canvasDir, "storybook.log");
  const pidPath = join(opts.canvasDir, "storybook.pid");
  mkdirSync(dirname(logPath), { recursive: true });

  console.log(`Starting Storybook on :${opts.port}, logging to ${logPath}`);
  const fd = openSync(logPath, "w");
  const child = spawn("npx", ["storybook", "dev", "-p", String(opts.port), "--no-open", "--ci"], {
    cwd: opts.canvasDir,
    stdio: ["ignore", fd, fd],
    detached: true,
  });
  child.unref();
  writeFileSync(pidPath, String(child.pid));
  console.log(`PID ${child.pid}. Polling for ready (timeout ${opts.timeout}s)…`);

  const ok = await poll(opts.port, opts.timeout);
  if (!ok) {
    console.error(`✗ Storybook did not respond on :${opts.port} within ${opts.timeout}s.`);
    console.error("--- last 30 lines of storybook.log ---");
    try {
      const log = readFileSync(logPath, "utf8").split("\n").slice(-30).join("\n");
      console.error(log);
    } catch {}
    process.exit(1);
  }
  console.log(`✓ Storybook ready at http://localhost:${opts.port}/`);
  console.log(`  PID file: ${pidPath}`);
  console.log(`  Log:      ${logPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
