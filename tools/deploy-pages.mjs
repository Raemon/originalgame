#!/usr/bin/env node
/*
 * Publish the game to GitHub Pages by committing the single-file builds to the gh-pages branch:
 *   index.html  <- dist/isogyre.html   (the game)
 *   widget.html <- dist/widget.html    (the embeddable auto-height build)
 *   .nojekyll
 * Builds first, writes the commit with git plumbing (your working tree and branch are left
 * alone), then pushes it as a fast-forward of the remote gh-pages branch.
 *
 *   node tools/deploy-pages.mjs [remote=origin]
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const remote = process.argv[2] || 'origin';
const git = (args, input) => execFileSync('git', args, { cwd: root, input, encoding: 'utf8' }).trim();

execFileSync(process.execPath, [path.join(root, 'tools', 'build.mjs')], { stdio: 'inherit' });

const blob = (file) => git(['hash-object', '-w', file]);
const tree = git(['mktree'], [
  `100644 blob ${blob('dist/isogyre.html')}\tindex.html`,
  `100644 blob ${blob('dist/widget.html')}\twidget.html`,
  `100644 blob ${git(['hash-object', '-w', '--stdin'], '')}\t.nojekyll`,
].join('\n') + '\n');

let parent = null;
try {
  git(['fetch', '-q', remote, 'gh-pages']);
  parent = git(['rev-parse', 'FETCH_HEAD']);
} catch {
  // first deploy: no gh-pages branch yet
}
if (parent && git(['rev-parse', `${parent}^{tree}`]) === tree) {
  console.log('gh-pages is already up to date.');
  process.exit(0);
}
const source = git(['rev-parse', '--short', 'HEAD']);
const commit = git(['commit-tree', tree, ...(parent ? ['-p', parent] : []), '-m', `Deploy ${source} to GitHub Pages`]);
git(['push', remote, `${commit}:refs/heads/gh-pages`]);
console.log(`Pushed ${commit.slice(0, 7)} (built from ${source}) to ${remote}/gh-pages.`);
