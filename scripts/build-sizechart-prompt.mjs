// Regenerates api/lib/sizechart-prompt.js from prompts/sizechart.md.
// Vercel bundles JS, not stray .md files, so the prompt ships as a JS module.
// Run after editing the prompt:  node scripts/build-sizechart-prompt.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const md = readFileSync(join(here, "..", "prompts", "sizechart.md"), "utf8");

writeFileSync(
  join(here, "..", "api", "lib", "sizechart-prompt.js"),
  `// GENERATED — edit prompts/sizechart.md, then run scripts/build-sizechart-prompt.mjs\n` +
    `export const SIZECHART_PROMPT = ${JSON.stringify(md)};\n`
);

console.log(`wrote api/lib/sizechart-prompt.js (${md.length} chars)`);
