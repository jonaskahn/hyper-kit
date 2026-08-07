#!/usr/bin/env node
/* Emits src/core/agent-icons.generated.ts from the SVG/PNG assets in
   assets/icons/. Run after adding or swapping icons:
     npm run generate:icons
   Detection: an icon is rendered as a CSS mask (so it adapts to light/dark
   via light-dark()) when it carries a single color or currentColor — e.g.
   cursor, windsurf, goose, shell. Multi-color brand SVGs are drawn as
   background images as-is. */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'assets', 'icons');
const outFile = join(root, 'src', 'core', 'agent-icons.generated.ts');

function uriOf(raw) {
  const encoded = encodeURIComponent(raw).replace(/\(/g, '%28').replace(/\)/g, '%29');
  return 'data:image/svg+xml;utf8,' + encoded;
}

function distinctColors(svg) {
  const colors = new Set();
  const re = /(?:fill|stroke)\s*:\s*([^;"']+)|(?:fill|stroke)\s*=\s*["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(svg))) {
    const value = (m[1] || m[2]).trim().toLowerCase();
    if (value === 'none' || value === 'transparent') {
      continue; // not a paint color
    }
    colors.add(value);
  }
  return colors;
}

/* A color is "neutral" when it's currentColor, white, black, or a near-white/
   near-black gray — such glyphs need the mask technique to stay visible in
   both schemes. Brand-tone colors (claude's orange, codex's teal) render as
   background images and read fine on any background. */
function isNeutral(color) {
  const named = { white: '#ffffff', black: '#000000', currentcolor: true };
  if (named[color] === true) {
    return true;
  }
  const hex = named[color] || color;
  const m = /^#([0-9a-f]{6})$/.exec(hex);
  if (!m) {
    return false; // gradients, rgb(), variables — treat as colored
  }
  const channels = m[1].match(/../g).map((c) => parseInt(c, 16) / 255);
  return channels.every((c) => c >= 0.8) || channels.every((c) => c <= 0.2);
}

const entries = [];
for (const file of readdirSync(iconsDir).sort()) {
  if (!file.endsWith('.svg')) {
    continue;
  }
  const svg = readFileSync(join(iconsDir, file), 'utf8');
  const key = file.replace(/\.svg$/, '');
  // a mask needs a solid color to tint: empty color sets (embedded rasters
  // like the aider avatar) and brand-tone colors render as images
  const colors = distinctColors(svg);
  const mask = colors.size > 0 && [...colors].every(isNeutral);
  entries.push({ key, mask, uri: uriOf(svg) });
}

const lines = [
  '/* AUTO-GENERATED from assets/icons/ by scripts/generate-agent-icons.mjs —',
  '   do not edit; run `npm run generate:icons` after swapping icons. */',
  'export interface AgentIconAsset {',
  '  uri: string;',
  '  mask: boolean;',
  '}',
  '',
  'export const AGENT_ICON_ASSETS: Record<string, AgentIconAsset> = {',
  ...entries.map(
    (e) => `  ${JSON.stringify(e.key)}: { uri: ${JSON.stringify(e.uri)}, mask: ${e.mask} },`,
  ),
  '};',
  '',
];

writeFileSync(outFile, lines.join('\n'));
console.log(`generated ${entries.length} icons -> ${outFile}`);
for (const e of entries) {
  console.log(`  ${e.key.padEnd(12)} ${e.mask ? 'mask' : 'image'}`);
}
