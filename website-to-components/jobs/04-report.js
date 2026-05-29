import { readFileSync, writeFileSync } from "fs";
import { basename } from "path";
import { sitePaths } from "../lib/paths.js";

export async function run(url) {
  const { componentsPath, reportPath, metaPath } = sitePaths(url);

  const meta = JSON.parse(readFileSync(metaPath, "utf8"));
  const results = JSON.parse(readFileSync(componentsPath, "utf8"));

  const lines = [
    `# Component Detection Report`,
    ``,
    `**Source URL:** ${url}`,
    `**Screenshot taken:** ${meta.timestamp}`,
    `**Sections analyzed:** ${results.length}`,
    ``,
  ];

  for (const result of results) {
    const sectionName = basename(result.section, ".png");
    lines.push(`## ${sectionName}`);
    lines.push(``);

    if (!result.components?.length) {
      lines.push("_No components detected._");
      lines.push(``);
      continue;
    }

    for (const comp of result.components) {
      lines.push(`### \`${comp.name}\` _(${comp.type})_`);
      lines.push(``);
      lines.push(comp.description);
      if (comp.children?.length) {
        lines.push(``);
        lines.push(`**Children:** ${comp.children.join(", ")}`);
      }
      lines.push(``);
    }
  }

  const report = lines.join("\n");
  writeFileSync(reportPath, report);
  console.log(report);
  console.log(`\nReport saved to ${reportPath}`);
}

if (process.argv[1]?.endsWith("04-report.js")) {
  const url = process.argv[2] || process.env.TARGET_URL;
  if (!url) { console.error("Usage: node jobs/04-report.js <url>"); process.exit(1); }
  await run(url);
}
