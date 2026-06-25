const VALID = ["homepage", "menus", "site"];
const NUMERIC = { "1": "homepage", "2": "menus", "3": "site" };

export async function resolveScope({ argv, isTTY, prompt }) {
  const i = argv.indexOf("--scope");
  if (i !== -1) {
    const v = (argv[i + 1] || "").toLowerCase();
    if (!VALID.includes(v)) throw new Error(`invalid scope: "${v}" (use homepage|menus|site)`);
    return v;
  }
  if (!isTTY) return "homepage";
  const answer = await prompt(
    "What do you want to migrate?\n  1) Homepage only\n  2) Menu-reachable pages (main/footer/sidebar)\n  3) Whole site (sitemap.xml)\n> ",
    ["1", "2", "3"],
  );
  const trimmed = (answer || "").trim().toLowerCase();
  return NUMERIC[trimmed] || (VALID.includes(trimmed) ? trimmed : "homepage");
}
