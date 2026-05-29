#!/usr/bin/env node
/**
 * Scaffold a Canvas component (component.yml + index.jsx) that is guaranteed to
 * pass `npx canvas validate` on the first run — every prop is typed correctly,
 * every example is non-empty, the title↔machineName casing is correct, and the
 * imports use the only paths the lint rule accepts.
 *
 * Usage:
 *   node website-to-components/scripts/init-component.js <machine_name> \
 *     [--display "Display Name"] \
 *     [--prop <name>] \
 *     [--prop <name>:<type>] \
 *     [--prop <name>:<type>:<extra>] \
 *     [--import <Identifier>:<machine_name>] \
 *     [--variant <name>:<class1>;<name>:<class2>] \
 *     [--status true|false] \
 *     [--force]
 *
 * Type spec (case-insensitive). If `<type>` is omitted, it is *inferred* from
 * the prop name suffix (see INFER table below):
 *
 *   string         → type: string
 *   richtext       → type: string, contentMediaType: text/html
 *   url            → type: string, format: uri-reference
 *   image          → type: string, format: uri-reference   (the pipeline default)
 *   imageobj       → type: object, $ref: 'json-schema-definitions://canvas.module/image'
 *   boolean        → type: boolean
 *   number         → type: number
 *   enum:a,b,c     → type: string, enum: [a, b, c]
 *
 * Examples:
 *   # Pure atom — all props inferred from names
 *   node website-to-components/scripts/init-component.js rmh_text_link \
 *     --display "RMH Text Link" --prop label --prop href
 *
 *   # Variant atom with a sub-component import
 *   node website-to-components/scripts/init-component.js rmh_donate_button \
 *     --display "RMH Donate Button" \
 *     --prop label --prop href \
 *     --prop variant:enum:outline,solid
 *
 *   # Composite with imports
 *   node website-to-components/scripts/init-component.js rmh_navbar \
 *     --display "RMH Navbar" \
 *     --prop variant:enum:cream,lavender \
 *     --prop logoHref:url \
 *     --prop nav1Label --prop nav1Href \
 *     --prop nav2Label --prop nav2Href \
 *     --import RmhLogo:rmh_logo \
 *     --import RmhPrimaryNav:rmh_primary_nav \
 *     --import RmhDonateButton:rmh_donate_button
 *
 * Output (writes both files only if neither exists, or with --force):
 *   canvas/src/components/<machine_name>/component.yml
 *   canvas/src/components/<machine_name>/index.jsx
 *
 * After scaffolding the script runs `npx canvas validate --components <machine_name>`
 * to confirm the file passes. If it doesn't, the script reports the error and exits 1
 * (so the subagent knows the scaffold itself is broken — not its later edits).
 */

import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..", "..");
const CANVAS_DIR = join(ROOT, "canvas");
const COMPONENTS_DIR = join(CANVAS_DIR, "src/components");

// ---------------------------------------------------------------------------
// Type inference by prop-name suffix
// ---------------------------------------------------------------------------
// Exact-name overrides (matched case-insensitively before suffix rules).
const INFER_EXACT = {
  href: "url",
  url: "url",
  link: "url",
  src: "url",
  source: "url",
  body: "richtext",
  description: "richtext",
  excerpt: "richtext",
  content: "richtext",
  intro: "richtext",
  active: "boolean",
  open: "boolean",
  disabled: "boolean",
};

const INFER_RULES = [
  // Booleans
  { match: /^(is|has|show|hide|with|enabled?|disabled?|default[A-Z])/, type: "boolean" },
  // Rich text (suffix)
  { match: /(Body|Description|Excerpt|Answer|Content|Intro|Bio)$/i, type: "richtext" },
  // URLs and image src (suffix)
  { match: /(Src|Url|Href|Link)$/i, type: "url" },
  // Plain strings (alt, label, name, etc.)
  { match: /(Alt|Label|Heading|Title|Caption|Eyebrow|Name|Question|Subtitle|Tagline|Day|Month|Year|Location|Date|Author|Quote|Value|Text|Tag)$/i, type: "string" },
];

function inferType(propName) {
  const lc = propName.toLowerCase();
  if (INFER_EXACT[lc]) return INFER_EXACT[lc];
  for (const r of INFER_RULES) if (r.match.test(propName)) return r.type;
  return "string";
}

// ---------------------------------------------------------------------------
// Example value generators
// ---------------------------------------------------------------------------
const EXAMPLE_BY_TYPE = {
  string: (name) => sampleString(name),
  richtext: () => "<p>Sample rich-text paragraph.</p>",
  url: () => "/destination",
  image: () => "/images/placeholder.webp",
  imageobj: () => ({ src: "https://placehold.co/600x400", alt: "Placeholder" }),
  boolean: () => true,
  number: () => 1,
};

function sampleString(propName) {
  const n = propName.toLowerCase();
  if (n.endsWith("label")) return "Read more";
  if (n.endsWith("alt")) return "Descriptive alt text";
  if (n.endsWith("heading") || n.endsWith("title")) return "Section heading";
  if (n.endsWith("eyebrow")) return "EYEBROW";
  if (n.endsWith("question")) return "What is this?";
  if (n.endsWith("name")) return "Name";
  if (n.endsWith("caption")) return "Caption";
  if (n.endsWith("date")) return "26 Apr 2026";
  if (n.endsWith("day")) return "26";
  if (n.endsWith("month")) return "April";
  if (n.endsWith("year")) return "2026";
  if (n.endsWith("location")) return "London";
  return "Example";
}

// ---------------------------------------------------------------------------
// CLI parsing
// ---------------------------------------------------------------------------
function parseArgs(argv) {
  const out = {
    machineName: argv[0],
    display: null,
    props: [],
    imports: [],
    status: true,
    force: false,
  };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--display") out.display = argv[++i];
    else if (a === "--prop") out.props.push(parsePropSpec(argv[++i]));
    else if (a === "--import") out.imports.push(parseImportSpec(argv[++i]));
    else if (a === "--status") out.status = argv[++i] !== "false";
    else if (a === "--force") out.force = true;
    else if (a === "--help" || a === "-h") {
      printUsage();
      process.exit(0);
    }
  }
  return out;
}

function parsePropSpec(spec) {
  // <name>[:<type>[:<extra>]]
  const [name, type, ...extraParts] = spec.split(":");
  const extra = extraParts.join(":");
  if (!type) return { name, type: inferType(name), extra: null };
  return { name, type: type.toLowerCase(), extra: extra || null };
}

function parseImportSpec(spec) {
  // <Identifier>:<machine_name>
  const [identifier, machineName] = spec.split(":");
  if (!identifier || !machineName) {
    throw new Error(`Invalid --import spec "${spec}". Use <Identifier>:<machine_name>.`);
  }
  return { identifier, machineName };
}

function printUsage() {
  console.log("Usage: init-component.js <machine_name> [--display <name>]");
  console.log("       [--prop <name>[:<type>[:<extra>]]]+ [--import <Id>:<machine>]+");
  console.log("       [--status true|false] [--force]");
  console.log("Types: string richtext url image imageobj boolean number enum:a,b,c");
}

// ---------------------------------------------------------------------------
// Naming helpers
// ---------------------------------------------------------------------------
function snakeToPascal(s) {
  return s.split("_").map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join("");
}

function camelToTitleCase(camel) {
  // imageSrc → "Image Src", heading → "Heading", primaryButton → "Primary Button"
  return camel
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (c) => c.toUpperCase())
    .trim();
}

function defaultDisplay(machineName) {
  // rmh_donate_button → "Rmh Donate Button"
  return machineName
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// ---------------------------------------------------------------------------
// YAML emission (manual — no external dependency)
// ---------------------------------------------------------------------------
function yamlEscape(s) {
  if (s == null) return "''";
  const str = String(s);
  if (/['":{}\[\]\n,&*#!|>%@`]/.test(str)) {
    return "'" + str.replace(/'/g, "''") + "'";
  }
  return str;
}

function indent(s, n) {
  const pad = " ".repeat(n);
  return s
    .split("\n")
    .map((l) => (l ? pad + l : l))
    .join("\n");
}

function yamlExamples(value) {
  // Always emit examples as a YAML sequence — covers strings, numbers, booleans, objects.
  if (Array.isArray(value)) value = value;
  else value = [value];
  return value
    .map((v) => {
      if (typeof v === "object" && v !== null) {
        // multi-line object
        const lines = Object.entries(v).map(([k, val]) => `  ${k}: ${yamlEscape(val)}`);
        return ["- " + lines[0].slice(2), ...lines.slice(1).map((l) => "  " + l)].join("\n");
      }
      return "- " + yamlEscape(v);
    })
    .join("\n");
}

function propToYaml(prop) {
  const title = camelToTitleCase(prop.name);
  const lines = [`${prop.name}:`, `  title: ${yamlEscape(title)}`];

  switch (prop.type) {
    case "string":
      lines.push("  type: string");
      break;
    case "richtext":
      lines.push("  type: string");
      lines.push("  contentMediaType: text/html");
      break;
    case "url":
    case "image":
      lines.push("  type: string");
      lines.push("  format: uri-reference");
      break;
    case "imageobj":
      lines.push("  type: object");
      lines.push("  $ref: 'json-schema-definitions://canvas.module/image'");
      break;
    case "boolean":
      lines.push("  type: boolean");
      break;
    case "number":
      lines.push("  type: number");
      break;
    case "enum": {
      const values = (prop.extra || "").split(",").map((v) => v.trim()).filter(Boolean);
      if (!values.length) throw new Error(`Enum prop ${prop.name} needs values: enum:a,b,c`);
      lines.push("  type: string");
      lines.push(`  enum: [${values.map(yamlEscape).join(", ")}]`);
      prop._enumValues = values;
      break;
    }
    default:
      throw new Error(`Unknown prop type "${prop.type}" for ${prop.name}`);
  }

  const exampleValue =
    prop.type === "enum"
      ? prop._enumValues[0]
      : EXAMPLE_BY_TYPE[prop.type === "url" || prop.type === "image" ? prop.type : prop.type === "imageobj" ? "imageobj" : prop.type === "richtext" ? "richtext" : prop.type === "boolean" ? "boolean" : prop.type === "number" ? "number" : "string"](prop.name);
  lines.push("  examples:");
  lines.push(indent(yamlExamples(exampleValue), 4));
  return lines.join("\n");
}

function buildComponentYml(opts) {
  const lines = [
    `name: ${yamlEscape(opts.display || defaultDisplay(opts.machineName))}`,
    `machineName: ${opts.machineName}`,
    `status: ${opts.status}`,
    `required: []`,
    `props:`,
    `  properties:`,
  ];
  for (const prop of opts.props) {
    lines.push(indent(propToYaml(prop), 4));
  }
  if (!opts.props.length) {
    lines.push("  # (no props — add via --prop on init or edit this file)");
  }
  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// JSX emission
// ---------------------------------------------------------------------------
function defaultJsxValueFor(prop) {
  if (prop.type === "boolean") return prop._exampleValue || "true";
  if (prop.type === "number") return prop._exampleValue || "1";
  if (prop.type === "richtext") return "'<p>Sample rich-text paragraph.</p>'";
  if (prop.type === "url" || prop.type === "image") return `'${EXAMPLE_BY_TYPE.url()}'`;
  if (prop.type === "imageobj") return `{ src: 'https://placehold.co/600x400', alt: 'Placeholder' }`;
  if (prop.type === "enum") return `'${(prop.extra || "").split(",")[0].trim()}'`;
  return `'${sampleString(prop.name).replace(/'/g, "\\'")}'`;
}

function buildIndexJsx(opts) {
  const Pascal = snakeToPascal(opts.machineName);
  const propsList = opts.props.map((p) => p.name).join(", ");
  const propDefaults = opts.props
    .map((p) => `  ${p.name} = ${defaultJsxValueFor(p)},`)
    .join("\n");

  const subImports = opts.imports
    .map((i) => `import ${i.identifier} from '@/components/${i.machineName}';`)
    .join("\n");

  const richTextProps = opts.props.filter((p) => p.type === "richtext").map((p) => p.name);
  const richTextBlock = richTextProps.length
    ? richTextProps
        .map(
          (n) =>
            `        {${n} && <FormattedText className="[&_p]:mb-4 [&_a]:text-brand-red [&_a]:underline" value={${n}} />}`,
        )
        .join("\n")
    : "        {/* …rich-text body lives here when set… */}";

  // Pick a representative string/heading prop to render in the placeholder JSX.
  const headingProp = opts.props.find((p) => /heading|title/i.test(p.name) && p.type === "string");
  const labelProp = opts.props.find((p) => /label/i.test(p.name) && p.type === "string");

  return `import React from 'react';
import { cn${richTextProps.length ? ", FormattedText" : ""} } from 'drupal-canvas';
${subImports ? subImports + "\n" : ""}
const ${Pascal} = ({
${propDefaults}
  className,
}) => {
  return (
    <section className={cn('p-8 bg-brand-cream', className)}>
${headingProp ? `      <h2 className="font-heading text-3xl text-brand-ink mb-4">{${headingProp.name}}</h2>` : ""}
${labelProp && headingProp !== labelProp ? `      <p className="font-sans text-base text-brand-ink mb-2">{${labelProp.name}}</p>` : ""}
${richTextBlock}
${opts.imports.length ? "      {/* Sub-components ready to mount: " + opts.imports.map((i) => `<${i.identifier} />`).join(", ") + " */}" : ""}
    </section>
  );
};

export default ${Pascal};
`;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.machineName || !/^[a-z][a-z0-9_]+$/.test(opts.machineName)) {
    console.error("First positional argument must be a snake_case machine name (lowercase + underscores).");
    printUsage();
    process.exit(1);
  }
  const dir = join(COMPONENTS_DIR, opts.machineName);
  const ymlPath = join(dir, "component.yml");
  const jsxPath = join(dir, "index.jsx");

  if ((existsSync(ymlPath) || existsSync(jsxPath)) && !opts.force) {
    console.error(`Component ${opts.machineName} already exists. Pass --force to overwrite.`);
    process.exit(1);
  }

  mkdirSync(dir, { recursive: true });
  const yml = buildComponentYml(opts);
  const jsx = buildIndexJsx(opts);
  writeFileSync(ymlPath, yml);
  writeFileSync(jsxPath, jsx);
  console.log(`Wrote ${ymlPath}`);
  console.log(`Wrote ${jsxPath}`);

  // Validate immediately so the subagent knows the scaffold is clean.
  console.log("");
  const v = spawnSync(
    "npx",
    ["canvas", "validate", "--components", opts.machineName, "--deprecated", "-y"],
    { cwd: CANVAS_DIR, stdio: "inherit" },
  );
  if (v.status !== 0) {
    console.error("");
    console.error(`✗ Validator failed on the scaffolded ${opts.machineName}.`);
    console.error("   This means the scaffolder itself produced an invalid file.");
    console.error("   Re-run with the offending fields removed, or report the bug.");
    process.exit(1);
  }
  console.log("");
  console.log(`✓ ${opts.machineName} scaffolded and validated. Now fill in the JSX body and adjust default prop values to match the source section.`);
}

main();
