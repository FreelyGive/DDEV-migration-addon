#!/usr/bin/env node
/**
 * scan-dom-images.js
 *
 * Deep-scans the fully-rendered DOM of a URL for ALL <img> elements,
 * including those injected by JavaScript and third-party widgets.
 *
 * Use this for pages with popups, modals, or embedded widgets that load
 * images dynamically — these are missed by the standard pipeline scraper.
 *
 * Usage:
 *   node website-to-components/scripts/scan-dom-images.js <url>
 *
 * Examples:
 *   node website-to-components/scripts/scan-dom-images.js https://example.com
 *   node website-to-components/scripts/scan-dom-images.js "https://example.com/?form=FUNJHNAUEXC"
 */

import { run } from '../jobs/03b-scan-dom-images.js';

const url = process.argv[2];
if (!url) {
  console.error('Usage: node website-to-components/scripts/scan-dom-images.js <url>');
  process.exit(1);
}

await run(url);
