import { readFileSync, writeFileSync, readdirSync } from "fs";
import { join } from "path";
import { analyzeSection } from "../lib/claude.js";
import { sitePaths } from "../lib/paths.js";

export async function run(url) {
  const { sectionsDir, componentsPath, metaPath } = sitePaths(url);

  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const sectionFiles = (meta.sections ?? readdirSync(sectionsDir).map((f) => join(sectionsDir, f)))
    .filter((p) => p.endsWith(".png"))
    .sort();

  if (sectionFiles.length === 0) {
    throw new Error("No section images found. Run split first.");
  }

  const results = [];
  for (const sectionPath of sectionFiles) {
    console.log(`Analyzing ${sectionPath}...`);
    const detected = await analyzeSection(sectionPath);
    results.push({ section: sectionPath, ...detected });
  }

  writeFileSync(componentsPath, JSON.stringify(results, null, 2));
  console.log(`Component detection complete. Results saved to ${componentsPath}`);
}

if (process.argv[1]?.endsWith("03-detect-components.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/03-detect-components.js <url>"); process.exit(1); }
  await run(url);
}
