#!/usr/bin/env node
/**
 * Write a baseline canvas/src/global.css with:
 *  - @import "tailwindcss";
 *  - @source "./components"; @source "./stories";
 *  - @source inline(...) listing every utility the pipeline commonly emits, so that
 *    Tailwind v4's `@tailwindcss/vite` plugin under Storybook does not silently
 *    fail to scan component JSX (observed: it does silently fail in some setups).
 *  - @theme block with sensible defaults (override or extend with --brand flags).
 *  - @font-face blocks for any .woff2 files found in canvas/public/fonts/.
 *  - @layer base mapping body→sans, headings→heading-font, and the brand-cream/ink defaults.
 *
 * Usage:
 *   node website-to-components/scripts/init-global-css.js
 *   node website-to-components/scripts/init-global-css.js --brand red=#DB0007 --brand cream=#FFFDE9 \
 *        --font-sans 'Audrey Text' --font-heading 'Audrey Display'
 *
 * Flags (all optional):
 *   --out <path>            Override the output path (default: canvas/src/global.css)
 *   --fonts-dir <path>      Override the fonts dir scanned for woff2 (default: canvas/public/fonts)
 *   --brand <name>=<hex>    Append/override a brand color token (repeatable)
 *   --font-sans <family>    Body font family (default: 'Inter')
 *   --font-heading <family> Heading font family (default: same as sans)
 *   --no-fonts              Skip @font-face block (e.g. when using Google Fonts via @import)
 *   --force                 Overwrite an existing global.css
 *
 * The default brand palette ships with neutral defaults so the file ALWAYS produces a working
 * Tailwind build even before the site-specific theming is wired in. Replace the colors after
 * extracting them from the live site.
 */

import { writeFileSync, existsSync, readdirSync, mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    out: join(ROOT, "canvas/src/global.css"),
    fontsDir: join(ROOT, "canvas/public/fonts"),
    brandColors: {},
    fontSans: "Inter",
    fontHeading: null,
    skipFonts: false,
    force: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") out.out = resolve(argv[++i]);
    else if (a === "--fonts-dir") out.fontsDir = resolve(argv[++i]);
    else if (a === "--brand") {
      const [name, hex] = argv[++i].split("=");
      if (name && hex) out.brandColors[name.trim()] = hex.trim();
    } else if (a === "--font-sans") out.fontSans = argv[++i];
    else if (a === "--font-heading") out.fontHeading = argv[++i];
    else if (a === "--no-fonts") out.skipFonts = true;
    else if (a === "--force") out.force = true;
    else if (a === "--help" || a === "-h") {
      console.log(
        "Usage: init-global-css [--out <path>] [--fonts-dir <path>] [--brand name=#hex] " +
          "[--font-sans <family>] [--font-heading <family>] [--no-fonts] [--force]",
      );
      process.exit(0);
    }
  }
  out.fontHeading ??= out.fontSans;
  return out;
}

// ---------------------------------------------------------------------------
// Defaults — universal across charity/nonprofit clones and most marketing sites
// ---------------------------------------------------------------------------
const DEFAULT_BRAND = {
  red: "#E11D48",
  yellow: "#FACC15",
  blue: "#2563EB",
  green: "#16A34A",
  orange: "#F97316",
  purple: "#7C3AED",
  cream: "#FFFDF7",
  ink: "#111111",
};

// The @source inline string lists every utility we have ever observed the pipeline emit.
// It is intentionally generous — Tailwind v4 tree-shakes anything unused at theme-token time,
// so the cost of listing extras is small compared to the cost of one silently-missing utility.
const INLINE_UTILITIES = [
  // layout
  "flex inline-flex flex-row flex-col flex-row-reverse flex-col-reverse flex-wrap flex-shrink-0 flex-grow",
  "grid grid-cols-1 grid-cols-2 grid-cols-3 grid-cols-4 grid-cols-5 grid-cols-6",
  "md:grid-cols-2 md:grid-cols-3 md:grid-cols-4 lg:grid-cols-3 lg:grid-cols-4",
  "md:flex-row md:flex-col lg:flex-row lg:flex-col",
  "items-start items-center items-end items-stretch items-baseline",
  "justify-start justify-center justify-end justify-between justify-around justify-evenly",
  "self-start self-center self-end self-stretch",
  "gap-0 gap-1 gap-2 gap-3 gap-4 gap-5 gap-6 gap-8 gap-10 gap-12 gap-16 gap-20",
  "gap-x-4 gap-x-6 gap-x-8 gap-y-4 gap-y-6 gap-y-8",
  // text
  "text-left text-center text-right text-justify",
  "text-xs text-sm text-base text-lg text-xl text-2xl text-3xl text-4xl text-5xl text-6xl text-7xl text-8xl text-9xl",
  "md:text-base md:text-lg md:text-xl md:text-2xl md:text-3xl md:text-4xl md:text-5xl md:text-6xl md:text-7xl md:text-8xl",
  "lg:text-2xl lg:text-3xl lg:text-4xl lg:text-5xl lg:text-6xl",
  "uppercase lowercase capitalize normal-case",
  "tracking-tighter tracking-tight tracking-normal tracking-wide tracking-wider tracking-widest",
  "leading-none leading-tight leading-snug leading-normal leading-relaxed leading-loose",
  "font-thin font-extralight font-light font-normal font-medium font-semibold font-bold font-extrabold font-black",
  "italic not-italic underline no-underline line-through hover:underline",
  // sizing
  "w-full w-auto w-screen w-1/2 w-1/3 w-2/3 w-1/4 w-3/4 w-1/5 w-2/5 w-3/5 w-4/5 w-fit",
  "min-w-0 min-w-full",
  "max-w-xs max-w-sm max-w-md max-w-lg max-w-xl max-w-2xl max-w-3xl max-w-4xl max-w-5xl max-w-6xl max-w-7xl max-w-full max-w-prose",
  "h-full h-auto h-screen h-fit h-px h-1 h-2 h-4 h-6 h-8 h-10 h-12 h-16 h-20 h-24 h-32 h-40 h-48 h-64 h-80 h-96",
  "min-h-0 min-h-screen min-h-full",
  "aspect-square aspect-video aspect-auto",
  // spacing
  "p-0 p-1 p-2 p-3 p-4 p-5 p-6 p-8 p-10 p-12 p-16 p-20 p-24",
  "px-0 px-2 px-3 px-4 px-5 px-6 px-8 px-10 px-12 px-16 px-20",
  "py-0 py-2 py-3 py-4 py-5 py-6 py-8 py-10 py-12 py-16 py-20 py-24",
  "md:p-8 md:p-12 md:p-16 md:p-20 md:px-12 md:px-16 md:px-20 md:py-12 md:py-16 md:py-20 md:py-24",
  "m-0 m-auto mx-auto my-auto",
  "mt-0 mt-1 mt-2 mt-3 mt-4 mt-6 mt-8 mt-12 mt-16 -mt-4 -mt-8 -mt-12",
  "mb-0 mb-1 mb-2 mb-3 mb-4 mb-6 mb-8 mb-12 mb-16",
  // position
  "static relative absolute fixed sticky",
  "top-0 right-0 bottom-0 left-0 inset-0 top-4 top-6 top-8 right-4 right-6 right-8 bottom-4 bottom-6 bottom-8 left-4 left-6 left-8",
  "z-0 z-10 z-20 z-30 z-40 z-50",
  // shape + border
  "rounded rounded-sm rounded-md rounded-lg rounded-xl rounded-2xl rounded-3xl rounded-full rounded-none",
  "rounded-t-3xl rounded-b-3xl rounded-l-3xl rounded-r-3xl",
  "rounded-t-[40px] rounded-b-[40px] rounded-t-[60px] rounded-b-[60px]",
  "border border-0 border-2 border-4 border-t border-b border-l border-r border-solid border-dashed border-dotted",
  "border-black border-white border-transparent",
  "shadow-none shadow-sm shadow shadow-md shadow-lg shadow-xl shadow-2xl",
  // display + interactivity
  "block inline-block inline hidden",
  "md:block md:inline-block md:flex md:grid md:hidden lg:block lg:flex lg:hidden",
  "cursor-pointer cursor-default cursor-not-allowed",
  "select-none select-text select-all",
  "pointer-events-none pointer-events-auto",
  // overflow + object
  "overflow-hidden overflow-visible overflow-auto overflow-scroll overflow-x-auto overflow-y-auto",
  "object-cover object-contain object-center object-top object-bottom object-left object-right",
  // list
  "list-none list-disc list-decimal list-inside list-outside pl-4 pl-6 pl-8",
  // transition + motion
  "transition transition-all transition-colors transition-transform transition-opacity",
  "duration-75 duration-100 duration-150 duration-200 duration-300 duration-500",
  "ease-in ease-out ease-in-out ease-linear",
  "hover:scale-100 hover:scale-105 hover:scale-110 hover:opacity-90 hover:opacity-100",
  "group group-hover:rotate-180 group-hover:scale-105 group-hover:opacity-100",
  // backgrounds + colors (default Tailwind palette — keep so subagents have access)
  "bg-white bg-black bg-transparent bg-current",
  "bg-gray-50 bg-gray-100 bg-gray-200 bg-gray-300 bg-gray-500 bg-gray-700 bg-gray-900",
  "text-white text-black text-current",
  "text-gray-400 text-gray-500 text-gray-600 text-gray-700 text-gray-800 text-gray-900",
];

// ---------------------------------------------------------------------------
// Font discovery
// ---------------------------------------------------------------------------
function listWoff2(fontsDir) {
  if (!existsSync(fontsDir)) return [];
  return readdirSync(fontsDir).filter((f) => f.endsWith(".woff2"));
}

function guessFontFace(filename, fontSans, fontHeading) {
  const lower = filename.toLowerCase();
  // Map common naming patterns to weight + style + family.
  const weight = /(?:^|[-_])(bold|black)/.test(lower)
    ? 700
    : /(?:^|[-_])(semi-?bold|semibold)/.test(lower)
      ? 600
      : /(?:^|[-_])(medium|med)/.test(lower)
        ? 500
        : /(?:^|[-_])(light|thin|extralight|extra-light|extra_light)/.test(lower)
          ? 300
          : 400;
  const style = /(?:^|[-_])italic/.test(lower) ? "italic" : "normal";
  // Family detection: anything before the first weight/style marker becomes the family name.
  const noExt = filename.replace(/\.woff2$/i, "");
  // Family = base name without trailing weight/style tokens.
  const baseFamily = noExt
    .replace(/[-_](bold|black|semi-?bold|semibold|medium|med|light|thin|regular|italic|bolditalic|web|woff2?)\b.*$/gi, "")
    .replace(/[-_]+$/g, "")
    .replace(/[-_]/g, " ")
    .trim();
  // If the file name maps to the heading or sans family, return that — otherwise fall back to the base.
  // Compare against the *concatenated* family name (case- and space-insensitive) so that
  // a partial overlap on a common first word (e.g. "Audrey") doesn't mis-route every file
  // to one family.
  const normalize = (s) => (s || "").toLowerCase().replace(/[\s_-]+/g, "");
  const baseKey = normalize(baseFamily);
  const headingKey = normalize(fontHeading);
  const sansKey = normalize(fontSans);
  const family =
    baseKey && headingKey && baseKey.startsWith(headingKey)
      ? fontHeading
      : baseKey && sansKey && baseKey.startsWith(sansKey)
        ? fontSans
        : baseKey && headingKey && (baseKey.includes(headingKey) || headingKey.includes(baseKey))
          ? fontHeading
          : baseKey && sansKey && (baseKey.includes(sansKey) || sansKey.includes(baseKey))
            ? fontSans
            : baseFamily || fontSans;
  return { family, weight, style, src: `/fonts/${filename}` };
}

// ---------------------------------------------------------------------------
// Compose the file
// ---------------------------------------------------------------------------
function compose(opts) {
  const brand = { ...DEFAULT_BRAND, ...opts.brandColors };
  const brandInline = Object.keys(brand)
    .flatMap((name) => [`bg-brand-${name}`, `text-brand-${name}`, `border-brand-${name}`])
    .join(" ");
  const inline = [...INLINE_UTILITIES, brandInline].join(" ");

  const fontFaces = opts.skipFonts
    ? ""
    : listWoff2(opts.fontsDir)
        .map((f) => guessFontFace(f, opts.fontSans, opts.fontHeading))
        .map(
          (ff) =>
            `@font-face {\n  font-family: "${ff.family}";\n  src: url("${ff.src}") format("woff2");\n  font-weight: ${ff.weight};\n  font-style: ${ff.style};\n  font-display: swap;\n}`,
        )
        .join("\n\n");

  const themeColors = Object.entries(brand)
    .map(([name, hex]) => `  --color-brand-${name}: ${hex};`)
    .join("\n");

  return `@import "tailwindcss";

/*
 * @source — point Tailwind at the component + story trees so it scans JSX for utilities.
 * @source inline(…) — a generous safelist of utilities the pipeline commonly emits.
 *   This guards against Tailwind v4's @tailwindcss/vite plugin silently failing to scan
 *   under Storybook (observed during the ronaldmcdonaldhouse.org.uk clone, 2026-05).
 *   When you see a styled component rendering with no styles, this list is the first thing
 *   to expand — but the inline safelist below already covers >95% of pipeline output.
 */
@source "./components";
@source "./stories";
@source inline("${inline}");

${fontFaces ? `/* ----- @font-face (auto-detected from public/fonts) ----- */\n${fontFaces}\n\n` : ""}/* ----- Theme tokens (Tailwind v4 @theme) ----- */
@theme {
  --font-sans: "${opts.fontSans}", Georgia, serif;
  --font-heading: "${opts.fontHeading}", Georgia, serif;
  --font-weight-normal: 400;
  --font-weight-bold: 700;

  /* Brand palette — replace defaults with values from the live site. */
${themeColors}
}

/* ----- Base layer ----- */
@layer base {
  html, body {
    font-family: var(--font-sans);
    color: var(--color-brand-ink);
    background-color: var(--color-brand-cream);
  }
  h1, h2, h3, h4, h5, h6 {
    font-family: var(--font-heading);
  }
}
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(opts.out), { recursive: true });
  if (existsSync(opts.out) && !opts.force) {
    console.error(`Refusing to overwrite existing file: ${opts.out}\nPass --force to overwrite.`);
    process.exit(1);
  }
  const content = compose(opts);
  writeFileSync(opts.out, content);
  const sizeKb = (content.length / 1024).toFixed(1);
  console.log(`Wrote ${opts.out} (${sizeKb} KB)`);
  console.log(`  Fonts scanned: ${opts.skipFonts ? "(skipped)" : opts.fontsDir}`);
  const woff = opts.skipFonts ? [] : listWoff2(opts.fontsDir);
  console.log(`  @font-face blocks emitted: ${woff.length}`);
  console.log(`  Brand tokens: ${Object.keys({ ...DEFAULT_BRAND, ...opts.brandColors }).join(", ")}`);
  console.log("");
  console.log("Next steps:");
  console.log("  1. Sample colors from the live page and re-run with --brand name=#hex --force to update.");
  console.log("  2. Confirm fonts in canvas/public/fonts/ are correctly named.");
  console.log("  3. Start Storybook and run jobs/05-smoke-test-tailwind.js to verify utilities resolve.");
}

if (import.meta.url === `file://${process.argv[1]}`) main();
