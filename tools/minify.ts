// Whitespace-only minification of classic scripts (identifiers and top-level names are kept,
// since the game's files share one global scope). Used by tools/build.mjs when Bun is available.
//   bun tools/minify.ts a.js b.js ...   -> JSON array of minified sources on stdout
const t = new Bun.Transpiler({
  loader: 'js', minifyWhitespace: true, minifySyntax: false, minifyIdentifiers: false,
  deadCodeElimination: false, treeShaking: false,
} as any);
const out: string[] = [];
for (const f of process.argv.slice(2)) out.push("'use strict';" + t.transformSync(await Bun.file(f).text()));
console.log(JSON.stringify(out));
