#!/usr/bin/env node
/* Rewrites every asset in assets/icons/ to a 16x16 SVG:
   - normalizes each SVG's viewBox to 0 0 16 16 (content fitted and centered)
   - converts raster assets (aider.png) into SVG files with the image
     embedded, then removes the PNG
   Idempotent: already-16x16 SVGs are left untouched. */
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'assets', 'icons');
const SIZE = 16;

/* Presentational attributes that may live on the root <svg> (fill,
   fill-rule, currentColor, ...) and must survive the rewrap onto the group,
   or the inner paths lose their paint. */
const ROOT_ATTRS = [
  'fill',
  'fill-rule',
  'clip-rule',
  'stroke',
  'stroke-width',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-opacity',
  'color',
  'opacity',
];

function rootAttrs(openTag) {
  const parts = [];
  for (const attr of ROOT_ATTRS) {
    const m = new RegExp(`${attr}\\s*=\\s*["']([^"']*)["']`).exec(openTag);
    if (m) {
      parts.push(`${attr}="${m[1]}"`);
    }
  }
  return parts.join(' ');
}

function fit(viewBox) {
  const [x, y, w, h] = viewBox.map(Number);
  const s = SIZE / Math.max(w, h);
  const tx = (SIZE - w * s) / 2 - x * s;
  const ty = (SIZE - h * s) / 2 - y * s;
  return { scale: s, tx, ty };
}

function wrap(inner, transform, attrs) {
  const inherited = attrs ? ` ${attrs}` : '';
  const group = transform
    ? `<g transform="translate(${transform.tx} ${transform.ty}) scale(${transform.scale})"${inherited}>${inner}</g>`
    : `<g${inherited}>${inner}</g>`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">` +
    group +
    '</svg>'
  );
}

for (const file of readdirSync(iconsDir).sort()) {
  const path = join(iconsDir, file);
  if (extname(file) === '.png') {
    const b64 = readFileSync(path).toString('base64');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" width="${SIZE}" height="${SIZE}">` +
      `<image href="data:image/png;base64,${b64}" width="${SIZE}" height="${SIZE}"/></svg>`;
    writeFileSync(join(iconsDir, basename(file, '.png') + '.svg'), svg);
    rmSync(path);
    console.log(`${file} -> ${basename(file, '.png')}.svg (embedded, ${SIZE}x${SIZE})`);
    continue;
  }
  if (extname(file) !== '.svg') {
    continue;
  }
  const original = readFileSync(path, 'utf8');
  const vb = /viewBox=["']([^"']+)["']/.exec(original);
  if (!vb) {
    console.log(`${file}: no viewBox, skipping`);
    continue;
  }
  const viewBox = vb[1].trim().split(/\s+/).map(Number);
  if (viewBox[2] === SIZE && viewBox[3] === SIZE) {
    console.log(`${file}: already ${SIZE}x${SIZE}`);
    continue;
  }
  const openTag = /<svg([^>]*)>/i.exec(original);
  const inner = original.replace(/^<svg[^>]*>/i, '').replace(/<\/svg>\s*$/i, '');
  const normalized = wrap(inner, fit(viewBox), rootAttrs(openTag ? openTag[1] : ''));
  writeFileSync(path, normalized);
  console.log(`${file}: viewBox ${vb[1]} -> ${SIZE}x${SIZE}`);
}
