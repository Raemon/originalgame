#!/usr/bin/env node
/*
 * Inline index.html + src/* into single-file builds:
 *   dist/isogyre.html   a complete standalone page (open it straight from disk)
 *   dist/fragment.html  the same page without <html>/<head>/<body>, for hosts that supply
 *                       their own document skeleton
 */
import fs from 'node:fs';
import path from 'node:path';
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

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'isogyre.html'), standalone);
fs.writeFileSync(path.join(root, 'dist', 'fragment.html'), fragment);
const kb = (s) => (Buffer.byteLength(s) / 1024).toFixed(1) + ' KB';
console.log(`dist/isogyre.html  ${kb(standalone)}  (${scripts.length} scripts inlined)`);
console.log(`dist/fragment.html ${kb(fragment)}`);
