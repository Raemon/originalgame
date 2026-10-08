#!/usr/bin/env node
/*
 * Inline index.html + src/* into single-file builds:
 *   dist/isogyre.html   a complete standalone page (open it straight from disk)
 *   dist/fragment.html  the same page without <html>/<head>/<body>, for hosts that supply
 *                       their own document skeleton
 *   dist/widget.html    a minified fragment for embedding in an auto-height iframe (e.g. a
 *                       blog-post widget): its height is derived from its width
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

const title = html.match(/<title>[\s\S]*?<\/title>/)[0];
const description = (html.match(/<meta name="description"[^>]*>/) || [''])[0];
const fontLinks = [...html.matchAll(/<link rel="(?:preconnect|stylesheet)" href="https:\/\/fonts\.[^>]*>/g)].map((m) => m[0]);
const cssHref = html.match(/<link rel="stylesheet" href="(src\/[^"]+\.css)">/)[1];
const css = read(cssHref);
const scripts = [...html.matchAll(/<script src="(src\/[^"]+\.js)"><\/script>/g)].map((m) => m[1]);
const body = html
  .match(/<body>([\s\S]*)<\/body>/)[1]
  .replace(/<script src="src\/[^"]+\.js"><\/script>\s*/g, '')
  .trim();

const js = scripts
  .map((src) => `<script>\n/* ${src} */\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`)
  .join('\n');
const style = `<style>\n${css}\n</style>`;

const standalone = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, user-scalable=no">
${title}
${description}
${fontLinks.join('\n')}
${style}
</head>
<body>
${body}
${js}
</body>
</html>
`;

const fragment = `${title}
${fontLinks.join('\n')}
${style}
${body}
${js}
`;

// ---- widget: the host iframe takes its height from <body>, so size the body from the width
const widgetCss = `
html, body { height: auto; }
body { height: clamp(380px, 80vw, 620px); }
@media (max-width: 559px) { body { height: min(175vw, 720px); } }
`;
const minifyCss = (c) => c.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ').replace(/\s*([{}:;,>])\s*/g, '$1').trim();
function minifiedScripts() {
  const bun = process.env.BUN || [path.join(os.homedir(), '.bun', 'bin', 'bun'), 'bun'].find((b) => {
    try { return spawnSync(b, ['--version']).status === 0; } catch { return false; }
  });
  if (!bun) return null;
  const r = spawnSync(bun, [path.join(root, 'tools', 'minify.ts'), ...scripts.map((s) => path.join(root, s))], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) { console.warn('minify failed, using unminified scripts:\n' + r.stderr); return null; }
  return JSON.parse(r.stdout);
}
const mins = minifiedScripts();
// Some hosts percent-decode widget content, turning a minified `x%10` into a control character.
// `x % 10` is the same expression, so keep `%` from ever being followed by two hex digits.
const noPercentEscapes = (code) => code.replace(/%(?=[0-9A-Fa-f]{2})/g, '% ');
const widgetJs = mins
  ? `<script>${noPercentEscapes(mins.join('\n')).replace(/<\/script/gi, '<\\/script')}</script>`
  : js;
const widget = `${fontLinks.filter((l) => l.includes('stylesheet')).join('\n')}
<style>${minifyCss(css + widgetCss)}</style>
${body.replace(/>\s+</g, '><')}
${widgetJs}
`;

const escapes = widget.match(/%[0-9A-Fa-f]{2}/g);
if (escapes) throw new Error(`dist/widget.html contains percent-escape-like text (${escapes.join(', ')})`);

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'isogyre.html'), standalone);
fs.writeFileSync(path.join(root, 'dist', 'fragment.html'), fragment);
fs.writeFileSync(path.join(root, 'dist', 'widget.html'), widget);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`dist/isogyre.html  ${kb(standalone)}  (${scripts.length} scripts inlined)`);
console.log(`dist/fragment.html ${kb(fragment)}`);
console.log(`dist/widget.html   ${kb(widget)}${mins ? ' (minified)' : ' (unminified: Bun not found)'}`);
