/**
 * Job 06 — Mobile visual check
 *
 * For each component story in Storybook, screenshots it at 390px width and
 * saves it alongside the mobile source section images so a Claude Code agent
 * can compare them side-by-side and report discrepancies.
 *
 * Prerequisites:
 *   - Storybook running at http://localhost:6007 (npm run dev in canvas/)
 *   - Mobile sections already captured (job 01b)
 *
 * Output:
 *   output/<site>/<page>/mobile-storybook/<component-name>.png
 *   output/<site>/<page>/mobile-check-report.md
 *
 * Usage:
 *   node jobs/06-mobile-check.js <url> [--storybook-port 6007]
 *
 * After running, the agent should:
 *   1. Read each mobile-storybook/<name>.png alongside the relevant mobile-sections/section-NN.png
 *   2. Identify layout/spacing/font differences
 *   3. Fix the component and re-run this job to verify
 */

import { execSync, spawnSync } from "child_process";
import { writeFileSync, readFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { imageSize, cropPng } from "../lib/image.js";
import { sitePaths, ensureDir } from "../lib/paths.js";

const MOBILE_WIDTH = 390;
const MOBILE_HEIGHT = 844;

const STORYBOOK_PORT = (() => {
  const idx = process.argv.indexOf("--storybook-port");
  return idx !== -1 ? process.argv[idx + 1] : "6007";
})();

function browserEval(js) {
  const result = spawnSync("agent-browser", ["eval", "--stdin"], {
    input: js,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  return result.stdout?.trim() ?? "";
}

function openStory(componentName, storyName = "Default") {
  // Storybook URL format: /story/<component-id>--<story-id>
  // component-id = component name lowercased, underscores → hyphens
  const componentId = componentName.toLowerCase().replace(/_/g, "-");
  const storyId = storyName.toLowerCase().replace(/\s+/g, "-");
  const storybookUrl = `http://localhost:${STORYBOOK_PORT}/iframe.html?id=components-${componentId}--${storyId}&viewMode=story`;
  execSync(`agent-browser open "${storybookUrl}"`, { stdio: "pipe" });
  execSync("agent-browser wait --load networkidle", { stdio: "pipe" });
  execSync("agent-browser wait 1000", { stdio: "pipe" });
}

async function screenshotStory(componentName, outPath) {
  execSync(`agent-browser screenshot "${outPath}" --full`, { stdio: "pipe" });
  // Trim any excessive white space below the component
  try {
    const meta = imageSize(outPath);
    if (meta.height > MOBILE_HEIGHT * 2) {
      // Crop to reasonable height — components shouldn't be taller than 2 viewports
      cropPng(outPath, { left: 0, top: 0, width: meta.width, height: Math.min(meta.height, MOBILE_HEIGHT * 2) }, outPath + ".tmp.png");
      execSync(`mv "${outPath}.tmp.png" "${outPath}"`);
    }
  } catch { /* keep original if crop fails */ }
}

function discoverComponentNames(canvasDir) {
  const componentsDir = join(canvasDir, "src", "components");
  if (!existsSync(componentsDir)) return [];
  return readdirSync(componentsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(componentsDir, d.name, "index.jsx")))
    .map((d) => d.name);
}

export async function run(url, canvasDir) {
  const paths = sitePaths(url);
  const mobileSectionsDir = join(paths.outputDir, "mobile-sections");
  const mobileStorybookDir = join(paths.outputDir, "mobile-storybook");
  const reportPath = join(paths.outputDir, "mobile-check-report.md");

  if (!existsSync(mobileSectionsDir)) {
    console.error(`Mobile sections not found at ${mobileSectionsDir}`);
    console.error("Run job 01b first: node jobs/01b-screenshot-mobile.js <url>");
    process.exit(1);
  }

  ensureDir(mobileStorybookDir);

  // Resolve canvas dir relative to this file if not provided
  if (!canvasDir) {
    const { dirname, join: pjoin } = await import("path");
    const { fileURLToPath } = await import("url");
    const here = dirname(fileURLToPath(import.meta.url));
    canvasDir = pjoin(here, "../../canvas");
  }

  const componentNames = discoverComponentNames(canvasDir);
  console.log(`Found ${componentNames.length} components: ${componentNames.join(", ")}\n`);

  // Check Storybook is running
  try {
    execSync(`curl -sf http://localhost:${STORYBOOK_PORT} > /dev/null`, { stdio: "pipe" });
  } catch {
    console.error(`Storybook not running at http://localhost:${STORYBOOK_PORT}`);
    console.error("Start it with: cd canvas && npm run dev");
    process.exit(1);
  }

  console.log(`Setting mobile viewport ${MOBILE_WIDTH}x${MOBILE_HEIGHT}...`);
  execSync(`agent-browser set viewport ${MOBILE_WIDTH} ${MOBILE_HEIGHT}`, { stdio: "inherit" });

  const results = [];

  for (const name of componentNames) {
    const outPath = join(mobileStorybookDir, `${name}.png`);
    process.stdout.write(`  Screenshotting ${name}... `);
    try {
      openStory(name);
      await screenshotStory(name, outPath);
      const meta = imageSize(outPath);
      console.log(`✅ ${meta.width}x${meta.height}px`);
      results.push({ name, screenshotPath: outPath, status: "ok" });
    } catch (e) {
      console.log(`❌ ${e.message}`);
      results.push({ name, screenshotPath: null, status: "error", error: e.message });
    }
  }

  execSync("agent-browser close", { stdio: "pipe" });

  // List mobile source sections for reference
  const sourceSections = existsSync(mobileSectionsDir)
    ? readdirSync(mobileSectionsDir).filter((f) => f.endsWith(".png")).sort()
    : [];

  // Write report for agent review
  const lines = [
    "# Mobile Visual Check Report",
    "",
    `**Site:** ${url}`,
    `**Viewport:** ${MOBILE_WIDTH}x${MOBILE_HEIGHT}px (iPhone 14)`,
    `**Generated:** ${new Date().toISOString()}`,
    "",
    "## Instructions for Claude Code agent",
    "",
    "Compare each component screenshot (Storybook at 390px) against the mobile source sections.",
    "Look for: layout misalignment, wrong font sizes, missing responsive rules, text overflow,",
    "images not resizing, padding/margin differences, elements that should stack but don't.",
    "",
    "To fix: edit the component's `@media (max-width: 768px)` rules, push with `npx canvas push -y`,",
    "then re-run: `node jobs/06-mobile-check.js <url>`",
    "",
    "## Source mobile sections",
    "",
    ...sourceSections.map((f) => `- \`mobile-sections/${f}\``),
    "",
    "## Component screenshots (Storybook @ 390px)",
    "",
    ...results.map((r) =>
      r.status === "ok"
        ? `- ✅ \`${r.name}\` → \`mobile-storybook/${r.name}.png\``
        : `- ❌ \`${r.name}\` — ${r.error}`
    ),
    "",
    "## Visual comparison checklist",
    "",
    "For each component, read the Storybook screenshot and the corresponding source section,",
    "then fill in this table:",
    "",
    "| Component | Issues found | Fixed? |",
    "|-----------|-------------|--------|",
    ...componentNames.map((n) => `| ${n} | — | — |`),
  ];

  writeFileSync(reportPath, lines.join("\n"));
  console.log(`\nReport written to: ${reportPath}`);
  console.log("\nNext: read the mobile-storybook/ and mobile-sections/ images and compare.");

  return { results, reportPath, mobileStorybookDir, mobileSectionsDir };
}

if (process.argv[1]?.endsWith("06-mobile-check.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/06-mobile-check.js <url>"); process.exit(1); }
  await run(url);
}
